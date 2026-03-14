// ═══════════════════════════════════════════════════════
// JUNGLE LANES - Map Layout (fully isolated)
// Diagonal mirror: P1 base bottom-left, P2 base top-right
// ═══════════════════════════════════════════════════════

import { Position, LaneId, TeamId, MonsterType } from './types';

export interface JungleLaneMapDef {
  nexus1: Position;
  nexus2: Position;
  spawn1: Position[];
  spawn2: Position[];
  lanes: Record<LaneId, Position[]>;
  towers: {
    team1: Record<LaneId, Position[]>;
    team2: Record<LaneId, Position[]>;
  };
  camps: Array<{
    position: Position;
    monsterType: MonsterType;
    nearestLane: LaneId;
    side: TeamId;
  }>;
  dragonPit: Position;
}

export const MAP: JungleLaneMapDef = {
  nexus1: { x: 5, y: 74 },
  nexus2: { x: 74, y: 5 },

  spawn1: [
    { x: 7, y: 72 }, { x: 9, y: 72 }, { x: 7, y: 74 },
    { x: 9, y: 74 }, { x: 8, y: 73 },
  ],
  spawn2: [
    { x: 72, y: 7 }, { x: 70, y: 7 }, { x: 72, y: 5 },
    { x: 70, y: 5 }, { x: 71, y: 6 },
  ],

  lanes: {
    top: [
      { x: 5, y: 70 }, { x: 5, y: 60 }, { x: 5, y: 50 },
      { x: 5, y: 40 }, { x: 5, y: 30 }, { x: 5, y: 20 },
      { x: 5, y: 10 }, { x: 5, y: 5 },
      { x: 15, y: 5 }, { x: 25, y: 5 }, { x: 35, y: 5 },
      { x: 45, y: 5 }, { x: 55, y: 5 }, { x: 65, y: 5 },
      { x: 74, y: 5 },
    ],
    mid: [
      { x: 10, y: 70 }, { x: 16, y: 64 }, { x: 22, y: 58 },
      { x: 28, y: 52 }, { x: 34, y: 46 }, { x: 40, y: 40 },
      { x: 46, y: 34 }, { x: 52, y: 28 }, { x: 58, y: 22 },
      { x: 64, y: 16 }, { x: 70, y: 10 },
    ],
    bot: [
      { x: 10, y: 74 }, { x: 20, y: 74 }, { x: 30, y: 74 },
      { x: 40, y: 74 }, { x: 50, y: 74 }, { x: 60, y: 74 },
      { x: 70, y: 74 }, { x: 74, y: 74 },
      { x: 74, y: 65 }, { x: 74, y: 55 }, { x: 74, y: 45 },
      { x: 74, y: 35 }, { x: 74, y: 25 }, { x: 74, y: 15 },
      { x: 74, y: 5 },
    ],
  },

  towers: {
    team1: {
      top: [{ x: 5, y: 60 }, { x: 5, y: 50 }, { x: 5, y: 40 }],
      mid: [{ x: 16, y: 64 }, { x: 24, y: 56 }, { x: 32, y: 48 }],
      bot: [{ x: 20, y: 74 }, { x: 35, y: 74 }, { x: 50, y: 74 }],
    },
    team2: {
      top: [{ x: 55, y: 5 }, { x: 45, y: 5 }, { x: 35, y: 5 }],
      mid: [{ x: 64, y: 16 }, { x: 56, y: 24 }, { x: 48, y: 32 }],
      bot: [{ x: 74, y: 20 }, { x: 74, y: 35 }, { x: 74, y: 50 }],
    },
  },

  camps: [
    // Team 1 - Top (5)
    { position: { x: 12, y: 60 }, monsterType: 'bunny', nearestLane: 'top', side: 'team1' },
    { position: { x: 12, y: 52 }, monsterType: 'wolf', nearestLane: 'top', side: 'team1' },
    { position: { x: 12, y: 44 }, monsterType: 'turtle', nearestLane: 'top', side: 'team1' },
    { position: { x: 12, y: 36 }, monsterType: 'bear', nearestLane: 'top', side: 'team1' },
    { position: { x: 12, y: 28 }, monsterType: 'lion', nearestLane: 'top', side: 'team1' },
    // Team 1 - Mid (6, 3 each side)
    { position: { x: 18, y: 56 }, monsterType: 'bunny', nearestLane: 'mid', side: 'team1' },
    { position: { x: 24, y: 50 }, monsterType: 'wolf', nearestLane: 'mid', side: 'team1' },
    { position: { x: 30, y: 44 }, monsterType: 'bear', nearestLane: 'mid', side: 'team1' },
    { position: { x: 22, y: 66 }, monsterType: 'bunny', nearestLane: 'mid', side: 'team1' },
    { position: { x: 28, y: 60 }, monsterType: 'turtle', nearestLane: 'mid', side: 'team1' },
    { position: { x: 34, y: 54 }, monsterType: 'wolf', nearestLane: 'mid', side: 'team1' },
    // Team 1 - Bot (5)
    { position: { x: 20, y: 68 }, monsterType: 'bunny', nearestLane: 'bot', side: 'team1' },
    { position: { x: 28, y: 68 }, monsterType: 'wolf', nearestLane: 'bot', side: 'team1' },
    { position: { x: 36, y: 68 }, monsterType: 'turtle', nearestLane: 'bot', side: 'team1' },
    { position: { x: 44, y: 68 }, monsterType: 'bear', nearestLane: 'bot', side: 'team1' },
    { position: { x: 52, y: 68 }, monsterType: 'lion', nearestLane: 'bot', side: 'team1' },

    // Team 2 - Top (5)
    { position: { x: 60, y: 12 }, monsterType: 'bunny', nearestLane: 'top', side: 'team2' },
    { position: { x: 52, y: 12 }, monsterType: 'wolf', nearestLane: 'top', side: 'team2' },
    { position: { x: 44, y: 12 }, monsterType: 'turtle', nearestLane: 'top', side: 'team2' },
    { position: { x: 36, y: 12 }, monsterType: 'bear', nearestLane: 'top', side: 'team2' },
    { position: { x: 28, y: 12 }, monsterType: 'lion', nearestLane: 'top', side: 'team2' },
    // Team 2 - Mid (6)
    { position: { x: 56, y: 18 }, monsterType: 'bunny', nearestLane: 'mid', side: 'team2' },
    { position: { x: 50, y: 24 }, monsterType: 'wolf', nearestLane: 'mid', side: 'team2' },
    { position: { x: 44, y: 30 }, monsterType: 'bear', nearestLane: 'mid', side: 'team2' },
    { position: { x: 66, y: 22 }, monsterType: 'bunny', nearestLane: 'mid', side: 'team2' },
    { position: { x: 60, y: 28 }, monsterType: 'turtle', nearestLane: 'mid', side: 'team2' },
    { position: { x: 54, y: 34 }, monsterType: 'wolf', nearestLane: 'mid', side: 'team2' },
    // Team 2 - Bot (5)
    { position: { x: 68, y: 20 }, monsterType: 'bunny', nearestLane: 'bot', side: 'team2' },
    { position: { x: 68, y: 28 }, monsterType: 'wolf', nearestLane: 'bot', side: 'team2' },
    { position: { x: 68, y: 36 }, monsterType: 'turtle', nearestLane: 'bot', side: 'team2' },
    { position: { x: 68, y: 44 }, monsterType: 'bear', nearestLane: 'bot', side: 'team2' },
    { position: { x: 68, y: 52 }, monsterType: 'lion', nearestLane: 'bot', side: 'team2' },
  ],

  dragonPit: { x: 40, y: 40 },
};
