# SILICON MINDS — Multiplayer AI Warfare

## Elevator Pitch

You're the unhinged founder-CEO of an AI company. You use your **voice** to bark orders at your employees: "Send the spies to Prometheus," "Redirect all compute to the AGI project," "Poach their lead researcher." Race your opponents to build **Artificial Superintelligence** first — or destroy them trying. Cyberattack their infrastructure, bankrupt them, steal their research, poach their talent. Last company standing wins.

**Think**: StarCraft's rush/boom/turtle + Offworld Trading Company's economic warfare + Factorio's production chains — but you command everything by talking like a CEO in a boardroom.

---

## Why This Works (Proven Mechanics We're Stealing)

| Source Game | Proven Mechanic | Our Version |
|-------------|----------------|-------------|
| **StarCraft** | Rush / Boom / Turtle triangle | Cyberattack rush vs. R&D boom vs. security turtle |
| **StarCraft** | Fog of war, scouting | Hidden opponent tech; spies reveal intel |
| **StarCraft** | Asymmetric factions with different philosophies | Each AI lab plays fundamentally differently |
| **Age of Empires** | Era/Age progression with power spikes | Narrow AI → AGI → ASI eras |
| **Offworld Trading Company** | Economic warfare, no guns, hostile takeovers | Bankrupt opponents, acquire them, sabotage markets |
| **Offworld Trading Company** | Black market sabotage (pirates, EMPs, bribes) | Cyberattacks, talent poaching, IP theft, media leaks |
| **Factorio** | Production chain throughput optimization | Data → Training → Model → Product pipeline |
| **Factorio** | Bottleneck identification as core skill | Is your bottleneck compute, data, talent, or capital? |
| **Civilization** | Tech tree with branching exclusive paths | Research tree: safety vs. speed vs. scale |
| **Dota/LoL** | Contested neutral objectives, power spikes | Government contracts, rare datasets, compute auctions |
| **Dota/LoL** | Destroy the Ancient win condition | Destroy opponent's AI Core / data center |
| **Slay the Spire** | Synergy over raw power, limited actions per turn | Focused strategy beats scattered investment |
| **Game Dev Tycoon** | Product-market fit, hire/fire talent | Ship AI products for revenue, talent is contested |

---

## Core Input: YOUR VOICE

You're the CEO. You talk. People listen (or don't).

### Voice Command Examples
```
"Hire two more researchers"
"Move the data team to project Chimera"
"Send a spy to Prometheus Labs"
"Launch a cyberattack on Catalyst's training cluster"
"Redirect all GPU to the reasoning model"
"Ship the chatbot product NOW"
"Poach their lead alignment researcher — offer double"
"Pull everyone off safety and go full speed on AGI"
"Lobby congress to regulate open-source models"
"Call a board meeting"
"Fire the VP of engineering"
"Leak Specter's safety incident to the press"
"Buy out OpenForge — hostile takeover"
```

The Gemini command parser (already built) interprets these into game actions. Ambiguous commands get clarified: *"Which opponent do you want to cyberattack?"*

### Keyboard Backup
- Number keys select departments
- Right-click for context menus
- Tab switches views (Office / Intel / Research / Market)
- Space pauses

---

## Factions (Asymmetric — StarCraft-style)

Each faction has a **different philosophy** that changes HOW they play, not just stat numbers. Players pick at match start.

### 🔴 TITAN SYSTEMS — "The Compute Brute"
*"Throw more GPUs at it."*
- **Advantage**: Starts with 2x compute capacity. Cheaper GPU upgrades. Training runs are faster.
- **Weakness**: Inefficient with talent. Higher salaries. Researchers burn out faster.
- **Playstyle**: BOOM. Overwhelm with scale. Train massive models quickly. Win the brute-force race to ASI.
- **Unique ability**: **Datacenter Blitz** — temporarily triple compute for 30 seconds, but costs enormous capital.

