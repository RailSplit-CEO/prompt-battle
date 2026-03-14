import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { DraftPick, CLASSES, ANIMALS, ClassId, AnimalId } from '@prompt-battle/shared';
import { GameRoom, SyncSnapshot, RemoteOrderPayload } from './GameRoom.js';
import { loadMap } from './mapLoader.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

// --- Types ---
interface PlayerConnection {
  ws: WebSocket;
  id: string;
  gameId?: string;
  slot?: 'player1' | 'player2';
}

interface WaitingPlayer {
  conn: PlayerConnection;
  joinedAt: number;
}

interface DraftState {
  gameId: string;
  player1: PlayerConnection;
  player2: PlayerConnection;
  picks: DraftPick[];
  pickOrder: string[]; // [p1, p2, p2, p1, p1, p2]
  currentPickIndex: number;
  timer: number;
  timerInterval?: NodeJS.Timeout;
  usedClasses: Set<string>;
  usedAnimals: Set<string>;
}

// --- State ---
const connections = new Map<string, PlayerConnection>();
let waitingPlayer: WaitingPlayer | null = null;
const drafts = new Map<string, DraftState>();
const games = new Map<string, GameRoom>();

// --- Message sending ---
function send(ws: WebSocket, type: string, payload: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

// --- Server setup ---
const server = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', games: games.size, connections: connections.size }));
    return;
  }
  // Serve a simple info page
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<h1>Prompt Battle Server</h1><p>Games: ${games.size}, Connections: ${connections.size}</p>`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const playerId = uuid();
  const conn: PlayerConnection = { ws, id: playerId };
  connections.set(playerId, conn);

  send(ws, 'connected', { playerId });
  console.log(`[Server] Player connected: ${playerId} (total: ${connections.size})`);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(conn, msg);
    } catch (err) {
      console.error('[Server] Bad message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[Server] Player disconnected: ${playerId}`);
    connections.delete(playerId);

    // Remove from matchmaking queue
    if (waitingPlayer?.conn.id === playerId) {
      waitingPlayer = null;
    }

    // Handle disconnect during draft
    for (const [gameId, draft] of drafts) {
      if (draft.player1.id === playerId || draft.player2.id === playerId) {
        const other = draft.player1.id === playerId ? draft.player2 : draft.player1;
        send(other.ws, 'opponent_disconnected', {});
        if (draft.timerInterval) clearInterval(draft.timerInterval);
        drafts.delete(gameId);
      }
    }

    // Handle disconnect during game
    for (const [gameId, game] of games) {
      if (game.player1Id === playerId || game.player2Id === playerId) {
        const otherId = game.player1Id === playerId ? game.player2Id : game.player1Id;
        const other = connections.get(otherId);
        if (other) {
          send(other.ws, 'game_over', { winner: otherId, reason: 'disconnect' });
        }
        game.stop();
        games.delete(gameId);
      }
    }
  });
});

// --- Message handler ---
function handleMessage(conn: PlayerConnection, msg: { type: string; payload: any }) {
  switch (msg.type) {
    case 'find_match':
      handleFindMatch(conn);
      break;
    case 'cancel_match':
      if (waitingPlayer?.conn.id === conn.id) waitingPlayer = null;
      break;
    case 'draft_pick':
      handleDraftPick(conn, msg.payload);
      break;
    case 'orders':
      handleOrders(conn, msg.payload);
      break;
    case 'command':
      handleCommand(conn, msg.payload);
      break;
    case 'ping':
      send(conn.ws, 'pong', { serverTime: Date.now(), clientTime: msg.payload?.clientTime });
      break;
  }
}

// --- Matchmaking ---
function handleFindMatch(conn: PlayerConnection) {
  if (waitingPlayer) {
    if (waitingPlayer.conn.id === conn.id) return; // already waiting

    // Match found!
    const gameId = `game_${Date.now()}_${uuid().slice(0, 8)}`;
    const p1 = waitingPlayer.conn;
    const p2 = conn;
    waitingPlayer = null;

    p1.gameId = gameId;
    p1.slot = 'player1';
    p2.gameId = gameId;
    p2.slot = 'player2';

    console.log(`[Server] Match found: ${p1.id} vs ${p2.id} -> ${gameId}`);

    // Start draft
    startDraft(gameId, p1, p2);
  } else {
    waitingPlayer = { conn, joinedAt: Date.now() };
    send(conn.ws, 'waiting', {});
    console.log(`[Server] Player waiting: ${conn.id}`);
  }
}

// --- Draft ---
function startDraft(gameId: string, p1: PlayerConnection, p2: PlayerConnection) {
  const pickOrder = [p1.id, p2.id, p2.id, p1.id, p1.id, p2.id];

  const draft: DraftState = {
    gameId,
    player1: p1,
    player2: p2,
    picks: [],
    pickOrder,
    currentPickIndex: 0,
    timer: 30,
    usedClasses: new Set(),
    usedAnimals: new Set(),
  };

  drafts.set(gameId, draft);

  const draftPayload = {
    gameId,
    pickOrder,
    currentPickIndex: 0,
    timer: 30,
    usedClasses: [] as string[],
    usedAnimals: [] as string[],
  };

  send(p1.ws, 'match_found', { gameId, slot: 'player1', draft: draftPayload });
  send(p2.ws, 'match_found', { gameId, slot: 'player2', draft: draftPayload });

  // Start draft timer
  draft.timerInterval = setInterval(() => {
    draft.timer--;
    if (draft.timer <= 0) {
      // Auto-pick for current player
      autoPick(draft);
    }
  }, 1000);
}

