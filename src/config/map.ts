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

/**
 * 可放置炮塔的格子坐标（中心点）。
 *
 * 注：每个格子到 ENEMY_PATH 的最近距离应控制在塔基础射程（melee 135 / splash 140）之内，
 * 且应落在某条折线段的"内部"而非贴着拐角——贴拐角只能切到敌人一瞬间，塔会看起来在正常
 * 开火/耗弹却几乎打不死人。2026-09 复盘：原 0/3/8 号格子分别精确卡在射程边界、超出射程、
 * 贴着拐角，实测单塔一整波（6只普通兵）打不到 1 个击杀；已重新定位到对应路径直线段中部
 * （距离约 50-90px），并新增 tests/gameSession.test.ts 里的"每个格子逐一验证"回归测试防止再犯。
 */
export const TOWER_SLOTS: Point[] = [
  { x: 200, y: 190 },
  { x: 260, y: 270 },
  { x: 300, y: 410 },
  { x: 560, y: 320 },
  { x: 480, y: 230 },
  { x: 560, y: 100 },
  { x: 720, y: 230 },
  { x: 750, y: 410 },
  { x: 680, y: 570 },
  { x: 750, y: 570 },
];

export const MAP_WIDTH = GAME_WIDTH;
export const MAP_HEIGHT = GAME_HEIGHT;
