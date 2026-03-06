import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { buildSystemPrompt, buildGameStateContext } from './prompt-templates';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const actionSchema = {
  type: SchemaType.OBJECT,
  properties: {
    actions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          characterRef: {
            type: SchemaType.STRING,
            description: 'The ID of the character to command',
          },
          action: {
            type: SchemaType.STRING,
            enum: ['move', 'attack', 'ability', 'defend', 'retreat', 'hold'],
            description: 'The action type',
          },
          targetRef: {
            type: SchemaType.STRING,
            description: 'Target character ID (for attack/ability)',
          },
          targetPosition: {
            type: SchemaType.OBJECT,
            properties: {
              x: { type: SchemaType.NUMBER },
              y: { type: SchemaType.NUMBER },
            },
            description: 'Target position (for move)',
          },
          abilityId: {
            type: SchemaType.STRING,
            description: 'Ability ID to use (for ability action)',
          },
        },
        required: ['characterRef', 'action'],
      },
    },
    reasoning: {
      type: SchemaType.STRING,
      description: 'Brief explanation of how the command was interpreted',
    },
  },
  required: ['actions'],
};

export interface ParsedResult {
  actions: Array<{
    characterRef: string;
    action: 'move' | 'attack' | 'ability' | 'defend' | 'retreat' | 'hold';
    targetRef?: string;
    targetPosition?: { x: number; y: number };
    abilityId?: string;
  }>;
  reasoning?: string;
}

export async function parseCommand(
  rawText: string,
  characters: Record<string, any>,
  playerId: string
): Promise<ParsedResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: actionSchema as any,
      temperature: 0.1,
    },
  });

  const systemPrompt = buildSystemPrompt();
  const gameContext = buildGameStateContext(characters, playerId);

  const prompt = `${systemPrompt}\n\n${gameContext}\n\nPlayer command: "${rawText}"\n\nParse this command into game actions.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  try {
    return JSON.parse(text) as ParsedResult;
  } catch {
    throw new Error('Failed to parse Gemini response as JSON');
  }
}
