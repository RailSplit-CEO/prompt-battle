// ═══════════════════════════════════════════════════════════════
// WORKFLOW VALIDATOR
// Validates HordeCommand JSON from LLM before game execution.
// Returns an array of error strings (empty = valid).
// ═══════════════════════════════════════════════════════════════

const VALID_TARGET_TYPES = new Set([
  'camp', 'nearest_camp', 'sweep_camps', 'nexus', 'base',
  'position', 'defend', 'retreat', 'workflow', 'query', 'advanced_plan',
]);

const VALID_RESPONSE_TYPES = new Set([
  'action', 'unrecognized', 'status_query', 'acknowledgment',
]);

const VALID_ACTIONS = new Set([
  'seek_resource', 'deliver', 'hunt', 'attack_camp', 'move',
  'defend', 'attack_enemies', 'scout', 'collect', 'kill_only',
  'mine', 'equip', 'contest_event', 'withdraw_base',
]);

const VALID_RESOURCE_TYPES = new Set(['carrot', 'meat', 'crystal', 'metal']);

const VALID_ANIMAL_TYPES = new Set([
  'gnome', 'turtle', 'skull', 'spider', 'hyena', 'rogue',
  'panda', 'lizard', 'minotaur', 'shaman', 'troll',
]);

const VALID_EQUIPMENT_TYPES = new Set([
  'pickaxe', 'sword', 'shield', 'boots', 'banner',
]);

const VALID_QUALIFIERS = new Set([
  'nearest', 'furthest', 'weakest', 'strongest', 'uncaptured', 'enemy',
]);

const VALID_FORMATIONS = new Set(['spread', 'tight', null]);
const VALID_CAUTIONS = new Set(['safe', 'aggressive', null]);
const VALID_PACINGS = new Set(['rush', 'efficient', null]);

export interface HordeCommandLike {
  targetType?: string;
  responseType?: string;
  workflow?: { action?: string; resourceType?: string; targetType?: string; targetAnimal?: string; equipmentType?: string; qualifier?: string; x?: any; y?: any; target?: string }[];
  loopFrom?: number;
  modifiers?: { formation?: string | null; caution?: string | null; pacing?: string | null };
  modifierOnly?: boolean;
  planGoal?: { type?: string; equipment?: string; resource?: string; amount?: number; thenAction?: string };
  [key: string]: any;
}

