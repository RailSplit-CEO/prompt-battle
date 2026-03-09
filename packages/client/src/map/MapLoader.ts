// MapLoader: Legacy file - not used in Animal Army prototype
// The new game uses generateMap() directly from MapGenerator.ts

import { TileType, Position } from '@prompt-battle/shared';
import { GameMap, MAP_WIDTH, MAP_HEIGHT, generateMap } from './MapGenerator';

interface MapDef {
  name: string;
  width: number;
  height: number;
  seed?: number;
  [key: string]: any;
}

export function loadMapFromDef(def: MapDef): GameMap {
  // Just use procedural generation
  return generateMap(def.seed || 0);
}
