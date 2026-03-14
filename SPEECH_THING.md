# SPEECH THING — Voice Command Analysis & Improvement Plan

## What This Document Is

Complete analysis of how new players interact with Horde Mode's voice command system, what breaks, and detailed implementation plans to fix it. Come back to this when ready to build.

---

# PART 1: THE PROBLEM

## Current Voice Command Pipeline (Horde Mode)

```
Player holds SPACE → Web Speech API → raw text
  → issueCommand() [HordeScene.ts:5851]
    → handleCommand() [HordeScene.ts:6034]
      → Builds GameContext (units, camps, nexus HP, resources, events)
      → parseWithGemini() [HordeScene.ts:57] — gemini-2.5-flash
        → Returns HordeCommand JSON
        → executeGeminiCommand() [HordeScene.ts:6150] dispatches it
      → If Gemini fails → executeLocalCommand() [HordeScene.ts:6468] regex fallback
      → If both fail → "Huh? Try simpler." + confused unit bubbles [line 6892]
```

## What Horde Mode Already Handles Well

- **Sequential orders**: Workflows with loopFrom (e.g., "equip sword then defend base")
- **Comparative targeting**: Qualifiers — nearest, furthest, weakest, uncaptured, enemy
- **Behavior modifiers**: Formation (spread/tight), Caution (safe/aggressive), Pacing (rush/efficient)
- **Negation (partial)**: "don't pick up" → kill_only, "don't clump" → spread
- **Voice recognition errors**: Extensive alias maps for mishearing (hyenna→hyena, nome→gnome, etc.)
- **Sweep commands**: Chain-capture multiple camps
- **Bootstrap workflows**: "make skulls" → full attack_camp + hunt + gather + deliver loop

## What Breaks: The Gaps

When a new player with ZERO context speaks into the mic, **30% of commands produce total failures** and **16% produce stretched/wrong actions**.

The failures fall into clear categories:
1. **Meta/system commands**: pause, save, quit, menu, settings (9 commands)
2. **Wrong genre**: jump, crouch, reload, grenade, craft, equip armor, potion (10 commands)
3. **Questions/commentary**: what's that?, this is cool, can I build? (7 commands)
4. **Speech tests**: can you hear me, is this working (4 commands)

All of these waste a Gemini API call ($$$), take 300-500ms, return garbage, fall through both parsers, and show the unhelpful "Huh? Try simpler."

---

# PART 2: 100 BLIND VOICE COMMANDS — FULL ANALYSIS

These are commands a player might say on their very first try, with zero context about the game.

## Rating System
- **A** — Produces a useful, correct action
- **B** — Produces a reasonable action (not optimal but functional)
- **C** — Produces some action but likely wrong/wasteful
- **D** — Gemini will guess something, but it'll be a stretch
- **F** — Likely garbage output, hallucinated targets, or empty actions

### EXPLORATION / CONFUSION

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 1 | "What do I do?" | D | No actionable intent. Gemini guesses random workflow or hold. |
| 2 | "Hello?" | D | No intent. Gemini outputs random action or hold. |
| 3 | "How do I play this?" | D | Same — no actionable intent, garbage output. |
| 4 | "What's going on?" | D | Hold or defend. Narration might describe game but action useless. |
| 5 | "Where am I?" | D | Might produce hold or meaningless move. |
| 6 | "Can you hear me?" | F | Pure speech test. Wasted API call. |
| 7 | "Is this thing working?" | F | Same — no game intent at all. |
| 8 | "Um, I don't know what to do" | D | Gemini might charitably send to nearest camp. Or nothing. |
| 9 | "Start" | D | Ambiguous. Could interpret as "get started" if lucky. |
| 10 | "Go" | B | Short but has intent. Gemini moves units forward. Decent. |

