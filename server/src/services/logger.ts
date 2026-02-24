type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
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
  debug(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      process.stdout.write(formatLog('debug', msg, data) + '\n');
    }
  },

  info(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      process.stdout.write(formatLog('info', msg, data) + '\n');
    }
  },

  warn(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      process.stderr.write(formatLog('warn', msg, data) + '\n');
    }
  },

  error(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      process.stderr.write(formatLog('error', msg, data) + '\n');
    }
  },
};