function autoPick(draft: DraftState) {
  const allClasses = Object.keys(CLASSES) as ClassId[];
  const allAnimals = Object.keys(ANIMALS) as AnimalId[];

  const availClasses = allClasses.filter(c => !draft.usedClasses.has(c));
  const availAnimals = allAnimals.filter(a => !draft.usedAnimals.has(a));

  if (availClasses.length === 0 || availAnimals.length === 0) return;

  const classId = availClasses[Math.floor(Math.random() * availClasses.length)];
  const animalId = availAnimals[Math.floor(Math.random() * availAnimals.length)];
  const playerId = draft.pickOrder[draft.currentPickIndex];

  processPick(draft, playerId, classId, animalId);
}

function handleDraftPick(conn: PlayerConnection, payload: { classId: ClassId; animalId: AnimalId }) {
  const draft = Array.from(drafts.values()).find(
    d => d.player1.id === conn.id || d.player2.id === conn.id
  );
  if (!draft) return;

  const expectedPlayer = draft.pickOrder[draft.currentPickIndex];
  if (conn.id !== expectedPlayer) return; // not your turn

  if (draft.usedClasses.has(payload.classId) || draft.usedAnimals.has(payload.animalId)) {
    send(conn.ws, 'draft_error', { message: 'Class or animal already picked' });
    return;
  }

  processPick(draft, conn.id, payload.classId, payload.animalId);
}

function processPick(draft: DraftState, playerId: string, classId: ClassId, animalId: AnimalId) {
  const pick: DraftPick = {
    playerId,
    classId,
    animalId,
    pickOrder: draft.currentPickIndex,
  };

  draft.picks.push(pick);
  draft.usedClasses.add(classId);
  draft.usedAnimals.add(animalId);
  draft.currentPickIndex++;
  draft.timer = 30;

  const update = {
    picks: draft.picks,
    currentPickIndex: draft.currentPickIndex,
    usedClasses: Array.from(draft.usedClasses),
    usedAnimals: Array.from(draft.usedAnimals),
    timer: 30,
  };

  send(draft.player1.ws, 'draft_update', update);
  send(draft.player2.ws, 'draft_update', update);

  // Check if draft is complete
  if (draft.currentPickIndex >= 6) {
    if (draft.timerInterval) clearInterval(draft.timerInterval);

    send(draft.player1.ws, 'draft_complete', { picks: draft.picks });
    send(draft.player2.ws, 'draft_complete', { picks: draft.picks });

    // Start game after short delay
    setTimeout(() => startGame(draft), 2000);
  }
}

// --- Game ---
function startGame(draft: DraftState) {
  const gameId = draft.gameId;
  const gameMap = loadMap();

  const room = new GameRoom(
    gameId,
    draft.player1.id,
    draft.player2.id,
    draft.picks,
    gameMap,
    // onStateUpdate
    (snapshot: SyncSnapshot) => {
      // Send to both players
      const p1 = connections.get(draft.player1.id);
      const p2 = connections.get(draft.player2.id);
      if (p1) send(p1.ws, 'game_state', snapshot);
      if (p2) send(p2.ws, 'game_state', snapshot);
    },
    // onGameOver
    (winner: string, reason: string) => {
      const p1 = connections.get(draft.player1.id);
      const p2 = connections.get(draft.player2.id);
      if (p1) send(p1.ws, 'game_over', { winner, reason });
      if (p2) send(p2.ws, 'game_over', { winner, reason });

      // Cleanup after delay
      setTimeout(() => {
        games.delete(gameId);
      }, 5000);
    },
  );

  games.set(gameId, room);
  drafts.delete(gameId);

  send(draft.player1.ws, 'game_start', { gameId });
  send(draft.player2.ws, 'game_start', { gameId });

  room.start();
  console.log(`[Server] Game started: ${gameId}`);
}

// --- In-game messages ---
function handleOrders(conn: PlayerConnection, payload: { orders: RemoteOrderPayload[] }) {
  if (!conn.gameId) return;
  const game = games.get(conn.gameId);
  if (!game) return;
  game.applyOrders(conn.id, payload.orders);
}

function handleCommand(conn: PlayerConnection, payload: { rawText: string; selectedCharId?: string }) {
  // For now, commands are parsed client-side and sent as orders
  // In the future, we can add server-side Gemini parsing here
  // Send back a simple ack
  send(conn.ws, 'command_ack', { message: 'Use client-side parsing and send orders' });
}

// --- Start ---
server.listen(PORT, () => {
  console.log(`\n  Prompt Battle Server running on http://localhost:${PORT}\n`);
  console.log(`  Players connect via WebSocket at ws://localhost:${PORT}\n`);
});
