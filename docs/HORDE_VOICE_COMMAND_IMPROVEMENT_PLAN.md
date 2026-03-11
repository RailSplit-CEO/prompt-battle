# Horde Mode: Voice Command Improvement Plan

## Context

New players say things like "what do I do?", "jump", "open inventory", "pause", "oh no!" and the system wastes a Gemini API call, gets garbage back, falls through the local parser, and shows "Huh? Try simpler." — teaching the player nothing. We're implementing three layered solutions:

1. **Smart Pre-Filter** — catches obvious non-commands client-side for $0 / 0ms
2. **Enthusiastic Mascot Advisor** — speaks helpful guidance via TTS with personality
3. **Gemini Query Mode** — lets "how are we doing?" get real answers from the LLM
4. **Enriched Failure Path** (bonus) — replaces "Huh? Try simpler." with contextual hints

---

## Files to Modify

| File | Changes |
|---|---|
| `packages/client/src/systems/CommandPreFilter.ts` | **NEW FILE** — classifier + response templates + mascot personality |
| `packages/client/src/scenes/HordeScene.ts` | Import pre-filter + TTS, intercept in `handleCommand()`, add query handler in `executeGeminiCommand()`, replace failure message, add `getContextualHint()` |
| `packages/client/src/systems/TtsService.ts` | No changes — import as-is into HordeScene |

---

## Step 1: Create `CommandPreFilter.ts`

New file at `packages/client/src/systems/CommandPreFilter.ts`.

### 1a. Input Classification

```typescript
export type InputClass = 'valid' | 'query' | 'impossible' | 'emotional' | 'gibberish' | 'unknown';
export type ImpossibleSubtype = 'fps' | 'rpg' | 'building' | 'meta' | 'generic';

export interface Classification {
  type: InputClass;
  subtype?: ImpossibleSubtype;
}

export function classifyInput(text: string): Classification
```

**Pattern dictionaries** (const arrays of RegExp tested against lowercased input):

**`VALID_SIGNALS`** — if ANY match, return `valid` (pass to Gemini):
- Action verbs: `attack|capture|take|make|get|gather|farm|collect|harvest|mine|defend|guard|protect|retreat|scout|explore|move|go|push|sweep|produce|train|spawn|bootstrap|equip|grab|pick up|unlock|buy|research|kill|fight|raid|hunt|send|charge|contest|deliver|stockpile`
- Target nouns: `camp|base|nexus|throne|gnome|turtle|skull|spider|hyena|panda|lizard|minotaur|shaman|troll|rogue|carrot|meat|crystal|metal|pickaxe|sword|shield|boots|banner|event`
- Directions: `left|right|up|down|north|south|east|west|forward|backward|center|middle`
- Horde keywords: `hoard|horde|everyone|all|spread|tight|safe|careful|aggressive|rush|efficient|started`
- Modifiers: `safely|carefully|aggressively|quickly`

**`QUERY_PATTERNS`** — starts with question word AND no valid signal outweighs it:
- `^(how|what|where|when|why|who|which)\b`
- `^(can I|do I|should I|is there|are there|tell me|am I)\b`
- `\b(help|tutorial|instructions|controls|explain|guide|status|score|winning|losing)\b` (standalone, no action verb)

**`IMPOSSIBLE_PATTERNS`** by subtype:
- `fps`: `\b(jump|shoot|fire|aim|reload|crouch|sprint|dodge|roll|block|parry|throw grenade|melee|slash|punch|kick|dash|teleport|snipe|scope)\b`
- `rpg`: `\b(inventory|backpack|potion|spell|skill tree|ability|level up|loot|open chest|open door|use item|magic|mana|health potion|cast)\b`
- `building`: `\b(build|construct|craft|place)\s+(wall|tower|building|trap|structure|house|fence|base)\b`
- `meta`: `\b(pause|unpause|save|load|quit|exit|restart|settings|options|menu|volume|brightness|difficulty|fullscreen|mute)\b`

**`EMOTIONAL_PATTERNS`**:
- `^(oh|ah|ugh|wow|yes|no|damn|dammit|nice|cool|awesome|whoa|yikes|oops|nooo+|yesss+|haha|lol|woo+|lets go|come on)!*$`
- `\b(oh (no|god|man|crap)|what the (heck|hell)|are you kidding|that's (great|terrible|bad|good)|I (love|hate) this)\b`

