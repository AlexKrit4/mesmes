const crypto = require('crypto');

const PREFIX = 'enc:v1';
const IV_LENGTH = 12; // recommended for GCM

function buildKey() {
  const raw = process.env.MESSAGE_ENCRYPTION_KEY || process.env.JWT_SECRET || 'change_this_secret_in_production';
  return crypto.createHash('sha256').update(String(raw)).digest();
}

const KEY = buildKey();

function encryptMessageContent(value) {
  const plain = String(value ?? '');
  if (!plain) return plain;

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  } catch {
    return plain;
  }
}

function decryptMessageContent(value) {
  const input = String(value ?? '');
  if (!input) return input;
  if (!input.startsWith(`${PREFIX}:`)) return input;

  const parts = input.split(':');
  if (parts.length !== 5) return '';

  try {
    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const ciphertext = Buffer.from(parts[4], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return '';
  }
}

module.exports = {
  encryptMessageContent,
  decryptMessageContent,
};