### 🔵 PROMETHEUS LABS — "The Safety Purists"
*"Alignment first, capabilities second."*
- **Advantage**: Models never have safety incidents. Reputation grows passively. Government trusts them.
- **Weakness**: Research is 30% slower. Can't skip safety evaluations. Principled employees refuse unethical orders.
- **Playstyle**: TURTLE. Build an unassailable reputation, win government contracts, and regulate competitors out of existence. Their AGI is slower but guaranteed safe.
- **Unique ability**: **Whistleblower Network** — reveal a rival's safety violations to the press, tanking their reputation.

### 🟢 CATALYST VENTURES — "The Hype Machine"
*"Ship it, fundraise, repeat."*
- **Advantage**: 2x fundraising speed. Products generate more hype. Media loves them. Can take on debt freely.
- **Weakness**: Products are often half-baked. High employee turnover. Vulnerable to market crashes.
- **Playstyle**: RUSH. Ship products fast, capture market share, use revenue to fund aggressive expansion. Win by acquisition or market dominance.
- **Unique ability**: **Funding Frenzy** — announce a fake breakthrough to spike stock price and raise emergency capital (but if caught, massive reputation hit).

### ⚫ SPECTER GROUP — "The Shadow Lab"
*"What we're building is classified."*
- **Advantage**: Invisible to fog of war by default. Espionage operations cost 50% less. Counter-intelligence is stronger.
- **Weakness**: Can't ship consumer products (only government/military contracts). Fewer revenue streams.
- **Playstyle**: STEALTH. Operate in the shadows, steal research from everyone, and suddenly emerge with ASI before anyone knew you were close.
- **Unique ability**: **Zero Day** — launch a devastating cyberattack that disables a rival's entire infrastructure for 60 seconds.

### 🟡 OPENFORGE COLLECTIVE — "The Swarm"
*"Open source everything."*
- **Advantage**: Community contributors generate free research points. Hiring is cheaper (people want to work here). Can use anyone's published research for free.
- **Weakness**: Can't keep secrets — all research is public. Rivals benefit from your breakthroughs. No espionage capability.
- **Playstyle**: SWARM. Outpace everyone through open collaboration. Your research leaks, but it comes so fast that rivals can't keep up. Win by reaching ASI through sheer velocity of innovation.
- **Unique ability**: **Open Source Bomb** — release your current best model publicly, destroying the commercial value of all rival products at that tier.

### 🟣 NEXUS AI — "The Balanced Startup"
*"We do a little bit of everything."*
- **Advantage**: No weaknesses, flexible strategy. Can pivot mid-game.
- **Weakness**: No unique strengths either. Master of none.
- **Playstyle**: ADAPTIVE. Read the room, counter what your opponents are doing. The "Terran" of the game.
- **Unique ability**: **Pivot** — once per game, completely restructure your company. Reassign all workers and refund 50% of research in one branch to invest in another.

---

## Game Structure (20-minute match, 3 Eras)

### Era 1: NARROW AI (0:00 – 6:00)
*The Garage Phase*

**You start with**:
- Small office (6 desks)
- 3 employees: 1 researcher, 1 engineer, 1 data person
- Seed capital ($500K)
- Basic compute (1 small GPU cluster)
- 1 unlocked product type (Basic Chatbot)

**Available actions**:
- Hire from the open talent market
- Research foundational tech (transformers, web scraping, cloud compute)
- Build your first product for revenue
- Scout opponents (basic intel)
- Small-scale poaching attempts

**Era transition**: Research "Foundation Models" to enter Era 2. First player to transition gets a power spike bonus.

**StarCraft parallel**: This is your "opening build order." Do you worker-rush (hire fast), tech-rush (beeline for Era 2), or harass early (send spies immediately)?

---

### Era 2: GENERAL AI (6:00 – 14:00)
*The Scale-Up Phase*

**Unlocks**:
- Bigger office, more departments
- Advanced research branches (reasoning, multimodal, agents, alignment)
- Espionage operations (moles, cyberattacks, media leaks)
- Government contracts & lobbying
- Hostile takeover attempts (buy out weakened rivals)
- Defensive operations (counter-intel, security hardening)
- 3 new product types (API Platform, Code Assistant, Enterprise AI)

