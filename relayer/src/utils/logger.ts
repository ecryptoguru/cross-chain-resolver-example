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

// Custom format for console logs
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  return `${timestamp} [${level}]: ${message} ${
    Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : ''
  }`;
});

// Custom format for file logs
const fileFormat = printf(({ level, message, timestamp, ...metadata }) => {
  return JSON.stringify({
    timestamp,
    level,
    message,
    ...metadata,
  });
});

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: combine(
    timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    winston.format.errors({ stack: true }),
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        align(),
        consoleFormat,
      ),
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
      filename: path.join('logs', 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: fileFormat,
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
