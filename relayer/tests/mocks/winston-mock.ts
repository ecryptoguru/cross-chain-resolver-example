/**
 * Mock implementation for Winston logger used in relayer testing
 */

export interface MockLogEntry {
  level: string;
  message: string;
  timestamp?: string;
  meta?: any;
}

export class MockLogger {
  public logs: MockLogEntry[] = [];
  public level: string = 'info';

  constructor(options: any = {}) {
    this.level = options.level || 'info';
  }

  info(message: string, meta?: any) {
    this.logs.push({
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      meta
    });
  }

  warn(message: string, meta?: any) {
    this.logs.push({
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      meta
    });
  }

  error(message: string, meta?: any) {
    this.logs.push({
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
      meta
    });
  }

  debug(message: string, meta?: any) {
    this.logs.push({
      level: 'debug',
      message,
      timestamp: new Date().toISOString(),
      meta
    });
  }

  verbose(message: string, meta?: any) {
    this.logs.push({
      level: 'verbose',
      message,
      timestamp: new Date().toISOString(),
      meta
    });
  }

  silly(message: string, meta?: any) {
    this.logs.push({
      level: 'silly',
      message,
      timestamp: new Date().toISOString(),
      meta
    });
  }

  // Test helper methods
  clearLogs(): void {
    this.logs = [];
  }

  getLogsByLevel(level: string): MockLogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  hasLogContaining(message: string): boolean {
    return this.logs.some(log => log.message.includes(message));
  }

  getLastLog(): MockLogEntry | undefined {
    return this.logs[this.logs.length - 1];
  }

  getLogCount(): number {
    return this.logs.length;
  }

  getLogsWithMeta(key: string, value?: any): MockLogEntry[] {
    return this.logs.filter(log => {
      if (!log.meta) return false;
      if (value === undefined) return key in log.meta;
      return log.meta[key] === value;
    });
  }
}

// Mock winston module
export const mockWinston = {
  createLogger(_options: any = {}): MockLogger {
    return new MockLogger(_options);
  },
  format: {
    combine(..._formats: any[]): any {
      return { transform: (info: any) => info };
    },
    timestamp: () => ({ transform: (info: any) => ({ ...info, timestamp: new Date().toISOString() }) }),
    errors: () => ({ transform: (info: any) => info }),
    json: () => ({ transform: (info: any) => info }),
    printf: (fn: Function) => ({ transform: (info: any) => ({ ...info, message: fn(info) }) })
  },
  transports: {
    Console: class MockConsoleTransport {
      constructor(_options: any = {}) {}
    },
    File: class MockFileTransport {
      constructor(_options: any = {}) {}
    }
  }
};

// Export default mock
export default mockWinston;
