# Exploration & Advancement Mechanics Research
## For "Horde Capture" Game Mode — Animal Army

> Research compiled from strategy/tactics games. Each mechanic includes the source game, how it works there, and how it could apply to a prompt-based competitive animal army game with fog of war, hero-led armies, camp capturing, structure destruction, and natural language commands.

---

## 1. EXPLORATION MECHANICS

### 1.1 Shroud vs. Fog of War (Heroes of Might & Magic III–V)

**Source:** In HoMM, unexplored map is covered by black "shroud." Once explored, it becomes visible terrain but is covered by gray "fog of war" — you can see the land but not enemy units unless you have active vision there. HoMM: Olden Era adds a "Week of Dusk" event that re-covers the entire map in fog for all players, and structures like the Necropolis "Cover of Darkness" can re-fog areas for opponents.

**Application:** The game already has fog of war. Add a **two-layer system**: black shroud (never-explored tiles) and gray fog (explored but no current vision). Captured camps provide persistent vision, but if a camp is lost, the area reverts to gray fog — you see terrain/structures but not enemy army positions. A mid-game event (e.g., "Midnight Stampede" at the 3-minute mark) could re-fog contested center tiles, forcing re-scouting. Players could issue commands like "scout the center" to send fast units ahead to re-reveal.

---

### 1.2 Watchtowers and Cartographer's Tents (Age of Wonders 4)

**Source:** In Age of Wonders 4, the strategic map starts covered in cloud. Players reveal it by moving armies, but they can also capture Watchtowers (which reveal a wide radius permanently) or find Cartographer's Tents (which reveal an entire region at once). Reflective Pools act as one-time intel items.

**Application:** Place **Lookout Perches** at elevated tiles on the map (hilltops). When a hero passes through one, it permanently reveals a large radius for that player. Alternatively, certain camps (like the Falcon or Parrot camp) could inherently provide extra vision range when captured, which already exists in the game's `visionRange` property — but this could be made more dramatic. A prompt like "send my falcons to scout ahead" could dispatch a small flying unit that reveals tiles along a path without engaging enemies.

---

### 1.3 Branching Node Map (Slay the Spire)

**Source:** Slay the Spire uses a vertically-scrolling map of branching nodes. Each node is marked with an icon indicating its type (normal fight, elite fight, merchant, rest site, random event, treasure) so players can plan routes several steps ahead. The map is procedurally generated each run but fully visible from the start.

**Application:** Instead of a fully open map, the horde mode could have **named waypoints** connected by paths, forming a network/graph rather than open terrain. Each waypoint's type (camp, structure, resource cache, hazard) is visible once adjacent nodes are explored, letting players plan routes via prompts: "take the northern path through wolf territory." This would make natural language commands more intuitive — players navigate by landmark names rather than coordinates.

---

### 1.4 Sector Progression with Pressure (FTL: Faster Than Light)

**Source:** In FTL, players navigate a sector map of ~20 beacons, choosing which nodes to visit. A rebel fleet advances from the left side of the map each turn, closing off previously available nodes. Players must balance thorough exploration (more scrap/upgrades) against the encroaching threat. Each sector ends with an exit jump.

**Application:** Add a **creep wave timer** or "wild stampede" mechanic — as game time progresses, a danger zone expands from the map center outward (or from the edges inward), making neutral camps harder. Uncaptured camps in the danger zone could get boosted guards, rewarding early exploration. A player who spends too long farming safe Tier 1 camps finds Tier 2–3 camps scaling up. This creates time pressure analogous to FTL's rebel fleet. Prompt: "we need to push out before the stampede reaches the wolf camp."

---

### 1.5 Scouting as Risk Mitigation (Darkest Dungeon)

**Source:** Darkest Dungeon gives a base 25% chance to scout ahead when entering a room. Successful scouting reveals upcoming dangers (traps, enemy ambushes), preventing the party from being surprised. Scouted traps can be disarmed for stress healing. Players can equip trinkets to boost scout chance, making it an investment. The light meter further modulates risk: lower light means more loot but more stress and harder fights.

**Application:** Before attacking a camp, the player could have an option to **scout first** — sending a fast unit (rabbit, falcon) ahead. Scouting reveals the camp's exact guard composition, any hidden bonuses, and whether the enemy hero is nearby. Unscouted attacks risk an "ambush" penalty (guards get first strike). The trade-off: scouting costs time during which the enemy might capture another camp. Prompt: "scout the bear camp before we attack" vs. "rush the bear camp."

---

### 1.6 Perfect Information Puzzle Terrain (Into the Breach)

**Source:** Into the Breach shows all enemy actions one turn in advance. The tactical depth comes from terrain manipulation — pushing enemies into water for instant kills, lighting forests on fire, using environmental events (tidal waves, earthquakes, airstrikes) that arrive on predictable schedules. Desert tiles create smoke; mountains block movement; buildings must be protected.

**Application:** Add **terrain hazards** that affect combat on specific tiles. River tiles could give a defense penalty; forest tiles could provide an ambush bonus (first-strike advantage); hill tiles give ranged units extra range. Crucially, make these effects visible and predictable so players can factor them into commands: "attack through the forest for the ambush bonus" or "lure them onto the river crossing." The tile system already has grass, forest, water, hill, etc. — give each a combat modifier.

