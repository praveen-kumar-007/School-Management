import { createClient } from 'redis';
import logger from '../utils/logger.js';

let redisClient = null;

export const connectRedis = async () => {
  if (redisClient) {
    return redisClient;
  }

  if (!process.env.REDIS_URL) {
    const message = 'REDIS_URL not configured, using in-memory cache fallback';
    if (process.env.NODE_ENV === 'production') {
      logger.warn(message);
    } else {
      logger.info(message);
    }
    return null;
  }

  try {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (error) => {
      logger.error('Redis client error', { error: error.message });
    });
    await redisClient.connect();
    logger.info('Redis connected');
    return redisClient;
  } catch (error) {
    logger.warn('Redis connection failed, falling back to memory cache', { error: error.message });
    redisClient = null;
    return null;
  }
};

export const getRedisClient = () => redisClient;