**Key dynamics**:
- **Contested objectives appear**: Government contracts, exclusive datasets, compute auctions — fight over them
- **Espionage intensifies**: Spies everywhere, counter-intelligence matters
- **First eliminations**: Weakened players get acquired or go bankrupt
- **Research branches DIVERGE**: You must specialize. You can't research everything.

**Era transition**: Research "Recursive Self-Improvement" to enter Era 3. This is the "arms race" moment — everyone scrambles.

**StarCraft parallel**: This is mid-game. Expansions, army compositions, tech switches. The map is being contested.

---

### Era 3: SUPERINTELLIGENCE (14:00 – 20:00)
*The Endgame*

**Unlocks**:
- ASI research project (the win condition — takes ~4 minutes of dedicated compute + researchers)
- Doomsday attacks (total infrastructure destruction attempts)
- AI-assisted automation (your AI starts helping run your company)
- Nuclear options: open-source your model to destroy all product markets, massive cyberwarfare campaigns

**Key dynamics**:
- **Visibility**: Everyone can see who's closest to ASI. Creates "kill the leader" dynamics.
- **Desperate plays**: Losing players launch all-out attacks, espionage blitzes, or try for miracle comebacks
- **Alignment matters**: If you skipped safety research, your ASI has a % chance of going rogue (you lose)
- **Escalation timer**: If no one wins by 20:00, the game accelerates — compute costs halve, research doubles

**Win condition**: Complete the ASI project. Your superintelligent AI systematically dismantles all rival companies. Cinematic victory screen.

---

## The Production Pipeline (Factorio Core)

The heart of your company. Resources flow through departments like items on conveyor belts:

```
                    ┌─────────────┐
                    │  TALENT     │ ← hire from market
                    │  MARKET     │
                    └──────┬──────┘
                           │ (people)
                    ┌──────▼──────┐
    ┌──────────┐    │             │    ┌──────────┐
    │ RAW DATA ├───►│  YOUR       │◄───┤ COMPUTE  │
    │ (buy/    │    │  OFFICE     │    │ (GPU     │
    │  scrape/ │    │             │    │  clusters│
    │  license)│    └──┬───┬───┬──┘    └──────────┘
    └──────────┘       │   │   │
         ┌─────────────┘   │   └──────────────┐
         ▼                 ▼                   ▼
   ┌───────────┐    ┌───────────┐       ┌───────────┐
   │ DATA      │    │ RESEARCH  │       │ SECURITY  │
   │ PIPELINE  │    │ LAB       │       │ OPS       │
   │           │    │           │       │           │
   │ raw→clean │    │ papers &  │       │ defend    │
   │ training  │    │ break-    │       │ against   │
   │ data      │    │ throughs  │       │ spies &   │
   └─────┬─────┘    └─────┬─────┘       │ attacks   │
         │                │              └───────────┘
         ▼                ▼
   ┌───────────────────────────┐
   │ TRAINING CLUSTER          │
   │                           │
   │ data + compute + research │
   │ = RAW MODEL               │
   └─────────────┬─────────────┘
                 │
         ┌───────▼───────┐
         │ EVAL & SAFETY │ ← skip at your own risk
         │               │
         │ raw → aligned │
         │ model         │
         └───────┬───────┘
                 │
         ┌───────▼───────┐         ┌───────────┐
         │ PRODUCT       │────────►│ MARKET    │
         │ STUDIO        │         │           │
         │               │         │ revenue   │──► $$$ back into system
         │ model→product │         │ & market  │
         └───────────────┘         │ share     │
                                   └───────────┘
```

### Bottleneck Gameplay

The Factorio magic: your pipeline is only as fast as its slowest link.

