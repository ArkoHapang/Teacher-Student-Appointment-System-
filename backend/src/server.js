/**
 * Application Entry Point & Server Bootstrap
 */

const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const db = require('./config/database');
const migrationService = require('./services/migrationService');

async function startServer() {
  try {
    logger.info('=================================================================');
    logger.info('  Teacher-Student Appointment System: Backend Initializing...  ');
    logger.info('=================================================================');
    logger.info(`Environment:  ${env.env}`);
    logger.info(`Port:         ${env.port}`);
    logger.info(`Database:     ${db.getPath()}`);

    // Pre-flight Database Connectivity Check
    const dbStatus = await db.ping();
    if (!dbStatus.connected) {
      logger.error('[Startup] Failed to connect to database file.');
      process.exit(1);
    }
    logger.info(`[Startup] Database connection verified (Ping: ${dbStatus.latencyMs}ms).`);

    // Migration Status Check
    const migrationStatus = await migrationService.getStatus();
    if (!migrationStatus.isUpToDate) {
      logger.warn(`[Startup] Database has ${migrationStatus.pendingCount} pending migrations!`, {
        pending: migrationStatus.pending
      });
    } else {
      logger.info(`[Startup] Database schema up-to-date (${migrationStatus.appliedCount} migrations applied).`);
    }

    // Start HTTP Server
    const server = app.listen(env.port, () => {
      logger.info(`[Startup] Server running on http://localhost:${env.port}`);
      logger.info(`[Startup] Health endpoint: http://localhost:${env.port}${env.apiPrefix}/health`);
      logger.info(`[Startup] Readiness endpoint: http://localhost:${env.port}${env.apiPrefix}/ready`);
      logger.info('=================================================================');
    });

    // Graceful Shutdown Handling
    const shutdown = (signal) => {
      logger.info(`[Shutdown] Received ${signal}. Closing HTTP server gracefully...`);
      server.close(() => {
        logger.info('[Shutdown] Server closed. Exiting process.');
        process.exit(0);
      });

      // Force close after 10s timeout
      setTimeout(() => {
        logger.error('[Shutdown] Forcefully shutting down after timeout.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return server;
  } catch (error) {
    logger.error(`[Startup] Fatal server startup error: ${error.message}`, { stack: error.stack });
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