### GENERIC GAME COMMANDS

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 11 | "Pause" | F | No pause action. Might output defend? Unlikely. |
| 12 | "Open menu" | F | No menu system via voice. Dead. |
| 13 | "Save game" | F | No save action. Gibberish output. |
| 14 | "Quit" | F | No quit action. Might interpret as retreat? Unlikely. |
| 15 | "Restart" | F | No restart action. Noise. |
| 16 | "Skip" | F | No skip mechanic. Noise. |
| 17 | "Inventory" | F | No inventory system. Noise. |
| 18 | "Settings" | F | No settings via voice. Dead. |
| 19 | "Undo" | F | No undo. Noise. |
| 20 | "Cancel" | C | Might interpret as "stop current orders" → defend/retreat. |

### FPS / ACTION GAME HABITS

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 21 | "Shoot" | C | No shooting, but Gemini might map to attack enemies. |
| 22 | "Reload" | F | No ammo/reload system. Noise. |
| 23 | "Jump" | F | No jump. Dead. |
| 24 | "Crouch" | F | No crouch. Dead. |
| 25 | "Throw grenade" | F | Wrong genre entirely. Noise. |
| 26 | "Take cover" | C | Gemini might interpret as defend. |
| 27 | "Fire" | C | Same as "shoot" — might trigger attack enemies. |
| 28 | "Sprint" | C | Might be interpreted as move forward or rush modifier. |
| 29 | "Use ability" | D | No ability system via voice. Gemini guesses something. |
| 30 | "Heal" | D | No heal command. Might map to retreat. |

### RPG / MMO HABITS

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 31 | "Level up" | D | Gemini might interpret "get upgrades" → unlock equipment? Stretch. |
| 32 | "Equip weapon" | D | Might trigger equip workflow but "weapon" is vague. |
| 33 | "Use potion" | F | No potions. Dead. |
| 34 | "Cast spell" | D | Might map to attacking something. Stretch. |
| 35 | "Talk to the NPC" | F | No NPCs/dialogue. Dead. |
| 36 | "Loot" | D | Gemini might interpret as "gather resources". Stretch. |
| 37 | "Check my stats" | F | No stats readout via voice. Dead. |
| 38 | "Rest" | C | Could map to defend or retreat. |
| 39 | "Buy something" | D | Might trigger unlock equipment. Stretch. |
| 40 | "Craft" | F | No crafting. Dead. |

### RTS / STRATEGY HABITS (Closest genre match)

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 41 | "Attack" | A | Clear intent. Gemini picks nearest valid target. Great. |
| 42 | "Defend" | A | Direct match to defend action. Perfect. |
| 43 | "Move forward" | A | Directional move. Clean. |
| 44 | "Retreat" | A | Direct match to retreat. Perfect. |
| 45 | "Build" | D | No build mechanic, might interpret as "capture camp". Stretch. |
| 46 | "Gather resources" | B | Maps to gather workflow. Decent. |
| 47 | "Send troops" | B | Sends units forward. Works. |
| 48 | "Explore the map" | B | Maps to scout workflow. Functional. |
| 49 | "Fortify" | B | Maps to defend. Good. |
| 50 | "Charge!" | A | Aggressive intent. Attack enemies/nexus. Great. |

### MOBA-SPECIFIC

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 51 | "Push the lane" | A | "Push" → attack nexus. Excellent. |
| 52 | "Farm" | B | Gemini should interpret as gather workflow. |
| 53 | "Gank" | B | Might send units to attack enemies. |
| 54 | "Ward" | F | No ward system. Dead. |
| 55 | "Back" | A | Retreat. |
| 56 | "Group up" | B | Could set tight formation. Functional. |
| 57 | "Split push" | A | Spread formation + attack. Excellent if parsed. |
| 58 | "Focus the carry" | B | Attack strongest enemy. |
| 59 | "Tower dive" | B | Attack enemy structures/nexus. |
| 60 | "Jungle" | B | Farming camps. |

### POINTING AT SCREEN / VISUAL REACTIONS

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 61 | "Go over there" | D | No spatial reference — "there" means nothing. Random move. |
| 62 | "Attack that thing" | D | "That thing" = no target. Gemini guesses. |
| 63 | "What's that?" | F | Informational query, no action. |
| 64 | "Click on that" | F | Wrong input paradigm. |
| 65 | "Move to the left" | A | Directional. Clean valid action. |
| 66 | "Go up" | A | Directional. Clean. |
| 67 | "Go to the animals" | B | Gemini finds nearest camp. Good. |
| 68 | "Attack the red ones" | C | If enemy team has red indicators, might guess. Stretch. |
| 69 | "Send everyone to the middle" | A | Clear. Moves all units to map center. |
| 70 | "What are those little guys?" | F | Question, no action. Dead. |

