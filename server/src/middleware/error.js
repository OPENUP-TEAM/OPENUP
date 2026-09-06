export function notFound(_req, res) {
  res.status(404).json({ error: 'That endpoint does not exist.' });
}

export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on our end.' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
