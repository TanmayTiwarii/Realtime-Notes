import mongoose from 'mongoose';

const noteSchema = new mongoose.Schema({
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    summary: { type: String },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

export default mongoose.model('Note', noteSchema);