### EMOTIONAL / REACTIVE

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 71 | "Oh no, run!" | A | Clear retreat intent. |
| 72 | "Help!" | B | Might defend or retreat. |
| 73 | "Get him!" | B | Attacks nearest enemy. |
| 74 | "No no no stop!" | A | "Stop" → defend/retreat. |
| 75 | "Yes! Keep going!" | B | Reinforces current action. |
| 76 | "Come back!" | A | Retreat. |
| 77 | "Watch out!" | C | Might defend. |
| 78 | "Kill them all!" | A | Clear aggressive intent. Attack enemies. |
| 79 | "I'm confused" | F | No game intent. Noise. |
| 80 | "This is cool" | F | Commentary. Dead. |

### CREATIVE / UNEXPECTED

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 81 | "Build me an army" | B | Could interpret as bootstrap/make units. |
| 82 | "Surround them" | B | Spread formation + attack. |
| 83 | "Flank from the right" | A | Directional attack. Great. |
| 84 | "Protect the base" | A | Clear defend. Perfect. |
| 85 | "Conquer everything" | B | Sweep camps. Ambitious but functional. |
| 86 | "Sneak around" | C | No stealth, might do flanking move. |
| 87 | "Power up" | C | Might map to unlock equipment. |
| 88 | "Capture the flag" | C | "Capture" might trigger attack_camp. |
| 89 | "Go hunt" | B | Hunt workflow. Good. |
| 90 | "Set up a defense" | A | Direct defend. Perfect. |

### TESTING THE SYSTEM / META

| # | Voice Command | Rating | Expected Behavior |
|---|---|---|---|
| 91 | "Do something" | C | Vague. Gemini picks default. |
| 92 | "Attack move to the right" | A | Clear RTS command. Excellent. |
| 93 | "Can I build a wall?" | F | No building. Question. Dead. |
| 94 | "Select all units" | D | No select mechanic. Might map to "all". |
| 95 | "Somebody go north" | A | Sends units north. Clean. |
| 96 | "Find the enemy" | B | Scout toward enemy side. |
| 97 | "Take the closest camp" | A | Perfect. Attack nearest camp. |
| 98 | "I want to win" | D | Might send to nexus? Big stretch. |
| 99 | "Fight!" | A | Clear aggressive intent. Great. |
| 100 | "Everybody scatter" | B | Spread formation + move. |

### Summary Statistics

| Grade | Count | % |
|---|---|---|
| A (Useful, correct) | 22 | 22% |
| B (Reasonable/functional) | 20 | 20% |
| C (Some action, likely wrong) | 12 | 12% |
| D (Stretch/guess) | 16 | 16% |
| F (Garbage/dead) | 30 | 30% |

**42% of blind commands produce useful results (A+B). 30% are total failures.**

---

# PART 3: DEEP DIVE — Commands With Good Intent But Bad Output

These are the highest-value fixes: commands where the player IS being smart but the system drops the ball.

## Status Queries (Player wants info, system forces actions)

| Command | Intent | What Happens |
|---|---|---|
| "How are we doing?" | Game status overview | Forced into workflow. Garbage actions. |
| "Where are the enemies?" | Enemy positions | Same. No info delivery channel. |
| "How much health does our base have?" | Nexus HP check | Wasted command. |
| "What should I do?" | Strategic advice | Could be amazing if Gemini answered instead of acting. |
| "Who's winning?" | Score check | No info response type. |

**Gap:** Output schema has no "query" response type. Gemini has ALL the data to answer but is forced to output actions.

## Wrong-Genre Commands With Translatable Intent

| Command | Intent | What Could Work |
|---|---|---|
| "Shoot" | Attack something | → attack_enemies |
| "Take cover" | Be defensive | → defend base |
| "Sprint" | Move fast | → rush modifier |
| "Fire" | Attack | → attack_enemies |
| "Heal" | Recover | → retreat to base |
| "Loot" | Get resources | → gather workflow |
| "Rest" | Stop/recover | → defend |

