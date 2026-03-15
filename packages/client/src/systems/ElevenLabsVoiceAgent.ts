// ═══════════════════════════════════════════════════════════════
// ELEVENLABS VOICE AGENT
// Manages an ElevenLabs Conversational AI session (WebRTC)
// that bundles STT + Gemini 2.5 Flash + TTS + tool calling.
// ═══════════════════════════════════════════════════════════════

import { Conversation } from '@elevenlabs/client';
import type { Status, DisconnectionDetails } from '@elevenlabs/client';
import { validateHordeCommand } from './WorkflowValidator';

// Re-use the same interfaces from HordeScene — imported as type-only
// to avoid circular deps. The actual types are defined in HordeScene.ts.
export interface GameContext {
  myUnits: { type: string; count: number; tier: number; gathering: number }[];
  camps: { name: string; animalType: string; tier: number; owner: string; index: number; x: number; y: number; dist: number; defenders: number; storedFood: number; spawnCost: number }[];
  nexusHp: { mine: number; enemy: number };
  resources: { carrot: number; meat: number; crystal: number; metal: number };
  groundCarrots: number;
  groundMeat: number;
  groundCrystals: number;
  gameTime: number;
  selectedHoard: string;
  hoardCenter: { x: number; y: number };
  carrotZones: { x: number; y: number; w: number; h: number }[];
  activeEvents?: { type: string; emoji: string; name: string; x: number; y: number; timeLeft: number; info: string; howToWin: string }[];
  activeBuffs?: { stat: string; amount: number; remaining: number }[];
}

export interface HordeCommand {
  targetType: string;
  targetAnimal?: string;
  campIndex?: number;
  qualifier?: string;
  workflow?: { action: string; resourceType?: string; target?: string; targetType?: string; campIndex?: number; qualifier?: string; targetAnimal?: string; x?: number; y?: number; equipmentType?: string }[];
  loopFrom?: number;
  narration?: string;
  unitReaction?: string;
  modifiers?: { formation?: string | null; caution?: string | null; pacing?: string | null };
  modifierOnly?: boolean;
  responseType?: string;
  statusReport?: string;
  planGoal?: { type: string; equipment?: string; resource?: string; amount?: number; thenAction?: string };
}

export interface VoiceAgentConfig {
  agentId: string;
  onWorkflowReceived: (cmd: HordeCommand) => void;
  onAgentSpeaking?: (text: string) => void;
  onStatusChange?: (status: string) => void;
  onUserTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}

export class ElevenLabsVoiceAgent {
  private conversation: Conversation | null = null;
  private agentId: string;
  private onWorkflowReceived: (cmd: HordeCommand) => void;
  private onAgentSpeaking?: (text: string) => void;
  private onStatusChange?: (status: string) => void;
  private onUserTranscript?: (text: string) => void;
  private onError?: (error: string) => void;
  private _status: string = 'disconnected';
  private _lastContextUpdate = 0;
  private static readonly CONTEXT_UPDATE_THROTTLE = 5000; // 5s min between updates

  constructor(config: VoiceAgentConfig) {
    this.agentId = config.agentId;
    this.onWorkflowReceived = config.onWorkflowReceived;
    this.onAgentSpeaking = config.onAgentSpeaking;
    this.onStatusChange = config.onStatusChange;
    this.onUserTranscript = config.onUserTranscript;
    this.onError = config.onError;
  }

  get status(): string { return this._status; }
  get isConnected(): boolean { return this._status === 'connected'; }

  async startSession(gameContext: GameContext): Promise<boolean> {
    // Don't start if already connected
    if (this.conversation) {
      console.warn('[VoiceAgent] Session already active');
      return true;
    }

    try {
      const contextSummary = this.buildContextSummary(gameContext);

      this.conversation = await Conversation.startSession({
        agentId: this.agentId,
        connectionType: 'webrtc',

        // Inject game state as dynamic variables for the agent's system prompt
        dynamicVariables: {
          game_state: contextSummary,
          game_time: Math.floor(gameContext.gameTime / 1000),
          selected_hoard: gameContext.selectedHoard,
          carrots: gameContext.resources.carrot,
          meat: gameContext.resources.meat,
          crystals: gameContext.resources.crystal,
          metal: gameContext.resources.metal,
        },

        // Client tool: the agent calls this to submit a workflow JSON
        clientTools: {
          submitWorkflow: async (params: any) => {
            return this.handleSubmitWorkflow(params);
          },
        },

        // Callbacks
        onConnect: ({ conversationId }) => {
          console.log('[VoiceAgent] Connected:', conversationId);
          this._status = 'connected';
          this.onStatusChange?.('connected');
        },

        onDisconnect: (details: DisconnectionDetails) => {
          console.log('[VoiceAgent] Disconnected:', details.reason);
          this._status = 'disconnected';
          this.conversation = null;
          this.onStatusChange?.('disconnected');
        },

        onError: (message: string, context?: any) => {
          console.error('[VoiceAgent] Error:', message, context);
          this.onError?.(message);
        },

        onMessage: (props) => {
          // Agent or user message
          if (props.role === 'agent') {
            this.onAgentSpeaking?.(props.message);
          } else if (props.role === 'user') {
            this.onUserTranscript?.(props.message);
          }
        },

        onStatusChange: ({ status }: { status: Status }) => {
          this._status = status;
          this.onStatusChange?.(status);
        },

        onModeChange: ({ mode }) => {
          // 'speaking' = agent is talking, 'listening' = waiting for user
          // Could update UI indicator here
        },
      });

      // Start with mic muted — player unmutes by holding SPACE
      this.conversation.setMicMuted(true);

      return true;
    } catch (err) {
      console.error('[VoiceAgent] Failed to start session:', err);
      this._status = 'disconnected';
      this.onError?.(`Failed to connect: ${err}`);
      return false;
    }
  }

