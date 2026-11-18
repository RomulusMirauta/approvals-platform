// Log fields replaced with "[redacted]", in the API's logs and the notification worker's. A safety net, not a
// licence to log objects blindly: if a header, body or config object ends up in a log line anyway, these never do.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  '*.password',
  'token',
  '*.token',
  'databaseUrl',
  '*.databaseUrl',
  'DATABASE_URL',
  '*.DATABASE_URL',
  'connectionString',
  '*.connectionString',
];

export const REDACT_CENSOR = '[redacted]';