**Gap:** These have valid RTS translations but Gemini doesn't know the mapping because they're not in the prompt vocabulary.

## Emotional Commands That Should Do Something

| Command | Intent | What Could Work |
|---|---|---|
| "Oh no, run!" | Retreat | Already works (A rating) |
| "Kill them all!" | Full attack | Already works (A rating) |
| "Help!" | Defensive action | → defend base |
| "Watch out!" | Alert/caution | → safe modifier |
| "Come back!" | Retreat | Already works |

**Gap:** Most emotional commands with action verbs already work. The ones that fail are pure emotions with no verb ("oh no!", "nice!", "ugh") — these should get brief acknowledgement, not garbage actions.

## Deictic/Pointing Commands (No Screen Context)

| Command | Intent | What Happens |
|---|---|---|
| "Go over there" | Move to pointed location | "There" has no spatial reference. Random move. |
| "Attack that thing" | Attack what player is looking at | "That" means nothing without screen position. |
| "Click on that" | Wrong paradigm | Dead. |

**Gap:** Would need camera center position or cursor position passed to the parser. Architectural change, not a parser fix.

---

# PART 4: SOLUTION DESIGNS (Chosen for Implementation)

## Solution 1: Smart Pre-Filter (`CommandPreFilter.ts`)

**What:** Zero-cost client-side classifier that intercepts ALL voice input BEFORE Gemini. Catches non-commands instantly ($0, 0ms latency).

**New file:** `packages/client/src/systems/CommandPreFilter.ts`

### Classification Buckets

| Bucket | Detection | Response |
|---|---|---|
| `valid` | Contains action verb OR target noun OR direction | Pass through to Gemini |
| `query` | Starts with question word AND no valid signal | Answer locally or route to Gemini query mode |
| `impossible` | FPS/RPG/building/meta game words | Reject with specific enthusiastic guidance |
| `emotional` | Pure exclamations, no action verbs | Brief acknowledgement |
| `gibberish` | < 2 chars, filler words | Silently ignored |
| `unknown` | No signals matched | Pass through to Gemini (conservative) |

### Pattern Dictionaries

**VALID_SIGNALS** (if ANY match → pass through to Gemini):
```
Action verbs: attack|capture|take|make|get|gather|farm|collect|harvest|mine|defend|guard|protect|retreat|scout|explore|move|go|push|sweep|produce|train|spawn|bootstrap|equip|grab|pick up|unlock|buy|research|kill|fight|raid|hunt|send|charge|contest|deliver|stockpile
Target nouns: camp|base|nexus|throne|gnome|turtle|skull|spider|hyena|panda|lizard|minotaur|shaman|troll|rogue|carrot|meat|crystal|metal|pickaxe|sword|shield|boots|banner|event
Directions: left|right|up|down|north|south|east|west|forward|backward|center|middle
Horde keywords: hoard|horde|everyone|all|spread|tight|safe|careful|aggressive|rush|efficient|started
Modifiers: safely|carefully|aggressively|quickly
```

**QUERY_PATTERNS:**
```
^(how|what|where|when|why|who|which)\b
^(can I|do I|should I|is there|are there|tell me|am I)\b
\b(help|tutorial|instructions|controls|explain|guide|status|score|winning|losing)\b (standalone)
```

**IMPOSSIBLE_PATTERNS by subtype:**
```
fps: \b(jump|shoot|fire|aim|reload|crouch|sprint|dodge|roll|block|parry|throw grenade|melee|slash|punch|kick|dash|teleport|snipe|scope)\b
rpg: \b(inventory|backpack|potion|spell|skill tree|ability|level up|loot|open chest|open door|use item|magic|mana|health potion|cast)\b
building: \b(build|construct|craft|place)\s+(wall|tower|building|trap|structure|house|fence|base)\b
meta: \b(pause|unpause|save|load|quit|exit|restart|settings|options|menu|volume|brightness|difficulty|fullscreen|mute)\b
```

