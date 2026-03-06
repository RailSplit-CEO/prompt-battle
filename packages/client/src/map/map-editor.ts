import type { TileType } from '@prompt-battle/shared';
import mapDef from './maps/default.json';

// ─── Config ─────────────────────────────────────────────────────
const W = mapDef.width || 80;
const H = mapDef.height || 80;
const BASE_TILE = 10;
let scale = 1;
let tileSize = BASE_TILE;

const TILE_COLORS: Record<string, string> = {
  grass: '#5CC96B', forest: '#2E8B4E', water: '#45A5FF', rock: '#9B9B9B',
  hill: '#DEB245', bush: '#65D155', path: '#EDD9A7', bridge: '#C4A060',
  lava: '#FF5533', sand: '#EED9A0', swamp: '#5A7A44', flowers: '#7BC96B',
  mushroom: '#BB6644', ruins: '#8888AA', gate_open: '#CCBB88',
  gate_closed: '#777777', switch: '#FFDD44', capture_point: '#E8C44A',
};

const TILE_LIST: { id: string; key: string; color: string }[] = [
  { id: 'grass', key: '.', color: TILE_COLORS.grass },
  { id: 'forest', key: 'F', color: TILE_COLORS.forest },
  { id: 'water', key: 'W', color: TILE_COLORS.water },
  { id: 'rock', key: 'R', color: TILE_COLORS.rock },
  { id: 'hill', key: 'H', color: TILE_COLORS.hill },
  { id: 'bush', key: 'B', color: TILE_COLORS.bush },
  { id: 'path', key: 'P', color: TILE_COLORS.path },
  { id: 'bridge', key: 'b', color: TILE_COLORS.bridge },
  { id: 'lava', key: 'L', color: TILE_COLORS.lava },
  { id: 'sand', key: 'S', color: TILE_COLORS.sand },
  { id: 'swamp', key: '~', color: TILE_COLORS.swamp },
  { id: 'flowers', key: '*', color: TILE_COLORS.flowers },
  { id: 'mushroom', key: 'm', color: TILE_COLORS.mushroom },
  { id: 'ruins', key: 'U', color: TILE_COLORS.ruins },
];

const MARKER_TYPES = [
  { id: 'spawn_p1', label: 'P1 Spawn', color: '#4499FF' },
  { id: 'spawn_p2', label: 'P2 Spawn', color: '#FF5555' },
  { id: 'control_point', label: 'Capture Point', color: '#FFD700' },
  { id: 'grab', label: 'Grab / Move CP', color: '#FFA500' },
  { id: 'eraser', label: 'Eraser (markers)', color: '#666' },
];

// ─── State ──────────────────────────────────────────────────────
let tiles: string[][] = [];
let selectedTile = 'rock';
let selectedMarker: string | null = null;
let brushSize = 1;
let mirrorRot = false;  // 180° rotation around center
let mirrorH = false;
let mirrorV = false;
let mirrorD1 = false;  // diagonal \ (swap x,y)
let mirrorD2 = false;  // diagonal / (swap and flip)
let painting = false;
let panning = false;
let panStart = { x: 0, y: 0 };
let scrollStart = { x: 0, y: 0 };
let draggingCP: CPData | null = null;

interface CPData {
  id: string; name: string; x: number; y: number; radius: number;
  buff: { type: string; value: number; label: string };
}

let controlPoints: CPData[] = [];
let spawnsP1: { x: number; y: number }[] = [];
let spawnsP2: { x: number; y: number }[] = [];