  /**
   * Push updated game state mid-conversation.
   * Throttled to avoid flooding the agent.
   */
  updateGameState(gameContext: GameContext): void {
    if (!this.conversation || !this.isConnected) return;
    const now = Date.now();
    if (now - this._lastContextUpdate < ElevenLabsVoiceAgent.CONTEXT_UPDATE_THROTTLE) return;
    this._lastContextUpdate = now;

    const summary = this.buildContextSummary(gameContext);
    this.conversation.sendContextualUpdate(
      `[GAME STATE UPDATE]\n${summary}`
    );
  }

  async endSession(): Promise<void> {
    if (!this.conversation) return;
    try {
      await this.conversation.endSession();
    } catch (err) {
      console.warn('[VoiceAgent] Error ending session:', err);
    }
    this.conversation = null;
    this._status = 'disconnected';
    this.onStatusChange?.('disconnected');
  }

  setMicMuted(muted: boolean): void {
    if (!this.conversation) return;
    this.conversation.setMicMuted(muted);
  }

  /**
   * Send a typed text command as if the user spoke it.
   * Useful as fallback when mic isn't available.
   */
  sendTextCommand(text: string): void {
    if (!this.conversation || !this.isConnected) return;
    this.conversation.sendUserMessage(text);
  }

  // ─── Client Tool Handler ────────────────────────────────────

  private handleSubmitWorkflow(params: any): string {
    try {
      // The agent sends the JSON as a string parameter
      let parsed: any;
      if (typeof params === 'string') {
        parsed = JSON.parse(params);
      } else if (typeof params?.json === 'string') {
        parsed = JSON.parse(params.json);
      } else if (typeof params === 'object') {
        // Agent might send it as a structured object directly
        parsed = params.json ? (typeof params.json === 'string' ? JSON.parse(params.json) : params.json) : params;
      } else {
        return 'Error: Expected a JSON object or a "json" string parameter. Send the workflow as a JSON string in the "json" parameter.';
      }

      // Validate
      const errors = validateHordeCommand(parsed);
      if (errors.length > 0) {
        return `Validation failed: ${errors.join('; ')}. Fix these issues and call submitWorkflow again.`;
      }

      // Success — deliver to game
      this.onWorkflowReceived(parsed as HordeCommand);
      return 'Workflow applied successfully. The units are executing the command.';
    } catch (e: any) {
      return `Invalid JSON: ${e.message}. Make sure to send valid JSON. Fix and call submitWorkflow again.`;
    }
  }

  // ─── Context Builder ────────────────────────────────────────

  private buildContextSummary(ctx: GameContext): string {
    const unitList = ctx.myUnits.map(u => {
      let info = `${u.type} (T${u.tier}): ${u.count} units`;
      if (u.gathering > 0) info += ` (${u.gathering} on task)`;
      return info;
    }).join(', ');

    const campList = ctx.camps.slice(0, 8).map(c =>
      `[${c.index}] ${c.animalType} (T${c.tier}) ${c.owner} d:${c.dist}${c.storedFood > 0 ? ` food:${c.storedFood}/${c.spawnCost}` : ''}`
    ).join(' | ');

    const events = ctx.activeEvents?.map(e => `${e.emoji}${e.name} at (${e.x},${e.y}) ${e.timeLeft}s left`).join(', ') || 'none';
    const buffs = ctx.activeBuffs?.map(b => `+${Math.round(b.amount * 100)}% ${b.stat} (${b.remaining}s)`).join(', ') || 'none';

    return [
      `Time: ${Math.floor(ctx.gameTime / 1000)}s | Hoard: ${ctx.selectedHoard} at (${ctx.hoardCenter.x},${ctx.hoardCenter.y})`,
      `Resources: 🥕${ctx.resources.carrot} 🍖${ctx.resources.meat} 💎${ctx.resources.crystal} ⚙️${ctx.resources.metal}`,
      `Ground: 🥕${ctx.groundCarrots} 🍖${ctx.groundMeat} 💎${ctx.groundCrystals}`,
      `Units: ${unitList || 'none'}`,
      `Castle HP: mine=${ctx.nexusHp.mine}/50000 enemy=${ctx.nexusHp.enemy >= 0 ? ctx.nexusHp.enemy + '/50000' : 'unknown'}`,
      `Camps: ${campList || 'none'}`,
      `Events: ${events}`,
      `Buffs: ${buffs}`,
    ].join('\n');
  }
}