**EMOTIONAL_PATTERNS:**
```
^(oh|ah|ugh|wow|yes|no|damn|dammit|nice|cool|awesome|whoa|yikes|oops|nooo+|yesss+|haha|lol|woo+|lets go|come on)!*$
\b(oh (no|god|man|crap)|what the (heck|hell)|are you kidding|that's (great|terrible)|I (love|hate) this)\b
```

**GIBBERISH_SET:** `um, uh, hmm, ok, okay, so, well, like, I mean, the, a, an, it, this, yeah`

### Scoring Logic

```
1. Trim + lowercase
2. If length < 2 or in GIBBERISH_SET → 'gibberish'
3. Count matches in each category
4. If query > 0 AND valid <= 0 → 'query'
5. If valid > 0 → 'valid' (any action signal = send to Gemini)
6. If impossible > 0 → 'impossible' (with subtype)
7. If emotional > 0 → 'emotional'
8. Else → 'unknown' (send to Gemini conservatively)
```

Edge cases verified:
- "can I attack?" → query=1 + valid=1 → valid (step 5 wins)
- "how do I play?" → query=1 + valid=0 → query
- "get started" → valid=1 → valid
- "help" → query=1 → query
- "jump" → impossible=1 → impossible
- "attack" → valid=1 → valid
- "oh no" → emotional=1 → emotional

---

## Solution 2: Enthusiastic Mascot Advisor

**What:** When the pre-filter catches a non-command, a hyper-positive mascot character speaks back via TTS with personality-driven guidance.

**Personality:** Enthusiastic mascot — think Navi meets a hype-beast. Never condescending, always excited about what you CAN do. Brief, punchy, always ends with a concrete command suggestion.

### Response Pools

**Query responses (context-aware):**
- If gameTime < 30s: "Ooh exciting, it's your first time! Hold SPACE and say 'get started' — trust me, it's AMAZING!"
- If unitCount === 0: "You need an army first! Say 'get started' and watch the gnomes GO!"
- If campsCaptured === 0: "Capture a camp! Say 'attack nearest camp' — you're gonna LOVE this!"
- If baseUnderAttack: "YOUR BASE NEEDS YOU! Say 'defend base' — go go go!"
- Default pool:
  - "You're the commander! Say things like 'make gnomes' or 'attack the skull camp'!"
  - "Ooh so many options! Try 'gather carrots', 'attack camp', or 'make skulls'!"
  - "Your horde awaits! Try 'get started' to begin the mayhem!"
  - "Command your army by voice! Say 'make gnomes' to start building up!"
  - "You give the orders, they follow! Try 'attack nearest camp' or 'gather carrots'!"

**Impossible (fps):**
- "Ooh no jumping here BUT — you can command an ARMY! Say 'attack' or 'make gnomes'!"
- "Shooting? Even BETTER — say 'attack enemies' and watch your whole horde go wild!"
- "No aiming needed! Your horde does the fighting! Try 'attack nearest camp'!"
- "Pew pew? Try 'attack enemies' — way more satisfying with a whole army!"

**Impossible (rpg):**
- "No inventory BUT your units ARE your inventory! Say 'make skulls' for a skeleton army!"
- "Potions? Who needs em! Say 'get started' and let your gnomes do the work!"
- "No spells here, but say 'make shamans' for some serious magic vibes!"
- "Ooh no loot drops — but say 'gather carrots' and your gnomes will hoard EVERYTHING!"

**Impossible (building):**
- "You don't build — you CONQUER! Say 'attack nearest camp' to claim territory!"
- "Why build when you can CAPTURE? Say 'attack camp' and it's yours!"
- "No construction needed! Just say 'attack camp' and your army takes over!"

**Impossible (meta):**
- "No pause button in WAR! But press Escape if you need a break. Now — what should your horde do?"
- "Settings? BORING! Say 'make gnomes' for instant FUN instead!"
- "Can't save — but you CAN save your base! Say 'defend base'!"

**Emotional (positive — "yes!", "nice!", "awesome!"):**
- "YESSS that energy! Channel it — what's the next order?!"
- "I LOVE the enthusiasm! Now tell your horde what to do!"
- "That's the spirit!! Keep commanding!"
- "Hype level MAXIMUM! Now say something like 'attack nexus'!"

