const socketHandler = (io) => {
    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);

        // Join a specific note room
        socket.on('join-note', (noteId, user) => {
            socket.join(noteId);
            console.log(`User ${user?.email || socket.id} joined note: ${noteId}`);

            // Notify others in the room
            socket.to(noteId).emit('user-joined', user);
        });

        // Handle note edits
        socket.on('edit-note', (noteId, content) => {
            // Broadcast to everyone else in the room
            socket.to(noteId).emit('note-updated', content);
        });

        // Handle cursor position / presence
        socket.on('cursor-move', (noteId, position, user) => {
            socket.to(noteId).emit('cursor-updated', { user, position });
        });

        // Leave note room
        socket.on('leave-note', (noteId) => {
            socket.leave(noteId);
            console.log(`User left note: ${noteId}`);
            socket.to(noteId).emit('user-left', socket.id);
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
        });
    });
};

module.exports = socketHandler;
