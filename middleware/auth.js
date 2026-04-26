// Minimal JWT auth middleware. No suspensions, no audit logs, no rate limits.

const jwt = require('jsonwebtoken');
const db = require('../storage');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

function generateToken(userId) {
  return jwt.sign({ userId: String(userId) }, JWT_SECRET, { expiresIn: '30d' });
}

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });

  const token = h.slice(7);
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = await db.users.findById(decoded.userId);
  if (!user) return res.status(401).json({ error: 'Account not found' });

  req.user = user;
  req.userId = user._id;
  next();
}

// Returns the safe public projection of a user (no passwordHash).
function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id,
    _id: u._id,
    email: u.email,
    displayName: u.displayName || '',
    role: u.role || 'user',
    plan: u.plan || 'unlimited',
    credits: u.credits ?? 999999,
    totalCreditsPurchased: u.totalCreditsPurchased || 0,
    totalCreditsUsed: u.totalCreditsUsed || 0,
    aiRequestsUsed: u.aiRequestsUsed || 0,
    isSuspended: false,
    createdAt: u.createdAt,
    lastLogin: u.lastLogin
  };
}

module.exports = { generateToken, requireAuth, publicUser };
