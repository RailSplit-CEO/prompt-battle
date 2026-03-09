import { ActionType, Position } from './game-state';

export interface RawCommand {
  gameId: string;
  playerId: string;
  rawText: string;
  timestamp: number;
}

export interface ParsedAction {
  heroId: string;
  action: ActionType;
  targetId?: string;
  targetPosition?: Position;
}

export interface ParsedCommand {
  actions: ParsedAction[];
  reasoning?: string;
}

export interface CommandResponse {
  success: boolean;
  actions?: ParsedAction[];
  error?: string;
  reasoning?: string;
}

export interface MatchmakingEntry {
  playerId: string;
  timestamp: number;
  status: 'waiting' | 'matched';
  gameId?: string;
}