// ─── Init from JSON ────────────────────────────────────────────
function initFromJson() {
  tiles = [];
  for (let y = 0; y < H; y++) {
    tiles[y] = [];
    for (let x = 0; x < W; x++) {
      tiles[y][x] = 'grass';
    }
  }

  // Apply wallFeatures coverSpots as rock
  if ((mapDef as any).wallFeatures?.coverSpots) {
    for (const s of (mapDef as any).wallFeatures.coverSpots) {
      if (s.x >= 0 && s.x < W && s.y >= 0 && s.y < H) tiles[s.y][s.x] = 'rock';
    }
  }

  controlPoints = ((mapDef as any).controlPoints || []).map((cp: any, i: number) => ({
    id: cp.id || `cp_${i}`,
    name: cp.name || `Point ${i}`,
    x: cp.x, y: cp.y,
    radius: cp.radius || 4,
    buff: cp.buff || { type: 'damage', value: 1.1, label: '+10% Damage' },
  }));

  spawnsP1 = [...(mapDef.spawns?.player1 || [])];
  spawnsP2 = [...(mapDef.spawns?.player2 || [])];
}

// ─── Canvas ────────────────────────────────────────────────────
const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const wrap = document.getElementById('canvas-wrap')!;
const tooltip = document.getElementById('tooltip')!;

function resize() {
  tileSize = Math.max(4, Math.round(BASE_TILE * scale));
  canvas.width = W * tileSize;
  canvas.height = H * tileSize;
}

