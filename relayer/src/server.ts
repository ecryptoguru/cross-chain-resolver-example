import express, { Request, Response, Application, NextFunction } from 'express';
import http from 'http';
import { logger } from './utils/logger.js';
import { Counter, Gauge, collectDefaultMetrics, Registry } from 'prom-client';

declare module 'http' {
  interface Server {
    close(callback?: (err?: Error) => void): this;
  }
}

// Create a Registry to register the metrics
const register = new Registry();

// Enable collection of default Node.js metrics
collectDefaultMetrics({ register });

// Define custom metrics
const ethereumEventsProcessed = new Counter({
  name: 'ethereum_events_processed_total',
  help: 'Total number of Ethereum events processed',
  labelNames: ['event_type', 'status'],
  registers: [register],
});

const nearEventsProcessed = new Counter({
  name: 'near_events_processed_total',
  help: 'Total number of NEAR events processed',
  labelNames: ['event_type', 'status'],
  registers: [register],
});

const activeConnections = new Gauge({
  name: 'active_connections',
  help: 'Number of active connections to the relayer',
  registers: [register],
});

const ethereumBlockHeight = new Gauge({
  name: 'ethereum_block_height',
  help: 'Current Ethereum block height',
  registers: [register],
});

const nearBlockHeight = new Gauge({
  name: 'near_block_height',
  help: 'Current NEAR block height',
  registers: [register],
});

// Initialize Express app
const app: Application = express();
const PORT = process.env.PORT || '3000';
const port = parseInt(PORT, 10);

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || 'unknown',
  });
});

// Metrics endpoint for Prometheus
app.get('/metrics', async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    logger.error('Error generating metrics:', error);
    res.status(500).end('Error generating metrics');
  }
});

// Start the server
function startServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', () => {
      logger.info(`🚀 Server running on port ${port}`);
      resolve(server as unknown as http.Server);
    });
  });
}

// Graceful shutdown
function setupGracefulShutdown(server: http.Server) {
  const shutdown = async () => {
    logger.info('🛑 Shutting down server...');
    
    // Close the server
    server.close(() => {
      logger.info('✅ Server closed');
      process.exit(0);
    });
    
    // Force close after 5 seconds
    setTimeout(() => {
      logger.error('⚠️ Forcing shutdown after timeout');
      process.exit(1);
    }, 5000);
  };
  
  // Handle shutdown signals (only if not already handled by main process)
  if (process.listenerCount('SIGTERM') === 0) {
    process.on('SIGTERM', shutdown);
  }
  if (process.listenerCount('SIGINT') === 0) {
    process.on('SIGINT', shutdown);
  }
}

export {
  startServer,
  setupGracefulShutdown,
  ethereumEventsProcessed,
  nearEventsProcessed,
  activeConnections,
  ethereumBlockHeight,
  nearBlockHeight,
  register,
};
