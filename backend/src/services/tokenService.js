import jwt from 'jsonwebtoken';
import { getRedisClient } from '../config/redis.js';
import logger from '../utils/logger.js';

const inMemoryTokenBlacklist = new Map();

const ttlFromToken = (token) => {
  if (!token) return null;

  const payload = jwt.decode(token);
  if (!payload || !payload.exp) return null;

  const expireAtMs = payload.exp * 1000;
  const ttlMs = expireAtMs - Date.now();

  return ttlMs > 0 ? Math.ceil(ttlMs / 1000) : null;
};

export const blacklistToken = async (token) => {
  const ttl = ttlFromToken(token);
  if (!ttl) return;

  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      await redisClient.set(`auth:blacklist:${token}`, 'blacklisted', { EX: ttl });
      return;
    } catch (error) {
      logger.warn('Redis blacklist unavailable, falling back to memory', { error: error.message });
    }
  }

  inMemoryTokenBlacklist.set(token, Date.now() + ttl * 1000);
};

export const isTokenBlacklisted = async (token) => {
  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      const existed = await redisClient.exists(`auth:blacklist:${token}`);
      return Boolean(existed);
    } catch (error) {
      logger.warn('Redis blacklist check failed, falling back to memory', { error: error.message });
    }
  }

  if (!inMemoryTokenBlacklist.has(token)) {
    return false;
  }

  const expiry = inMemoryTokenBlacklist.get(token);
  if (!expiry || expiry <= Date.now()) {
    inMemoryTokenBlacklist.delete(token);
    return false;
  }

  return true;
};
