
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogPayload = Record<string, unknown> | (() => Record<string, unknown>);

interface LogEntry {
  level: LogLevel;
  msg: string;
  timestamp: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const envLevel = process.env.LOG_LEVEL as LogLevel;
const currentLevel: LogLevel = envLevel in LOG_LEVELS ? envLevel : 'info';
const lazyPayloadEnabled = process.env.LOGGER_LAZY_PAYLOAD_ENABLED !== 'false';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function resolvePayload(payload?: LogPayload): Record<string, unknown> | undefined {
  if (typeof payload === 'function') {
    return payload();
  }
  return payload;
}

function resolvePayloadSafely(payload?: LogPayload): Record<string, unknown> | undefined {
  if (payload === undefined) return undefined;
  try {
    return resolvePayload(payload);
  } catch (err) {
    return { logPayloadResolveError: err instanceof Error ? err.message : String(err) };
  }
}

function formatLog(level: LogLevel, msg: string, data?: Record<string, unknown>): string {
  const entry: LogEntry = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...data,
  };
  return JSON.stringify(entry);
}

function emitLog(
  level: LogLevel,
  stream: NodeJS.WriteStream,
  msg: string,
  data?: LogPayload,
): void {
  if (shouldLog(level)) {
    stream.write(formatLog(level, msg, resolvePayloadSafely(data)) + '\n');
  } else if (!lazyPayloadEnabled) {
    // When lazy payload is disabled, eagerly evaluate the callback
    // even when the message won't be emitted (for debugging / side-effect use cases).
    resolvePayloadSafely(data);
  }
}

export const logger = {
  debug(msg: string, data?: LogPayload): void {
    emitLog('debug', process.stdout, msg, data);
  },

  info(msg: string, data?: LogPayload): void {
    emitLog('info', process.stdout, msg, data);
  },

  warn(msg: string, data?: LogPayload): void {
    emitLog('warn', process.stderr, msg, data);
  },

  error(msg: string, data?: LogPayload): void {
    emitLog('error', process.stderr, msg, data);
  },
};
