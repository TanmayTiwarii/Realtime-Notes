import express from 'express';
import { db } from '../firebase/admin.js';
import verifyToken from '../middleware/auth.js';
const router = express.Router();

// Get version history for a note
router.get('/:noteId', verifyToken, async (req, res) => {
    try {
        const { noteId } = req.params;
        const userId = req.user.uid;

        // Check access to note
        const noteRef = db.collection('notes').doc(noteId);
        const noteDoc = await noteRef.get();

        if (!noteDoc.exists) {
            return res.status(404).json({ message: 'Note not found' });
        }

        const noteData = noteDoc.data();
        if (noteData.ownerId !== userId && !noteData.sharedWith.includes(userId)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const versionsSnapshot = await noteRef.collection('versions').orderBy('createdAt', 'desc').get();
        const versions = versionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        res.json(versions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save a version (Snapshot) - usually called periodically or manually
router.post('/:noteId', verifyToken, async (req, res) => {
    try {
        const { noteId } = req.params;
        const userId = req.user.uid;
        const { content, title } = req.body;

        // Check access
        const noteRef = db.collection('notes').doc(noteId);
        const noteDoc = await noteRef.get();

        if (!noteDoc.exists) {
            return res.status(404).json({ message: 'Note not found' });
        }

        const noteData = noteDoc.data();
        if (noteData.ownerId !== userId && !noteData.sharedWith.includes(userId)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        await noteRef.collection('versions').add({
            content: content || noteData.content,
            title: title || noteData.title,
            createdAt: new Date().toISOString(),
            savedBy: userId
        });

        res.status(201).json({ message: 'Version saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
