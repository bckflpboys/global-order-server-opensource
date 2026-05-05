// WhatsApp Outbox — durable queue of messages waiting to be typed into the
// user's "My Agent" WhatsApp Web group by the extension content script.
//
// Why this exists:
//   The server can't talk to WhatsApp directly — only the content script in the
//   user's WhatsApp Web tab can. So we queue messages here, the content script
//   polls /api/integrations/whatsapp/outbox every few seconds, drains them, and
//   types them into the chat. Documents are deleted as soon as they are drained.
//
// TTL safety net:
//   If a message is enqueued but never delivered (user closed WhatsApp Web,
//   server lost the user, etc.) the document is auto-removed by MongoDB after
//   10 minutes so the collection never grows unbounded.

const mongoose = require('mongoose');

const WhatsAppOutboxSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, {
  // We don't need updatedAt — these are write-once-then-delete.
  timestamps: false
});

// TTL index — undelivered messages auto-expire after 10 minutes.
WhatsAppOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model('WhatsAppOutbox', WhatsAppOutboxSchema);
