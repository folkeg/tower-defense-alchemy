/**
 * Headless 平衡性模拟脚本（不依赖 Phaser/浏览器）。
 *
 * 目的：用一个"合理但不追求最优"的简单 AI 自动跑完整局游戏 N 次，
 * 检查关卡数值是否可通关、难度曲线是否过于宽松/严苛，
 * 并把结果打印为汇总报告，方便后续调参参考。
 *
 * 用法：npx tsx scripts/headlessSim.ts [次数]
 */
import { GameSession } from "../src/core/gameSession";
import { LEVEL_1 } from "../src/config/waves";
import { SHOP_MATERIALS, getMaterialById } from "../src/config/materials";
import { TOWERS, type TowerKind } from "../src/config/towers";
import { TOWER_SLOTS } from "../src/config/map";

/** 基于种子的确定性伪随机数生成器，保证模拟结果可复现 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RunResult {
  won: boolean;
  finalHealth: number;
  wavesCleared: number;
  totalKills: number;
  craftCount: number;
  greatSuccessCount: number;
  greatFailureCount: number;
  finalGold: number;
  ticks: number;
}

const TOWER_KINDS: TowerKind[] = ["melee", "splash"];

/**
 * 一个"合理但朴素"的自动策略：
 * - 备战阶段：如果有空格且买得起就造塔（melee/splash 交替），
 *   用余下金币买 2 种不同素材各 2 份，凑够就合成临时弹药，
 *   把弹药架里所有弹药装到未装填的塔上，然后立即开始下一波（不刻意等待建议倒计时，
 *   因为倒计时只是 UI 提示，不是强制机制）。
 * - 战斗阶段：什么都不做（塔已经自动开火）。
 */
function runAutoPrep(session: GameSession, rng: () => number): void {
  let builtCount = session.towers.filter((t) => t !== null).length;
  let towerCursor = 0;
  // 1) 尽量把空格都建满（预算允许的情况下）
  for (let i = 0; i < session.towers.length; i++) {
    if (session.towers[i]) continue;
    const kind = TOWER_KINDS[towerCursor % TOWER_KINDS.length];
    towerCursor += 1;
    const def = TOWERS[kind];
    if (session.wallet.getGold() >= def.cost + 20) {
      try {
        session.placeTower(kind, i);
        builtCount += 1;
      } catch {
        // 忽略（格子被占用等）
      }
    }
  }
  void builtCount;

  // 2) 用剩余金币买素材（保留至少 10 金币缓冲）
  const affordable = SHOP_MATERIALS.filter((m) => m.shopPrice !== null);
  let guard = 0;
  while (guard < 8 && affordable.length > 0) {
    guard += 1;
    const pick = affordable[Math.floor(rng() * affordable.length)];
    if (session.wallet.getGold() < (pick.shopPrice ?? Infinity) + 10) break;
    try {
      session.buyMaterial(pick.id);
    } catch {
      break;
    }
  }

  // 3) 尝试合成：找到持有数量 >= 2 的素材两两组合，合成临时弹药
  let craftGuard = 0;
  while (craftGuard < 4) {
    craftGuard += 1;
    const owned = affordable
      .map((m) => m.id)
      .filter((id) => session.wallet.getMaterialCount(id) >= 1);
    if (owned.length === 0) break;
    // 优先凑同一种素材 x2（保证配方可预测、走"固定配方"逻辑）
    const pair = owned.find((id) => session.wallet.getMaterialCount(id) >= 2);
    let materialIds: string[];
    if (pair) {
      materialIds = [pair, pair];
    } else if (owned.length >= 2) {
      materialIds = [owned[0], owned[1]];
    } else {
      break;
    }
    if (session.rack.getItems().every((slot) => slot !== null)) break; // 弹药架已满
    try {
      session.craftAmmo(materialIds, "temporary");
    } catch {
      break;
    }
  }

  reloadEmptyTowers(session);
}

/**
 * 把弹药架里的弹药尽量装到还没装填的塔上。
 * 拖拽装填在战斗阶段也允许（规格明确说明玩家可在战斗阶段操作弹药架→炮塔），
 * 所以该步骤在备战和战斗阶段都可以调用，用于模拟"随时补弹"的合格玩家行为。
 */
