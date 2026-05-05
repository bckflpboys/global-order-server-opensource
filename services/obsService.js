// Object Storage Service — Self-hosted version
// S3-compatible storage for screenshots and captured files.
// Works with MinIO, Cloudflare R2, AWS S3, or any S3-compatible provider.
// If no S3 credentials are configured, all upload calls return a graceful error.

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand;
try {
  const aws = require('@aws-sdk/client-s3');
  S3Client = aws.S3Client;
  PutObjectCommand = aws.PutObjectCommand;
  GetObjectCommand = aws.GetObjectCommand;
  DeleteObjectCommand = aws.DeleteObjectCommand;
} catch {
  console.warn('[OBS] @aws-sdk/client-s3 not installed — screenshot/file uploads disabled. Run: npm install @aws-sdk/client-s3');
}

const crypto = require('crypto');

const {
  OBS_ENDPOINT,
  OBS_ACCESS_KEY,
  OBS_SECRET_KEY,
  OBS_BUCKET,
  OBS_REGION
} = process.env;

const TTL_MINUTES = Math.max(1, parseInt(process.env.OBS_SCREENSHOT_TTL_MINUTES || '10', 10));
const CAPTURE_TTL_DAYS = Math.max(1, parseInt(process.env.OBS_CAPTURE_TTL_DAYS || '7', 10));

let client = null;
function getClient() {
  if (client) return client;
  if (!S3Client || !OBS_ENDPOINT || !OBS_ACCESS_KEY || !OBS_SECRET_KEY || !OBS_BUCKET) return null;
  client = new S3Client({
    region: OBS_REGION || 'auto',
    endpoint: OBS_ENDPOINT,
    credentials: { accessKeyId: OBS_ACCESS_KEY, secretAccessKey: OBS_SECRET_KEY },
    forcePathStyle: OBS_ENDPOINT.includes('localhost') || OBS_ENDPOINT.includes('127.0.0.1')
  });
  return client;
}

function isConfigured() {
  return !!getClient();
}

async function putObject(objectKey, buffer, contentType) {
  const s3 = getClient();
  if (!s3) throw new Error('Object storage not configured. Set OBS_* env vars.');
  await s3.send(new PutObjectCommand({
    Bucket: OBS_BUCKET,
    Key: objectKey,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream'
  }));
  // Build a simple URL — works for most S3-compatible stores
  const signedUrl = `${OBS_ENDPOINT.replace(/\/$/, '')}/${OBS_BUCKET}/${objectKey}`;
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);
  return { objectKey, signedUrl, expiresAt };
}

async function getObject(objectKey) {
  const s3 = getClient();
  if (!s3) throw new Error('Object storage not configured');
  const resp = await s3.send(new GetObjectCommand({ Bucket: OBS_BUCKET, Key: objectKey }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function deleteObject(objectKey) {
  const s3 = getClient();
  if (!s3) return;
  try { await s3.send(new DeleteObjectCommand({ Bucket: OBS_BUCKET, Key: objectKey })); }
  catch (e) { console.warn(`[OBS] Failed to delete ${objectKey}:`, e.message); }
}

// Convenience: upload screenshot
async function uploadScreenshot(userId, taskId, pngBuffer, contentType = 'image/png') {
  const rand = crypto.randomBytes(8).toString('hex');
  const objectKey = `screenshots/${userId}/${taskId}/${Date.now()}-${rand}.png`;
  const result = await putObject(objectKey, pngBuffer, contentType);
  return { ...result, ttlMinutes: TTL_MINUTES };
}

// Convenience: upload captured file
const EXT_FOR_MIME = {
  'application/pdf': 'pdf',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'text/plain': 'txt', 'text/csv': 'csv', 'text/html': 'html', 'application/json': 'json',
  'application/zip': 'zip', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
};

function safeExt(mime, fallbackName) {
  if (EXT_FOR_MIME[mime]) return EXT_FOR_MIME[mime];
  if (fallbackName && /\.[a-z0-9]{1,8}$/i.test(fallbackName)) {
    return fallbackName.match(/\.([a-z0-9]{1,8})$/i)[1].toLowerCase();
  }
  return 'bin';
}

async function uploadCapturedFile(userId, taskId, buffer, contentType, filename) {
  const rand = crypto.randomBytes(8).toString('hex');
  const ext = safeExt(contentType, filename);
  const objectKey = `captures/${userId}/${taskId}/${Date.now()}-${rand}.${ext}`;
  const result = await putObject(objectKey, buffer, contentType || 'application/octet-stream');
  return { ...result, ttlDays: CAPTURE_TTL_DAYS };
}

function refreshCaptureSignedUrl(objectKey) {
  return `${OBS_ENDPOINT.replace(/\/$/, '')}/${OBS_BUCKET}/${objectKey}`;
}

function createSignedGetUrl(objectKey, ttlSeconds) {
  return refreshCaptureSignedUrl(objectKey);
}

function scheduleDelete(objectKey, delayMs) {
  const timer = setTimeout(() => { deleteObject(objectKey).catch(() => {}); }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
  isConfigured, putObject, getObject, deleteObject,
  uploadScreenshot, uploadCapturedFile, refreshCaptureSignedUrl,
  createSignedGetUrl, scheduleDelete, TTL_MINUTES, CAPTURE_TTL_DAYS
};
