import client from 'prom-client';

const register = new client.Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'elearning_backend_'
});

const httpRequestDurationMs = new client.Histogram({
  name: 'elearning_backend_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [25, 50, 100, 250, 500, 1000, 2000, 5000],
  registers: [register]
});

export const metricsMiddleware = (req, res, next) => {
  const end = httpRequestDurationMs.startTimer();

  res.on('finish', () => {
    const route = req.route?.path || req.path || 'unknown_route';
    end({
      method: req.method,
      route,
      status_code: String(res.statusCode)
    });
  });

  next();
};

export const metricsHandler = async (_req, res, next) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    next(error);
  }
};