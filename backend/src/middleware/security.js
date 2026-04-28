import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX || 300);
const MAX_AUTH_REQUESTS = Number(process.env.RATE_LIMIT_AUTH_MAX || 20);

export const helmetMiddleware = helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === 'production'
});

export const globalRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests, please try again later.'
  }
});

export const authRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_AUTH_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  }
});

export const parameterPollutionProtection = hpp();

export const enforceHttps = (req, res, next) => {
  const shouldEnforce = process.env.NODE_ENV === 'production' && process.env.ENFORCE_HTTPS === 'true';

  if (!shouldEnforce) {
    return next();
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const isSecure = req.secure || forwardedProto === 'https';

  if (isSecure) {
    return next();
  }

  const host = req.headers.host;
  return res.redirect(301, `https://${host}${req.originalUrl}`);
};