import { loadMapFromDef } from './MapLoader';
import { GameMap, MAP_WIDTH, MAP_HEIGHT } from './MapGenerator';
import type { TileType } from '@prompt-battle/shared';
import mapDef from './maps/default.json';

const TILE_SIZE = 10; // pixels per tile in the viewer

const TILE_COLORS: Record<TileType, string> = {
  grass: '#5CC96B',
  forest: '#2E8B4E',
  water: '#45A5FF',
  rock: '#9B9B9B',
  hill: '#DEB245',
  bush: '#65D155',
  path: '#EDD9A7',
  bridge: '#C4A060',
  lava: '#FF5533',
  sand: '#EED9A0',
  swamp: '#5A7A44',
  flowers: '#7BC96B',
  mushroom: '#BB6644',
  ruins: '#8888AA',
  gate_open: '#CCBB88',
  gate_closed: '#777777',
  switch: '#FFDD44',
  capture_point: '#E8C44A',
};

const MARKER_COLORS = {
  spawnP1: '#4499FF',
  spawnP2: '#FF5555',
  flagP1: '#66BBFF',
  flagP2: '#FF8888',
  controlPoint: '#FFD700',
  mine: '#FFB833',
  towerSite: '#AA66CC',
  scoutingPost: '#88DDFF',
  neutralCamp: '#FF6666',
  poi: '#55FF55',
};

let gameMap: GameMap;

