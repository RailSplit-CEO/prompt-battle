import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { DraftScene } from './scenes/DraftScene';
import { BattleScene } from './scenes/BattleScene';
import { ResultScene } from './scenes/ResultScene';
import { HordeScene } from './scenes/HordeScene';
import { CharactersScene } from './scenes/CharactersScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 1920,
  height: 1080,
  backgroundColor: '#0f1a0a',
  antialias: true,
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.RESIZE,
  },
  scene: [BootScene, MenuScene, DraftScene, BattleScene, ResultScene, HordeScene, CharactersScene],
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
};

const game = new Phaser.Game(config);
(window as any).__gameStarted = true;

export default game;
