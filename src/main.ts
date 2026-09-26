import "./style.css";
import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { GAME_WIDTH, GAME_HEIGHT } from "./config/map";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#0a0a12",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 3,
  },
  scene: [BootScene],
};

new Phaser.Game(config);

// 防止 iOS Safari 的双指缩放/双击缩放与整页面滚动，保证全屏触控体验
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);