function render() {
  resize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Tiles
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      ctx.fillStyle = TILE_COLORS[tiles[y][x]] || TILE_COLORS.grass;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }

  // Grid
  if (tileSize >= 6) {
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    for (let y = 0; y <= H; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * tileSize); ctx.lineTo(W * tileSize, y * tileSize); ctx.stroke();
    }
    for (let x = 0; x <= W; x++) {
      ctx.beginPath(); ctx.moveTo(x * tileSize, 0); ctx.lineTo(x * tileSize, H * tileSize); ctx.stroke();
    }
  }

  // Control points
  for (const cp of controlPoints) {
    const cx = cp.x * tileSize + tileSize / 2;
    const cy = cp.y * tileSize + tileSize / 2;

    // Fill capture_point tiles
    for (let dy = -cp.radius; dy <= cp.radius; dy++) {
      for (let dx = -cp.radius; dx <= cp.radius; dx++) {
        if (dx * dx + dy * dy > cp.radius * cp.radius) continue;
        const nx = cp.x + dx, ny = cp.y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
          ctx.fillStyle = 'rgba(232,196,74,0.35)';
          ctx.fillRect(nx * tileSize, ny * tileSize, tileSize, tileSize);
        }
      }
    }

    // Radius ring
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, cp.radius * tileSize, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center dot
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(cx, cy, tileSize * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Name
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold ${Math.max(9, tileSize)}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(cp.name, cx, cy + cp.radius * tileSize + tileSize + 2);
  }

  // Spawns
  const drawSpawn = (s: { x: number; y: number }, color: string, label: string) => {
    const sx = s.x * tileSize + tileSize / 2;
    const sy = s.y * tileSize + tileSize / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, tileSize * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(7, tileSize * 0.65)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, sx, sy);
  };

  spawnsP1.forEach((s, i) => drawSpawn(s, '#4499FF', `${i + 1}`));
  spawnsP2.forEach((s, i) => drawSpawn(s, '#FF5555', `${i + 1}`));

  // Mirror guide lines
  const anyMirror = mirrorRot || mirrorH || mirrorV || mirrorD1 || mirrorD2;
  if (anyMirror) {
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    if (mirrorRot) {
      // Draw a crosshair at center to indicate rotation point
      const cx = W * tileSize / 2;
      const cy = H * tileSize / 2;
      ctx.strokeStyle = 'rgba(255,165,0,0.5)';
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 18, cy); ctx.lineTo(cx + 18, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy + 18); ctx.stroke();
    }
    if (mirrorH) {
      ctx.strokeStyle = 'rgba(255,100,100,0.4)';
      ctx.beginPath();
      ctx.moveTo(0, H * tileSize / 2);
      ctx.lineTo(W * tileSize, H * tileSize / 2);
      ctx.stroke();
    }
    if (mirrorV) {
      ctx.strokeStyle = 'rgba(100,100,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(W * tileSize / 2, 0);
      ctx.lineTo(W * tileSize / 2, H * tileSize);
      ctx.stroke();
    }
    if (mirrorD1) {
      ctx.strokeStyle = 'rgba(100,255,100,0.4)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W * tileSize, H * tileSize);
      ctx.stroke();
    }
    if (mirrorD2) {
      ctx.strokeStyle = 'rgba(255,255,100,0.4)';
      ctx.beginPath();
      ctx.moveTo(W * tileSize, 0);
      ctx.lineTo(0, H * tileSize);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

// ─── Mirror helpers ─────────────────────────────────────────────
function getMirroredPoints(x: number, y: number): { x: number; y: number }[] {
  // Compound: each axis reflects ALL existing points, building up the full symmetry group.
  let pts = [{ x, y }];

  if (mirrorRot) {
    // 180° rotation around center: (x,y) -> (W-1-x, H-1-y)
    pts = pts.concat(pts.map(p => ({ x: W - 1 - p.x, y: H - 1 - p.y })));
  }
  if (mirrorH) {
    pts = pts.concat(pts.map(p => ({ x: p.x, y: H - 1 - p.y })));
  }
  if (mirrorV) {
    pts = pts.concat(pts.map(p => ({ x: W - 1 - p.x, y: p.y })));
  }
  if (mirrorD1) {
    pts = pts.concat(pts.map(p => ({ x: p.y, y: p.x })));
  }
  if (mirrorD2) {
    pts = pts.concat(pts.map(p => ({ x: W - 1 - p.y, y: H - 1 - p.x })));
  }

  // Deduplicate
  const seen = new Set<string>();
  return pts.filter(p => {
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Paint ─────────────────────────────────────────────────────
function paintAt(tx: number, ty: number) {
  if (selectedMarker) {
    handleMarkerPlace(tx, ty);
    return;
  }

  const r = brushSize - 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + r) continue;
      const px = tx + dx;
      const py = ty + dy;
      // Collect all mirrored points
      const points = getMirroredPoints(px, py);
      for (const p of points) setTile(p.x, p.y, selectedTile);
    }
  }
  render();
}

function setTile(x: number, y: number, t: string) {
  if (x >= 0 && x < W && y >= 0 && y < H) tiles[y][x] = t;
}

function handleMarkerPlace(tx: number, ty: number) {
  if (selectedMarker === 'spawn_p1') {
    if (spawnsP1.length >= 5) spawnsP1.shift();
    spawnsP1.push({ x: tx, y: ty });
  } else if (selectedMarker === 'spawn_p2') {
    if (spawnsP2.length >= 5) spawnsP2.shift();
    spawnsP2.push({ x: tx, y: ty });
  } else if (selectedMarker === 'control_point') {
    showCPModal(tx, ty);
    return;
  } else if (selectedMarker === 'eraser') {
    // Remove any marker at this tile
    spawnsP1 = spawnsP1.filter(s => s.x !== tx || s.y !== ty);
    spawnsP2 = spawnsP2.filter(s => s.x !== tx || s.y !== ty);
    controlPoints = controlPoints.filter(cp => Math.abs(cp.x - tx) > cp.radius && Math.abs(cp.y - ty) > cp.radius);
    // Check if clicking on a CP center
    const cpIdx = controlPoints.findIndex(cp => cp.x === tx && cp.y === ty);
    if (cpIdx >= 0) controlPoints.splice(cpIdx, 1);
  }
  render();
}

// ─── CP Modal ──────────────────────────────────────────────────
let editingCP: CPData | null = null;
let editingCPIsNew = false;

function showCPModal(tx: number, ty: number, existing?: CPData) {
  const modal = document.getElementById('cp-modal')!;
  const overlay = document.getElementById('overlay')!;

  if (existing) {
    editingCP = existing;
    editingCPIsNew = false;
  } else {
    editingCP = {
      id: `cp_${Date.now()}`,
      name: `Point ${controlPoints.length + 1}`,
      x: tx, y: ty, radius: 4,
      buff: { type: 'damage', value: 1.15, label: '+15% Damage' },
    };
    editingCPIsNew = true;
  }

  (document.getElementById('cp-name') as HTMLInputElement).value = editingCP.name;
  (document.getElementById('cp-radius') as HTMLInputElement).value = String(editingCP.radius);
  (document.getElementById('cp-buff-type') as HTMLSelectElement).value = editingCP.buff.type;
  (document.getElementById('cp-buff-value') as HTMLInputElement).value = String(editingCP.buff.value);

  modal.style.display = 'block';
  overlay.style.display = 'block';
}

function hideCPModal() {
  document.getElementById('cp-modal')!.style.display = 'none';
  document.getElementById('overlay')!.style.display = 'none';
  editingCP = null;
}

document.getElementById('cp-ok')!.onclick = () => {
  if (!editingCP) return;
  editingCP.name = (document.getElementById('cp-name') as HTMLInputElement).value;
  editingCP.radius = parseInt((document.getElementById('cp-radius') as HTMLInputElement).value) || 4;
  const btype = (document.getElementById('cp-buff-type') as HTMLSelectElement).value;
  const bval = parseFloat((document.getElementById('cp-buff-value') as HTMLInputElement).value) || 1.1;
  editingCP.buff = { type: btype, value: bval, label: `+${Math.round((bval - 1) * 100)}% ${btype[0].toUpperCase() + btype.slice(1)}` };
  if (editingCPIsNew) controlPoints.push(editingCP);
  hideCPModal();
  render();
};

document.getElementById('cp-cancel')!.onclick = hideCPModal;
document.getElementById('cp-delete')!.onclick = () => {
  if (editingCP && !editingCPIsNew) {
    controlPoints = controlPoints.filter(cp => cp !== editingCP);
  }
  hideCPModal();
  render();
};
document.getElementById('overlay')!.onclick = hideCPModal;

// ─── Build UI ──────────────────────────────────────────────────
function buildTileTools() {
  const group = document.getElementById('tile-tools')!;
  for (const t of TILE_LIST) {
    const btn = document.createElement('div');
    btn.className = 'tool-btn' + (t.id === selectedTile ? ' active' : '');
    btn.style.background = t.color;
    btn.innerHTML = `<span style="color:#fff;text-shadow:0 0 3px #000">${t.key}</span><div class="tooltip">${t.id}</div>`;
    btn.dataset.tile = t.id;
    btn.onclick = () => {
      selectedTile = t.id;
      selectedMarker = null;
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.marker-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
    group.appendChild(btn);
  }
}

function buildMarkerTools() {
  const group = document.getElementById('marker-tools')!;
  for (const m of MARKER_TYPES) {
    const btn = document.createElement('div');
    btn.className = 'marker-btn';
    btn.innerHTML = `<div class="marker-dot" style="background:${m.color}"></div>${m.label}`;
    btn.onclick = () => {
      selectedMarker = m.id;
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.marker-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
    group.appendChild(btn);
  }
}

// ─── Brush size ────────────────────────────────────────────────
const brushSlider = document.getElementById('brush-size') as HTMLInputElement;
const brushLabel = document.getElementById('brush-label')!;
brushSlider.oninput = () => {
  brushSize = parseInt(brushSlider.value);
  brushLabel.textContent = String(brushSize);
};

// ─── Mirror checkboxes ─────────────────────────────────────────
const mirrorChkRot = document.getElementById('chk-mirror-rot') as HTMLInputElement;
const mirrorChkH = document.getElementById('chk-mirror-h') as HTMLInputElement;
const mirrorChkV = document.getElementById('chk-mirror-v') as HTMLInputElement;
const mirrorChkD1 = document.getElementById('chk-mirror-d1') as HTMLInputElement;
const mirrorChkD2 = document.getElementById('chk-mirror-d2') as HTMLInputElement;
mirrorChkRot.onchange = () => { mirrorRot = mirrorChkRot.checked; render(); };
mirrorChkH.onchange = () => { mirrorH = mirrorChkH.checked; render(); };
mirrorChkV.onchange = () => { mirrorV = mirrorChkV.checked; render(); };
mirrorChkD1.onchange = () => { mirrorD1 = mirrorChkD1.checked; render(); };
mirrorChkD2.onchange = () => { mirrorD2 = mirrorChkD2.checked; render(); };

// ─── Mouse events ──────────────────────────────────────────────
let spaceDown = false;

function getTile(e: MouseEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const tx = Math.floor((e.clientX - rect.left) / tileSize);
  const ty = Math.floor((e.clientY - rect.top) / tileSize);
  return [tx, ty];
}

function findCPNear(tx: number, ty: number): CPData | null {
  return controlPoints.find(cp => Math.abs(cp.x - tx) <= 1 && Math.abs(cp.y - ty) <= 1) || null;
}

function updateCursor() {
  if (spaceDown || panning) canvas.style.cursor = panning ? 'grabbing' : 'grab';
  else if (selectedMarker === 'grab') canvas.style.cursor = 'grab';
  else canvas.style.cursor = 'crosshair';
}

// Disable right-click context menu on the canvas area so we can use it for pan
wrap.oncontextmenu = (e) => { e.preventDefault(); };

// Pan: right-click drag, middle-click drag, or space+left-click drag
// Listen on the whole wrapper so panning works even outside the canvas
wrap.onmousedown = (e) => {
  const isPanButton = e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown);
  if (isPanButton) {
    panning = true;
    panStart = { x: e.clientX, y: e.clientY };
    scrollStart = { x: wrap.scrollLeft, y: wrap.scrollTop };
    updateCursor();
    e.preventDefault();
    return;
  }
};

canvas.onmousedown = (e) => {
  // Pan buttons already handled by wrap
  if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) return;

  if (e.button === 0) {
    const [tx, ty] = getTile(e);

    // Grab tool: start dragging a CP
    if (selectedMarker === 'grab') {
      const cp = findCPNear(tx, ty);
      if (cp) {
        draggingCP = cp;
        canvas.style.cursor = 'grabbing';
      }
      return;
    }

    // Click on existing CP center to edit (unless eraser)
    const existingCP = controlPoints.find(cp => cp.x === tx && cp.y === ty);
    if (existingCP && selectedMarker !== 'eraser' && !selectedMarker) {
      showCPModal(tx, ty, existingCP);
      return;
    }

    painting = true;
    paintAt(tx, ty);
  }
};

// Use document-level mousemove/mouseup so panning doesn't break when cursor leaves canvas
document.addEventListener('mousemove', (e) => {
  // Tooltip (only when over canvas)
  const rect = canvas.getBoundingClientRect();
  const overCanvas = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;

  if (overCanvas) {
    const [tx, ty] = getTile(e);
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top = (e.clientY + 14) + 'px';
    tooltip.textContent = `(${tx}, ${ty}) ${tiles[ty]?.[tx] || ''}`;
  } else {
    tooltip.style.display = 'none';
  }

  if (panning) {
    wrap.scrollLeft = scrollStart.x - (e.clientX - panStart.x);
    wrap.scrollTop = scrollStart.y - (e.clientY - panStart.y);
    return;
  }

  if (!overCanvas) return;
  const [tx, ty] = getTile(e);

  // Dragging a CP
  if (draggingCP) {
    if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
      draggingCP.x = tx;
      draggingCP.y = ty;
      render();
    }
    return;
  }

  // Grab tool cursor hint
  if (selectedMarker === 'grab') {
    const cp = findCPNear(tx, ty);
    canvas.style.cursor = cp ? 'grab' : 'default';
  }

  if (painting && !selectedMarker) paintAt(tx, ty);
});