- **Compute bottleneck**: Training cluster idle because you can't afford enough GPUs → Solution: ship products for revenue, or take on debt
- **Data bottleneck**: Training cluster idle because data pipeline can't clean fast enough → Solution: hire more data engineers, or buy pre-cleaned datasets
- **Talent bottleneck**: Everything is slow because you can't find researchers → Solution: offer higher salaries, poach from rivals, improve reputation to attract talent
- **Capital bottleneck**: You want to hire and expand but can't afford it → Solution: ship products, raise funding round (gives up board control), or take government contracts

**Visual**: Employees physically walk between departments carrying glowing data cubes, documents, model artifacts. You SEE the flow. You SEE where things pile up. Like watching a Factorio belt back up.

---

## Attack & Sabotage System (Offworld Trading Company + StarCraft)

### Attack Types

| Attack | Cost | Cooldown | Effect | Risk if Detected |
|--------|------|----------|--------|-----------------|
| **Talent Poach** | $$$ | 30s | Steal a specific employee from rival. They lose the person, you gain them. | Target gets warning, can counter-offer |
| **Cyberattack: DDoS** | $$ | 20s | Rival's products go offline for 15s. No revenue during downtime. | Reputation -5 |
| **Cyberattack: Data Breach** | $$$ | 45s | Copy rival's training data. You get a data boost. | Reputation -15, possible lawsuit |
| **Cyberattack: Sabotage** | $$$$ | 60s | Corrupt a rival's active training run. Wastes their compute + time. | Reputation -25, regulatory investigation |
| **Plant Spy** | $$ | 90s | Embed a mole. After 30s, they start leaking research intel continuously. | If caught: lose the spy + reputation -20 |
| **Media Leak** | $ | 30s | Leak a rival's safety incident or internal drama to press. | If fabricated & caught: reputation -30 |
| **Patent Troll** | $$ | 45s | File patents that block a rival's product launch for 20s. | Reputation -10 in the community |
| **Market Dump** | $$$$ | 120s | Flood market with cheap/free product to destroy rival's revenue in that segment. | Costs you revenue too |
| **Hostile Takeover** | $$$$$ | once | If rival's stock price is low enough (they're struggling), buy them out entirely. They're eliminated. | Must have 3x their remaining capital |
| **Lobby Congress** | $$$$ | 90s | Push regulation that hurts a specific rival (or type of rival). | Public reputation risk |
| **Infrastructure Strike** | $$$$$ | 120s | Full cyberattack on rival's data center. Destroys GPU capacity for 45s. Era 3 only. | Reputation -40, all rivals may retaliate |

### Defense Types

| Defense | Cost | Effect |
|---------|------|--------|
| **Security Team** | $$/month | Passive spy detection. Better team = higher catch rate. |
| **Firewall Upgrade** | $$$ one-time | Reduces cyberattack effectiveness by 50%. |
| **PR Team** | $$/month | Reduces reputation damage from leaks and incidents by 50%. |
| **Legal Team** | $$/month | Can counter-sue patent trolls. Enforces NDAs on departing employees. |
| **Counter-Intel** | $$$ | Actively hunt moles. If found, can turn them into double agents. |
| **Talent Retention** | $$/month | Higher salaries + perks. Makes poaching attempts less likely to succeed. |
| **Air Gap** | $$$$ one-time | Your most secret project is unhackable, but also can't use cloud compute. |

### The Rush/Boom/Turtle Triangle

- **RUSH** (early aggression): Spam cyberattacks and poaching before rivals build defenses. Works if opponent boomed.
- **BOOM** (economic focus): Maximize pipeline throughput, ship products, build capital. Outscale everyone. Loses to rush.
- **TURTLE** (defensive): Heavy security, firewall, counter-intel. Survive attacks and steadily research. Loses to boom (they outscale you).

---

## Research Tree (Civ + AoE branching paths)

Research costs **Research Points** (generated by researchers) + **Time** + sometimes **Compute**.

You CANNOT research everything. Branching paths force strategic choices.