export function validateHordeCommand(cmd: HordeCommandLike): string[] {
  const errors: string[] = [];

  if (!cmd || typeof cmd !== 'object') {
    return ['Command must be a JSON object'];
  }

  // targetType
  if (!cmd.targetType) {
    errors.push('Missing targetType');
  } else if (!VALID_TARGET_TYPES.has(cmd.targetType)) {
    errors.push(`Invalid targetType "${cmd.targetType}". Must be one of: ${[...VALID_TARGET_TYPES].join(', ')}`);
  }

  // responseType (optional but if present must be valid)
  if (cmd.responseType && !VALID_RESPONSE_TYPES.has(cmd.responseType)) {
    errors.push(`Invalid responseType "${cmd.responseType}". Must be one of: ${[...VALID_RESPONSE_TYPES].join(', ')}`);
  }

  // Workflow validation
  if (cmd.targetType === 'workflow') {
    if (!cmd.workflow || !Array.isArray(cmd.workflow) || cmd.workflow.length === 0) {
      errors.push('targetType is "workflow" but workflow array is missing or empty');
    } else {
      if (cmd.workflow.length > 10) {
        errors.push(`Workflow has ${cmd.workflow.length} steps — max 10`);
      }

      for (let i = 0; i < cmd.workflow.length; i++) {
        const step = cmd.workflow[i];
        if (!step.action) {
          errors.push(`Workflow step ${i}: missing action`);
          continue;
        }
        if (!VALID_ACTIONS.has(step.action)) {
          errors.push(`Workflow step ${i}: invalid action "${step.action}". Must be one of: ${[...VALID_ACTIONS].join(', ')}`);
          continue;
        }

        // Action-specific validation
        if (step.action === 'seek_resource' || step.action === 'collect' || step.action === 'withdraw_base') {
          if (step.resourceType && !VALID_RESOURCE_TYPES.has(step.resourceType)) {
            errors.push(`Step ${i}: invalid resourceType "${step.resourceType}"`);
          }
        }
        if (step.action === 'equip') {
          if (!step.equipmentType) {
            errors.push(`Step ${i}: equip action requires equipmentType`);
          } else if (!VALID_EQUIPMENT_TYPES.has(step.equipmentType)) {
            errors.push(`Step ${i}: invalid equipmentType "${step.equipmentType}"`);
          }
        }
        if (step.action === 'attack_camp') {
          if (step.targetAnimal && !VALID_ANIMAL_TYPES.has(step.targetAnimal)) {
            errors.push(`Step ${i}: invalid targetAnimal "${step.targetAnimal}"`);
          }
          if (step.qualifier && !VALID_QUALIFIERS.has(step.qualifier)) {
            errors.push(`Step ${i}: invalid qualifier "${step.qualifier}"`);
          }
        }
        if (step.action === 'hunt' || step.action === 'kill_only') {
          if (step.targetType && !VALID_ANIMAL_TYPES.has(step.targetType)) {
            errors.push(`Step ${i}: invalid hunt targetType "${step.targetType}"`);
          }
        }
        if (step.action === 'move' || step.action === 'scout') {
          if (step.x !== undefined && (typeof step.x !== 'number' || step.x < 0 || step.x > 6400)) {
            errors.push(`Step ${i}: x must be a number between 0 and 6400`);
          }
          if (step.y !== undefined && (typeof step.y !== 'number' || step.y < 0 || step.y > 6400)) {
            errors.push(`Step ${i}: y must be a number between 0 and 6400`);
          }
        }
      }

      // loopFrom bounds
      if (cmd.loopFrom !== undefined) {
        if (typeof cmd.loopFrom !== 'number' || cmd.loopFrom < 0 || cmd.loopFrom >= cmd.workflow.length) {
          errors.push(`loopFrom ${cmd.loopFrom} is out of bounds (workflow has ${cmd.workflow.length} steps, valid range: 0-${cmd.workflow.length - 1})`);
        }
      }
    }
  }

  // Modifier validation
  if (cmd.modifiers) {
    if (cmd.modifiers.formation !== undefined && !VALID_FORMATIONS.has(cmd.modifiers.formation)) {
      errors.push(`Invalid formation "${cmd.modifiers.formation}". Must be: spread, tight, or null`);
    }
    if (cmd.modifiers.caution !== undefined && !VALID_CAUTIONS.has(cmd.modifiers.caution)) {
      errors.push(`Invalid caution "${cmd.modifiers.caution}". Must be: safe, aggressive, or null`);
    }
    if (cmd.modifiers.pacing !== undefined && !VALID_PACINGS.has(cmd.modifiers.pacing)) {
      errors.push(`Invalid pacing "${cmd.modifiers.pacing}". Must be: rush, efficient, or null`);
    }
  }

  // Advanced plan validation
  if (cmd.targetType === 'advanced_plan') {
    if (!cmd.planGoal) {
      errors.push('targetType is "advanced_plan" but planGoal is missing');
    } else {
      if (!cmd.planGoal.type || !['unlock_equipment', 'stockpile_resource'].includes(cmd.planGoal.type)) {
        errors.push(`Invalid planGoal.type "${cmd.planGoal.type}". Must be: unlock_equipment or stockpile_resource`);
      }
      if (cmd.planGoal.type === 'unlock_equipment' && cmd.planGoal.equipment && !VALID_EQUIPMENT_TYPES.has(cmd.planGoal.equipment)) {
        errors.push(`Invalid planGoal.equipment "${cmd.planGoal.equipment}"`);
      }
      if (cmd.planGoal.type === 'stockpile_resource' && cmd.planGoal.resource && !VALID_RESOURCE_TYPES.has(cmd.planGoal.resource)) {
        errors.push(`Invalid planGoal.resource "${cmd.planGoal.resource}"`);
      }
    }
  }

  return errors;
}
