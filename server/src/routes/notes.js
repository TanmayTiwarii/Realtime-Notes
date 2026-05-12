import express from 'express';
import verifyToken from '../middleware/auth.js';
import Note from '../models/Note.js';
import User from '../models/User.js';

const router = express.Router();


// Create a new note
router.post('/', verifyToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        const userId = req.user._id;

        console.log(`Creating note for user: ${req.user.email}`);
        const note = await Note.create({
            title: title || 'Untitled Note',
            content: content || '',
            ownerId: userId,
            sharedWith: []
        });
        console.log('Note created:', note._id);

        res.status(201).json({ id: note._id, message: 'Note created' });
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all notes for a user (owned + shared)
router.get('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user._id;

        const notes = await Note.find({
            $or: [
                { ownerId: userId },
                { sharedWith: userId }
            ]
        }).select('-messages').populate('ownerId', 'email').lean();

        const enrichedNotes = notes.map(n => ({
            id: n._id, // map _id to id for frontend
            ...n,
            ownerEmail: n.ownerId ? n.ownerId.email : 'Unknown',
            ownerId: n.ownerId ? n.ownerId._id : null
        }));

        res.json(enrichedNotes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a single note
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const userId = req.user._id.toString();
        
        const note = await Note.findById(noteId).lean();

        if (!note) {
            return res.status(404).json({ message: 'Note not found' });
        }

        const isOwner = note.ownerId.toString() === userId;
        const isShared = note.sharedWith.some(id => id.toString() === userId);

        if (!isOwner && !isShared) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        res.json({ id: note._id, ...note });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update a note
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const { title, content, drawings } = req.body;
        const userId = req.user._id.toString();

        const note = await Note.findById(noteId);

        if (!note) {
            return res.status(404).json({ message: 'Note not found' });
        }

        const isOwner = note.ownerId.toString() === userId;
        const isShared = note.sharedWith.some(id => id.toString() === userId);

        if (!isOwner && !isShared) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        if (title !== undefined) note.title = title;
        if (content !== undefined) note.content = content;
        if (drawings !== undefined) note.drawings = drawings;
        
        await note.save();

        res.json({ message: 'Note updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a note
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const userId = req.user._id.toString();

        const note = await Note.findById(noteId);

        if (!note) {
            return res.status(404).json({ message: 'Note not found' });
        }

        if (note.ownerId.toString() !== userId) {
            return res.status(403).json({ message: 'Only owner can delete' });
        }

        await note.deleteOne();
        res.json({ message: 'Note deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Share a note
router.post('/:id/share', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const { email } = req.body;
        const userId = req.user._id.toString();

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const note = await Note.findById(noteId);

        if (!note) {
            return res.status(404).json({ message: 'Note not found' });
        }

        if (note.ownerId.toString() !== userId) {
            return res.status(403).json({ message: 'Only owner can share' });
        }

        // Lookup user by email in MongoDB
        const shareUser = await User.findOne({ email });
        
        if (!shareUser) {
            return res.status(404).json({ message: 'User not found with that email. They must log in to the app first.' });
        }

        if (!note.sharedWith.includes(shareUser._id)) {
            note.sharedWith.push(shareUser._id);
            await note.save();
        }

        res.json({ message: `Shared with ${email}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
