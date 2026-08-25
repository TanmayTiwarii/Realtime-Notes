import Groq from 'groq-sdk';
import Note from '../models/Note.js';
import { searchSimilarChunks } from '../services/embeddings.js';
import {
    acquireLock,
    releaseLock,
    isLockHolder,
    renewLock,
    releaseAllForSocket,
    getLockInfo,
    onStaleRelease
} from '../services/lockManager.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const socketHandler = (io) => {
    // When a stale lock is auto-released, broadcast note-unlocked to the room
    onStaleRelease((noteId, holder) => {
        io.to(noteId).emit('note-unlocked', { noteId });
        console.log(`[Lock] Stale unlock broadcast for note ${noteId}`);
    });
    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // Join a specific note room
        socket.on('join-note', (noteId, user) => {
            socket.join(noteId);
            if (user) {
                socket.userId = user.id || user.uid || user._id;
                socket.userEmail = user.email;
            }
            console.log(`User ${user?.email || socket.id} joined note: ${noteId}`);

            // Notify others in the room
            socket.to(noteId).emit('user-joined', user);

            // Send current lock state to the joining client
            const lockInfo = getLockInfo(noteId);
            if (lockInfo) {
                socket.emit('lock-state', {
                    noteId,
                    holder: { userEmail: lockInfo.userEmail, userId: lockInfo.userId }
                });
            }
        });

        // ── Write-lock events ───────────────────────────────────

        socket.on('request-edit-lock', async (noteId) => {
            try {
                // Verify the user has permission to edit this note
                const note = await Note.findById(noteId).select('ownerId sharedWith').lean();
                if (!note) {
                    socket.emit('lock-denied', { noteId, reason: 'Note not found' });
                    return;
                }

                const uid = socket.userId?.toString();
                const isOwner = note.ownerId.toString() === uid;
                const isShared = note.sharedWith.some(id => id.toString() === uid);

                if (!isOwner && !isShared) {
                    socket.emit('lock-denied', { noteId, reason: 'Unauthorized' });
                    return;
                }

                const result = acquireLock(noteId, socket.id, uid, socket.userEmail);

                if (result.granted) {
                    socket.emit('lock-granted', { noteId });
                    socket.to(noteId).emit('note-locked', {
                        noteId,
                        holder: { userEmail: socket.userEmail, userId: uid }
                    });
                    console.log(`[Lock] Granted to ${socket.userEmail} on note ${noteId}`);
                } else {
                    socket.emit('lock-denied', {
                        noteId,
                        holder: result.holder
                    });
                }
            } catch (err) {
                console.error('[Lock] Error processing lock request:', err);
                socket.emit('lock-denied', { noteId, reason: 'Server error' });
            }
        });

        socket.on('release-edit-lock', (noteId) => {
            const released = releaseLock(noteId, socket.id);
            if (released) {
                io.to(noteId).emit('note-unlocked', { noteId });
                console.log(`[Lock] Released by ${socket.userEmail} on note ${noteId}`);
            }
        });

        socket.on('heartbeat-lock', (noteId) => {
            renewLock(noteId, socket.id);
        });

        // Handle note edits — only if sender holds the lock
        socket.on('edit-note', (noteId, content) => {
            if (!isLockHolder(noteId, socket.id)) return;
            // Broadcast to everyone else in the room
            socket.to(noteId).emit('note-updated', content);
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
                    const truncatedContent = updatedNote.content?.slice(0, 2500) || '';

                    // --- RAG: Retrieve relevant chunks from vector search ---
                    let ragContext = '';
                    try {
                        // Get the user ID from the socket (set during join-note)
                        const userId = socket.userId;
                        if (userId) {
                            const relevantChunks = await searchSimilarChunks(content, userId.toString(), 6);
                            if (relevantChunks.length > 0) {
                                ragContext = '\n\nRelevant Passages from Workspace (retrieved via semantic chunk search):\n' +
                                    relevantChunks.map((c, i) => 
                                        `--- Passage ${i + 1} (from "${c.noteTitle}", chunk #${c.chunkIndex}) [score: ${c.score.toFixed(2)}] ---\n${c.chunkContent}`
                                    ).join('\n\n');
                                console.log(`[RAG] Injected ${relevantChunks.length} relevant chunks into AI context`);
                            }
                        }
                    } catch (ragError) {
                        console.error('[RAG] Retrieval failed, proceeding without RAG:', ragError.message);
                    }

                    const prompt = `You are an AI assistant participating in a group chat inside a shared collaborative document.
                    The user asking you the question right now is: ${sender}

                    Current Document Content:
                    """
                    ${truncatedContent}
                    """${ragContext}

                    Recent Chat History:
                    ${recentMessages}

                    Instructions:
                    1. Respond directly to the latest question/message from the user (${sender}) in a friendly, conversational tone.
                    2. Address them directly as "you" or speak to the group naturally.
                    3. Keep responses highly focused, accurate, and concise.
                    4. If relevant passages from the workspace were provided, use that knowledge to give more informed answers. Reference the source note title when helpful.`;

                    // Run inference logic asynchronously
                    const response = await groq.chat.completions.create({
                        messages: [
                            { role: 'system', content: 'You are a helpful and expert AI assistant embedded in a shared notes workspace group chat.' },
                            { role: 'user', content: prompt }
                        ],
                        model: 'llama-3.1-8b-instant',
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
            }
        });

        // Leave note room
        socket.on('leave-note', (noteId) => {
            socket.leave(noteId);
            console.log(`User left note: ${noteId}`);
            socket.to(noteId).emit('user-left', socket.userId || socket.id);
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);

            // Release any locks held by this socket
            const releasedNotes = releaseAllForSocket(socket.id);
            for (const nId of releasedNotes) {
                io.to(nId).emit('note-unlocked', { noteId: nId });
                console.log(`[Lock] Auto-released on disconnect for note ${nId}`);
            }
        });
    });
};

export default socketHandler;

    