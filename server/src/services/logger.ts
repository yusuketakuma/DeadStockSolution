import { parseBooleanFlag } from '../utils/number-utils';

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
const LOGGER_LAZY_PAYLOAD_ENABLED = parseBooleanFlag(process.env.LOGGER_LAZY_PAYLOAD_ENABLED, true);

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function resolvePayload(payload?: LogPayload): Record<string, unknown> | undefined {
  if (typeof payload === 'function') {
    return payload();
  }
  return payload;
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

export const logger = {
  debug(msg: string, data?: LogPayload): void {
    const eagerPayload = LOGGER_LAZY_PAYLOAD_ENABLED ? undefined : resolvePayload(data);
    if (shouldLog('debug')) {
      process.stdout.write(formatLog('debug', msg, LOGGER_LAZY_PAYLOAD_ENABLED ? resolvePayload(data) : eagerPayload) + '\n');
    }
  },

  info(msg: string, data?: LogPayload): void {
    const eagerPayload = LOGGER_LAZY_PAYLOAD_ENABLED ? undefined : resolvePayload(data);
    if (shouldLog('info')) {
      process.stdout.write(formatLog('info', msg, LOGGER_LAZY_PAYLOAD_ENABLED ? resolvePayload(data) : eagerPayload) + '\n');
    }
  },

  warn(msg: string, data?: LogPayload): void {
    const eagerPayload = LOGGER_LAZY_PAYLOAD_ENABLED ? undefined : resolvePayload(data);
    if (shouldLog('warn')) {
      process.stderr.write(formatLog('warn', msg, LOGGER_LAZY_PAYLOAD_ENABLED ? resolvePayload(data) : eagerPayload) + '\n');
    }
  },

  error(msg: string, data?: LogPayload): void {
    const eagerPayload = LOGGER_LAZY_PAYLOAD_ENABLED ? undefined : resolvePayload(data);
    if (shouldLog('error')) {
      process.stderr.write(formatLog('error', msg, LOGGER_LAZY_PAYLOAD_ENABLED ? resolvePayload(data) : eagerPayload) + '\n');
    }
  },
};
