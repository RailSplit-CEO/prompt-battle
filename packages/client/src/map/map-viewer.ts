// Map viewer - simplified for Animal Army prototype

import { GameMap, MAP_WIDTH, MAP_HEIGHT, generateMap } from './MapGenerator';
import type { TileType } from '@prompt-battle/shared';

const TILE_SIZE = 10;

const TILE_COLORS: Record<TileType, string> = {
  grass: '#5CC96B',
  forest: '#2E8B4E',
  water: '#45A5FF',
  hill: '#DEB245',
  path: '#EDD9A7',
  bridge: '#C4A060',
  sand: '#EED9A0',
  river: '#3388CC',
  shore: '#D4C090',
  blue_base: '#2266CC',
  red_base: '#CC2222',
};

function render() {
  const gameMap = generateMap(Date.now());
  const w = MAP_WIDTH;
  const h = MAP_HEIGHT;

  const canvas = document.getElementById('map') as HTMLCanvasElement;
  if (!canvas) return;
  canvas.width = w * TILE_SIZE;
  canvas.height = h * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tile = gameMap.tiles[y]?.[x] || 'grass';
      ctx.fillStyle = TILE_COLORS[tile] || '#5CC96B';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 0.5;
  for (let y = 0; y <= h; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * TILE_SIZE); ctx.lineTo(w * TILE_SIZE, y * TILE_SIZE); ctx.stroke();
  }
  for (let x = 0; x <= w; x++) {
    ctx.beginPath(); ctx.moveTo(x * TILE_SIZE, 0); ctx.lineTo(x * TILE_SIZE, h * TILE_SIZE); ctx.stroke();
  }

  // Spawns
  function marker(x: number, y: number, color: string, label: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${TILE_SIZE * 0.7}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
  }

  gameMap.spawnP1.forEach((s, i) => marker(s.x, s.y, '#4499FF', `${i + 1}`));
  gameMap.spawnP2.forEach((s, i) => marker(s.x, s.y, '#FF5555', `${i + 1}`));

  // Zones (camps, structures, bases)
  for (const zone of gameMap.zones) {
    const color = zone.type === 'camp' ? '#FFD700' : zone.type === 'structure' ? '#AA66CC' : '#44FF44';
    marker(zone.center.x, zone.center.y, color, zone.name[0]);
  }
}

render();