**`GIBBERISH_SET`**: `um, uh, hmm, ok, okay, so, well, like, I mean, the, a, an, it, this, yeah`

**Scoring logic:**
```
1. Trim + lowercase
2. If length < 2 or in GIBBERISH_SET → 'gibberish'
3. Score valid signals (count matches)
4. Score query signals
5. Score impossible signals
6. Score emotional signals
7. If query > 0 AND valid <= 0 → 'query' (question with no action verb)
8. If valid > 0 → 'valid' (any action signal = send to Gemini)
9. If impossible > 0 → 'impossible' (with subtype)
10. If emotional > 0 → 'emotional'
11. Else → 'unknown' (send to Gemini conservatively)
```

Key edge cases:
- "can I attack?" → query=1 + valid=1 → valid wins (step 8) ✓
- "how do I play?" → query=1 + valid=0 → query ✓
- "get started" → valid=1 → valid ✓
- "help" → query=1 + valid=0 → query ✓
- "jump" → impossible=1 → impossible ✓
- "attack" → valid=1 → valid ✓
- "oh no" → emotional=1 → emotional ✓

### 1b. Mascot Response System

```typescript
export interface MascotResponse {
  text: string;        // Display text
  speakText: string;   // TTS text (may be slightly different)
  color: string;       // Feedback color hex
  showConfused: boolean; // Whether units show confused bubbles
}

export function getMascotResponse(
  classification: Classification,
  gameContext?: { unitCount: number; campsCaptured: number; baseUnderAttack: boolean; gameTime: number }
): MascotResponse | null  // null = silently ignored (gibberish) or pass-through (valid/unknown)
```

**Personality: Enthusiastic Mascot** — hyper-positive, cheerful, always ends with a concrete suggestion. Think Navi meets a hype-beast. Never condescending, always excited about what you CAN do.

**Response pools (5+ per category, randomly selected):**

**Query responses** (context-aware):
- If gameTime < 30s: "Ooh exciting, it's your first time! Hold SPACE and say 'get started' — trust me, it's AMAZING!"
- If unitCount === 0: "You need an army first! Say 'get started' and watch the gnomes GO!"
- If campsCaptured === 0: "Capture a camp! Say 'attack nearest camp' — you're gonna LOVE this!"
- If baseUnderAttack: "YOUR BASE NEEDS YOU! Say 'defend base' — go go go!"
- Default pool: "You're the commander! Say things like 'make gnomes' or 'attack the skull camp'!", "Ooh so many options! Try 'gather carrots', 'attack camp', or 'make skulls'!", "Your horde awaits! Try 'get started' to begin the mayhem!"
- Color: `#6CC4FF` (info blue)

**Impossible responses** by subtype:
- fps: "Ooh no jumping here BUT — you can command an ARMY! Say 'attack' or 'make gnomes'!", "Shooting? Even BETTER — say 'attack enemies' and watch your whole horde go wild!", "No aiming needed! Your horde does the fighting! Try 'attack nearest camp'!"
- rpg: "No inventory BUT your units ARE your inventory! Say 'make skulls' for an army of skeletons!", "Potions? Who needs em! Say 'get started' and let your gnomes do the work!", "No spells here, but say 'make shamans' for some serious magic vibes!"
- building: "You don't build — you CONQUER! Say 'attack nearest camp' to claim territory!", "Why build when you can CAPTURE? Say 'attack camp' and it's yours!"
- meta: "No pause button in WAR! But press Escape if you need a break. Now — what should your horde do?", "Settings? BORING! Say 'make gnomes' for instant FUN instead!"
- Color: `#FFD93D` (warning yellow), showConfused: true

**Emotional responses:**
- Positive ("yes!", "nice!", "awesome!", "let's go!"): "YESSS that energy! Channel it — what's the next order?!", "I LOVE the enthusiasm! Now tell your horde what to do!", "That's the spirit!! Keep commanding!"
- Negative ("oh no", "damn", "ugh"): "Hey it's okay! Say 'defend base' to regroup! You got this!", "Setback? NAH — say 'make gnomes' and bounce back!", "Don't give up! Your horde believes in you! Try 'retreat' to fall back!"
- Color: positive=`#45E6B0` (green), negative=`#FFD93D` (yellow), showConfused: false

**Gibberish:** Return `null` (silently ignore, clear transcript after delay).

**Cooldown:** Track `lastMascotResponseTime`. Don't fire more than once per 3 seconds to avoid spam.

### 1c. Local Status Reporter