document.addEventListener('mouseup', () => {
  if (draggingCP) {
    draggingCP = null;
    render();
  }
  painting = false;
  panning = false;
  updateCursor();
});

canvas.onmouseleave = () => { tooltip.style.display = 'none'; };

// Zoom
wrap.onwheel = (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.15 : 0.15;
  scale = Math.min(4, Math.max(0.3, scale + delta));
  render();
};

// ─── Buttons ───────────────────────────────────────────────────
document.getElementById('btn-clear')!.onclick = () => {
  if (!confirm('Clear entire map?')) return;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles[y][x] = 'grass';
  controlPoints = [];
  spawnsP1 = [];
  spawnsP2 = [];
  render();
};

document.getElementById('btn-mirror')!.onclick = () => {
  // Apply current mirror axes to the whole map as a one-shot operation
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = tiles[y][x];
      if (t === 'grass') continue;
      const pts = getMirroredPoints(x, y);
      for (const p of pts) setTile(p.x, p.y, t);
    }
  }
  render();
};

function buildJson(): string {
  const json: any = {
    name: mapDef.name || 'Custom Map',
    description: 'Created with Map Editor',
    width: W,
    height: H,
    legend: mapDef.legend,
    terrain: [],
    useProcedural: false,
    seed: 42,
    spawns: {
      player1: spawnsP1,
      player2: spawnsP2,
    },
    flags: { player1: { x: -1, y: -1 }, player2: { x: -1, y: -1 } },
    controlPoints: controlPoints.map(cp => ({
      id: cp.id, name: cp.name, x: cp.x, y: cp.y, radius: cp.radius, buff: cp.buff,
    })),
    mines: [], towerSites: [], scoutingPosts: [], neutralCamps: [], pois: [],
    lanes: [], connectors: [], switchGates: [],
    wallFeatures: {},
    zones: [],
  };

  // Encode terrain as strings
  const legend = mapDef.legend as Record<string, string>;
  const reverse: Record<string, string> = {};
  for (const [ch, tileType] of Object.entries(legend)) {
    reverse[tileType] = ch;
  }

  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      row += reverse[tiles[y][x]] || '.';
    }
    rows.push(row);
  }
  json.terrain = rows;

  return JSON.stringify(json, null, 2);
}