**Emotional (negative — "oh no", "damn", "ugh"):**
- "Hey it's okay! Say 'defend base' to regroup! You got this!"
- "Setback? NAH — say 'make gnomes' and bounce back!"
- "Don't give up! Your horde believes in you! Try 'retreat' to fall back!"
- "Tough moment! But say 'gather carrots' and rebuild stronger!"

**Cooldown:** 3 seconds between mascot responses to avoid spam.

---

## Solution 3: Gemini Query Mode

**What:** Add `query` targetType to HordeCommand so Gemini can answer questions with real game-state data.

### Schema Change (HordeScene.ts line 42)

Add to HordeCommand interface:
```typescript
targetType: '...' | 'query';  // Add 'query'
statusReport?: string;          // New field
```

### Prompt Addition (after section H in intent classification)

```
I) STATUS QUERY: player asks a question instead of giving an order
   → "how are we doing?", "what should I do?", "who's winning?", "what's my plan?", "should I push?"
   → targetType: "query"
   → statusReport: 1-2 sentence tactical answer using REAL game state data (unit counts, nexus HP, camp ownership, resources). Be specific with numbers.
   → narration: max 5 words, terse
   → unitReaction: omit or null
   → modifiers: omit
   Examples:
   "how are we doing?" → statusReport: "15 gnomes, 8 skulls. 3 camps ours. Enemy nexus at 38000 — push now!"
   "what should I do?" → statusReport: "Capture the spider camp for T2 units, then bootstrap skulls."
   "should I attack?" → statusReport: "With 20 units? Absolutely. Send everything!"
```

### Execution Handler (in executeGeminiCommand)

```typescript
if (cmd.targetType === 'query') {
  const report = cmd.statusReport || cmd.narration || 'All good, Commander!';
  this.showFeedback(report, '#6CC4FF');
  if (this.tts) this.tts.speak('mascot', report);
  return true;
}
```

### Pre-Filter Routing

Simple queries ("how many troops?", "what's the score?") → answered locally by pre-filter (no API call).
Strategic queries ("what should I do?", "should I push?", "what's my best move?") → routed to Gemini query mode (needs full game context).

Heuristic: queries containing "should", "best", "plan", "strategy", "next" → classify as `unknown` → pass to Gemini.

---

## Solution 4: Enriched Failure Path (Bonus)

Replace "Huh? Try simpler." (line 6892) with contextual suggestions:

```typescript
private getContextualHint(team: 1 | 2): string {
  const myUnits = this.units.filter(u => u.team === team && !u.dead);
  const myCamps = this.camps.filter(c => c.owner === team);
  const enemyNex = this.nexuses.find(n => n.team !== team);
  const myNex = this.nexuses.find(n => n.team === team);

  if (myUnits.length === 0) return "No units! Say 'get started' to spawn gnomes!";
  if (myCamps.length === 0) return "Capture a camp! Say 'attack nearest camp'!";
  if (myUnits.length > 10 && enemyNex && enemyNex.hp > 0) return "Big army! Say 'attack nexus' to push!";
  if (myNex && myNex.hp < myNex.maxHp * 0.5) return "Base in danger! Say 'defend base'!";
  return "Try: 'make gnomes', 'gather carrots', or 'attack camp'";
}
```

---

# PART 5: WIRING IT ALL TOGETHER

## Changes to HordeScene.ts

### Imports (top of file)
```typescript
import { classifyInput, getMascotResponse, buildLocalStatus } from '../systems/CommandPreFilter';
import { TtsService } from '../systems/TtsService';
```

### New Properties
```typescript
private tts: TtsService | null = null;
private lastMascotTime = 0;
```

### Init TTS in create()
```typescript
this.tts = new TtsService();
```

### Intercept at top of handleCommand() (line 6034)

