import Groq from 'groq-sdk';
import Note from '../models/Note.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const socketHandler = (io) => {
    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // Join a specific note room
        socket.on('join-note', (noteId, user) => {
            socket.join(noteId);
            if (user) {
                socket.userId = user.id || user.uid || user._id;
            }
            console.log(`User ${user?.email || socket.id} joined note: ${noteId}`);

            // Notify others in the room
            socket.to(noteId).emit('user-joined', user);
        });

        // Handle note edits
        socket.on('edit-note', (noteId, content) => {
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

                const note = await Note.findById(noteId);
                if (!note) return;

                const userMessage = {
                    sender,
                    content,
                    isAi: false,
                    createdAt: new Date()
                };

                note.messages.push(userMessage);
                await note.save();

                // Get the saved message with its _id
                const savedUserMessage = note.messages[note.messages.length - 1];

                // Broadcast user message to others in the room
                socket.to(noteId).emit('chat-message', savedUserMessage);

                // Check if @ai is mentioned
                if (content.toLowerCase().includes('@ai')) {
                    // Notify room that AI is thinking
                    io.to(noteId).emit('ai-typing', true);

                    // Build context from recent chat messages and note content
                    const recentMessages = note.messages.slice(-10).map(m => `[${m.sender}] says: ${m.content}`).join('\n');
                    const prompt = `You are an AI assistant participating in a group chat inside a shared collaborative document.
The user asking you the question right now is: ${sender}

Current Document Content:
"""
${note.content}
"""

Recent Chat History:
${recentMessages}

Instructions:
1. Respond directly to the latest question/message from the user (${sender}) in a friendly, conversational tone.
2. Do not start your response by repeating their email address or saying "As user@example.com asked". Address them directly as "you" or speak to the group naturally.
3. Be concise and helpful.`;

                    const response = await groq.chat.completions.create({
                        messages: [
                            { role: 'system', content: 'You are a helpful and expert AI assistant embedded in a shared notes workspace group chat.' },
                            { role: 'user', content: prompt }
                        ],
                        model: 'llama-3.1-8b-instant',
                    });

                    const aiResponseText = response.choices[0]?.message?.content || "I'm here to help!";

                    const aiMessage = {
                        sender: 'AI Assistant',
                        content: aiResponseText,
                        isAi: true,
                        createdAt: new Date()
                    };

                    note.messages.push(aiMessage);
                    await note.save();

                    const savedAiMessage = note.messages[note.messages.length - 1];

                    // Broadcast AI message to everyone in the room
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
        });
    });
};

export default socketHandler;