document.getElementById('btn-save')!.onclick = async () => {
  const json = buildJson();
  try {
    const resp = await fetch('/__save_map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
    if (resp.ok) {
      showToast('Saved!');
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(json);
      showToast('Copied to clipboard (save endpoint not available)');
    }
  } catch {
    await navigator.clipboard.writeText(json);
    showToast('Copied to clipboard');
  }
};

document.getElementById('btn-export')!.onclick = async () => {
  await navigator.clipboard.writeText(buildJson());
  showToast('JSON copied to clipboard!');
};

function showToast(msg: string) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#27ae60;color:#fff;padding:10px 20px;border-radius:8px;font-weight:bold;z-index:100;transition:opacity 0.3s';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 1500);
}

// ─── Keyboard shortcuts ────────────────────────────────────────
document.onkeydown = (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; updateCursor(); }
    return;
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const num = parseInt(e.key);
  if (num >= 1 && num <= TILE_LIST.length) {
    selectedTile = TILE_LIST[num - 1].id;
    selectedMarker = null;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.marker-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tool-btn')[num - 1]?.classList.add('active');
  }
  if (e.key === 'm') { mirrorChkV.click(); mirrorChkD1.click(); }
  if (e.key === '+' || e.key === '=') { brushSize = Math.min(8, brushSize + 1); brushSlider.value = String(brushSize); brushLabel.textContent = String(brushSize); }
  if (e.key === '-') { brushSize = Math.max(1, brushSize - 1); brushSlider.value = String(brushSize); brushLabel.textContent = String(brushSize); }
};

document.onkeyup = (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    panning = false;
    updateCursor();
  }
};

// ─── Init ──────────────────────────────────────────────────────
buildTileTools();
buildMarkerTools();
initFromJson();
render();
