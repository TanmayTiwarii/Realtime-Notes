import Groq from 'groq-sdk';
import Note from '../models/Note.js';
import { searchSimilarChunks } from '../services/embeddings.js';
import {
    initSession,
    receiveOp,
    removeClient,
    getDocument
} from '../services/otManager.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const socketHandler = (io) => {
    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // Track which notes this socket has joined (for cleanup on disconnect)
        const joinedNotes = new Set();

        // Join a specific note room
        socket.on('join-note', async (noteId, user) => {
            socket.join(noteId);
            joinedNotes.add(noteId);

            if (user) {
                socket.userId = user.id || user.uid || user._id;
                socket.userEmail = user.email;
            }
            console.log(`User ${user?.email || socket.id} joined note: ${noteId}`);

            // Notify others in the room
            socket.to(noteId).emit('user-joined', user);

            // Initialize OT session and send current document state
            try {
                const { document, revision } = await initSession(noteId, socket.id);
                socket.emit('doc-sync', { content: document, revision });
            } catch (err) {
                console.error(`[OT] Failed to init session for note ${noteId}:`, err);
                socket.emit('ot-error', { message: 'Failed to sync document' });
            }
        });

        // ── OT operation submission ────────────────────────────────

        socket.on('submit-op', ({ noteId, revision, op }) => {
            const result = receiveOp(noteId, revision, op);

            if (result.ok) {
                // Acknowledge the sender with the new revision
                socket.emit('op-ack', {
                    noteId,
                    revision: result.revision
                });

                // Broadcast the transformed op to all other clients in the room
                socket.to(noteId).emit('apply-op', {
                    noteId,
                    op: result.op,
                    revision: result.revision
                });
            } else {
                console.warn(`[OT] Op rejected for note ${noteId}:`, result.error);
                // Tell the client to re-sync
                const state = getDocument(noteId);
                if (state) {
                    socket.emit('doc-sync', {
                        content: state.document,
                        revision: state.revision
                    });
                }
            }
        });

        // ── Title editing (last-write-wins) ────────────────────────

        socket.on('edit-title', async (noteId, newTitle) => {
            socket.to(noteId).emit('title-updated', newTitle);
            try {
                await Note.updateOne({ _id: noteId }, { $set: { title: newTitle } });
            } catch (err) {
                console.error('Error saving title:', err);
            }
        });

        // Handle live drawing progress relay
        socket.on('draw-progress', (noteId, stroke) => {
            socket.to(noteId).emit('stroke-progress', stroke);
        });

        // Handle drawing stroke addition
        socket.on('draw-stroke', async (noteId, stroke) => {
            socket.to(noteId).emit('stroke-drawn', stroke);
            try {
                await Note.findByIdAndUpdate(noteId, { $push: { drawings: stroke } });
            } catch (err) {
                console.error('Error saving drawing stroke:', err);
            }
        });

        // Handle drawing stroke deletion
        socket.on('delete-stroke', async (noteId, strokeId) => {
            socket.to(noteId).emit('stroke-deleted', strokeId);
            try {
                await Note.findByIdAndUpdate(noteId, { $pull: { drawings: { id: strokeId } } });
            } catch (err) {
                console.error('Error deleting drawing stroke:', err);
            }
        });

        // Handle full canvas clear
        socket.on('clear-drawings', async (noteId) => {
            socket.to(noteId).emit('drawings-cleared');
            try {
                await Note.findByIdAndUpdate(noteId, { $set: { drawings: [] } });
            } catch (err) {
                console.error('Error clearing drawings:', err);
            }
        });

        // Handle group chat messages
        socket.on('send-chat', async (noteId, messageData) => {
            try {
                const { sender, content } = messageData;
                if (!content || !content.trim()) return;

                const userMessage = {
                    sender,
                    content,
                    isAi: false,
                    createdAt: new Date()
                };

                // Extremely optimized atomic update appending chat arrays while stripping massive drawing memory footprint
                const updatedNote = await Note.findByIdAndUpdate(
                    noteId,
                    { $push: { messages: userMessage } },
                    { new: true, select: 'messages content' }
                );

                if (!updatedNote) return;

                // Retrieve hydrated subdocument containing newly assigned _id
                const savedUserMessage = updatedNote.messages[updatedNote.messages.length - 1];

                // Relay instantly across note room channels
                socket.to(noteId).emit('chat-message', savedUserMessage);

                // Check AI mention triggers
                if (content.toLowerCase().includes('@ai')) {
                    io.to(noteId).emit('ai-typing', true);

                    // Constrain token payloads cleanly to eliminate API queue bottlenecks
                    const recentMessages = updatedNote.messages.slice(-8).map(m => `[${m.sender}]: ${m.content}`).join('\n');
                    
                    // Always read the live in-memory OT document so AI sees real-time edits
                    const liveDoc = getDocument(noteId)?.document;
                    const documentContent = (liveDoc !== undefined && liveDoc !== null ? liveDoc : updatedNote.content) || '';
                    const truncatedContent = documentContent.slice(0, 3500);

                    // Clean prompt for semantic RAG search (strip '@ai')
                    const cleanQuery = content.replace(/@ai\b/gi, '').trim();

                    // --- RAG: Retrieve relevant chunks from vector search across other workspace notes ---
                    let ragContext = '';
                    try {
                        const userId = socket.userId;
                        if (userId && cleanQuery.length > 2) {
                            const relevantChunks = await searchSimilarChunks(cleanQuery, userId.toString(), 6);
                            // Exclude chunks from current note since current note content is already injected directly
                            const otherNotesChunks = relevantChunks.filter(c => c.noteId.toString() !== noteId.toString());
                            if (otherNotesChunks.length > 0) {
                                ragContext = '\n\nRelevant Passages from Other Workspace Notes:\n' +
                                    otherNotesChunks.map((c, i) => 
                                        `--- Passage ${i + 1} (from "${c.noteTitle}") ---\n${c.chunkContent}`
                                    ).join('\n\n');
                                console.log(`[RAG] Injected ${otherNotesChunks.length} relevant chunks into AI context for query: "${cleanQuery}"`);
                            }
                        }
                    } catch (ragError) {
                        console.error('[RAG] Retrieval failed, proceeding without RAG:', ragError.message);
                    }

                    const prompt = `You are a helpful AI assistant embedded in a shared collaborative workspace note.
The user asking you a question is: ${sender}

User Question:
"${cleanQuery || content}"

Current Document Content:
"""
${truncatedContent || '(Empty document)'}
"""${ragContext}

Recent Chat History:
${recentMessages}

Instructions:
1. Respond directly to the user's question in a clear, friendly, and helpful tone.
2. If the user asks about the current note (e.g. summarize, critique, expand, analyze), use the "Current Document Content" above.
3. If relevant passages from other workspace notes were provided, synthesize that knowledge and mention the source note title when helpful.
4. Keep responses concise, well-structured, and accurate.`;

                    // Run inference logic asynchronously
                    const response = await groq.chat.completions.create({
                        messages: [
                            { role: 'system', content: 'You are a helpful and expert AI assistant embedded in a shared notes workspace group chat.' },
                            { role: 'user', content: prompt }
                        ],
                        model: 'qwen/qwen3.8-27b',
                    });

                    const aiResponseText = response.choices[0]?.message?.content || "I'm processing the context streams!";

                    const aiMessage = {
                        sender: 'AI Assistant',
                        content: aiResponseText,
                        isAi: true,
                        createdAt: new Date()
                    };

                    // Persist inference text atomically
                    const finalNote = await Note.findByIdAndUpdate(
                        noteId,
                        { $push: { messages: aiMessage } },
                        { new: true, select: 'messages' }
                    );

                    const savedAiMessage = finalNote.messages[finalNote.messages.length - 1];

                    io.to(noteId).emit('ai-typing', false);
                    io.to(noteId).emit('chat-message', savedAiMessage);
                }
            } catch (error) {
                console.error('Error handling chat message:', error);
                io.to(noteId).emit('ai-typing', false);

                // Send error feedback so the user knows the AI failed
                const errorMsg = {
                    sender: 'AI Assistant',
                    content: `Sorry, I encountered an error and couldn't respond. (${error.message || 'Unknown error'})`,
                    isAi: true,
                    createdAt: new Date()
                };
                const errorNote = await Note.findByIdAndUpdate(
                    noteId,
                    { $push: { messages: errorMsg } },
                    { new: true, select: 'messages' }
                );
                if (errorNote) {
                    const savedErrorMsg = errorNote.messages[errorNote.messages.length - 1];
                    io.to(noteId).emit('chat-message', savedErrorMsg);
                }
            }
        });

        // Leave note room
        socket.on('leave-note', async (noteId) => {
            socket.leave(noteId);
            joinedNotes.delete(noteId);
            console.log(`User left note: ${noteId}`);
            socket.to(noteId).emit('user-left', socket.userId || socket.id);

            // Remove from OT session
            await removeClient(noteId, socket.id);
        });

        socket.on('disconnect', async () => {
            console.log('User disconnected:', socket.id);

            // Clean up all OT sessions this socket was part of
            for (const noteId of joinedNotes) {
                await removeClient(noteId, socket.id);
            }
            joinedNotes.clear();
        });
    });
};

export default socketHandler;