import { pipeline } from '@xenova/transformers';
import Note from '../models/Note.js';
import NoteChunk from '../models/NoteChunk.js';

const EMBEDDING_DIMENSIONS = 384;
const CHUNK_SIZE = 500;   // chars per chunk
const CHUNK_OVERLAP = 100; // overlap between adjacent chunks

// Singleton pipeline — caches the loading Promise so concurrent callers share one load
let extractorPromise = null;

async function getExtractor() {
    if (!extractorPromise) {
        console.log('[RAG] Loading embedding model (all-MiniLM-L6-v2)... first load may take a moment.');
        extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        extractorPromise.then(() => console.log('[RAG] Embedding model loaded successfully.'));
    }
    return extractorPromise;
}

/**
 * Generate an embedding vector for the given text using all-MiniLM-L6-v2.
 * Returns an array of 384 floats (mean-pooled, normalized).
 */
export async function generateEmbedding(text) {
    if (!text || !text.trim()) {
        return new Array(EMBEDDING_DIMENSIONS).fill(0);
    }

    // MiniLM has a 256-token context window; truncate to ~1500 chars to stay safe
    const truncated = text.slice(0, 1500);

    const extractor = await getExtractor();
    const output = await extractor(truncated, { pooling: 'mean', normalize: true });

    return Array.from(output.data);
}

/**
 * Split text into overlapping chunks, breaking on word boundaries.
 * Returns an array of non-empty chunk strings.
 */
export function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
    if (!text || !text.trim()) return [];
    const trimmed = text.trim();
    if (trimmed.length <= chunkSize) return [trimmed];

    const chunks = [];
    let start = 0;

    while (start < trimmed.length) {
        let end = start + chunkSize;

        // Don't cut in the middle of a word — walk back to last space
        if (end < trimmed.length) {
            const lastSpace = trimmed.lastIndexOf(' ', end);
            if (lastSpace > start) end = lastSpace;
        } else {
            end = trimmed.length;
        }

        chunks.push(trimmed.slice(start, end).trim());

        // Advance by (chunkSize - overlap), but at least 1 char to avoid infinite loop
        const step = Math.max(end - start - overlap, 1);
        start += step;
    }

    return chunks.filter(c => c.length > 0);
}

/**
 * Chunk a note's text content, embed each chunk, and persist to the NoteChunk collection.
 * Replaces all existing chunks for the given note (delete + insert).
 * Designed to be called fire-and-forget (errors are logged, not thrown).
 *
 * @param {string} noteId - The note's ObjectId
 * @param {string} ownerId - The note owner's ObjectId (denormalized into chunks)
 * @param {Array} sharedWith - Array of ObjectIds the note is shared with
 * @param {string} title - Note title
 * @param {string} content - Note content
 */
export async function updateNoteChunks(noteId, ownerId, sharedWith, title, content) {
    try {
        const combinedText = `${title || 'Untitled Note'}\n\n${content || ''}`.trim();

        if (!combinedText || combinedText === 'Untitled Note') {
            // Empty note — remove any existing chunks
            await NoteChunk.deleteMany({ noteId });
            return;
        }

        const chunks = chunkText(combinedText);

        // Generate embeddings for all chunks in parallel
        const embeddings = await Promise.all(
            chunks.map(chunk => generateEmbedding(chunk))
        );

        // Atomic replace: delete old chunks then insert new ones
        await NoteChunk.deleteMany({ noteId });

        const chunkDocs = chunks.map((chunk, index) => ({
            noteId,
            ownerId,
            sharedWith: sharedWith || [],
            chunkIndex: index,
            content: chunk,
            embedding: embeddings[index],
        }));

        if (chunkDocs.length > 0) {
            await NoteChunk.insertMany(chunkDocs);
        }

        console.log(`[RAG] Chunked note ${noteId} into ${chunkDocs.length} chunks (${CHUNK_SIZE} chars, ${CHUNK_OVERLAP} overlap)`);
    } catch (error) {
        console.error(`[RAG] Failed to update chunks for note ${noteId}:`, error.message);
    }
}

/**
 * Delete all chunks for a note. Call when a note is deleted.
 */
export async function deleteNoteChunks(noteId) {
    try {
        const result = await NoteChunk.deleteMany({ noteId });
        console.log(`[RAG] Deleted ${result.deletedCount} chunks for note ${noteId}`);
    } catch (error) {
        console.error(`[RAG] Failed to delete chunks for note ${noteId}:`, error.message);
    }
}

/**
 * Sync the sharedWith array on all chunks when a note's sharing changes.
 * This keeps the denormalized access control in sync for vector search filtering.
 */
