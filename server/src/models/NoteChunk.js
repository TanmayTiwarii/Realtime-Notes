import mongoose from 'mongoose';

const noteChunkSchema = new mongoose.Schema({
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true },
    // Denormalized from parent Note for vector search filtering (avoids cross-collection $lookup)
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    chunkIndex: { type: Number, required: true },
    content: { type: String, required: true },
    embedding: { type: [Number], default: [] },
}, { timestamps: true });

// Fast lookup/deletion by parent note
noteChunkSchema.index({ noteId: 1 });
// Vector search pre-filters
noteChunkSchema.index({ ownerId: 1 });
noteChunkSchema.index({ sharedWith: 1 });

export default mongoose.model('NoteChunk', noteChunkSchema);