function reloadEmptyTowers(session: GameSession): void {
  session.towers.forEach((tower, slotIndex) => {
    if (!tower || tower.loadedAmmo) return;
    const items = session.rack.getItems();
    const rackIndex = items.findIndex((i) => i !== null);
    if (rackIndex === -1) return;
    try {
      session.loadAmmoFromRack(slotIndex, rackIndex);
    } catch {
      // 忽略
    }
  });
}

function runOnce(seed: number): RunResult {
  const rng = mulberry32(seed);
  const session = new GameSession(LEVEL_1, rng);
  let ticks = 0;
  const maxTicks = 200000; // 安全上限，避免死循环（200000*0.05s ≈ 2.7 小时游戏内时间）

  while (session.phase !== "level_complete" && session.phase !== "game_over" && ticks < maxTicks) {
    if (session.phase === "prep") {
      runAutoPrep(session, rng);
      try {
        session.startNextWave();
      } catch {
        // 没有更多波次时会抛错，循环条件会在下一次检查时退出
        break;
      }
    }
    if (session.phase === "battle") {
      // 模拟一个更积极的玩家：战斗中随时把弹药架里剩余的弹药补装到刚打空的塔上
      reloadEmptyTowers(session);
    }
    session.update(0.05);
    ticks += 1;
  }

  return {
    won: session.phase === "level_complete",
    finalHealth: session.health,
    wavesCleared: session.stats.wavesCleared,
    totalKills: session.stats.totalKills,
    craftCount: session.stats.craftCount,
    greatSuccessCount: session.stats.greatSuccessCount,
    greatFailureCount: session.stats.greatFailureCount,
    finalGold: session.wallet.getGold(),
    ticks,
  };
}

function main(): void {
  const runs = Number(process.argv[2] ?? 30);
  const results: RunResult[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(runOnce(1000 + i));
  }

  const wins = results.filter((r) => r.won).length;
  const avg = (fn: (r: RunResult) => number) => results.reduce((s, r) => s + fn(r), 0) / results.length;

  console.log(`\n===== Headless 平衡性模拟报告（关卡：${LEVEL_1.name}，样本数：${runs}） =====`);
  console.log(`胜率: ${wins}/${runs} (${((wins / runs) * 100).toFixed(1)}%)`);
  console.log(`平均剩余生命: ${avg((r) => r.finalHealth).toFixed(1)} / ${LEVEL_1.startingHealth}`);
  console.log(`平均完成波次: ${avg((r) => r.wavesCleared).toFixed(2)} / ${LEVEL_1.waves.length}`);
  console.log(`平均击杀数: ${avg((r) => r.totalKills).toFixed(1)}`);
  console.log(`平均合成次数: ${avg((r) => r.craftCount).toFixed(1)}`);
  console.log(
    `平均大成功/大失败次数: ${avg((r) => r.greatSuccessCount).toFixed(2)} / ${avg((r) => r.greatFailureCount).toFixed(2)}`,
  );
  console.log(`平均剩余金币: ${avg((r) => r.finalGold).toFixed(1)}`);
  const stuck = results.filter((r) => r.ticks >= 199999);
  if (stuck.length > 0) {
    console.log(`⚠️ 有 ${stuck.length} 局达到了模拟 tick 上限，可能存在死循环或卡关，需要人工检查。`);
  }

  console.log("\n--- 简单结论 ---");
  if (wins / runs > 0.9) {
    console.log(
      "胜率偏高：即便使用较朴素的自动策略也几乎总能通关，说明当前第一关难度对新手友好，" +
        "但长期可能缺乏挑战性，后续可以考虑提高后几波的数值或增加更强的精英/BOSS 波次。",
    );
  } else if (wins / runs < 0.3) {
    console.log(
      "胜率偏低：朴素策略难以通关，需要检查是否起始金币/塔伤害不足，或波次强度曲线过陡。",
    );
  } else {
    console.log("胜率处于中等区间，说明关卡难度曲线基本合理，普通策略也有一定失败率，符合塔防预期体验。");
  }

  const anyRareCraft = results.some((r) => r.craftCount > 0);
  if (!anyRareCraft) {
    console.log("⚠️ 没有任何一局完成过合成，说明自动策略或经济系统可能有阻塞合成循环的问题，需要重点检查。");
  }
  console.log("");
}

main();

// 供潜在的单元测试或其它脚本复用
export { runOnce, mulberry32 };
export type { RunResult };
