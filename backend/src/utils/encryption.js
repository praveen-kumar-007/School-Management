import crypto from 'crypto';

const normalizeKey = (rawKey) => {
  if (!rawKey || typeof rawKey !== 'string') {
    throw new Error('Encryption key must be set in BACKUP_ENCRYPTION_KEY');
  }

  const key = crypto.createHash('sha256').update(rawKey).digest();
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes after hashing');
  }

  return key;
};

export const encryptPayload = ({ data, key }) => {
  const encryptionKey = normalizeKey(key || process.env.BACKUP_ENCRYPTION_KEY);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // store IV + tag + ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
};

export const decryptPayload = ({ encryptedBuffer, key }) => {
  const encryptionKey = normalizeKey(key || process.env.BACKUP_ENCRYPTION_KEY);

  const iv = encryptedBuffer.slice(0, 12);
  const authTag = encryptedBuffer.slice(12, 28);
  const ciphertext = encryptedBuffer.slice(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
};
