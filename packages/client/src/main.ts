import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { DraftScene } from './scenes/DraftScene';
import { BattleScene } from './scenes/BattleScene';
import { ResultScene } from './scenes/ResultScene';
import { JungleLaneScene } from './scenes/JungleLaneScene';
import { HordeScene } from './scenes/HordeScene';
import { CharactersScene } from './scenes/CharactersScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  parent: 'game-container',
  width: 1920,
  height: 1080,
  backgroundColor: '#1B1040',
  antialias: true,
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, DraftScene, BattleScene, ResultScene, JungleLaneScene, HordeScene, CharactersScene],
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
};

const game = new Phaser.Game(config);

export default game;