```
ERA 1: NARROW AI
├── Transformer Architecture ──────► unlocks model training
├── Web Scraping ──────────────────► unlocks bulk data collection
├── Cloud Compute ─────────────────► unlocks GPU rental
├── Basic NLP ─────────────────────► unlocks Chatbot product
└── Data Licensing ────────────────► unlocks premium datasets

ERA 2: GENERAL AI (pick your path — can't do all)
│
├─── SCALE PATH (brute force)
│    ├── Mixture of Experts ────────► 2x training efficiency
│    ├── Custom Silicon ────────────► build own chips (huge compute advantage)
│    └── Massive Pretraining ───────► bigger models = better quality
│
├─── INTELLIGENCE PATH (quality)
│    ├── Chain-of-Thought ──────────► reasoning ability boost
│    ├── Tool Use & Agents ─────────► unlocks Agent product (high value)
│    └── Multimodal Fusion ─────────► vision + audio + text
│
├─── ALIGNMENT PATH (safety)
│    ├── RLHF ──────────────────────► model quality + safety boost
│    ├── Constitutional AI ─────────► prevent safety incidents
│    └── Interpretability ──────────► understand what your model is doing
│
├─── OFFENSIVE PATH (warfare)
│    ├── Advanced Cyber Ops ────────► stronger attacks, shorter cooldowns
│    ├── Social Engineering AI ─────► AI-powered espionage (auto-spy)
│    └── Market Manipulation AI ────► AI finds optimal market attacks
│
└─── DEFENSIVE PATH (fortress)
     ├── AI Security Systems ───────► auto-detect spies & cyberattacks
     ├── Encrypted Training ────────► training runs can't be sabotaged
     └── Reputation Management AI ──► auto-PR crisis response

ERA 3: SUPERINTELLIGENCE (all paths converge here)
├── Recursive Self-Improvement ────► AI helps generate research points
├── World Models ──────────────────► AI understands causality
├── Autonomous Research ───────────► AI runs experiments independently
└── ★ ASI PROJECT ─────────────────► WIN CONDITION (requires alignment OR luck)
     └── Alignment score determines safety:
         - High alignment: clean victory, your ASI wins
         - Medium alignment: 50% chance of rogue AI (you lose)
         - No alignment: 90% chance of rogue AI (everyone loses)
```

### Key Design Choice (from research)
**Branching paths that lock you out** create the most interesting strategies. If you went heavy on the Scale Path, you can't also max out Intelligence Path. This means different matches play differently. You might face a Scale player's massive models with your Intelligence player's efficient reasoning agents.

---

## Contested Objectives (MOBA-style neutral objectives)

Every 2 minutes, a contested objective spawns. All players can see it. First to claim it wins.

| Objective | How to Claim | Reward |
|-----------|-------------|--------|
| **Government Contract** | Highest influence + adequate model quality | Massive recurring revenue + reputation |
| **Rare Dataset** | First to send data engineers to acquire it | Unique training data no one else has |
| **Compute Auction** | Highest bid | Temporary 3x compute for 60 seconds |
| **Star Researcher** | Highest salary offer + best reputation | Legendary employee (10/10 skill) |
| **Viral Moment** | Have a product live when it triggers | 5x revenue for 30 seconds |
| **Regulatory Hearing** | Spend influence to shape outcome | Can hurt specific rivals or protect yourself |
| **Breakthrough Paper** | Fastest research team | Major tech shortcut (skip one research node) |
| **Whistleblower** | An opponent's disgruntled employee offers intel | Full visibility of one rival for 60 seconds |

---

## People System (Simplified Rimworld)

Every employee has:

| Attribute | Range | Effect |
|-----------|-------|--------|
| **Skill** | 1-10 | Productivity in their role |
| **Loyalty** | 0-100 | Resistance to poaching. Below 30 = flight risk. |
| **Morale** | 0-100 | Multiplier on productivity. Low morale = mistakes, incidents. |
| **Ethics** | Low/Med/High | Low: will do espionage. High: refuses unethical orders, may whistleblow. |

### Roles

