const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  if (typeof obj === 'object') {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      // block common operator injections and dotted paths
      if (typeof key === 'string' && (key.startsWith('$') || key.includes('.'))) {
        return acc;
      }
      acc[key] = sanitizeObject(value);
      return acc;
    }, {});
  }

  return obj;
};

export const requestSanitizer = (req, res, next) => {
  if (req.body) req.body = sanitizeObject(req.body);

  if (req.query) {
    const sanitizedQuery = sanitizeObject(req.query);
    Object.keys(req.query).forEach((key) => { delete req.query[key]; });
    Object.assign(req.query, sanitizedQuery);
  }

  if (req.params) {
    const sanitizedParams = sanitizeObject(req.params);
    Object.keys(req.params).forEach((key) => { delete req.params[key]; });
    Object.assign(req.params, sanitizedParams);
  }

  next();
};