For queries that can be answered locally (avoiding Gemini), build a status string from game state:

```typescript
export function buildLocalStatus(ctx: {
  unitCount: number; campsCaptured: number; enemyCamps: number;
  nexusHp: { mine: number; enemy: number };
  resources: { carrot: number; meat: number; crystal: number };
  gameTime: number;
}): string
```

Example output: "You have 12 units, 3 camps captured. Your nexus: 45000, enemy: 38000. You're ahead! Push with 'attack nexus'!"

BUT: If the query seems genuinely strategic/complex ("what should I do?", "what's my best move?"), the pre-filter should classify it as `unknown` to let Gemini handle it with full game context via Query Mode.

Simple heuristic: queries with "should", "best", "plan", "strategy" → `unknown` (route to Gemini). Others → answer locally.

---

## Step 2: Gemini Query Mode

### 2a. Schema change in HordeScene.ts

Add to the `HordeCommand` interface (line 42):
```typescript
interface HordeCommand {
  targetType: 'camp' | 'nearest_camp' | 'sweep_camps' | 'nexus' | 'base' | 'position' | 'defend' | 'retreat' | 'workflow' | 'query'; // ADD 'query'
  statusReport?: string; // NEW: filled when targetType='query'
  // ... rest unchanged
}
```

### 2b. Prompt addition

Add to the `INTENT CLASSIFICATION` section (after "H) MOVEMENT"), roughly line 262:

```
I) STATUS QUERY: player asks a question instead of giving an order
   → "how are we doing?", "what should I do?", "who's winning?", "what's my plan?", "should I push?"
   → targetType: "query"
   → statusReport: 1-2 sentence tactical answer using REAL game state data (unit counts, nexus HP, camp ownership, resources). Be specific — mention numbers.
   → narration: max 5 words, terse
   → unitReaction: omit or null
   → modifiers: omit
   Examples:
   "how are we doing?" → statusReport: "15 gnomes, 8 skulls. 3 camps ours. Enemy nexus at 38000 — push now!", narration: "Status report"
   "what should I do?" → statusReport: "Capture the spider camp for T2 units, then bootstrap skulls. You have enough carrots.", narration: "Strategic advice"
   "should I attack?" → statusReport: "With 20 units and enemy nexus at 30000? Absolutely. Send everything!", narration: "Green light"
```

Also add `"query"` to the JSON schema at the end of the prompt (line 385):
```
"targetType": "<camp|nearest_camp|sweep_camps|nexus|base|defend|retreat|workflow|query>",
```

### 2c. Execution handler

Add to `executeGeminiCommand()` (line 6150), before the existing targetType checks:

```typescript
if (cmd.targetType === 'query') {
  const report = cmd.statusReport || cmd.narration || 'All good, Commander!';
  this.showFeedback(report, '#6CC4FF');
  // Optional: speak via TTS
  if (this.tts) this.tts.speak('mascot', report);
  return true;
}
```

---

## Step 3: Wire Pre-Filter into HordeScene

### 3a. Import at top of HordeScene.ts

```typescript
import { classifyInput, getMascotResponse, buildLocalStatus } from '../systems/CommandPreFilter';
import { TtsService } from '../systems/TtsService';
```

### 3b. Add TTS instance

In `create()` method, initialize TTS:
```typescript
this.tts = new TtsService();
```

Add property:
```typescript
private tts: TtsService | null = null;
private lastMascotTime = 0;
```

### 3c. Intercept in handleCommand()

At the very start of `handleCommand()` (line 6034), BEFORE the `showFeedback('Thinking...')` and Gemini call:

```typescript
private async handleCommand(text: string, team: 1 | 2) {
  // ── Pre-filter: catch non-commands before hitting Gemini ──
  const classification = classifyInput(text);

  if (classification.type !== 'valid' && classification.type !== 'unknown') {
    const now = Date.now();
    const gameCtx = {
      unitCount: this.units.filter(u => u.team === team && !u.dead).length,
      campsCaptured: this.camps.filter(c => c.owner === team).length,
      enemyCamps: this.camps.filter(c => c.owner !== 0 && c.owner !== team).length,
      baseUnderAttack: false, // TODO: check if nexus took damage recently
      gameTime: this.gameTime / 1000,
      nexusHp: {
        mine: this.nexuses.find(n => n.team === team)?.hp || 0,
        enemy: this.nexuses.find(n => n.team !== team)?.hp || 0,
      },
      resources: { ...this.baseStockpile[team] },
    };

    // For simple queries, answer locally
    if (classification.type === 'query') {
      const status = buildLocalStatus(gameCtx);
      this.showFeedback(status, '#6CC4FF');
      if (this.tts && now - this.lastMascotTime > 3000) {
        this.tts.speak('mascot', status);
        this.lastMascotTime = now;
      }
      return;
    }

    const response = getMascotResponse(classification, gameCtx);
    if (!response) return; // gibberish: silently ignore

    this.showFeedback(response.text, response.color);
    if (response.showConfused) {
      const sel = this.units.filter(u => u.team === team && !u.dead);
      this.unitReact('confused', sel);
    }
    if (this.tts && now - this.lastMascotTime > 3000) {
      this.tts.speak('mascot', response.speakText);
      this.lastMascotTime = now;
    }
    return;
  }

  // ── Existing flow continues for 'valid' and 'unknown' ──
  this.pendingCommandText = text;
  this.showFeedback('Thinking...', '#FFD93D');
  // ... rest of existing handleCommand unchanged
}
```

### 3d. Enriched Failure Path

Replace lines 6892-6896 (the "Huh? Try simpler." fallback) with:

```typescript
if (!found) {
  const confSel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
  this.unitReact('confused', confSel);
  const hint = this.getContextualHint(team);
  this.showFeedback(hint, '#FF6B6B');
  return;
}
```

Add new method `getContextualHint()`:

```typescript
private getContextualHint(team: 1 | 2): string {
  const myUnits = this.units.filter(u => u.team === team && !u.dead);
  const myCamps = this.camps.filter(c => c.owner === team);
  const myNex = this.nexuses.find(n => n.team === team);
  const enemyNex = this.nexuses.find(n => n.team !== team);

  if (myUnits.length === 0) return "No units! Say 'get started' to spawn gnomes!";
  if (myCamps.length === 0) return "Capture a camp! Say 'attack nearest camp'!";
  if (myUnits.length > 10 && enemyNex && enemyNex.hp > 0) return "Big army! Say 'attack nexus' to push!";
  if (myNex && myNex.hp < myNex.maxHp * 0.5) return "Base in danger! Say 'defend base'!";
  return "Try: 'make gnomes', 'gather carrots', or 'attack camp'";
}
```

---

## Step 4: TTS Voice Assignment for Mascot

In TtsService, the mascot needs a consistent voice. The voice assignment is hash-based on charId, so passing `'mascot'` will deterministically get the same voice every time. No changes needed to TtsService — just use `this.tts.speak('mascot', text)`.

---

## Implementation Order

1. **Create `CommandPreFilter.ts`** — classifier, response pools, local status builder
2. **Add Gemini Query Mode** — HordeCommand schema + prompt addition + execution handler
3. **Wire into HordeScene** — import, intercept in handleCommand(), TTS init
4. **Replace failure path** — "Huh? Try simpler." → contextual hints
5. **Test all 100 commands** from the original analysis

---

## Verification

1. **Classification accuracy:** Run all 100 voice commands from our analysis through `classifyInput()`, verify:
   - All 22 A-rated commands → `valid`
   - All 20 B-rated commands → `valid`
   - Genre-wrong commands → `impossible` with correct subtype
   - Questions → `query`
   - Emotions → `emotional`
   - Gibberish → `gibberish`
   - Ambiguous → `unknown` (conservative pass-through)

2. **Regression test valid commands:** These MUST still pass through to Gemini:
   - "make gnomes", "get skulls", "attack nearest camp", "defend base"
   - "gather carrots", "mine metal", "get swords and attack"
   - "sweep skull camps", "attack nexus", "retreat"
   - "spread out", "be aggressive", "safely make gnomes"
   - "get started"

3. **Manual voice test:** Hold SPACE and say:
   - "what do I do?" → mascot answers with status, no Gemini call
   - "jump" → mascot says something enthusiastic about what you CAN do
   - "pause" → mascot says no pause, press Escape
   - "oh no!" → brief positive encouragement
   - "um" → silently ignored
   - "how are we doing?" → either local status or Gemini query mode answer

4. **Gemini query test:** Ensure "what should I do?" and "should I push?" reach Gemini and return `targetType: 'query'` with a real statusReport.

5. **Failure path test:** Say total nonsense that passes the pre-filter as `unknown`, fails Gemini, fails local parser → should show contextual hint instead of "Huh? Try simpler."
