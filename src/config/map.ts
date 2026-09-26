/**
 * 固定路径地图配置（逻辑坐标 = 渲染坐标，画布尺寸见 GAME_WIDTH/GAME_HEIGHT）。
 * 画布右侧 844-1024 与顶部 0-50 保留给 HUD/弹药架 UI，不与路径/塔位重叠。
 */

export interface Point {
  x: number;
  y: number;
}

export const GAME_WIDTH = 1024;
export const GAME_HEIGHT = 768;
export const HUD_HEIGHT = 50;
export const RACK_PANEL_X = 844;
export const RACK_PANEL_WIDTH = 180;

/** 敌人行走路径的关键点（折线），终点视为"能量核心"入口 */
export const ENEMY_PATH: Point[] = [
  { x: -30, y: 110 },
  { x: 150, y: 110 },
  { x: 150, y: 330 },
  { x: 400, y: 330 },
  { x: 400, y: 150 },
  { x: 650, y: 150 },
  { x: 650, y: 490 },
  { x: 820, y: 490 },
];

/** 可放置炮塔的格子坐标（中心点） */
export const TOWER_SLOTS: Point[] = [
  { x: 260, y: 190 },
  { x: 260, y: 270 },
  { x: 300, y: 410 },
  { x: 480, y: 410 },
  { x: 480, y: 230 },
  { x: 560, y: 100 },
  { x: 720, y: 230 },
  { x: 750, y: 410 },
  { x: 560, y: 570 },
  { x: 750, y: 570 },
];

export const MAP_WIDTH = GAME_WIDTH;
export const MAP_HEIGHT = GAME_HEIGHT;
