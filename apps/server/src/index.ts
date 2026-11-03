import { createApp } from './app.js';
import { config } from './config.js';
import { createApplicationContext } from './application/index.js';

const appContext = createApplicationContext({
  runtimeConfig: {
    backendPort: config.PORT,
    frontendPort: 5173,
  },
});
const bootstrapToken = appContext.control.getBootstrapToken();
const app = createApp(appContext);

// Start outbound webhook delivery engine & worker pool
appContext.engine.start();

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`[PAYSIM] Server listening strictly on http://${config.HOST}:${config.PORT}`);
  console.log(`[PAYSIM] Bootstrap Control Token: ${bootstrapToken}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[PAYSIM] Port collision error: Port ${config.PORT} is already in use on ${config.HOST}. Please specify an alternative port via the PORT environment variable.`
    );
    process.exit(1);
  }
  console.error('[PAYSIM] Server startup error:', err);
  process.exit(1);
});

const gracefulShutdown = async () => {
  try {
    await appContext.engine.stop();
  } catch (err) {
    console.error('[PAYSIM] Error stopping webhook engine:', err);
  }
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', () => {
  void gracefulShutdown();
});

process.on('SIGTERM', () => {
  void gracefulShutdown();
});