---

### 1.7 Mutation-Driven Exploration (Caves of Qud)

**Source:** Caves of Qud procedurally generates nearly 1 million map tiles, with regions growing harder as the player moves west. Monsters themselves are procedurally mutated (extra heads, arms, mechanical augments). Exploration is rewarded by finding relics, mutagens, and lore at historic sites. Characters gain mutation points each level, spent to strengthen existing mutations or buy new random ones.

**Application:** Make each game's camp layout partially randomized with **"mutant camps"** — occasional camps that have a random modifier applied: double guards but double spawn rate, a rare elite animal type, a camp that spawns two animal types at once, or a camp with a terrain hazard baked in. These would appear in unexplored areas, rewarding scouting. Players discover what they're dealing with when they explore: "there's a mutant bear camp with twin spawns — we should prioritize it."

---

### 1.8 Ancient Wonders as Exploration Goals (Age of Wonders 4)

**Source:** Ancient Wonders are grand landmark structures that require a hero-led army to explore. They contain powerful loot and narrative encounters. They serve as major exploration incentives placed at key map positions, offering adventure and reward for the army that reaches them first.

**Application:** Place 1–2 **"Legendary Dens"** on the map — special locations that aren't regular camps but require significant army strength to clear. Rewards could be a unique unit type (e.g., a Phoenix or Dragon not available from normal camps), a permanent team-wide buff, or a large vision reveal. These become race objectives: the first player to reach and clear the Legendary Den gets a power spike. Prompt: "rally everything and push to the Dragon's Den."

---

## 2. ADVANCEMENT / PROGRESSION MECHANICS

### 2.1 Creeping for Items and XP (Warcraft 3)

**Source:** Warcraft 3's "creeping" system places neutral hostile camps across the map in three color-coded difficulty tiers (green/orange/red). Killing creeps grants hero XP and random item drops. Item drops are tied to camp difficulty — harder camps drop better items (Tome of Experience, Claws of Attack, healing items). Creeping order matters: players who efficiently clear green camps first, then orange, then red gain a tempo advantage.

**Application:** This is already the core loop of the game — but the research suggests making **camp loot more varied**. Currently destroying a camp gives you the unit type. Consider adding a small random "loot drop" when a camp is captured: a consumable (heal burst for the hero), a temporary buff (attack speed for 30 seconds), or a permanent minor stat boost for units from that camp. Higher-tier camps drop better loot. Prompt: "grab the wolf camp quick — I want the attack buff before we push."

---

### 2.2 Star Upgrades / Unit Combining (Teamfight Tactics)

**Source:** TFT lets players buy units from a shared shop. Three copies of the same 1-star unit combine into a 2-star unit (doubled stats, improved ability). Three 2-star copies combine into a 3-star unit (tripled stats, dramatically enhanced ability). This creates a satisfying progression loop where accumulating "copies" of units leads to power spikes.

**Application:** Introduce a **unit promotion system**: when a player has 3+ units of the same animal type alive at once, they can be "promoted." Three rabbits merge into one "Elite Rabbit" with 2x stats and an enhanced ability. This creates a strategic choice: do you keep many weak units for numbers, or consolidate for fewer elite units? Prompt: "promote my wolves" or "merge the rabbits." This would interact with the existing `pack_bonus` for wolves — pack bonus stays relevant for the unmerged state, while promotion is for when you commit to quality over quantity.

---

### 2.3 Synergy Trait Thresholds (Teamfight Tactics / Auto Chess)

**Source:** Every TFT champion has traits (e.g., "Challenger," "Bruiser"). Fielding 2 Challengers gives +20% attack speed; 4 Challengers gives +50%; 6 gives +80%. Players build armies around hitting trait breakpoints, creating emergent team composition strategies.

**Application:** The unit tag system (`swift`, `ranged`, `tank`, `healer`, etc.) could trigger **army-wide synergy bonuses** at thresholds. Having 5+ "swift" units grants all units +10% movement speed. Having 3+ "ranged" units gives +1 range to all ranged units. Having 2+ "support" units doubles aura effectiveness. This makes army composition a deliberate strategy rather than just "capture everything." Prompt: "I want to build a swift army — focus on rabbits, falcons, and deer."

---

### 2.4 Boon Choices with Synergy (Hades)

**Source:** Hades offers boons from Olympian gods at room completions. Each god specializes in an effect type (Zeus = lightning/chain damage, Artemis = crits, Aphrodite = weak debuff). Taking multiple boons from the same god unlocks powerful "Duo Boons" that combine two gods' effects. Players must commit to a build direction early.

**Application:** When destroying a structure (which currently grants a permanent upgrade), offer a **choice of 2–3 upgrade options** rather than a fixed upgrade. The player picks via prompt: "take the attack boost" or "give me the spawn speed." If the player already has a related upgrade, the new one could be enhanced (a "Duo" effect) — e.g., if you have Savage Strikes (+25% ATK) and then choose Rapid Reinforcements (2x spawn), you also get a bonus: freshly spawned units arrive with a temporary damage boost. This rewards strategic upgrade pathing.

---

### 2.5 Item Stacking with Scaling Categories (Risk of Rain 2)

