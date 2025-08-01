// Mock implementation for Winston logger used in enhanced scripts testing

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

  // Test utilities
  clearLogs() {
    this.logs = [];
  }

  getLogsByLevel(level: string): MockLogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  getLastLog(): MockLogEntry | undefined {
    return this.logs[this.logs.length - 1];
  }

  hasLogContaining(message: string): boolean {
    return this.logs.some(log => log.message.includes(message));
  }

  getLogCount(): number {
    return this.logs.length;
  }
}

export class MockTransport {
  public logs: MockLogEntry[] = [];

  log(info: any, callback?: Function) {
    this.logs.push(info);
    if (callback) callback();
  }
}

export class MockConsoleTransport extends MockTransport {
  constructor(options: any = {}) {
    super();
  }
}

export class MockFileTransport extends MockTransport {
  constructor(options: any = {}) {
    super();
  }
}

// Mock winston format functions
export const mockFormat = {
  timestamp: () => (info: any) => {
    info.timestamp = new Date().toISOString();
    return info;
  },
  
  errors: (options: any = {}) => (info: any) => {
    if (info instanceof Error) {
      info.stack = info.stack;
    }
    return info;
  },
  
  printf: (templateFn: Function) => (info: any) => {
    info.message = templateFn(info);
    return info;
  },
  
  colorize: () => (info: any) => info,
  
  simple: () => (info: any) => {
    info.message = `${info.level}: ${info.message}`;
    return info;
  },
  
  combine: (...formats: any[]) => (info: any) => {
    return formats.reduce((acc, format) => format(acc), info);
  },
  
  json: () => (info: any) => {
    info.message = JSON.stringify(info);
    return info;
  }
};

// Mock winston transports
export const mockTransports = {
  Console: MockConsoleTransport,
  File: MockFileTransport
};

// Mock winston createLogger function
export function mockCreateLogger(options: any = {}): MockLogger {
  return new MockLogger(options);
}

// Export the complete mock winston
export const mockWinston = {
  createLogger: mockCreateLogger,
  format: mockFormat,
  transports: mockTransports,
  Logger: MockLogger
};