| Role | Function | Voice Command |
|------|----------|---------------|
| **ML Researcher** | Generates research points | "Assign researchers to the reasoning project" |
| **Data Engineer** | Processes raw data into training data | "Put the data team on cleaning the new dataset" |
| **ML Engineer** | Runs training jobs, optimizes models | "Start a training run on project Chimera" |
| **Safety Researcher** | Evaluates models, alignment work | "Run safety eval on the new model" |
| **Product Manager** | Turns models into shippable products | "Ship the chatbot to market" |
| **Software Engineer** | Infrastructure, APIs, deployment | "Build the API platform" |
| **Salesperson** | Generates revenue from products | "Push enterprise sales harder" |
| **Recruiter** | Finds and hires new talent | "Hire three more engineers" |
| **PR / Comms** | Manages reputation, handles crises | "Spin the safety incident as a feature" |
| **Spy** | Espionage operations against rivals | "Send a spy to infiltrate Titan" |
| **Security Officer** | Counter-intel, catches spies | "Sweep the office for moles" |
| **Lawyer** | IP protection, patents, regulatory | "File a patent on our reasoning tech" |

### Character Events (Emergent Drama)
- Researcher gets a better offer → you can counter or lose them
- Spy gets caught at rival → diplomatic incident, reputation hit
- Low-ethics employee leaks your roadmap → rivals adapt
- High-ethics employee refuses your order to skip safety → either fire them (morale hit to others) or comply
- Two employees start dating → productivity boost. They break up → productivity crash.
- Burned-out engineer → goes on leave for 30 seconds
- Brilliant researcher has a eureka moment → bonus research points

---

## Win & Lose Conditions

### Win (any one)
1. **ASI Victory**: Complete the ASI Project. Your superintelligent AI wins. (Alignment check applies — skip safety and you might self-destruct.)
2. **Last Standing**: All other companies are eliminated (bankrupt, acquired, or infrastructure destroyed).
3. **Total Domination**: Control 70%+ of all product markets simultaneously for 60 seconds.

### Lose
1. **Bankrupt**: Capital hits $0 with no revenue stream.
2. **Acquired**: A rival executes a hostile takeover on you.
3. **Infrastructure Destroyed**: Your AI Core (main data center) is destroyed by attacks.
4. **Rogue AI**: You built ASI without alignment → your own AI destroys you.
5. **Talent Exodus**: Headcount drops below 2 → can't operate.

### Elimination Cascade
When a player is eliminated, their employees scatter to the talent market (other players can hire them) and their research is partially leaked (everyone gets some of it). This creates a mid-game power shift — eliminating a rival benefits EVERYONE, creating interesting politics about who to attack.

---

## Multiplayer Design