**Source:** Risk of Rain 2 items stack in three patterns: **Linear** (Soldier's Syringe: +15% attack speed per stack, constant returns), **Hyperbolic** (Tougher Times: diminishing returns, approaches but never reaches 100%), and **Exponential** (Shaped Glass: doubles damage per stack, compounding). This creates interesting decisions about whether to diversify items or stack one type.

**Application:** If units from the same camp stack (you have 5 wolves), apply **scaling bonuses**: the first wolf gives base stats, but each additional wolf could give a small bonus to all wolves (linear stacking). Alternatively, tank units (bears, elephants) could stack defense hyperbolically — many bears approach but never reach invincibility. This gives mathematical depth to army size decisions. The `pack_bonus` for wolves already hints at this — expand it to other unit types with different stacking curves.

---

### 2.6 Evolution through Conditions (Pokemon)

**Source:** Pokemon evolve through multiple methods: reaching a level threshold, using an evolution stone, trading, leveling up in a specific location, leveling with high friendship, or knowing a specific move. Each method feels thematic. Evolution dramatically changes stats and sometimes type, and can be delayed to learn certain moves available only to the pre-evolved form.

**Application:** Add **conditional unit evolution**: a unit that survives N combats evolves into a stronger form. A rabbit that kills 3 enemies becomes a "War Hare" with better stats. A wolf that fights alongside 3+ pack members for 60 seconds becomes an "Alpha Wolf" with a leadership aura. An elephant that tanks 200 damage without dying becomes a "War Elephant" with armor. These evolutions reward keeping units alive and could be triggered by specific conditions the player can pursue: "keep my bears alive — they're close to evolving."

---

### 2.7 Material Farming for Crafted Upgrades (Monster Hunter)

**Source:** In Monster Hunter, defeating monsters yields materials specific to that monster (scales, fangs, hides). Players use these materials to craft weapons and armor, each with unique stats and elemental properties. Capturing a monster (weakening then trapping it) yields different/better materials than killing it. The crafting system creates a progression loop driven by targeted hunting.

**Application:** Each animal camp could drop a **"trophy material"** when captured. Collecting specific combinations of trophies could unlock permanent hero upgrades or army-wide buffs at the base. For example: Wolf Fang + Bear Hide = "Predator's Armor" (+15% hero defense). Rabbit Foot + Deer Antler = "Swift Stride" (+10% army speed). This rewards diverse camp capturing rather than just stacking one type. Prompt: "I need a bear trophy — let's take the bear camp."

---

### 2.8 Tech Tree with Branching Choices (Warcraft 3 / StarCraft)

**Source:** Warcraft 3 races have tech trees tied to buildings: constructing a Keep unlocks Tier 2 units, a Castle unlocks Tier 3. Upgrades at specific buildings improve units globally (e.g., Improved Ranged Weapons at the Lumber Mill gives all ranged units +1 damage). StarCraft's three races each have completely different tech trees, creating asymmetric progression.

**Application:** Rather than a single upgrade per structure, add a **mini tech tree** at the player's base. As the game progresses (or as camps are captured), the player unlocks upgrade tiers. Tier 1: basic stat boosts. Tier 2 (after capturing 3+ camps): unlock unit specials for all units. Tier 3 (after capturing 5+ camps or destroying a structure): unlock an ultimate ability (mass heal, berserker rage for all units, etc.). The player chooses which upgrade to research via prompt: "research the berserker upgrade."

---

### 2.9 Scrap Economy and Ship Subsystems (FTL)

**Source:** FTL uses scrap as a universal currency earned from combat and events. Players spend scrap on ship system upgrades (shields, weapons, engines), reactor power, crew hiring, and store purchases. The tension is between immediate combat capability (buy weapons now) and long-term investment (save for a shield upgrade later). Destroying a ship yields scrap; killing crew without destroying yields bonus scrap.

**Application:** Add a **resource currency** earned passively from captured camps (like gold/sec in MOBAs). Resources are spent on hero upgrades, spawning bursts of units, or purchasing one-time abilities. The tension: do you spend resources on an immediate heal for your hero, or save up for a powerful "mass spawn" that floods a camp with units? Prompt: "save up for a big push" or "spend resources to heal."

---

### 2.10 Base Building as Gradual Investment (They Are Billions / Rimworld)

**Source:** In They Are Billions, defenses follow a priority hierarchy: Units > Towers > Walls > Turrets. The player uses terrain (forests, mountains, water) as natural walls and builds artificial walls only where needed. Spending on defense competes with spending on economy (housing, resource buildings). Waves arrive on a schedule, so the player must balance expansion with fortification on a known timeline.

**Application:** Allow players to **fortify their base** as an alternative to expanding. Instead of always pushing outward, a player could issue "build walls" or "set up defenses" to create defensive structures near their base or near captured camps. Captured camps could have a defense upgrade: "fortify the wolf camp" makes it harder for the enemy to recapture. This creates a strategic tension between turtling (defense) and aggression (capturing more camps). The current base has 500 HP — allow spending resources to add base turrets or heal the base.

---

## 3. ARMY COMPOSITION MECHANICS

### 3.1 Unit Veterancy with Stat Gains (Total War)

**Source:** In Total War (Rome, Empire, etc.), units gain experience "chevrons" from combat kills. Each chevron gives +1 melee attack, +1 defense, and ranged units get +2 accuracy and +2 reload speed. The first chevron also gives +1 morale. A veteran unit with 3–4 chevrons is dramatically more effective than a fresh recruit. This creates attachment to long-serving units and strategic value in preserving them.

**Application:** Track **kills per unit**. After a unit gets 2 kills, it gains a veterancy star (+10% attack, +10% HP). After 5 kills, a second star. After 10 kills, a third star and a visual indicator (golden border). Veteran units become precious — losing a 3-star wolf to a careless fight feels costly. This rewards careful micro and army preservation. Prompt: "protect my veteran wolves — pull them back and send the rabbits in first."

---

### 3.2 Counter Triangle System (Fire Emblem / Pokemon)

**Source:** Fire Emblem uses a weapon triangle: Swords beat Axes, Axes beat Lances, Lances beat Swords. Each advantage grants +15% hit rate and +1 damage. Pokemon expands this to 18 types with a full matrix of strengths, weaknesses, immunities, and resistances. Both systems reward bringing the right unit to the right fight.

**Application:** The game already has a `COUNTER_TABLE` (swift > ranged, ranged > tank, tank > melee, AoE > swarm). Make this more visible and impactful — increase the counter multiplier from 1.25x to 1.5x, and add visual/audio feedback when a counter is triggered. More importantly, make this a **core strategic prompt** players must think about: "send wolves against their falcons — wolves are swift and counter ranged." Add counter info to the scouting mechanic so players can plan compositions.

---

### 3.3 Formation Bonuses (Total War / Ogre Battle)

**Source:** Total War's formation system grants bonuses based on unit arrangement: Rank Fire (alternating rows fire muskets for sustained damage), Shield Wall (front rank locks shields for massive defense boost), Wedge formation (cavalry charges with bonus penetration). In Ogre Battle, unit placement within a 3x3 squad grid determines who attacks first and who gets hit first.

**Application:** Allow players to specify **army formation via prompt**: "wolves in front, parrots behind" or "defensive formation" or "spread out." Frontline units absorb damage; backline ranged/support units attack safely. A "phalanx" formation could give tanks +50% defense but -30% speed. A "charge" formation gives +30% damage on first contact but units take more damage. Prompt: "charge formation — wolves and lions up front, everyone else follow."

---

### 3.4 Morale and Loyalty System (Tactics Ogre: Reborn)

**Source:** In Tactics Ogre, each unit has a Loyalty stat based on alignment (Lawful, Neutral, Chaotic) and the player's choices. Loyalty drops when the player makes decisions that conflict with a unit's alignment — a Lawful unit loses loyalty if the player acts ruthlessly. Units with low loyalty fight less effectively and can even desert. Loyalty rises naturally through leveling up and making alignment-compatible choices.

**Application:** Add a **morale system** to armies. Units near their hero fight at full strength. Units far from their hero (sent to attack solo) fight at 80% effectiveness. Winning fights boosts morale (+5% damage for 15 seconds). Losing units drops morale. If morale drops critically low (hero dies, losing badly), units might flee back to base instead of fighting. This creates a tension between splitting your army (faster capture but weaker fights) and keeping it together (slower but stronger). Prompt: "keep the army together — morale is low."

---

### 3.5 Pretender God Bless Design (Dominions 5)

**Source:** In Dominions 5, players design a Pretender God before the game begins, choosing magic paths that determine which "bless" effects apply to Sacred units. A fire-path pretender might grant Sacred units flaming weapons; a nature-path gives regeneration. Powerful "incarnate" blesses only work while the Pretender is alive and on the map. Any priest can activate the bless in battle, but the Pretender's survival matters for the strongest effects.

**Application:** This maps to the existing **hero passive system** — but suggests making it more impactful. The hero passive (rally_leader, iron_will, etc.) could have a **proximity requirement**: the passive only applies to units within the hero's vision range. If the hero dies, the passive deactivates entirely until respawn. This makes protecting your hero critical and creates assassination opportunities. Prompt: "their hero gives attack bonus — kill the hero and their army weakens."

---

### 3.6 Sacred/Elite Unit Design (Dominions 5)

**Source:** Sacred units in Dominions are special national troops that benefit from the Pretender's bless effect. A well-designed bless can make relatively cheap Sacred units fight far above their cost. The strategy is building your entire army around making Sacred units as effective as possible through the right bless choices.

**Application:** Designate one animal type per game as the player's **"favored beast"** (chosen during a quick draft phase or randomly assigned). That animal type gets +25% stats from all sources and spawns 50% faster from its camp. This creates asymmetry — one player might have favored wolves while the other has favored bears — and the meta-game of exploiting or countering the opponent's favored beast. Prompt: "they have favored bears — we need to stack ranged units."

---

### 3.7 Supply Lines and Unit Upkeep (Total War / They Are Billions)

**Source:** In Total War, armies far from supply lines suffer attrition (units slowly lose HP). In They Are Billions, each fighting unit requires gold upkeep at regular intervals; falling behind payments causes desertion. This prevents endless army accumulation and forces economic decisions.

**Application:** Add **upkeep pressure**: each captured camp produces units, but also consumes "food" (a passive resource). The more camps you hold, the more food you need. If food production can't keep up (based on how many Tier 1 camps you hold, which are "farms"), higher-tier units spawn slower or start losing HP over time. This prevents a dominant player from holding everything — there's a natural cap based on economy. Prompt: "we're overextended — abandon the rabbit camp to feed the bear army."

---

### 3.8 Class Promotion Trees (Fire Emblem / Final Fantasy Tactics)

**Source:** In Fire Emblem, units can promote from a base class to an advanced class at level 10+ (e.g., Cavalier → Paladin or Great Knight). Each promotion path offers different stat bonuses and abilities. In Final Fantasy Tactics, the job system lets any unit learn abilities from any class, and abilities from one class can be equipped while using another, creating deep customization.

**Application:** At certain thresholds (e.g., when a camp has produced 10 units total), it could **upgrade its production tier**: Rabbit Run starts producing "War Hares" instead of basic Rabbits, Wolf Warren starts producing "Dire Wolves." The player could influence which promotion path a camp takes via prompt: "upgrade the wolf camp to dire wolves" vs. "upgrade the wolf camp to shadow wolves" (stealth variant). This adds depth to long-held camps.

---

## 4. COMPETITIVE / ASYMMETRIC MECHANICS

### 4.1 Timing Attacks and Power Spikes (StarCraft II)

**Source:** A timing attack exploits a window where you have a temporary advantage — typically right after a key upgrade finishes or a new unit type becomes available, but before the opponent has their own. Classic examples: Marine-Medivac push at 7:30 when Stim finishes; Zealot-Archon timing before opponent gets Colossus. The concept extends to "hitting before the investment pays off" — attacking someone who just expanded before their economy catches up.

**Application:** Structure destruction already creates power spikes (the upgrade applies immediately). Make these **more dramatic and announced** — when a player destroys a structure, both players hear it, creating a "clock" effect. The opponent knows a power spike just happened and must decide: engage now before the upgraded army masses, or turtle and tech up to match. Camp captures could also create visible power spikes: "their wolf pack just hit 5 units — pack bonus is active, avoid wolves." Prompt: "they just got savage strikes — attack now before they mass units with it."

---

### 4.2 Positive Elixir Trading (Clash Royale)

**Source:** Clash Royale's core competitive mechanic is elixir advantage — countering expensive cards with cheaper ones to accumulate a resource lead. A 5-elixir Executioner stopped by a 3-elixir Knight gives +2 elixir advantage. The game flows around "positive trades" until one player has enough advantage to mount an offense that can't be efficiently defended.

**Application:** Make **efficient camp clearing** a competitive mechanic. If a player can capture a camp while losing minimal units (efficient trade), they gain tempo. If they lose most of their army to capture a camp (inefficient trade), they're vulnerable. Track and surface "trade efficiency" — how many units lost vs. camp value gained. Higher-tier camps that are cleared with few losses represent big value. Prompt: "don't waste units on the bear camp yet — wait until we have more wolves."

---

### 4.3 Multiple Win Conditions (Northgard)

**Source:** Northgard offers multiple victory conditions: Domination (military conquest), Fame (accumulate prestige through deeds), Wisdom (research all technologies), Trade (accumulate trade value), and map-specific objectives. Each clan has a unique victory condition they're best suited for. This means different strategies can win, and players must scout to understand which win condition the opponent is pursuing.

**Application:** Currently the only win condition is base destruction. Add **alternative win conditions**:
- **Camp Dominance**: Control 8+ camps simultaneously for 60 seconds
- **Hero Supremacy**: Kill the enemy hero 3 times
- **Total War**: Destroy both the enemy base AND hold the center camps
This means a player who's losing the base race might pivot to camp dominance. Prompt: "forget the base — capture everything and hold it for the camp victory."

---

### 4.4 Comeback Rubber-Banding (StarCraft / MOBAs)

**Source:** In StarCraft, a player who loses their army can rebuild from production facilities; a player who loses production facilities struggles to recover. MOBAs like Dota 2 give increased gold/XP bounties for killing players on winning streaks, and losing teams get cheaper buybacks. The game already has `HERO_RESPAWN_COMEBACK_BONUS` (3 seconds faster respawn for the losing team).

**Application:** Expand the comeback system. When one player controls fewer camps than the opponent, their hero could gain **"Underdog Fury"**: +15% damage, +10% speed, and camps they attack have weakened guards (-20% HP). This helps the losing player recapture territory without making the mechanic so strong it punishes the leading player. The existing respawn bonus is good — consider also giving the losing player's units a morale boost ("fighting for survival") that increases damage when near their own base.

---

### 4.5 Asymmetric Faction Design (StarCraft)

**Source:** StarCraft's three races (Terran, Protoss, Zerg) play completely differently. Terran has strong defense and mobility. Protoss has expensive, powerful units. Zerg has cheap, expendable units and rapid expansion. This asymmetry means mirror matches are rare and each game has a unique dynamic based on matchup.

**Application:** Currently both players play identically. Consider giving each player a **randomly assigned "Warlord trait"** at game start that modifies their playstyle:
- **Swarm Lord**: Tier 1–2 camps spawn 50% faster, but Tier 3–4 units have -20% HP
- **Beast Master**: Tier 3–4 units get +30% stats, but Tier 1–2 camps produce nothing
- **Pack Alpha**: Units near the hero get +25% damage, but units far from hero get -25%
- **Siege Commander**: Massive damage to structures, but hero has -30% combat stats
This creates asymmetric matchups each game. Prompt: "I'm the Swarm Lord — flood them with rabbits and wolves before they get their bears online."

---

### 4.6 Map Control Through Expansion Denial (StarCraft / Northgard)

**Source:** In StarCraft, denying enemy expansions (destroying their new bases before they become profitable) is a core strategy. A Zerg player who prevents the Protoss from taking a third base wins the economic war. In Northgard, territory costs increase with each tile controlled, so denying tiles to opponents is as valuable as taking them yourself.

**Application:** Add a mechanic where **recapturing a camp that was previously held by the enemy** is more valuable than capturing a neutral camp — it triggers a "plunder" bonus (extra resources, a temporary buff). Conversely, losing a camp you held for a long time is more punishing — units from that camp get a morale debuff for 15 seconds. This makes camp control more dynamic and rewards aggression. Prompt: "raid their falcon camp — we'll get the plunder bonus."

---

### 4.7 Escalating Tension / Double Elixir Time (Clash Royale)

**Source:** Clash Royale's 3-minute matches accelerate: in the first 2 minutes, elixir regenerates at 1/2.8s. In the last minute, it doubles to 1/1.4s (Double Elixir), and overtime is Triple Elixir. This ensures games end dramatically — the pace increases, making defensive play harder and rewarding aggressive compositions.

**Application:** The game already has camp scaling (`CAMP_SCALING_AMOUNT = 0.10` every 60 seconds). Make the escalation more dramatic in the final phase: in the last 90 seconds, **all camps produce units at 2x rate** and the base takes 50% more damage. This ensures games reach a decisive conclusion and rewards players who built better compositions (not just more units). Announce it: "The Great Stampede begins — all camps surge!" Prompt: "it's double spawn time — throw everything at the base."

---

### 4.8 Hero Assassination as Strategic Objective (Warcraft 3 / MOBAs)

**Source:** In Warcraft 3, killing an enemy hero awards XP to your hero, denies the enemy hero XP and item usage while dead, and gives map control during the respawn timer. High-level hero kills are devastating because the respawn timer scales with level. Entire strategies revolve around "hero sniping" — committing resources specifically to kill the hero.

**Application:** The game already has hero death/respawn. Make hero kills more impactful: when a hero dies, their captured camps produce units 50% slower until respawn, and existing units lose the hero passive effect. The killing player gets a **"Dominance" buff** — their hero gains +10% stats for 30 seconds. This makes hero fights a high-stakes decision point rather than incidental. Prompt: "ignore the camps — hunt their hero down."

---

### 4.9 Territorial Fog Manipulation (HoMM: Olden Era)

**Source:** The Necropolis faction's "Cover of Darkness" structure re-fogs areas of the map for all opponents, forcing them to re-explore. Combined with the "Week of Dusk" global event that covers everything in fog, this creates strategic information denial where one player can see and the other can't.

**Application:** Add a **"Smoke Screen" ability** that the hero can activate (cooldown: 90 seconds) to cover a 5-tile radius around themselves in fog for the enemy for 15 seconds. This enables sneak attacks on camps or structures, or allows the player to move their army without being tracked. Counter: if the enemy has a falcon unit nearby, the falcon's innate scouting negates the smoke screen. Prompt: "activate smoke screen and push through the center unseen."

---

### 4.10 Resource Denial / Map Starving (StarCraft)

**Source:** In StarCraft, when an opponent turtles defensively, the optimal response isn't to attack their fortified position — it's to expand everywhere they aren't and deny their expansion attempts. This "map starving" strategy cuts off their resources and lets you overwhelm them with superior production. The opponent is forced out of their defensive position or slowly loses.

**Application:** If a player controls more camps, they should gain a **gradual advantage beyond just unit production**: increased hero regen, faster respawn, and a slowly growing damage bonus to their base attack. This means a player who turtles at their base while the opponent controls the map will eventually lose even without direct base assault — the economic advantage converts into unstoppable pressure. Prompt: "we control 7 camps — just hold and let the advantage grow."

---

### 4.11 Bounty Systems and Streaks (MOBAs / Clash Royale)

**Source:** In Dota 2 and League of Legends, killing a player on a killing streak awards bonus gold proportional to the streak length. This creates a "bounty" on dominant players, giving the losing team a potential comeback if they can take down the fed player. Clash Royale's "First Crown Tower" bonus gives extra elixir for the first structure destroyed.

**Application:** Track a **"Camp Streak"** — each consecutive camp captured without losing one increases the reward slightly (faster spawns, bonus resources). But if the enemy breaks the streak by recapturing a camp, they get a "Streak Breaker" bonus. Also, add a bounty to the hero: a hero that has captured 3+ camps in a row becomes "Marked" (visible through fog of war to the opponent for 10 seconds), creating a risk-reward dynamic for aggressive expansion. Prompt: "their hero is marked — we know where they are, let's ambush."

---

### 4.12 Environmental Events as Equalizers (Into the Breach / Northgard)

**Source:** Into the Breach uses environmental events (tidal waves, earthquakes, airstrikes) announced one turn in advance that affect the entire battlefield indiscriminately. Northgard has winter seasons that reduce food production and increase upkeep, periodically punishing overextended players. Both systems create periodic resets that prevent any one player from snowballing.

**Application:** Add **timed environmental events** that disrupt the map:
- **Migration Wave** (every 3 minutes): a wave of neutral animals sweeps across the center, dealing damage to any units in their path — both players must briefly pull back or lose units
- **Rainy Season** (once per game): water tiles flood adjacent tiles for 30 seconds, cutting off certain paths and forcing rerouting
- **Territorial Roar** (once per game): all camp guards respawn at 50% strength, making recently captured camps contestable again
Prompt: "migration wave incoming — pull the army south and let it pass."

---

## 5. BONUS: MECHANICS ESPECIALLY SUITED TO NATURAL LANGUAGE COMMANDS

### 5.1 Named Landmarks as Navigation Language

**Source:** Every game on this list uses named locations for navigation — Heroes of Might & Magic names every mine, every town, every artifact location.

**Application:** The game already does this well with alliterative camp names (Rowdy Rabbit Run, Brutal Bear Bastion, etc.). Extend this to **all map features**: name terrain zones ("Whispering Woods," "Deadman's Ridge," "the River Crossing"). This makes prompt commands richer and more intuitive: "march through Whispering Woods to Brutal Bear Bastion" rather than "move to position 18,22."

---

### 5.2 Standing Orders and Behavioral Macros

**Source:** Total War allows units to be set to behaviors like "fire at will," "guard mode," or "skirmish mode." Ogre Battle lets entire squads be set to AI behaviors that persist until changed.

**Application:** Allow players to set **persistent behavioral orders** via prompt that last until overridden: "wolves: always guard the base." "falcons: patrol between the two center camps." "rabbits: follow the hero." These standing orders free the player from micromanaging every unit group every turn and play to the strength of natural language — it's easy to say "patrol" but hard to implement via traditional RTS click-commands.

---

### 5.3 Conditional/Reactive Orders

**Source:** Paradox grand strategy games (Stellaris, EU4) let players set policies and triggers: "if war exhaustion reaches 50%, seek peace." Supreme Commander allows queued orders and waypoint patterns.

**Application:** Let players issue **conditional commands** via prompt: "if they attack the wolf camp, send the bears to defend." "When we have 5+ wolves, push to the bear camp." "If my hero drops below 50% HP, retreat to base." The AI command parser would store these as triggers, making the game feel more strategic and less reactive. This is a unique advantage of the natural-language interface over traditional RTS controls.

---

## SUMMARY TABLE

| # | Mechanic | Source Game(s) | Category |
|---|----------|---------------|----------|
| 1 | Shroud + Fog dual layer | HoMM III–V | Exploration |
| 2 | Watchtowers / vision structures | Age of Wonders 4 | Exploration |
| 3 | Branching node map | Slay the Spire | Exploration |
| 4 | Encroaching danger zone | FTL | Exploration |
| 5 | Scouting as risk mitigation | Darkest Dungeon | Exploration |
| 6 | Terrain combat modifiers | Into the Breach | Exploration |
| 7 | Mutant/procedural camps | Caves of Qud | Exploration |
| 8 | Legendary dens as race objectives | Age of Wonders 4 | Exploration |
| 9 | Camp loot drops | Warcraft 3 | Advancement |
| 10 | Unit star upgrades (3-merge) | TFT / Auto Chess | Advancement |
| 11 | Synergy trait thresholds | TFT / Auto Chess | Advancement |
| 12 | Upgrade choices with combos | Hades | Advancement |
| 13 | Stacking with scaling curves | Risk of Rain 2 | Advancement |
| 14 | Conditional unit evolution | Pokemon | Advancement |
| 15 | Trophy crafting from camps | Monster Hunter | Advancement |
| 16 | Branching tech tree | Warcraft 3 / StarCraft | Advancement |
| 17 | Scrap economy / resource spending | FTL | Advancement |
| 18 | Base fortification investment | They Are Billions / Rimworld | Advancement |
| 19 | Unit veterancy from kills | Total War | Army Composition |
| 20 | Counter triangle system | Fire Emblem / Pokemon | Army Composition |
| 21 | Formation bonuses | Total War / Ogre Battle | Army Composition |
| 22 | Morale and proximity effects | Tactics Ogre | Army Composition |
| 23 | Pretender bless / hero aura | Dominions 5 | Army Composition |
| 24 | Favored beast designation | Dominions 5 | Army Composition |
| 25 | Supply lines and upkeep | Total War / They Are Billions | Army Composition |
| 26 | Camp production promotion | Fire Emblem / FFT | Army Composition |
| 27 | Timing attacks and power spikes | StarCraft II | Competitive |
| 28 | Positive elixir trading | Clash Royale | Competitive |
| 29 | Multiple win conditions | Northgard | Competitive |
| 30 | Comeback rubber-banding | StarCraft / MOBAs | Competitive |
| 31 | Asymmetric warlord traits | StarCraft | Competitive |
| 32 | Expansion denial / plunder bonus | StarCraft / Northgard | Competitive |
| 33 | Escalating game pace | Clash Royale | Competitive |
| 34 | Hero assassination value | Warcraft 3 / MOBAs | Competitive |
| 35 | Fog manipulation abilities | HoMM: Olden Era | Competitive |
| 36 | Map starving / economic victory | StarCraft | Competitive |
| 37 | Bounty systems and streaks | MOBAs / Clash Royale | Competitive |
| 38 | Environmental events | Into the Breach / Northgard | Competitive |
| 39 | Named landmark navigation | HoMM / all | NLP-suited |
| 40 | Standing behavioral orders | Total War / Ogre Battle | NLP-suited |
| 41 | Conditional/reactive orders | Paradox games / SupCom | NLP-suited |

---

## Sources

- [HoMM Adventure Map - Might and Magic Wiki](https://mightandmagic.fandom.com/wiki/Adventure_map)
- [HoMM Olden Era - Fog of War Discussion](https://steamcommunity.com/app/3105440/discussions/0/596288191849665895/)
- [Age of Wonders 4 Dev Diary #7 - Exploration](https://www.paradoxinteractive.com/games/age-of-wonders-4/news/age-of-wonders-4-dev-diary-7)
- [Age of Wonders 4 - Ancient Wonders](https://gamespace.com/all-articles/news/age-of-wonders-4-ancient-wonders/)
- [Slay the Spire - Wikipedia](https://en.wikipedia.org/wiki/Slay_the_Spire)
- [FTL Map vs STS Map Discussion](https://steamcommunity.com/app/646570/discussions/0/3093389895543717739/)
- [FTL Sectors - Wiki](https://ftl.fandom.com/wiki/Sectors)
- [FTL Scrap - Wiki](https://ftl.fandom.com/wiki/Scrap)
- [Warcraft 3 Creeping - Battle.net](http://classic.battle.net/war3/basics/creeping.shtml)
- [WC3 Creep Mechanics - WC3 Gym](https://warcraft-gym.com/a-summary-on-creep-mechanics-and-how-to-abuse-them/)
- [Warcraft 3 Upgrades - Liquipedia](https://liquipedia.net/warcraft/Upgrades)
- [TFT Beginner's Guide - Mobalytics](https://mobalytics.gg/blog/tft/tft-guide/)
- [TFT Champions and Synergies - MMO Auctions](https://mmoauctions.com/news/teamfight-tactics-champions-and-synergies-guide-find-the-best-teamcomp)
- [TFT - Wikipedia](https://en.wikipedia.org/wiki/Teamfight_Tactics)
- [StarCraft Timing Attack - Liquipedia](https://liquipedia.net/starcraft2/Timing_Attack)
- [Map Control - Learning SC2](https://learningsc2.com/tag/map-control/)
- [Darkest Dungeon Scouting - Wiki](https://darkestdungeon.fandom.com/wiki/Scouting)
- [Darkest Dungeon Light Meter - Wiki](https://darkestdungeon.wiki.gg/wiki/Light_Meter)
- [Into the Breach Tips - PC Gamer](https://www.pcgamer.com/into-the-breach-tips/)
- [Into the Breach Abilities - Wiki](https://intothebreach.fandom.com/wiki/Abilities_and_status_effects)
- [Risk of Rain 2 Item Stacking - Wiki](https://riskofrain2.fandom.com/wiki/Item_Stacking)
- [Hades Boons - Wiki](https://hades.fandom.com/wiki/Boons)
- [Hades II Best Builds - Vocal Media](https://vocal.media/gamers/hades-ii-best-builds-and-boon-synergies-explained)
- [Caves of Qud Mutations - Wiki](https://wiki.cavesofqud.com/wiki/Mutations)
- [Caves of Qud Procedural Generation - Game Developer](https://www.gamedeveloper.com/design/tapping-into-the-potential-of-procedural-generation-in-caves-of-qud)
- [Monster Hunter Elemental Damage - Wiki](https://monsterhunterworld.wiki.fextralife.com/Elemental+Damage)
- [Pokemon/Monster-Taming Games - Wikipedia](https://en.wikipedia.org/wiki/Monster-taming_game)
- [Total War Unit Experience - Wiki](https://totalwar.fandom.com/wiki/Experience)
- [Total War Experience Stats Effects](https://etw.heavengames.com/articles/strategy/campaign/effects-of-experience/)
- [Tactics Ogre Loyalty - Wiki](https://ogrebattlesaga.fandom.com/wiki/Loyalty)
- [Tactics Ogre Reborn - Loyalty and Chaos Frame](https://www.thegamer.com/tactics-ogre-reborn-how-loyalty-chaos-frame-cressida-explained/)
- [Dominions 5 Pretender and Bless Design](https://steamcommunity.com/sharedfiles/filedetails/?id=1978405957)
- [Dominions 5 Bless Strategies - illwiki](https://illwiki.com/dom5/taorec-bless-strategies)
- [They Are Billions Defense Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2644408902)
- [They Are Billions Swarms - Wiki](https://they-are-billions.fandom.com/wiki/Swarms)
- [Northgard Colonization - Wiki](https://northgard.fandom.com/wiki/Colonization)
- [Northgard Advanced Gameplay Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=870510451)
- [Clash Royale Elixir - Wiki](https://clashroyale.fandom.com/wiki/Elixir)
- [Clash Royale Elixir Management Guide](https://clashdecks.com/guides/elixir-management-101)
