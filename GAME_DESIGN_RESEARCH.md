# Prompt Battle: Game Design Research
## What Should This Game Actually Be?

Research synthesized from 50+ games, GDC talks, academic papers, and game design analysis.

---

## THE CORE INSIGHT: What Prompt Battle Actually Is

Prompt Battle isn't really an RTS. It's a **performative commander game**. The player shouting orders at the screen IS the entertainment — like karaoke meets tactics. The gap between what you say and what happens creates comedy, drama, and tension.

This means the game design should optimize for:
1. **Moments that make you shout** — not quiet optimization
2. **Spectator readability** — others watching should understand and react
3. **The voice feeling powerful** — commands should have visible, dramatic consequences
4. **Short, intense matches** — energy can't sustain for 20 minutes of shouting

---

## WHAT WORKS WITH VOICE (Proven by 25 Years of Voice Games)

### Voice is GREAT for:
- **High-level tactical direction** — "Attack the mage!" "Fall back!" "Take the point!" (EndWar, There Came an Echo)
- **Relationship/social commands** — Praising, rallying, directing named characters (Binary Domain's Trust system)
- **Dramatic moments with stakes** — When consequences are visible and immediate (Spaceteam's chaos)
- **Handler/commander fantasy** — Narrative frames you as someone giving orders from a distance (Lifeline's Operator)

### Voice is TERRIBLE for:
- **Precision micro-management** — "Move 2 tiles left then 1 up" (every game that tried this failed)
- **Rapid sequential actions** — 600ms silence between commands kills flow (There Came an Echo)
- **Repetitive identical commands** — Saying the same thing 50 times depletes the "novelty budget" (In Verbis Virtus)
- **Reactive twitch combat** — The more panicked you get, the worse you speak, the worse it gets — death spiral (Lifeline)

### The Golden Rules:
1. **Calm Commander Principle** — Voice works for decisions, not reactions
2. **Narrative Justification** — Players need a reason they're speaking (you're the commander, not the cursor)
3. **Graceful Failure** — Misrecognition should look like character personality, not system failure
4. **Novelty Budget** — Vary what players say, or keep matches short
5. **Escalation Trap** — Don't make voice faster when stakes rise; make it MORE STRATEGIC

---

## WHAT THE CURRENT GAME HAS (Audit)

### Current flow:
Draft (30s/pick, 6 picks) -> 5-min Battle (3v3 domination) -> First to 200 pts wins

### What's working:
- Voice -> Gemini parsing -> squad executes = strong commander fantasy
- Draft creates meaningful composition decisions (8 classes x 10 animals = 80 combos)
- Characters talking back via TTS barks adds personality
- Terrain matters (forest ambush, hill range bonus, bush concealment)

### What's overcomplicated:
- Economy system (gold, mining, towers) — too much cognitive load for voice
- 8 consumable item types with inventory management — micro, not macro
- Map phases (arbitrary gates on mine activation) — feel artificial
- POI bloat (lookouts, wells, caches) — visual noise
- Leveling/XP system — encourages farming over fighting
- 80x80 map is huge — action gets diluted
- Too many secondary systems competing for attention

### The core problem:
The game tries to be a full RTS crammed into voice commands. But voice is best for **simple, dramatic, high-stakes decisions** — not resource management spreadsheets.

---

## OBJECTIVE TYPES RANKED FOR VOICE GAMEPLAY

### Tier 1: Perfect for Voice

**1. Asymmetric Attack/Defend (CS-style)**
- One side attacks an objective, the other defends
- Natural drama: "HOLD THE LINE!" vs "PUSH IN NOW!"
- Clear win condition everyone understands
- Creates clutch moments (last-second captures/defuses)
- Voice commands map naturally: attack, defend, flank, retreat

**2. Heist / Steal-and-Extract**
- Three-act structure: infiltrate, steal, extract
- Natural escalation (quiet start -> chaotic extraction)
- Every command feels different at each phase
- "Scout ahead!" -> "Grab it!" -> "RUN! GET TO THE EXIT!"
- The extraction phase is inherently climactic

**3. King of the Hill with Escalation**
- Simple enough to command by voice: "Take point A!" "Defend the hill!"
- Needs dynamic elements to prevent camping (rotating points, overtime)
- Clash Royale's doubled elixir in final minute = good model
- Works best with 2-3 contestable zones (not just 1)

### Tier 2: Strong Potential

**4. Escort/VIP**
- Moving objective forces constant repositioning
- "Protect the healer!" "Ambush them at the bridge!"
- Naturally creates different roles (guard vs. interceptor)
- The VIP reaching extraction at the last second = peak drama

**5. Tug-of-War / Push-Pull**
- Visual clarity: a bar/indicator shows who's winning at a glance
- Inherently prevents snowballing (natural oscillation)
- Commands feel meaningful: every push/pull is visible
- Spectators immediately understand the state

**6. Survival / Boss Rush**
- Both players face the same PvE challenge simultaneously
- "Focus the boss!" "Dodge left!" "Heal the warrior!"
- Natural escalation through phases
- Could be cooperative rather than competitive

### Tier 3: Interesting but Risky

**7. Race/Checkpoint**
- Both teams race to complete objectives across the map
- Creates urgency without direct confrontation
- Risk: might not create enough conflict moments

**8. Territory Control (Current Game)**
- Works but tends toward "sit on point" without dynamism
- Needs strong secondary mechanics to stay interesting
- Can feel like optimization rather than drama

---

## WHAT MAKES IT FUN TO WATCH (Spectator Design)

Research from StarCraft esports, Jackbox, Spaceteam, Overcooked:

### The 5 Spectator Principles:
1. **Visible decision-making** — Audience can see the command AND the result, judging in real-time
2. **Dramatic reversals** — Comeback mechanics prevent foregone conclusions
3. **Humor from failure** — When commands go wrong, it should be funny, not just punishing
4. **Escalating chaos** — Matches should build to a climax, not settle into equilibrium
5. **Player as performer** — The person shouting IS the show (like karaoke)

### What Spaceteam teaches:
Spaceteam is "a cooperative shouting game." The shouting wasn't designed — it emerged from time pressure + competing demands. The technobabble (nonsense terms) makes shouting inherently funny. Over 3M downloads. **Prompt Battle should lean into the absurdity of shouting tactical orders at animated animals.**

### What Jackbox teaches:
Quiplash gives the audience MORE power than the players — "players have to play toward the audience." Consider: spectators could vote on map events, buff/debuff teams, or influence objectives.

### The Clash Royale model:
3-minute matches. Elixir doubles in the final minute. If tied, sudden-death overtime. "Deliberately chaotic, designed to keep adrenaline high and players queueing for just one more game." This pacing is ideal for Prompt Battle.

---

## THE COMMANDER FANTASY (Making Characters Feel Alive)

### The Disobedience Principle (Most Important Finding)
From Darkest Dungeon, XCOM, Dwarf Fortress research:

> "Disobedience is an act of intelligence; only a thing with agency can disobey." — Tanya X. Short

A unit that always obeys is a tool. A unit that sometimes doesn't is a person. Characters should occasionally:
- Panic under fire and retreat without orders
- Get cocky after a kill and push too aggressively
- Argue with each other ("I'm not going near that mage again!")
- Rise heroically under pressure (rare virtue moments)
- React to your commands with personality ("Finally, a good order!")

This is PERFECT for voice gameplay — the characters talking back to you, sometimes disagreeing, creates the illusion that you're commanding real personalities, not moving chess pieces.

### The Attachment Hierarchy:
1. **Naming** — Characters have names and personalities (already in game)
2. **Growth** — Watching them level up and improve (light version)
3. **Emergent stories** — Things happen that weren't scripted
4. **Shared hardship** — Surviving tough moments together
5. **Relationships between units** — Characters bonding with each other
6. **Consequences** — Losing a character matters

### What makes you feel like a LEADER:
- Your orders have **visible, lasting consequences**
- The gap between order and execution creates drama
- Characters **exist when you're not commanding them** (banter, idle behavior)
- You make **strategic decisions, not pixel-level movements**
- The macro layer (who goes where) matters more than micro (how they fight)

---

## ANTI-SNOWBALL & COMEBACK DESIGN

### The Problem:
Without comeback mechanics, games become boring once someone pulls ahead. The losing player stops having fun, and spectators lose interest.

### Best Solutions for Voice Games:
- **Street Fighter model** — Getting hit reduces HP but never reduces your capabilities. You can always come back with skill.
- **Alternative win conditions** — Even if losing militarily, capturing a key point at the right moment can win
- **Rubber-banding that doesn't feel cheap** — Losing team gets faster respawns, not direct power boosts
- **Diminishing returns on dominance** — Holding all 3 points doesn't score 3x; maybe 2x
- **Escalation mechanics** — Late-game abilities/events that give the trailing player options
- **Respawn timers** — Deaths aren't permanent; the 20s respawn prevents snowball cascades

### From David Sirlin:
"The goal is not to negate the benefits of winning, but to reduce it to a manageable level." The ideal: winning gives advantage, but never locks out the opponent.

---

## MATCH STRUCTURE RECOMMENDATIONS

### Length:
- **3-5 minutes per round** (Clash Royale model)
- Current 5 minutes is at the upper edge; consider 3-4 minutes
- **Best-of-3 for competitive** (~10-15 minutes total)
- Short enough to maintain shouting energy; long enough for strategy

### Pacing (The Escalation Curve):
- **Phase 1 (0:00-1:00)** — Setup. Characters move to positions. First contact. Low stakes.
- **Phase 2 (1:00-2:30)** — Skirmishes. First objectives contested. Medium stakes.
- **Phase 3 (2:30-end)** — Climax. Stakes doubled. Resources increased. Everything on fire.

### The Shrinking World:
Like battle royale's closing circle — the playable area or number of objectives should compress over time, forcing confrontation and preventing turtling.

---

## 5 GAME MODE CONCEPTS (Ranked by Voice Fit)

### Concept 1: "SIEGE" (Asymmetric Attack/Defend)
- Each round: one team attacks a fortified point, other defends
- Swap sides after the round; faster capture wins
- Attacker commands: coordinate assault, flank, focus fire
- Defender commands: hold positions, call reinforcements, set traps
- **Why it works for voice:** Every command is dramatic. "BREACH THE GATE!" "FALL BACK TO THE KEEP!"
- **Spectator appeal:** Attackers pressing in creates visible tension

### Concept 2: "HEIST" (Steal and Extract)
- One team guards a treasure/artifact, other tries to steal it
- Thief team must grab and carry it to extraction zone
- Carrier is slowed; must be protected by teammates
- Guard team has defensive positions but must react to flanks
- **Why it works for voice:** Three-act drama. Plans change constantly.
- **Spectator appeal:** Will they make it out? Maximum clutch potential.

### Concept 3: "BRAWL" (Simplified Domination)
- Strip current game to its essence: 3 characters, 1-2 control points, small map
- No economy, no items, no leveling. Pure tactics.
- Points score every second; first to 100 wins
- Overtime: if within 10 points, match continues until 20-point gap
- **Why it works for voice:** Nothing to manage except your team. Pure commander decisions.
- **Spectator appeal:** Constant action, clear score, dramatic overtimes.

### Concept 4: "GAUNTLET" (Cooperative PvE Race)
- Both players run the same dungeon/challenge simultaneously
- Waves of enemies, environmental puzzles, boss at the end
- Fastest completion wins; or who survives longer
- **Why it works for voice:** "Focus the big one!" "Healer, stay back!" Natural callouts.
- **Spectator appeal:** Side-by-side comparison. Who handles chaos better?

### Concept 5: "ARENA" (Elimination Rounds)
- Best-of-5 short rounds (60-90 seconds each)
- Small arena, no objectives except elimination
- Between rounds: pick one buff or terrain modifier
- Last team standing wins the round
- **Why it works for voice:** Pure combat, high intensity, short bursts of shouting
- **Spectator appeal:** Fight game energy. Quick rounds, constant action.

---

## THE SIMPLIFICATION ARGUMENT

The strongest signal from all this research: **the current game has too many systems for voice control.**

### What to consider cutting:
- Gold/economy (voice players can't manage resources while commanding troops)
- Consumable items (inventory management is cursor work, not commander work)
- Map phases (artificial; let the game's natural flow create pacing)
- POI bloat (lookouts, wells, caches — reduce to 1-2 meaningful map features)
- Leveling/XP (encourages farming; kills aren't permanent anyway)
- 80x80 map size (shrink to 40x40 or smaller; concentrate the action)
- Tower building (another resource-management layer)
- Mining (literally the opposite of exciting voice commands)

### What to keep/enhance:
- Voice -> AI -> Squad execution (the core)
- Character personalities and barks (make them MORE reactive, not less)
- Draft system (meaningful pre-game decisions)
- Terrain that matters (forest ambush, hill advantage, chokepoints)
- Control point contention (simple, dramatic, voice-friendly)
- Animal + Class combo system (identity and variety)

### What to add:
- Character disobedience/personality in combat (panic, cockiness, heroism)
- Escalation mechanics (late-game stakes increase)
- Comeback mechanics (trailing player gets options, not just loses slower)
- Spectator features (visible commands, audience participation?)
- Shorter, more intense matches (3 min rounds, BO3)
- Characters responding TO you ("On it, Commander!" / "Are you sure about that?")

---

## SOURCES

### Voice-Commanded Games:
- EndWar, There Came an Echo, Lifeline, Binary Domain, Hey You Pikachu, Seaman, In Verbis Virtus, Bot Colony, Mage Arena, Ubisoft Teammates, PUBG Ally

### Tactical Games:
- Pikmin, Tooth and Tail, Bad North, Into the Breach, Desperados III, Battle Brothers, Wartales, Wildermyth

### Commander Fantasy:
- XCOM, Darkest Dungeon, Fire Emblem, RimWorld, Dwarf Fortress, Banner Saga, Frostpunk, Massive Chalice, Pyre, Republic Commando

### Spectator/Party:
- StarCraft, TFT/Auto-battlers, Spaceteam, Keep Talking and Nobody Explodes, Overcooked, Jackbox, Clash Royale, Gang Beasts

### Design Theory:
- David Sirlin (Slippery Slope), Tanya X. Short (Disobedient Design), Into the Breach GDC Postmortem, Tooth and Tail Design Philosophy, Apex Legends Ping System Design