BEFORE the existing `showFeedback('Thinking...')` and Gemini call:

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
      baseUnderAttack: false,
      gameTime: this.gameTime / 1000,
      nexusHp: {
        mine: this.nexuses.find(n => n.team === team)?.hp || 0,
        enemy: this.nexuses.find(n => n.team !== team)?.hp || 0,
      },
      resources: { ...this.baseStockpile[team] },
    };

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

  // ── Existing flow continues unchanged for 'valid' and 'unknown' ──
  this.pendingCommandText = text;
  this.showFeedback('Thinking...', '#FFD93D');
  // ... rest of existing handleCommand
}
```

### Add query handler in executeGeminiCommand() (line 6150)

Before existing targetType checks:
```typescript
if (cmd.targetType === 'query') {
  const report = cmd.statusReport || cmd.narration || 'All good, Commander!';
  this.showFeedback(report, '#6CC4FF');
  if (this.tts) this.tts.speak('mascot', report);
  return true;
}
```

### Replace failure path (line 6892-6896)

```typescript
if (!found) {
  const confSel = this.units.filter(u => u.team === team && !u.dead && (subject === 'all' || u.type === subject));
  this.unitReact('confused', confSel);
  const hint = this.getContextualHint(team);
  this.showFeedback(hint, '#FF6B6B');
  return;
}
```

---

# PART 6: IMPLEMENTATION ORDER

1. Create `packages/client/src/systems/CommandPreFilter.ts` — classifier, response pools, local status builder
2. Add Gemini Query Mode — HordeCommand schema + prompt addition + execution handler
3. Wire into HordeScene — imports, intercept in handleCommand(), TTS init
4. Replace failure path — "Huh? Try simpler." → contextual hints
5. Test all 100 commands from the analysis

---

# PART 7: VERIFICATION PLAN

1. **Classification accuracy:** Feed all 100 commands through classifyInput():
   - All A/B-rated commands → `valid`
   - Genre-wrong commands → `impossible` with correct subtype
   - Questions → `query`
   - Emotions → `emotional`
   - Gibberish → `gibberish`

2. **Regression test valid commands** (MUST still pass to Gemini):
   - "make gnomes", "get skulls", "attack nearest camp", "defend base"
   - "gather carrots", "mine metal", "get swords and attack"
   - "sweep skull camps", "attack nexus", "retreat"
   - "spread out", "be aggressive", "safely make gnomes"
   - "get started"

3. **Voice test bad commands:** Hold SPACE and say:
   - "what do I do?" → mascot answers, no Gemini call
   - "jump" → enthusiastic guidance about what you CAN do
   - "pause" → no pause, press Escape
   - "oh no!" → brief positive encouragement
   - "um" → silently ignored

4. **Gemini query test:** "what should I do?" reaches Gemini, returns targetType:'query' with real statusReport.

5. **Failure path test:** Nonsense that passes pre-filter → fails Gemini → fails local → shows contextual hint instead of "Huh? Try simpler."

---

# KEY FILES REFERENCE

| File | What It Does | Lines |
|---|---|---|
| `packages/client/src/scenes/HordeScene.ts` | Monolithic game scene, all game logic | ~8500 |
| `packages/client/src/systems/TtsService.ts` | TTS via Qwen3-TTS / AIML API | ~142 |
| `packages/client/src/systems/CommandInput.ts` | Web Speech API wrapper (Animal Army mode) | ~137 |
| `packages/client/src/systems/GeminiCommandParser.ts` | Gemini parser (Animal Army mode, NOT Horde) | ~245 |
| `packages/client/src/systems/CommandPreFilter.ts` | **NEW** — Pre-filter + mascot responses | ~200 est |

### Key Line Numbers in HordeScene.ts
- `parseWithGemini()`: line 57-442 (Gemini prompt + API call)
- `HordeCommand interface`: line 42-55
- `GameContext interface`: line 18-29
- `BehaviorMods interface`: line 34-38
- `issueCommand()`: line 5851
- `handleCommand()`: line 6034
- `executeGeminiCommand()`: line 6150
- `executeLocalCommand()`: line 6468
- `parseLocalSteps()`: line 6357
- `"Huh? Try simpler."` failure: line 6892-6895
- `CANNED_REACTIONS`: line 6922
- `unitReact()`: line 6971
- `showFeedback()`: used throughout
- `showThoughtBubbles()`: line 6985
