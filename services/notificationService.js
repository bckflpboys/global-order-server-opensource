// Channel-aware notifier — Self-hosted version
// Uses storage abstraction instead of Mongoose. No cryptoService (self-hosted = no encryption).
// WhatsApp outbox is in-memory for self-hosted (single-process).

const db = require('../storage');
let telegramService;
try { telegramService = require('./telegramService'); } catch {}

const WHATSAPP_AGENT_PREFIX = '🤖 Agent: ';

// In-memory WhatsApp outbox for self-hosted (single process)
const waOutbox = new Map();

async function enqueueWhatsApp(userId, text) {
  const arr = waOutbox.get(String(userId)) || [];
  arr.push({ text, queuedAt: Date.now() });
  waOutbox.set(String(userId), arr);
}

async function popWhatsAppOutbox(userId) {
  const msgs = waOutbox.get(String(userId)) || [];
  waOutbox.set(String(userId), []);
  return msgs;
}

async function notify(userId, text, opts = {}) {
  if (!text) return { sent: false, reason: 'empty' };
  try {
    const integ = await db.integrations.findByUser(String(userId));
    if (!integ) return { sent: false, reason: 'no_integration' };

    const channel = opts.forceChannel || integ.preferences?.notifyChannel || 'none';
    if (channel === 'none') return { sent: false, reason: 'channel_none' };

    if (channel === 'telegram') {
      if (!integ.telegram?.enabled || !integ.telegram?.botToken || !integ.telegram?.chatId) {
        return { sent: false, reason: 'telegram_not_configured' };
      }
      // Self-hosted: botToken stored as plaintext (no decryption needed)
      if (!telegramService?.sendMessage) return { sent: false, reason: 'telegram_service_missing' };
      const r = await telegramService.sendMessage(integ.telegram.botToken, integ.telegram.chatId, text);
      return { sent: !!r?.ok, channel: 'telegram', detail: r };
    }

    if (channel === 'whatsapp') {
      if (!integ.whatsapp?.enabled || !integ.whatsapp?.verified) {
        return { sent: false, reason: 'whatsapp_not_configured' };
      }
      await enqueueWhatsApp(userId, WHATSAPP_AGENT_PREFIX + text);
      return { sent: true, channel: 'whatsapp', queued: true };
    }

    return { sent: false, reason: 'unknown_channel' };
  } catch (err) {
    console.error('[Notify Error]', err.message);
    return { sent: false, reason: 'error', error: err.message };
  }
}

module.exports = { notify, enqueueWhatsApp, popWhatsAppOutbox, WHATSAPP_AGENT_PREFIX };
