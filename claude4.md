# Claude 4 Session Notes — Prompt Battle

## What Was Done This Session

### 1. Added 3 Missing Characters to CharacterHub + Store
Snake (T1), Bear (T3), and Harpoon Fish (T3) existed in gameplay (HordeScene) but were missing from the Characters panel and store catalog. Now fully added:

**Files modified:**
- `packages/shared/src/types/store.ts` — Added `snake`, `bear`, `harpoon_fish` to `HordeUnitType`
- `packages/shared/src/data/store-catalog.ts` — Added UNIT_TIER, UNIT_SKINS (12 skins), VOICE_PACKS (15 voice packs), DELUXE_PORTRAIT_DESCS (3 portraits)
- `packages/shared/src/data/skin-defs.ts` — Added SKIN_REGISTRY entries (12 skin defs with particle effects)
- `packages/client/src/ui/CharacterHub.ts` — Added 3 entries to UNIT_ORDER with stats/abilities
- `packages/client/src/scenes/MenuScene.ts` — Added 3 units to background vignettes + equipped skin support

### 2. Removed Thief (Rogue Duplicate)
Thief and Rogue shared the same sprite (`assets/enemies/thief/Thief_*.png`) and were redundant. Rogue had 40 references across 16 files; Thief had 11 in 2 files. Kept Rogue, removed Thief.

**Files modified:**
- `packages/client/src/scenes/HordeScene.ts` — Removed thief from ANIMALS, RANGED_UNITS, HARD_COUNTERS, GUARD_COUNT, SPAWN_MS, SUPPLY_COST, combat ranges, projectile visuals, pilfer ability, allTypes
- `packages/shared/src/data/maps.ts` — Removed thief from TIER_POOLS
- `packages/client/src/sprites/SpriteConfig.ts` — Removed thief HORDE_SPRITE_CONFIGS entry
- `packages/client/src/audio/SoundManager.ts` — Removed thief from UNIT_AUDIO_NAME

### 3. Fixed Bear Spritesheet
Bear sprites were 256x256 frames, not 192x192. Frame counts were also wrong.
- `SpriteConfig.ts`: Changed bear to frameWidth/Height: 256, idle: 8 frames, walk: 5 frames, attack: 9 frames

### 4. Menu Background Vignettes — New Characters + Equipped Skins
- Added snake, bear, harpoon_fish to VIGNETTE_UNITS
- Now uses `getEffectiveSpriteConfig()` and `getAnimKeyPrefix()` to show equipped skins on background units
- Falls back to default sprite if skin texture isn't loaded

### 5. Store UI Fixes
- **Crown bonus badge**: Removed +50% first-purchase inflation from displayed percentage. Now shows only `pkg.bonusPercent`.
- **Battle Pass**: Removed Premium+ option. Single "BUY BATTLE PASS — 1,000 👑" button.

---

## Current Unit Roster (14 units)

| Unit | Emoji | Tier | HP | ATK | SPD | Abilities |
|------|-------|------|----|-----|-----|-----------|
| Gnome | 🧝 | 1 | 20 | 4 | 210 | Nimble Hands, Plucky |
| Snake | 🐍 | 1 | 30 | 6 | 190 | Venom Spit, Shed Skin |
| Turtle | 🐢 | 2 | 80 | 5 | 55 | Shell Stance, Iron Shell |
| Skull | 💀 | 2 | 90 | 16 | 155 | Undying, Dread Aura |
| Spider | 🕷️ | 2 | 110 | 20 | 140 | Venom Bite, Web Trap |
| Hyena | 🐺 | 2 | 65 | 24 | 175 | Bone Toss, Pack Frenzy |
| Rogue | 🗡️ | 2 | 70 | 40 | 200 | Backstab, Shadow Step |
| Panda | 🐼 | 3 | 280 | 32 | 80 | Thick Hide, Bamboo Wall |
| Lizard | 🦎 | 3 | 200 | 55 | 110 | Cold Blood, Tail Whip |
| Bear | 🐻 | 3 | 320 | 45 | 90 | Rage, Maul |
| Harpoon Fish | 🐡 | 3 | 150 | 65 | 70 | Harpoon, Anchor Shot |
| Minotaur | 🐂 | 4 | 550 | 85 | 105 | War Cry, Bull Rush |
| Shaman | 🔮 | 4 | 350 | 120 | 95 | Arcane Blast, Hex Ward |
| Troll | 👹 | 5 | 1200 | 200 | 50 | Club Slam, Regeneration |

---

## Known Issue: Firebase 401 Unauthorized

All Cloud Function calls (purchaseItem, grantGlory, etc.) are returning 401 from Google Frontend infrastructure. The `www-authenticate` header indicates token verification failure at the Cloud Functions level, not in the function code. This likely means:

1. Cloud Functions may require IAM `allUsers` invoker permission for HTTP functions
2. Or the Firebase Auth token format doesn't match what Google Cloud expects at the infrastructure level
3. Functions ARE deployed and listed (confirmed via `firebase functions:list`)
4. The Vite proxy at localhost:3000 forwards `/api/store/*` to `https://us-central1-prompt-battle-c5e6a.cloudfunctions.net/*`

**To fix:** Run in Google Cloud Console or via gcloud CLI:
```
gcloud functions add-invoker-policy-binding grantGlory --region=us-central1 --member="allUsers"
```
(Repeat for each function, or use `--all` flag)

Alternatively, in Firebase Console → Functions → each function → Permissions → Add `allUsers` as Cloud Functions Invoker.

---

## Key Architecture Notes

### Store/Purchase Flow
- Client: `PaymentService.purchaseItem()` → `apiPost('/api/store/purchaseItem', ...)` with Firebase ID token
- Vite proxy: `/api/store/*` → `https://us-central1-prompt-battle-c5e6a.cloudfunctions.net/*`
- Server: `purchaseItem` cloud function validates token via `admin.auth().verifyIdToken()`, checks catalog, deducts currency, grants item
- All data in Firebase RTDB at `/users/{uid}/inventory/`, `/users/{uid}/wallet/`, `/users/{uid}/equipped/`

### Sprite System
- Default sprites: `HORDE_SPRITE_CONFIGS` in `SpriteConfig.ts`
- Equipped skins: `getEffectiveSpriteConfig(unitType)` resolves equipped skin via `InventoryManager`
- Skin definitions: `SKIN_REGISTRY` in `skin-defs.ts`
- Skin sprite paths: `assets/enemies/{unitType}/skins/{skinId}/Idle.png|Walk.png|Attack.png`

### Project Memory (persistent)
- Fog of war rework pending (reverted to `ts_shadow` brush)
- 99+ SFX generated via ElevenLabs
- SoundManager is a stub (audio system not fully implemented)

### Firebase Project
- Project ID: `prompt-battle-c5e6a`
- RTDB: `https://prompt-battle-c5e6a-default-rtdb.firebaseio.com`
- Functions: `us-central1`
- Auth: Google, Anonymous, itch.io
