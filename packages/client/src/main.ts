import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
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
  scene: [BootScene, MenuScene, HordeScene, CharactersScene],
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
};

const game = new Phaser.Game(config);
(window as any).__gameStarted = true;

// Prevent Phaser from pausing the game loop when the tab is hidden
game.loop.sleep = () => {};

// Prevent Phaser from suspending AudioContext when tab loses focus
game.sound.pauseOnBlur = false;

// Web Worker keepalive to bypass browser rAF throttling in background tabs
const blob = new Blob(
  [`setInterval(function(){postMessage(0)},${Math.round(1000 / 60)})`],
  { type: 'text/javascript' }
);
const bgTimer = new Worker(URL.createObjectURL(blob));
bgTimer.onmessage = () => {
  if (document.hidden) game.loop.step(performance.now());
};

export default game;
