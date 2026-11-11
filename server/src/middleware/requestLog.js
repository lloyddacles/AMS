import crypto from 'node:crypto';

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = (incoming && String(incoming).slice(0, 100)) || crypto.randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/health') return;
    const ms = Date.now() - start;
    const entry = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      msg: 'http_request',
      requestId: req.id,
      method: req.method,
      path: req.originalUrl?.split('?')[0] || req.path,
      status: res.statusCode,
      durationMs: ms,
      userId: req.user?.id || null,
    };
    const line = JSON.stringify(entry);
    if (entry.level === 'error') console.error(line);
    else console.log(line);
  });
  next();
}

export { requestId, requestLogger };
