import Phaser from "phaser";
import { GameScene } from "./GameScene";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    this.scene.add("GameScene", GameScene, true);
  }
}
