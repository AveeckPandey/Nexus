import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, required: true, trim: true },
  senderImage: { type: String, default: '' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverName: { type: String, required: true, trim: true },
  content: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  audioUrl: { type: String, default: '' },
  transcript: { type: String, default: '' },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedForEveryone: { type: Boolean, default: false },
  isAiGenerated: { type: Boolean, default: false }, // Placeholder for Phase 4
}, { timestamps: true });

export const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);
