// New Order Global — Tool Model

const mongoose = require('mongoose');

const toolSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  icon: {
    type: String,
    default: '🔧'
  },
  targetSites: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'archived'],
    default: 'active'
  },
  // Who created this tool. 'user' = built via the Builder UI (default).
  // 'agent' = auto-created by Global Executive during a task run.
  // Agent-created tools are shown in the dashboard with a badge so the user
  // can review / edit / archive them.
  origin: {
    type: String,
    enum: ['user', 'agent'],
    default: 'user',
    index: true
  },
  // When origin === 'agent', the task that produced it. Useful for audit
  // and for surfacing "made while doing X" in the dashboard.
  agentTaskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgentTask',
    default: null
  },
  contentScript: {
    type: String,
    default: ''
  },
  styles: {
    type: String,
    default: ''
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  storageSchema: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  dashboardHTML: {
    type: String,
    default: ''
  },
  // The original prompt the user gave
  originalPrompt: {
    type: String,
    default: ''
  },
  // Conversation history for iterations
  chatHistory: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  version: {
    type: Number,
    default: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamps
toolSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Index for efficient querying
toolSchema.index({ userId: 1, status: 1 });
toolSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Tool', toolSchema);