export async function syncChunkAccess(noteId, sharedWith) {
    try {
        await NoteChunk.updateMany(
            { noteId },
            { $set: { sharedWith } }
        );
        console.log(`[RAG] Synced chunk access for note ${noteId}`);
    } catch (error) {
        console.error(`[RAG] Failed to sync chunk access for note ${noteId}:`, error.message);
    }
}

/**
 * Search for semantically similar chunks accessible by the given user.
 * Uses MongoDB Atlas Vector Search ($vectorSearch) on the NoteChunk collection.
 * Groups results by parent note, returning the best chunk per note.
 *
 * @param {string} queryText - The search query text
 * @param {string} userId - The user's ObjectId string
 * @param {number} limit - Max chunk results to retrieve (default 10)
 * @returns {Array} Array of { noteId, noteTitle, chunkContent, score } objects
 */
export async function searchSimilarChunks(queryText, userId, limit = 10) {
    try {
        const queryEmbedding = await generateEmbedding(queryText);

        const results = await NoteChunk.aggregate([
            {
                $vectorSearch: {
                    index: 'chunk_embedding_index',
                    path: 'embedding',
                    queryVector: queryEmbedding,
                    numCandidates: limit * 10,
                    limit: limit,
                    filter: {
                        $or: [
                            { ownerId: NoteChunk.base.Types.ObjectId.createFromHexString(userId) },
                            { sharedWith: NoteChunk.base.Types.ObjectId.createFromHexString(userId) }
                        ]
                    }
                }
            },
            {
                $project: {
                    noteId: 1,
                    chunkIndex: 1,
                    content: 1,
                    score: { $meta: 'vectorSearchScore' }
                }
            }
        ]);

        // Filter out low-relevance results
        const MIN_SCORE_THRESHOLD = 0.6;
        const filtered = results.filter(r => r.score >= MIN_SCORE_THRESHOLD);

        // Deduplicate by noteId — keep only the highest-scoring chunk per note
        const bestByNote = new Map();
        for (const chunk of filtered) {
            const nid = chunk.noteId.toString();
            if (!bestByNote.has(nid) || chunk.score > bestByNote.get(nid).score) {
                bestByNote.set(nid, chunk);
            }
        }

        // Enrich with parent note title for display
        const noteIds = [...bestByNote.keys()];
        const notes = await Note.find({ _id: { $in: noteIds } }).select('title').lean();
        const titleMap = new Map(notes.map(n => [n._id.toString(), n.title]));

        const enriched = [...bestByNote.values()].map(chunk => ({
            noteId: chunk.noteId,
            noteTitle: titleMap.get(chunk.noteId.toString()) || 'Untitled',
            chunkContent: chunk.content,
            chunkIndex: chunk.chunkIndex,
            score: chunk.score,
        }));

        console.log(`[RAG] Chunk search returned ${results.length} chunks → ${filtered.length} above threshold → ${enriched.length} unique notes for query: "${queryText.slice(0, 50)}..."`);
        return enriched;
    } catch (error) {
        console.error('[RAG] Chunk vector search failed:', error.message);
        // Graceful fallback: return empty results so the AI still works without RAG
        return [];
    }
}

/**
 * Backward-compatible wrapper: search and return note-level results for the dashboard.
 * Groups chunks by note and returns the parent note's full title + content preview.
 */
export async function searchSimilarNotes(queryText, userId, limit = 5) {
    try {
        const chunkResults = await searchSimilarChunks(queryText, userId, limit * 2);

        // Get unique noteIds, ordered by best chunk score
        const seen = new Set();
        const uniqueNoteIds = [];
        for (const r of chunkResults) {
            const nid = r.noteId.toString();
            if (!seen.has(nid)) {
                seen.add(nid);
                uniqueNoteIds.push({ noteId: r.noteId, score: r.score });
            }
            if (uniqueNoteIds.length >= limit) break;
        }

        // Fetch full note data for the results
        const notes = await Note.find({ _id: { $in: uniqueNoteIds.map(u => u.noteId) } })
            .select('title content')
            .lean();

        const noteMap = new Map(notes.map(n => [n._id.toString(), n]));
        const scoreMap = new Map(uniqueNoteIds.map(u => [u.noteId.toString(), u.score]));

        return notes.map(n => ({
            _id: n._id,
            title: n.title,
            content: n.content,
            score: scoreMap.get(n._id.toString()) || 0,
        })).sort((a, b) => b.score - a.score);
    } catch (error) {
        console.error('[RAG] Note-level search failed:', error.message);
        return [];
    }
}
