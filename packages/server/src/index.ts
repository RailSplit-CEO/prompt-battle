import express from 'express';
import { initAdmin } from './FirebaseAdmin';
import { GameManager } from './GameManager';

const PORT = parseInt(process.env.PORT || '8080', 10);

async function main() {
  console.log('[Server] Initializing Firebase Admin...');
  initAdmin();

  const manager = new GameManager();
  manager.start();

  const app = express();

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      activeGames: manager.getActiveGameCount(),
      uptime: process.uptime(),
    });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Listening on 0.0.0.0:${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down...');
    manager.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
