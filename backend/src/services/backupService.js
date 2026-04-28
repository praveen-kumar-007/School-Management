import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { encryptPayload, decryptPayload } from '../utils/encryption.js';
import logger from '../utils/logger.js';
import { notifyAdmins } from './notificationService.js';

const BACKUP_DIR = process.env.BACKUP_PATH || path.resolve(process.cwd(), 'backups');

export let lastBackupInfo = {
  success: false,
  path: null,
  timestamp: null,
  message: 'No backup performed yet'
};

const ensureBackupDirectory = async () => {
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  } catch (error) {
    logger.error('Unable to create backup directory', { backupDir: BACKUP_DIR, error: error.message });
    throw error;
  }
};

const collectAllData = async (targetCollections = []) => {
  const collections = mongoose.connection.collections;
  const result = {};

  for (const [name, collection] of Object.entries(collections)) {
    if (targetCollections.length && !targetCollections.includes(name)) {
      continue;
    }

    const docs = await collection.find({}, { projection: { __v: 0 } }).lean();
    result[name] = docs;
  }

  return result;
};

export const runDatabaseBackup = async ({ targetCollections = [], encryptionKey } = {}) => {
  if (!process.env.BACKUP_ENCRYPTION_KEY && !encryptionKey) {
    throw new Error('Missing BACKUP_ENCRYPTION_KEY for encrypted backups');
  }

  await ensureBackupDirectory();

  const data = await collectAllData(targetCollections);
  const jsonText = JSON.stringify({ backupCreatedAt: new Date().toISOString(), data }, null, 2);

  const encryptedBuffer = encryptPayload({ data: jsonText, key: encryptionKey });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `backup-${timestamp}.json.enc`;
  const filePath = path.join(BACKUP_DIR, fileName);

  await fs.promises.writeFile(filePath, encryptedBuffer, { flag: 'w' });

  lastBackupInfo = {
    success: true,
    path: filePath,
    timestamp: new Date().toISOString(),
    message: 'Database backup completed successfully'
  };

  logger.info('Database backup created', { filePath });

  return { filePath, timestamp: lastBackupInfo.timestamp };
};

export const getBackupStatus = () => lastBackupInfo;

export const scheduleAutomaticBackups = () => {
  const intervalMs = Number(process.env.BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000);
  if (intervalMs <= 0) {
    logger.info('Automatic backup scheduling disabled (interval <= 0)');
    return;
  }

  if (!process.env.BACKUP_ENCRYPTION_KEY) {
    logger.warn('Automatic backup scheduling disabled (missing BACKUP_ENCRYPTION_KEY)');
    return;
  }

  setInterval(async () => {
    try {
      const result = await runDatabaseBackup({});
      logger.info('Scheduled backup completed successfully', { ...result });
      await notifyAdmins({
        userIds: [],
        type: 'system_update',
        title: 'Scheduled Backup Completed',
        message: `Backup completed at ${result.timestamp}`,
        metadata: { filePath: result.filePath, timestamp: result.timestamp },
        sendEmail: false
      });
    } catch (error) {
      logger.error('Scheduled backup failed', { error: error.message });
      await notifyAdmins({
        userIds: [],
        type: 'system_update',
        title: 'Scheduled Backup Failed',
        message: `Backup failure: ${error.message}`,
        metadata: { error: error.message },
        sendEmail: true
      });
    }
  }, intervalMs);

  logger.info('Automatic backup scheduler started', { intervalMs });
};

export const listBackups = async () => {
  await ensureBackupDirectory();
  const files = await fs.promises.readdir(BACKUP_DIR);

  const backupFiles = await Promise.all(
    files
      .filter((filename) => filename.endsWith('.json.enc'))
      .map(async (filename) => {
        const fullPath = path.join(BACKUP_DIR, filename);
        const stats = await fs.promises.stat(fullPath);
        return {
          filename,
          path: fullPath,
          size: stats.size,
          modifiedAt: stats.mtime
        };
      })
  );

  return backupFiles.sort((a, b) => b.modifiedAt - a.modifiedAt);
};

export const restoreDatabaseBackup = async ({ filePath, encryptionKey } = {}) => {
  if (!filePath) {
    throw new Error('Backup file path is required for restore');
  }

  const fileBuffer = await fs.promises.readFile(filePath);
  const decrypted = decryptPayload({ encryptedBuffer: fileBuffer, key: encryptionKey });
  const parsed = JSON.parse(decrypted);

  if (!parsed?.data) {
    throw new Error('Invalid backup file format');
  }

  const collections = parsed.data;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    for (const [collectionName, docs] of Object.entries(collections)) {
      const collection = mongoose.connection.collection(collectionName);
      if (!collection) {
        continue;
      }

      await collection.deleteMany({}, { session });
      if (docs.length) {
        await collection.insertMany(docs, { session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    const message = `Restore from backup ${path.basename(filePath)} completed`;
    logger.info(message, { filePath });
    await notifyAdmins({
      userIds: [],
      type: 'system_update',
      title: 'Backup Restore Completed',
      message,
      metadata: { filePath }
    });

    return { success: true, filePath, message };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    const message = `Restore from backup failed: ${error.message}`;
    logger.error(message, { filePath, error: error.message });
    await notifyAdmins({
      userIds: [],
      type: 'system_update',
      title: 'Backup Restore Failed',
      message,
      metadata: { filePath, error: error.message }
    });

    throw error;
  }
};
