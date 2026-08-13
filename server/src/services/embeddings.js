import { pipeline } from '@xenova/transformers';
import Note from '../models/Note.js';

const EMBEDDING_DIMENSIONS = 384;

// Singleton pipeline — initialized once on first call, reused thereafter
let extractorPipeline = null;

async function getExtractor() {
    if (!extractorPipeline) {
        console.log('[RAG] Loading embedding model (all-MiniLM-L6-v2)... first load may take a moment.');
        extractorPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('[RAG] Embedding model loaded successfully.');
    }
    return extractorPipeline;
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
 * Generate and persist the embedding for a note.
 * Combines title + content for richer semantic signal.
 * This is designed to be called fire-and-forget (errors are logged, not thrown).
 */
export async function updateNoteEmbedding(noteId, title, content) {
    try {
        const combinedText = `${title || 'Untitled Note'}\n\n${content || ''}`.trim();

        if (!combinedText || combinedText === 'Untitled Note') {
            // Skip embedding for empty notes
            return;
        }

        const embedding = await generateEmbedding(combinedText);

        await Note.updateOne(
            { _id: noteId },
            {
                $set: {
                    embedding: embedding,
                    embeddingUpdatedAt: new Date()
                }
            }
        );

        console.log(`[RAG] Embedding updated for note ${noteId} (${embedding.length} dims)`);
    } catch (error) {
        console.error(`[RAG] Failed to update embedding for note ${noteId}:`, error.message);
    }
}

/**
 * Search for semantically similar notes accessible by the given user.
 * Uses MongoDB Atlas Vector Search ($vectorSearch aggregation stage).
 * Returns top-k notes with their similarity scores.
 *
 * @param {string} queryText - The search query text
 * @param {string} userId - The user's ObjectId string
 * @param {number} limit - Max results to return (default 5)
 * @returns {Array} Array of { _id, title, content, score } objects
 */
export async function searchSimilarNotes(queryText, userId, limit = 5) {
    try {
        const queryEmbedding = await generateEmbedding(queryText);

        const results = await Note.aggregate([
            {
                $vectorSearch: {
                    index: 'note_embedding_index',
                    path: 'embedding',
                    queryVector: queryEmbedding,
                    numCandidates: limit * 10,
                    limit: limit,
                    filter: {
                        $or: [
                            { ownerId: Note.base.Types.ObjectId.createFromHexString(userId) },
                            { sharedWith: Note.base.Types.ObjectId.createFromHexString(userId) }
                        ]
                    }
                }
            },
            {
                $project: {
                    title: 1,
                    content: 1,
                    score: { $meta: 'vectorSearchScore' }
                }
            }
        ]);

        console.log(`[RAG] Vector search returned ${results.length} results for query: "${queryText.slice(0, 50)}..."`);
        return results;
    } catch (error) {
        console.error('[RAG] Vector search failed:', error.message);
        // Graceful fallback: return empty results so the AI still works without RAG
        return [];
    }
}
