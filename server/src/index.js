import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import socketHandler from './sockets/index.js';
import notesRoute from './routes/notes.js';
import versionsRoute from './routes/versions.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/notes', notesRoute);
app.use('/api/versions', versionsRoute);

// Socket.io Setup
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST']
    }
});

socketHandler(io);

// Basic Route
app.get('/', (req, res) => {
    res.send('Real-Time Notes API is running');
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
