import type { EnemyKind } from "./enemies";

export interface SpawnEntry {
  kind: EnemyKind;
  count: number;
  /** 同类型敌人之间的生成间隔（秒） */
  interval: number;
}

export interface WaveDef {
  index: number;
  spawns: SpawnEntry[];
  /** 备战阶段建议倒计时（秒），可跳过 */
  prepSuggestedSeconds: number;
}

export interface LevelDef {
  id: string;
  name: string;
  startingGold: number;
  startingHealth: number;
  waves: WaveDef[];
}

export const LEVEL_1: LevelDef = {
  id: "level-1",
  name: "第一关：熔岩前哨",
  startingGold: 150,
  startingHealth: 20,
  waves: [
    {
      index: 1,
      spawns: [{ kind: "grunt", count: 6, interval: 1.1 }],
      prepSuggestedSeconds: 30,
    },
    {
      index: 2,
      spawns: [
        { kind: "grunt", count: 5, interval: 1.0 },
        { kind: "runner", count: 3, interval: 0.7 },
      ],
      prepSuggestedSeconds: 30,
    },
    {
      index: 3,
      spawns: [
        { kind: "runner", count: 5, interval: 0.6 },
        { kind: "grunt", count: 4, interval: 0.9 },
      ],
      prepSuggestedSeconds: 30,
    },
    {
      index: 4,
      spawns: [
        { kind: "grunt", count: 4, interval: 0.9 },
        { kind: "tank", count: 2, interval: 1.8 },
        { kind: "runner", count: 4, interval: 0.6 },
      ],
      prepSuggestedSeconds: 30,
    },
    {
      index: 5,
      spawns: [
        { kind: "tank", count: 3, interval: 1.6 },
        { kind: "runner", count: 6, interval: 0.5 },
        { kind: "grunt", count: 6, interval: 0.7 },
      ],
      prepSuggestedSeconds: 30,
    },
  ],
};

export const LEVELS: LevelDef[] = [LEVEL_1];
