const pino = require('pino');
const config = require('./config');

const rootLogger = pino({ level: config.LOG_LEVEL });

function log(requestId, stage, status, ms, meta) {
  const entry = { stage, status };
  if (ms !== undefined) entry.ms = ms;
  if (meta) entry.meta = meta;
  const requestLogger = requestId ? rootLogger.child({ requestId }) : rootLogger;
  requestLogger[status === 'error' ? 'error' : 'info'](entry);
  return { requestId: requestId || null, ...entry };
}

module.exports = { log };
