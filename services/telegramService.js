// Telegram Bot helpers — send messages, set webhook, parse incoming.

const TELEGRAM_API = 'https://api.telegram.org';

async function sendMessage(botToken, chatId, text, options = {}) {
  if (!botToken || !chatId || !text) return { ok: false, error: 'missing_params' };
  try {
    const body = {
      chat_id: chatId,
      text: text.length > 4000 ? text.substring(0, 4000) + '…' : text,
      disable_web_page_preview: true
    };
    // Telegram's default when parse_mode is omitted is plain text. Callers
    // that need HTML/Markdown formatting must pass `parseMode: 'HTML'` (or
    // 'Markdown', 'MarkdownV2') explicitly. Passing 'none' or '' — or
    // omitting the option entirely — sends plain text so that stray `<`, `>`
    // or `_` characters don't cause Telegram to reject the message with
    // 400 "can't parse entities".
    const pm = options.parseMode;
    if (pm && pm !== 'none' && pm !== '') body.parse_mode = pm;

    const resp = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!data.ok) {
      console.warn('[Telegram sendMessage] API rejected:', data.description || JSON.stringify(data));
    }
    return { ok: !!data.ok, raw: data };
  } catch (err) {
    console.warn('[Telegram sendMessage] error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function getMe(botToken) {
  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${botToken}/getMe`);
    const data = await resp.json();
    return data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function setWebhook(botToken, url) {
  try {
    const resp = await fetch(`${TELEGRAM_API}/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, allowed_updates: ['message'] })
    });
    return await resp.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function parseUpdate(update) {
  // Returns { chatId, text, from } or null
  const msg = update?.message;
  if (!msg || !msg.text) return null;
  return {
    chatId: String(msg.chat.id),
    text: msg.text,
    from: msg.from?.username || msg.from?.first_name || 'unknown',
    messageId: msg.message_id
  };
}

module.exports = { sendMessage, getMe, setWebhook, parseUpdate };
