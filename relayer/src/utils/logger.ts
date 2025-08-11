import * as winston from 'winston';
import 'winston-daily-rotate-file';
import * as path from 'path';

const { combine, timestamp, printf, colorize, align } = winston.format;

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

// Add colors to winston
winston.addColors(colors);

// Safe JSON.stringify that handles BigInt, ethers BigNumber and circular refs
const safeStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, val: any) => {
    const t = typeof val;
    if (t === 'bigint') return val.toString();
    if (val && t === 'object') {
      // ethers BigNumber
      if ((val as any)._isBigNumber && typeof (val as any).toString === 'function') {
        try { return (val as any).toString(); } catch { return `${val}`; }
      }
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  };
  try {
    return JSON.stringify(value, replacer, 2);
  } catch {
    // Fallback best-effort
    try { return String(value); } catch { return '[Unserializable]'; }
  }
};

// Custom format for console logs
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  const metaStr = Object.keys(metadata).length ? safeStringify(metadata) : '';
  return `${timestamp} [${level}]: ${message} ${metaStr}`;
});

// Custom format for file logs
const fileFormat = printf(({ level, message, timestamp, ...metadata }) => {
  return safeStringify({
    timestamp,
    level,
    message,
    ...metadata,
  });
});

// Create the logger instance
const logger = winston.createLogger({
  // Default to debug level in development, info in production
  level: process.env.NODE_ENV === 'production' 
    ? (process.env.LOG_LEVEL || 'info')
    : (process.env.LOG_LEVEL || 'debug'),
  levels,
  // Don't exit on handled exceptions
  exitOnError: false,
  format: combine(
    timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    winston.format.errors({ stack: true }),
  ),
  transports: [
    // Console transport with colors
    new winston.transports.Console({
      level: 'debug', // Always show debug logs in console
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        consoleFormat,
        align(),
      ),
      handleExceptions: true,
      handleRejections: true,
    }),
    // File transport for errors
    new winston.transports.DailyRotateFile({
      filename: path.join('logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'error',
      format: fileFormat,
    }),
    // File transport for all logs
    new winston.transports.DailyRotateFile({
      level: 'debug', // Log everything to file
      filename: path.join('logs', 'relayer-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: combine(timestamp(), fileFormat),
      handleExceptions: true,
      handleRejections: true,
    }),
    // Error log file (errors only)
    new winston.transports.File({
      level: 'error',
      filename: path.join('logs', 'error.log'),
      format: combine(timestamp(), fileFormat),
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' }),
  ],
});

// Create logs directory if it doesn't exist
import * as fs from 'fs';

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export { logger };
