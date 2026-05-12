import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    sender: { type: String, required: true }, // email or 'AI Assistant'
    content: { type: String, required: true },
    isAi: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const noteSchema = new mongoose.Schema({
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    messages: [messageSchema],
    drawings: { type: Array, default: [] },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

// Optimize query performance via persistent indexing
noteSchema.index({ ownerId: 1 });
noteSchema.index({ sharedWith: 1 });

export default mongoose.model('Note', noteSchema);
