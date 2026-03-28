import express from 'express';
import { db, admin } from '../firebase/admin.js';
import verifyToken from '../middleware/auth.js';
const router = express.Router();

// Create a new note
router.post('/', verifyToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        const userId = req.user.uid;

        console.log(`Creating note for user: ${userId}`);
        const noteRef = await db.collection('notes').add({
            title: title || 'Untitled Note',
            content: content || '',
            ownerId: userId,
            sharedWith: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        console.log('Note created:', noteRef.id);

        res.status(201).json({ id: noteRef.id, message: 'Note created' });
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all notes for a user (owned + shared)
router.get('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;

        // Notes owned by user
        const ownerQuery = db.collection('notes').where('ownerId', '==', userId).get();

        // Notes shared with user (requires exact email match or user ID match in array)
        // For simplicity, assuming sharedWith contains user IDs or emails. 
        // Let's assume user IDs for now as per schema in prompt.
        const sharedQuery = db.collection('notes').where('sharedWith', 'array-contains', userId).get();

        const [ownerNotes, sharedNotes] = await Promise.all([ownerQuery, sharedQuery]);

        const notes = [];
        ownerNotes.forEach(doc => notes.push({ id: doc.id, ...doc.data() }));
        sharedNotes.forEach(doc => notes.push({ id: doc.id, ...doc.data() }));

        // Resolve owner emails
        const ownerIds = [...new Set(notes.map(n => n.ownerId))];
        const ownerEmails = {};
        for (const uid of ownerIds) {
            try {
                const userRecord = await admin.auth().getUser(uid);
                ownerEmails[uid] = userRecord.email;
            } catch (e) {
                ownerEmails[uid] = 'Unknown';
            }
        }

        const enrichedNotes = notes.map(n => ({
            ...n,
            ownerEmail: ownerEmails[n.ownerId]
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
        const userId = req.user.uid;
        const doc = await db.collection('notes').doc(noteId).get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Note not found' });
        }

        const note = doc.data();
        if (note.ownerId !== userId && !note.sharedWith.includes(userId)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        res.json({ id: doc.id, ...note });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update a note
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const { title, content } = req.body;
        const userId = req.user.uid;

        const noteRef = db.collection('notes').doc(noteId);
        const doc = await noteRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Note not found' });
        }

        const note = doc.data();
        if (note.ownerId !== userId && !note.sharedWith.includes(userId)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        await noteRef.update({
            title,
            content,
            updatedAt: new Date().toISOString()
        });

        res.json({ message: 'Note updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a note
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const userId = req.user.uid;

        const noteRef = db.collection('notes').doc(noteId);
        const doc = await noteRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Note not found' });
        }

        if (doc.data().ownerId !== userId) {
            return res.status(403).json({ message: 'Only owner can delete' });
        }

        await noteRef.delete();
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
        const userId = req.user.uid;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const noteRef = db.collection('notes').doc(noteId);
        const doc = await noteRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Note not found' });
        }

        if (doc.data().ownerId !== userId) {
            return res.status(403).json({ message: 'Only owner can share' });
        }

        // Lookup user by email
        try {
            const userRecord = await admin.auth().getUserByEmail(email);
            const shareUid = userRecord.uid;

            await noteRef.update({
                sharedWith: admin.firestore.FieldValue.arrayUnion(shareUid)
            });

            res.json({ message: `Shared with ${email}` });
        } catch (userError) {
            console.error('Error fetching user by email:', userError);
            return res.status(404).json({ message: 'User not found with that email' });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
