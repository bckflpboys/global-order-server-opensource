// New Order Global — Conversation Model
const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  creditsUsed: { type: Number, default: 0 },
  model: { type: String, default: '' },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'New Conversation'
  },
  totalCreditsUsed: {
    type: Number,
    default: 0
  },
  messageCount: {
    type: Number,
    default: 0
  },
  modelUsed: {
    type: String,
    default: ''
  },
  toolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tool',
    default: null
  },
  toolName: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'archived'],
    default: 'active'
  },
  messages: [chatMessageSchema]
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);