function render() {
  gameMap = loadMapFromDef(mapDef as any);
  const w = mapDef.width || MAP_WIDTH;
  const h = mapDef.height || MAP_HEIGHT;

  const canvas = document.getElementById('map') as HTMLCanvasElement;
  canvas.width = w * TILE_SIZE;
  canvas.height = h * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Draw tiles
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tile = gameMap.tiles[y]?.[x] || 'grass';
      ctx.fillStyle = TILE_COLORS[tile] || '#5CC96B';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Grid lines (subtle)
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 0.5;
  for (let y = 0; y <= h; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * TILE_SIZE); ctx.lineTo(w * TILE_SIZE, y * TILE_SIZE); ctx.stroke();
  }
  for (let x = 0; x <= w; x++) {
    ctx.beginPath(); ctx.moveTo(x * TILE_SIZE, 0); ctx.lineTo(x * TILE_SIZE, h * TILE_SIZE); ctx.stroke();
  }

  // Draw markers
  function marker(x: number, y: number, color: string, label: string, size = TILE_SIZE) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, size / 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(8, TILE_SIZE * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
  }

  function labelBelow(x: number, y: number, text: string, color: string) {
    ctx.fillStyle = color;
    ctx.font = `bold 9px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(text, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE + 9);
  }

  // Spawns
  gameMap.spawnP1.forEach((s, i) => marker(s.x, s.y, MARKER_COLORS.spawnP1, `${i + 1}`));
  gameMap.spawnP2.forEach((s, i) => marker(s.x, s.y, MARKER_COLORS.spawnP2, `${i + 1}`));

  // Flags (skip if off-map)
  if (gameMap.flagP1.x >= 0 && gameMap.flagP1.y >= 0)
    marker(gameMap.flagP1.x, gameMap.flagP1.y, MARKER_COLORS.flagP1, 'F', TILE_SIZE * 1.2);
  if (gameMap.flagP2.x >= 0 && gameMap.flagP2.y >= 0)
    marker(gameMap.flagP2.x, gameMap.flagP2.y, MARKER_COLORS.flagP2, 'F', TILE_SIZE * 1.2);

  // Control points with radius circle
  if (gameMap.controlPointDefs) {
    for (const cp of gameMap.controlPointDefs) {
      const cx = cp.position.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = cp.position.y * TILE_SIZE + TILE_SIZE / 2;
      // Draw radius circle
      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, cp.radius * TILE_SIZE, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Center marker
      marker(cp.position.x, cp.position.y, MARKER_COLORS.controlPoint, 'C', TILE_SIZE * 1.3);
      labelBelow(cp.position.x, cp.position.y + 1, cp.name, '#FFD700');
    }
  } else {
    gameMap.controlPointPositions.forEach(p => marker(p.x, p.y, MARKER_COLORS.controlPoint, 'C', TILE_SIZE * 1.3));
  }

  // Mines
  for (const m of gameMap.mineNodes) {
    marker(m.position.x, m.position.y, MARKER_COLORS.mine, 'M');
    labelBelow(m.position.x, m.position.y, m.name, '#FFB833');
  }

  // Tower sites
  for (const t of gameMap.towerSites) {
    marker(t.position.x, t.position.y, MARKER_COLORS.towerSite, 'T');
    labelBelow(t.position.x, t.position.y, t.name, '#AA66CC');
  }

  // Scouting posts
  for (const sp of gameMap.scoutingPosts) {
    marker(sp.position.x, sp.position.y, MARKER_COLORS.scoutingPost, 'S');
    labelBelow(sp.position.x, sp.position.y, sp.name, '#88DDFF');
  }

  // Neutral camps
  for (const c of gameMap.neutralCamps) {
    marker(c.position.x, c.position.y, MARKER_COLORS.neutralCamp, 'X', TILE_SIZE * 1.2);
    labelBelow(c.position.x, c.position.y, c.name, '#FF6666');
  }

  // POIs
  for (const p of gameMap.poiPlacements) {
    const icon = p.type === 'lookout' ? 'L' : p.type === 'healing_well' ? 'H' : '$';
    marker(p.position.x, p.position.y, MARKER_COLORS.poi, icon);
  }

  // Info
  const info = document.getElementById('info')!;
  info.textContent = `${mapDef.name} | ${w}x${h} | seed: ${mapDef.seed} | Hover for tile info`;

  // Legend
  const legend = document.getElementById('legend')!;
  legend.innerHTML = '<b>Tiles</b><br>' +
    Object.entries(TILE_COLORS).map(([name, color]) =>
      `<div class="legend-item"><div class="legend-swatch" style="background:${color}"></div>${name}</div>`
    ).join('') +
    '<br><b>Markers</b><br>' +
    `<div class="legend-item"><div class="legend-swatch" style="background:${MARKER_COLORS.spawnP1};border-radius:50%"></div>P1 Spawn</div>` +
    `<div class="legend-item"><div class="legend-swatch" style="background:${MARKER_COLORS.spawnP2};border-radius:50%"></div>P2 Spawn</div>` +
    `<div class="legend-item"><div class="legend-swatch" style="background:${MARKER_COLORS.controlPoint};border-radius:50%"></div>Control Point (C)</div>` +
    `<div class="legend-item"><div class="legend-swatch" style="background:${MARKER_COLORS.mine};border-radius:50%"></div>Mine (M)</div>` +
    `<div class="legend-item"><div class="legend-swatch" style="background:${MARKER_COLORS.towerSite};border-radius:50%"></div>Tower Site (T)</div>` +
    `<div class="legend-item"><div class="legend-swatch" style="background:${MARKER_COLORS.scoutingPost};border-radius:50%"></div>Scouting Post (S)</div>` +
    `<div class="legend-item"><div class="legend-swatch" style="background:${MARKER_COLORS.neutralCamp};border-radius:50%"></div>Neutral Camp (X)</div>` +
    `<div class="legend-item"><div class="legend-swatch" style="background:${MARKER_COLORS.poi};border-radius:50%"></div>POI (L/H/$)</div>`;

  // Tooltip on hover
  const tooltip = document.getElementById('tooltip')!;
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const tx = Math.floor((e.clientX - rect.left) / TILE_SIZE);
    const ty = Math.floor((e.clientY - rect.top) / TILE_SIZE);
    if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
      const tile = gameMap.tiles[ty][tx];
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top = (e.clientY + 12) + 'px';
      tooltip.textContent = `(${tx}, ${ty}) ${tile}`;
    } else {
      tooltip.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}

render();

// Hot reload support
if (import.meta.hot) {
  import.meta.hot.accept('./maps/default.json', () => {
    render();
  });
}
