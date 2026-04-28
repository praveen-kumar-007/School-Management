const formatLog = (level, message, context = {}) => {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  });
};

const writeLog = (level, message, context = {}) => {
  const output = formatLog(level, message, context);

  if (level === 'error') {
    console.error(output);
    return;
  }

  if (level === 'warn') {
    console.warn(output);
    return;
  }

  console.log(output);
};

export const logger = {
  info: (message, context = {}) => writeLog('info', message, context),
  warn: (message, context = {}) => writeLog('warn', message, context),
  error: (message, context = {}) => writeLog('error', message, context),
  debug: (message, context = {}) => {
    if (process.env.NODE_ENV !== 'production') {
      writeLog('debug', message, context);
    }
  }
};

export default logger;