### Match Setup
- **2-6 players** (sweet spot: 4)
- **20-minute matches** (with built-in escalation so games don't stall)
- **Faction draft**: Players pick factions in order (snake draft for fairness)
- **Map**: Procedurally generated "Neural Valley" — locations of data centers, talent pools, government buildings vary

### Anti-Snowball Mechanics (from research)
1. **Defender's advantage**: Attacks cost more than defenses. You can't just steamroll.
2. **Elimination bounty**: When you eliminate a rival, their talent and research leak to ALL remaining players, not just you.
3. **Contested objectives**: Neutral events that give underdogs a chance to catch up.
4. **Debt vulnerability**: Aggressive expansion requires debt. Debt makes you vulnerable to hostile takeover. Classic risk/reward.
5. **Fog of war**: You don't know what rivals are researching. A "losing" player might be secretly close to ASI.
6. **Escalation timer**: After 16 minutes, all research speeds up and attack cooldowns decrease, forcing an endgame.

### Information Design
- **Your company**: Full visibility
- **Rivals**: Fog of war by default. You see their published products and public reputation.
- **Scouting**: Spies and intel operations reveal rival details temporarily
- **Public events**: Product launches, funding rounds, safety incidents are visible to all
- **Research**: Hidden by default. You only know a rival's tech level by what products they ship.

---

## Visual Design (Phaser Implementation)

### Main View: Your Office (Top-Down)
- Grid-based office layout
- Departments as room-sized blocks with clear labels
- Tiny animated employees walking between departments
- Glowing resource flows between departments (data cubes, compute pulses, document icons)
- Color-coded by department
- Pulsing alerts when attacks incoming or events fire

### Rival Panel (Side Bar)
- Company logos with health bars (capital / infrastructure / reputation)
- Known intel (from spies/public info)
- Attack buttons with cooldowns

### Research Tree (Overlay)
- Tech tree with glowing unlocked nodes
- Branching paths clearly visible
- Active research shows progress bar

### HUD
```
┌─────────────────────────────────────────────────────┐
│ 💰 $2.3M  🖥️ 84 GPU-hrs  📊 3.2k data  🧪 47 RP  │ ← resources
│ ⭐ Rep: 72  🏛️ Influence: 34  👥 Staff: 18/24     │
├─────────────────────────────────────────────────────┤
│                                                     │
│                  YOUR OFFICE                        │
│               (main game view)                      │
│                                                     │
│                                                     │
├───────────┬─────────────────────────────────────────┤
│ RIVALS    │  EVENT LOG / COMMAND FEED                │
│           │                                         │
│ 🔴 TITAN  │  ► "Hired 2 researchers"                │
│ ██████░░  │  ► "Cyberattack on Catalyst: SUCCESS"   │
│           │  ► "Spy detected at Prometheus!"        │
│ 🔵 PROM.  │  ► "Chatbot shipped — $50k/tick"        │
│ ████████  │  ► "Government contract: YOU WON"       │
│           │                                         │
│ 🟢 CATA.  │  🎤 Hold SPACE to give orders...        │
│ █████░░░  │                                         │
└───────────┴─────────────────────────────────────────┘
```

### Voice Feedback
When you give a voice command:
1. Command appears in the feed with a 🎤 icon
2. Employees visibly react — head to their new assignment
3. Confirmation audio: "Yes sir" / "On it" / "Right away" (TTS with personality)
4. If command fails: "We can't afford that" / "We don't have the tech for that yet"

---

## Implementation Architecture

### Shared Types (`packages/shared/src/types/silicon-minds.ts`)
- Company, Employee, Department, Resource types
- Research tree nodes and dependencies
- Attack/Defense definitions with costs and effects
- Product and Market types
- Event definitions

### Scene (`packages/client/src/scenes/SiliconMindsScene.ts`)
- Main game scene — office rendering, employee simulation, production pipeline
- Game tick loop (500ms ticks like Jungle Flow)
- Attack/defense processing
- Win/lose condition checks

### Systems
- `GeminiCommandParser.ts` — already built, adapt prompt for CEO commands
- `SiliconMindsAI.ts` — rival AI decision-making (if playing vs bots)
- `MarketSimulation.ts` — product revenue, market share, competition
- `EspionageSystem.ts` — spy operations, counter-intel, attack resolution
- `ResearchTree.ts` — tech tree progression, unlock effects

### Multiplayer
- Firebase Realtime DB (already set up in the project)
- Sync company state, attacks, market state
- Lock-step game ticks across all players
- Voice commands processed locally, actions synced

---

## Implementation Phases

| Phase | What | Effort |
|-------|------|--------|
| 1 | Shared types, constants, configs | Medium |
| 2 | Office rendering + employee movement + departments | Large |
| 3 | Production pipeline simulation (the Factorio core) | Large |
| 4 | Voice command parsing adapted for CEO commands | Medium |
| 5 | Research tree + era progression | Medium |
| 6 | Products + market + revenue | Medium |
| 7 | Attack & defense system | Large |
| 8 | Rival AI (for single-player / bot opponents) | Large |
| 9 | Contested objectives + events | Medium |
| 10 | Multiplayer sync via Firebase | Large |
| 11 | HUD, polish, sound, victory screens | Medium |

---

## The Vibe

This game should feel **unhinged**. You're a power-tripping CEO screaming orders at your team. You're sending spies. You're launching cyberattacks. You're manipulating markets. You're cutting corners on safety. You're bribing Congress. All while trying to build God.

The comedy writes itself. The drama is emergent. The strategy is deep. And the whole thing runs in a browser.
