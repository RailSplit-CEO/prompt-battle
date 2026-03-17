#!/usr/bin/env npx tsx
/**
 * test-skin-prompts.ts — Test 4 different prompting strategies on the same skin
 * to find the best approach before batch generating.
 *
 * Tests gnome frost idle (8 frames, 192x192, 1536x192 strip)
 */

import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

const API_KEY = process.argv[2] || process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Pass API key as first arg or set GEMINI_API_KEY'); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: API_KEY });
const MODEL = 'gemini-2.5-flash-image';

const ASSETS = path.resolve(__dirname, 'public/assets/enemies');
const BASE_PATH = path.join(ASSETS, 'gnome/Gnome_Idle.png');
const OUT_DIR = path.join(ASSETS, 'gnome/skins/_test_prompts');

const FRAME_W = 192, FRAME_H = 192, FRAME_COUNT = 8;
const TOTAL_W = FRAME_W * FRAME_COUNT; // 1536
const TOTAL_H = FRAME_H; // 192

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function callGemini(prompt: string, images: { data: string; mime: string }[]): Promise<Buffer> {
  const parts: any[] = [];
  for (const img of images) {
    parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
  }
  parts.push({ text: prompt });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: { responseModalities: ['IMAGE'] },
      });

      const candidates = response.candidates;
      if (!candidates?.length) throw new Error('No candidates');
      const resParts = candidates[0].content?.parts;
      if (!resParts) throw new Error('No parts');

      for (const p of resParts) {
        if (p.inlineData?.data) {
          return Buffer.from(p.inlineData.data, 'base64');
        }
      }
      throw new Error('No image in response');
    } catch (err: any) {
      console.error(`    Attempt ${attempt + 1}/3 failed: ${err.message}`);
      if (attempt < 2) await sleep(5000 * (attempt + 1));
      else throw err;
    }
  }
  throw new Error('Unreachable');
}

async function postProcess(buf: Buffer, w: number, h: number): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  let pipeline = sharp(buf).ensureAlpha();
  if (meta.width !== w || meta.height !== h) {
    console.log(`    Resizing ${meta.width}x${meta.height} -> ${w}x${h}`);
    pipeline = pipeline.resize(w, h, { fit: 'fill', kernel: 'nearest' });
  }
  return pipeline.png().toBuffer();
}

// ─── Strategy 1: Detailed Strip Recolor (current approach) ─────────

async function strategy1_detailedStrip(baseB64: string): Promise<Buffer> {
  console.log('\n[Strategy 1] Detailed strip recolor prompt');
  const prompt = `You are a pixel art sprite sheet colorist. I'm giving you a horizontal sprite sheet strip of a game character in Idle animation.

The strip contains exactly ${FRAME_COUNT} animation frames laid out left-to-right. Each frame is ${FRAME_W}x${FRAME_H} pixels. The total image is ${TOTAL_W}x${TOTAL_H} pixels.

TASK: Recolor this character sprite sheet to create the "Frost Gnome" skin variant.

THEME: Recolor to an icy frost theme. Use pale blue (#A0D2DB) for body areas, ice white (#E8F4F8) for highlights, deep blue (#2E5090) for shadows. The hat should look like a pointed ice crystal cap. Add subtle frost/icy texture to clothing.

CRITICAL RULES:
- Keep EXACTLY the same poses, proportions, outlines, and silhouette in every frame
- Keep the transparent background — do NOT add any background color or fill
- Keep the same number of frames (${FRAME_COUNT}) in the same positions
- Only change the colors and palette of the character
- Maintain the pixel art style with clean dark outlines
- Include the subtle circular ground shadow beneath the character like the reference
- The output MUST be exactly ${TOTAL_W}x${TOTAL_H} pixels
- Each frame must be exactly ${FRAME_W}x${FRAME_H} pixels`;

  const raw = await callGemini(prompt, [{ data: baseB64, mime: 'image/png' }]);
  return postProcess(raw, TOTAL_W, TOTAL_H);
}

// ─── Strategy 2: Minimal/Simple Prompt ──────────────────────────────

async function strategy2_minimalPrompt(baseB64: string): Promise<Buffer> {
  console.log('\n[Strategy 2] Minimal simple prompt');
  const prompt = `Take this pixel art sprite sheet and recolor the character to look like a Frost/Ice version. Change the colors to icy blues and whites. Keep the same transparent background, same poses, same layout. Do not change anything except the colors. Output the same dimensions: ${TOTAL_W}x${TOTAL_H} pixels.`;

  const raw = await callGemini(prompt, [{ data: baseB64, mime: 'image/png' }]);
  return postProcess(raw, TOTAL_W, TOTAL_H);
}

// ─── Strategy 3: Frame-by-Frame (extract frame 1, recolor, then ask for full strip) ──

