import * as Sentry from '@sentry/node';

let sentryEnabled = false;

export const initializeMonitoring = () => {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.warn('⚠️ SENTRY_DSN not configured, Sentry monitoring is disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.2),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE || 0.0)
  });

  sentryEnabled = true;
  console.log('✅ Sentry monitoring initialized');
};

export const captureException = (error, context = {}) => {
  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });

    Sentry.captureException(error);
  });
};