# Deploy Prompt Battle (Horde Mode) to itch.io

## One command to build the ZIP

```
npm run build:itch
```

This builds the project and creates `prompt-battle-itch.zip` in the project root.

## Upload to itch.io

1. Go to https://itch.io/game/new
2. Set **Kind of project** to **HTML**
3. Upload `prompt-battle-itch.zip`
4. Check **"This file will be played in the browser"**
5. Set viewport to **1920 x 1080**
6. Check **"Mobile friendly"**
7. Set embed mode to **"Click to launch in fullscreen"**
8. Save & publish

## What works on itch.io

- **Horde Mode (Solo)** — fully playable, zero server dependencies
- **Voice input** — uses browser-native Web Speech API (free, no key needed)
- **Command parsing** — regex fallback works without any API key
- **AI parsing (optional)** — players can paste their own Gemini API key via the brain button in-game
- **Maps** — bundled JSON + localStorage save/load
- **Google Fonts** — loaded from CDN, works inside itch.io iframes

## What does NOT work on itch.io

- **Animal Army (multiplayer)** — requires WebSocket + Firebase server infrastructure
- The multiplayer menu options will fail to connect; this is expected

## AI Settings (Gemini key)

Players can optionally bring their own Gemini API key for smarter command parsing:

1. In Horde Mode, click the brain button in the top-right toolbar
2. Paste a Gemini API key (free at https://aistudio.google.com/app/apikey)
3. The key is stored in localStorage and used immediately
4. Without a key, the built-in regex parser handles all commands fine

## Technical notes

- `base: './'` in Vite config makes all asset paths relative (required for itch.io subdirectory serving)
- All localStorage keys are prefixed with `pb_` to avoid collisions with other games on `html-classic.itch.zone`
- Phaser renderer is set to `AUTO` (falls back to Canvas2D if WebGL is unavailable)
- Build output is ~7 MB (well under itch.io's 500 MB limit)
