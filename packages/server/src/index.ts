import http from 'http';
import express from 'express';
import { initAdmin } from './FirebaseAdmin';
import { GameManager } from './GameManager';
import { GameWebSocketServer } from './WebSocketServer';

const PORT = parseInt(process.env.PORT || '8080', 10);

async function main() {
  console.log('[Server] Initializing Firebase Admin...');
  initAdmin();

  const manager = new GameManager();

  const app = express();

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      activeGames: manager.getActiveGameCount(),
      uptime: process.uptime(),
    });
  });

  // Create HTTP server from Express app (needed for WebSocket upgrade)
  const httpServer = http.createServer(app);

  // Attach WebSocket server to the same HTTP server
  const wsServer = new GameWebSocketServer(httpServer, {
    onJoin: (gameId, playerId) => manager.handleJoin(gameId, playerId),
    onCommand: (gameId, team, orders) => manager.handleCommand(gameId, team, orders),
  });
  manager.setWebSocketServer(wsServer);

  // Start game loop
  manager.start();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Listening on 0.0.0.0:${PORT} (HTTP + WebSocket)`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down...');
    manager.stop();
    httpServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