async function strategy3_conceptThenStrip(baseB64: string): Promise<Buffer> {
  console.log('\n[Strategy 3] Two-pass: concept frame + strip generation');

  // Pass 1: Generate a single concept frame from frame 1
  const baseBuffer = Buffer.from(baseB64, 'base64');
  const frame1 = await sharp(baseBuffer)
    .extract({ left: 0, top: 0, width: FRAME_W, height: FRAME_H })
    .png().toBuffer();
  const frame1B64 = frame1.toString('base64');

  console.log('  Pass 1: Generating concept frame...');
  const conceptPrompt = `This is a single frame of a pixel art game character (${FRAME_W}x${FRAME_H} pixels).

Create a "Frost Gnome" recolored version of this exact character. Change the color palette to icy blues and frost whites:
- Body: pale ice blue (#A0D2DB)
- Highlights: frost white (#E8F4F8)
- Shadows: deep blue (#2E5090)
- Hat: icy crystal appearance

Keep the EXACT same pose, proportions, silhouette, and transparent background. Keep pixel art style with dark outlines. Output must be ${FRAME_W}x${FRAME_H} pixels.`;

  const conceptRaw = await callGemini(conceptPrompt, [{ data: frame1B64, mime: 'image/png' }]);
  const conceptFrame = await postProcess(conceptRaw, FRAME_W, FRAME_H);
  const conceptB64 = conceptFrame.toString('base64');

  // Save concept for inspection
  fs.writeFileSync(path.join(OUT_DIR, 'strategy3_concept.png'), conceptFrame);
  console.log('  Concept frame saved');

  await sleep(2000);

  // Pass 2: Use concept + full base strip to generate the full strip
  console.log('  Pass 2: Generating full strip from concept...');
  const stripPrompt = `I'm giving you two images:
1. A reference sprite sheet strip with ${FRAME_COUNT} animation frames (the POSES to follow)
2. A single concept frame showing the target character design (the COLORS/STYLE to use)

Create a new sprite sheet strip of ${FRAME_COUNT} frames, each ${FRAME_W}x${FRAME_H} pixels, laid out left-to-right. Total output: ${TOTAL_W}x${TOTAL_H} pixels.

Follow the exact poses/animation from image 1, but use the character design/colors from image 2.
Keep transparent background, pixel art style, dark outlines, ground shadow.
Output MUST be exactly ${TOTAL_W}x${TOTAL_H} pixels.`;

  const raw = await callGemini(stripPrompt, [
    { data: baseB64, mime: 'image/png' },
    { data: conceptB64, mime: 'image/png' },
  ]);
  return postProcess(raw, TOTAL_W, TOTAL_H);
}

// ─── Strategy 4: Edit-style instruction with strong anchoring ──────

async function strategy4_editStyle(baseB64: string): Promise<Buffer> {
  console.log('\n[Strategy 4] Edit-style instruction with pixel-level anchoring');
  const prompt = `EDIT this sprite sheet image. This is a ${TOTAL_W}x${TOTAL_H} pixel art sprite sheet with ${FRAME_COUNT} frames of a gnome character on a transparent background.

INSTRUCTION: Change ONLY the colors of the character in every frame to create an ice/frost themed version:
- Orange/red hat → icy blue (#A0D2DB) crystal hat
- Brown/tan body colors → pale blue (#B8D4E3) and white (#E8F4F8)
- Dark outlines → keep as-is (dark outlines stay)
- Ground shadow → keep as-is
- Background → keep fully transparent (RGBA)
- All poses, positions, frame layout → keep EXACTLY as-is, pixel-for-pixel positioning

This is a palette swap. Do NOT redraw, move, resize, or reposition any element. Only swap colors. Output the edited image at exactly ${TOTAL_W}x${TOTAL_H} pixels.`;

  const raw = await callGemini(prompt, [{ data: baseB64, mime: 'image/png' }]);
  return postProcess(raw, TOTAL_W, TOTAL_H);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('=== Skin Prompt Strategy Test ===');
  console.log(`Base: ${BASE_PATH}`);
  console.log(`Output: ${OUT_DIR}\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const baseBuffer = fs.readFileSync(BASE_PATH);
  const baseB64 = baseBuffer.toString('base64');

  // Copy base for comparison
  fs.copyFileSync(BASE_PATH, path.join(OUT_DIR, '0_base_original.png'));

  const strategies = [
    { name: 'strategy1_detailed_strip', fn: () => strategy1_detailedStrip(baseB64) },
    { name: 'strategy2_minimal_prompt', fn: () => strategy2_minimalPrompt(baseB64) },
    { name: 'strategy3_concept_then_strip', fn: () => strategy3_conceptThenStrip(baseB64) },
    { name: 'strategy4_edit_style', fn: () => strategy4_editStyle(baseB64) },
  ];

  for (const strat of strategies) {
    try {
      const result = await strat.fn();
      const outPath = path.join(OUT_DIR, `${strat.name}.png`);
      fs.writeFileSync(outPath, result);

      const meta = await sharp(result).metadata();
      console.log(`  ✓ Saved: ${strat.name}.png (${meta.width}x${meta.height})`);
    } catch (err: any) {
      console.error(`  ✗ FAILED: ${strat.name} — ${err.message}`);
    }

    // Brief pause between strategies to avoid rate limits
    await sleep(3000);
  }

  console.log(`\n=== Done! Check results in: ${OUT_DIR} ===`);
  console.log('Compare the 4 output PNGs against 0_base_original.png');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
