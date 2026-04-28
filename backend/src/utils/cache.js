import { getRedisClient } from '../config/redis.js';

const memoryCache = new Map();

const getMemoryValue = (key) => {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return item.value;
};

export const getCache = async (key) => {
  const redis = getRedisClient();
  if (redis) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return getMemoryValue(key);
};

export const setCache = async (key, value, ttlSeconds = 60) => {
  const redis = getRedisClient();
  if (redis) {
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return;
  }

  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
};

export const deleteCacheByPrefix = async (prefix) => {
  const redis = getRedisClient();
  if (redis) {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }
    return;
  }

  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
};
