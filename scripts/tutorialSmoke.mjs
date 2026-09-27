// 新手引导（Tutorial）专项冒烟测试。
// 覆盖用户明确要求的自测点：
//   1. 首次进入（无 localStorage 标记）自动弹出教程；
//   2. 教程遮罩确实"强制聚焦"——在当前高亮目标之外点击不会产生任何效果；
//   3. 按教程指引的顺序依次完成 买素材->开熔炉->选素材->合成->建塔->装填->开始下一波，
//      教程会自动逐步推进，不会卡在任何一步；
//   4. 扩展步骤：wave 1 战斗中触发的两次强制素材掉落（物理系/法系）能正确引导玩家
//      买够素材->合成->建造第 2 座塔(范围溅射)->装填并观察契合加成生效/消失的对比；
//   5. 教程结束后，全部 UI 恢复可交互（用点击商店购买验证）；
//   6. 刷新页面后（localStorage 已标记完成），教程不会再次自动弹出。
//
// 实现说明：不再对熔炉芯片/商店按钮使用硬编码像素坐标——它们的下标会随玩家当前
// 持有的素材种类动态变化（见 GameScene.furnaceChipIndexFor 的注释），硬编码坐标
// 在扩展教程里已经被证明很脆弱。改为通过场景暴露的 window.__tutorialHoleCenters()
// 读取"当前教程步骤高亮的目标区域中心点"，直接点击/拖拽该坐标，这样测试脚本本身
// 与具体 UI 布局、素材下标解耦，只要教程的 getHoleRects() 逻辑是对的，点击就一定准。
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 4176 } });
await server.listen();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
});

await page.goto('http://localhost:4176/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const canvas = page.locator('canvas').first();
const box = await canvas.boundingBox();
function toReal(lx, ly) {
  const scaleX = box.width / 1024;
  const scaleY = box.height / 768;
  return { x: box.x + lx * scaleX, y: box.y + ly * scaleY };
}
async function clickLogical(lx, ly) {
  const p = toReal(lx, ly);
  await page.mouse.click(p.x, p.y);
}
async function tutorialState() {
  return page.evaluate(() => window.__tutorialDebug?.());
}
async function holeCenters() {
  return page.evaluate(() => window.__tutorialHoleCenters?.() ?? []);
}
/** 点击当前教程步骤高亮的第 holeIndex 个目标区域（大多数步骤只有 1 个洞，holeIndex 默认 0）。 */
async function clickHole(holeIndex = 0) {
  const holes = await holeCenters();
  if (!holes[holeIndex]) throw new Error(`当前步骤没有第 ${holeIndex} 个高亮目标区域，实际: ${JSON.stringify(holes)}`);
  await clickLogical(holes[holeIndex].x, holes[holeIndex].y);
}
/** 把第 fromHoleIndex 个高亮目标拖拽到第 toHoleIndex 个高亮目标（用于弹药架卡片->塔位的拖拽步骤）。 */
async function dragHoleToHole(fromHoleIndex, toHoleIndex) {
  const holes = await holeCenters();
  if (!holes[fromHoleIndex] || !holes[toHoleIndex]) {
    throw new Error(`拖拽所需的高亮目标区域不足，实际: ${JSON.stringify(holes)}`);
  }
  const from = toReal(holes[fromHoleIndex].x, holes[fromHoleIndex].y);
  const to = toReal(holes[toHoleIndex].x, holes[toHoleIndex].y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}
async function expectStep(targetIndex, label) {
  const s = await tutorialState();
  if (s?.stepIndex !== targetIndex) errors.push(`${label}，期望教程步骤 ${targetIndex}，实际: ${JSON.stringify(s)}`);
  return s;
}
async function waitForStep(targetIndex, timeoutMs, label) {
  let waitedLocal = 0;
  while (waitedLocal < timeoutMs) {
    const s = await tutorialState();
    if (s?.stepIndex === targetIndex) return s;
    await page.waitForTimeout(500);
    waitedLocal += 500;
  }
  errors.push(`等待 ${label} 超时（${timeoutMs}ms），期望教程步骤 ${targetIndex}，实际: ${JSON.stringify(await tutorialState())}`);
  return tutorialState();
}

// --- 1. 首次进入应自动弹出教程 ---
let state = await tutorialState();
console.log('初始教程状态:', state);
if (!state || !state.active || state.stepIndex !== 0) {
  errors.push(`首次进入未按预期自动弹出教程第 1 步，实际: ${JSON.stringify(state)}`);
}

// --- 2. 遮罩强制聚焦验证：教程第一步要求点「商店」，先尝试点别的地方（塔位），应该毫无效果 ---
await clickLogical(200, 190); // 1号塔位
await page.waitForTimeout(150);
const towerAfterWrongClick = await page.evaluate(() => window.__debugSession?.towers[0] != null);
if (towerAfterWrongClick) {
  errors.push('教程遮罩未能阻止目标区域之外的点击（塔位被意外建造）');
}
state = await tutorialState();
if (!state?.active || state.stepIndex !== 0) {
  errors.push(`误触其它区域不应改变教程步骤，实际: ${JSON.stringify(state)}`);
}

// --- 3. 按教程指引顺序完成"经典 9 步"（买素材->熔炉->建第一座塔->装填->开始下一波）---
// 3.1 点击商店（高亮目标）
await clickHole();
await page.waitForTimeout(200);
await expectStep(1, '点击商店后教程未推进到第 2 步');

// 3.2 购买火种粉 x2
await clickHole();
await page.waitForTimeout(100);
await clickHole();
await page.waitForTimeout(200);
await expectStep(2, '购买 2 个素材后教程未推进到第 3 步');

// 3.3 点击熔炉
await clickHole();
await page.waitForTimeout(200);
await expectStep(3, '点击熔炉后教程未推进到第 4 步');

// 3.4 选择火种粉素材 x2
await clickHole();
await page.waitForTimeout(100);
await clickHole();
await page.waitForTimeout(200);
await expectStep(4, '选够素材后教程未推进到第 5 步');

// 3.5 合成临时弹药
await clickHole();
await page.waitForTimeout(300);
await expectStep(5, '合成弹药后教程未推进到第 6 步');

// 3.6 点击塔位建造炮塔（教程会在进入本步时自动收起熔炉面板）
await clickHole();
await page.waitForTimeout(200);
await expectStep(6, '点击塔位后教程未推进到第 7 步');

// 3.7 选择「近程速射塔」
await clickHole();
await page.waitForTimeout(200);
await expectStep(7, '建塔后教程未推进到第 8 步');
const towerBuilt = await page.evaluate(() => window.__debugSession?.towers[0] != null);
if (!towerBuilt) errors.push('教程引导建塔步骤完成后，塔实际并未建造成功');

// 3.8 把弹药架第一张卡片拖到刚建造的炮塔上（本步有 2 个高亮洞：卡片 + 塔位）
await dragHoleToHole(0, 1);
await page.waitForTimeout(300);
await expectStep(8, '拖拽装填弹药后教程未推进到第 9 步');
const ammoLoaded = await page.evaluate(() => window.__debugSession?.towers[0]?.loadedAmmo != null);
if (!ammoLoaded) errors.push('教程引导拖拽装填步骤完成后，塔上实际并未装填弹药');

// 3.9 点击「开始下一波」，教程进入扩展步骤（wave 1 战斗中教契合系统），不会在此结束
await clickHole();
await page.waitForTimeout(300);
state = await tutorialState();
if (!state?.active || state.stepIndex !== 9) {
  errors.push(`点击开始下一波后教程应推进到扩展步骤第 10 步（观察物理素材掉落），实际: ${JSON.stringify(state)}`);
}

// --- 4. 扩展教程：物理系素材 + 契合加成教学 ---
// 观察类步骤（等待强制掉落）发生在 wave 1 战斗过程中；但商店购买/熔炉合成/建塔
// 三个动作都被游戏规则限定只能在备战阶段进行（GameSession.buyMaterial /
// craftAmmo / placeTower 的 phase==="prep" 校验），所以教程在两次观察步骤之后
// 插入了一个"等待返回备战阶段"的过渡步骤，再继续买/合成/建塔。

// 4.1 等待第一个强制掉落（破甲铁砂，物理系）——纯观察步骤，无需点击
await waitForStep(10, 30000, '第一次强制掉落（破甲铁砂）后教程推进到第 11 步（观察火种粉掉落）');
const ironAfterDrop = await page.evaluate(() => window.__debugSession?.wallet.getMaterialCount('iron_shrapnel') ?? null);
console.log('第一次强制掉落后持有破甲铁砂:', ironAfterDrop);
if (!ironAfterDrop || ironAfterDrop < 1) errors.push(`第一个敌人应强制掉落 1 个破甲铁砂，实际持有: ${ironAfterDrop}`);

// 4.2 等待第二个强制掉落（火种粉，法系）——同样是纯观察步骤
await waitForStep(11, 30000, '第二次强制掉落（火种粉）后教程推进到第 12 步（等待备战阶段）');
const emberAfterDrop = await page.evaluate(() => window.__debugSession?.wallet.getMaterialCount('ember_dust') ?? null);
console.log('第二次强制掉落后持有火种粉:', emberAfterDrop);
if (!emberAfterDrop || emberAfterDrop < 1) errors.push(`第二个敌人应强制掉落 1 个火种粉，实际持有: ${emberAfterDrop}`);

// 4.3 等待 wave 1 战斗结束、返回备战阶段（过渡步骤，无需点击）
await waitForStep(12, 60000, 'wave 1 结束返回备战阶段后教程推进到第 13 步（引导买第 2 个破甲铁砂）');
const phaseAtStep12 = await page.evaluate(() => window.__debugSession?.phase ?? null);
if (phaseAtStep12 !== 'prep') errors.push(`教程第 13 步应已处于备战阶段，实际: ${phaseAtStep12}`);

// 4.4 点击商店
await clickHole();
await page.waitForTimeout(200);
await expectStep(13, '点击商店后教程未推进到第 14 步');

// 4.5 购买第 2 个破甲铁砂
await clickHole();
await page.waitForTimeout(200);
await expectStep(14, '购买第 2 个破甲铁砂后教程未推进到第 15 步');
const ironTotalAfterBuy = await page.evaluate(() => window.__debugSession?.wallet.getMaterialCount('iron_shrapnel') ?? null);
if (ironTotalAfterBuy !== 2) errors.push(`购买后破甲铁砂应凑够 2 个，实际: ${ironTotalAfterBuy}`);

// 4.6 点击熔炉
await clickHole();
await page.waitForTimeout(200);
await expectStep(15, '点击熔炉后教程未推进到第 16 步');

// 4.7 选择破甲铁砂 x2（此时同时持有火种粉(1，来自掉落)和破甲铁砂(2)，
// 用 __tutorialHoleCenters 拿到的坐标已经是当前渲染的真实位置，天然规避了
// "芯片下标随持有物动态变化"的问题）
await clickHole();
await page.waitForTimeout(100);
await clickHole();
await page.waitForTimeout(200);
await expectStep(16, '选够破甲铁砂后教程未推进到第 17 步');

// 4.8 合成临时弹药（破甲弹）
await clickHole();
await page.waitForTimeout(300);
await expectStep(17, '合成破甲弹后教程未推进到第 18 步');
const physicalInRack = await page.evaluate(() =>
  window.__debugSession?.rack.getItems().some((it) => it?.craftResult.recipeKey === 'physical'),
);
if (!physicalInRack) errors.push('合成完成后弹药架里应有一个 recipeKey 为 physical 的弹药');

// 4.9 点击 2 号塔位（教程会在进入本步时自动收起熔炉面板），建造范围溅射塔
await clickHole();
await page.waitForTimeout(200);
await expectStep(18, '点击 2 号塔位后教程未推进到第 19 步');

// 4.10 选择「范围溅射塔」
await clickHole();
await page.waitForTimeout(200);
await expectStep(19, '建造溅射塔后教程未推进到第 20 步');
const tower1Built = await page.evaluate(() => window.__debugSession?.towers[1] != null);
if (!tower1Built) errors.push('教程引导建造第 2 座塔完成后，塔实际并未建造成功');

// 4.11 把破甲弹拖到 2 号塔位——契合成功，塔身应持续发出金色光环
await dragHoleToHole(0, 1);
await page.waitForTimeout(300);
await expectStep(20, '装填破甲弹后教程未推进到第 21 步');
const affinityLoaded = await page.evaluate(
  () => window.__debugSession?.towers[1]?.loadedAmmo?.craftResult.recipeKey === 'physical',
);
if (!affinityLoaded) errors.push('装填破甲弹后 2 号塔的 loadedAmmo.recipeKey 应为 physical');

// 4.12 点击商店，买第 2 个火种粉（用于对比契合消失的效果）
await clickHole();
await page.waitForTimeout(200);
await expectStep(21, '点击商店后教程未推进到第 22 步');
await clickHole();
await page.waitForTimeout(200);
await expectStep(22, '购买第 2 个火种粉后教程未推进到第 23 步');

// 4.13 点击熔炉，合成火系弹药
await clickHole();
await page.waitForTimeout(200);
await expectStep(23, '点击熔炉后教程未推进到第 24 步');
await clickHole();
await page.waitForTimeout(100);
await clickHole();
await page.waitForTimeout(200);
await expectStep(24, '选够火种粉后教程未推进到第 25 步');
await clickHole();
await page.waitForTimeout(300);
await expectStep(25, '合成火种弹后教程未推进到第 26 步（最后一步）');
const fireInRack = await page.evaluate(() =>
  window.__debugSession?.rack.getItems().some((it) => it?.craftResult.recipeKey === 'fire'),
);
if (!fireInRack) errors.push('合成完成后弹药架里应有一个 recipeKey 为 fire 的弹药');

// 4.14 把火种弹拖到同一座溅射塔上，替换掉破甲弹——契合应消失（不再发光），教程随之结束
await dragHoleToHole(0, 1);
await page.waitForTimeout(300);
state = await tutorialState();
if (state?.active) errors.push(`装填火种弹（法系→物理塔，契合应消失）后教程应结束，实际仍处于激活状态: ${JSON.stringify(state)}`);
const mismatchLoaded = await page.evaluate(
  () => window.__debugSession?.towers[1]?.loadedAmmo?.craftResult.recipeKey === 'fire',
);
if (!mismatchLoaded) errors.push('装填火种弹后 2 号塔的 loadedAmmo.recipeKey 应为 fire');

// --- 5. 教程结束后 UI 应完全恢复可交互：等待波次结束回到备战阶段后，商店购买应正常生效 ---
// （购买/建塔在战斗阶段本身就会被游戏规则拒绝，这与教程无关；因此这里等真正回到
//  备战阶段再验证，才能确认是"教程遮罩已解除"而不是被正常的阶段限制挡住。）
let waited = 0;
while (waited < 60000) {
  const phase = await page.evaluate(() => window.__debugSession?.phase ?? null);
  if (phase === 'prep') break;
  await page.waitForTimeout(1000);
  waited += 1000;
}
const phaseNow = await page.evaluate(() => window.__debugSession?.phase ?? null);
console.log(`等待 ${waited}ms 后阶段: ${phaseNow}`);

await clickLogical(1024 - 380 + 39, 25); // 商店
await page.waitForTimeout(200);
await clickLogical(766, 200); // 再买一个火种粉
await page.waitForTimeout(200);
const emberAfter = await page.evaluate(() => window.__debugSession?.wallet.getMaterialCount('ember_dust') ?? null);
if (emberAfter === null || emberAfter < 1) {
  errors.push(`教程结束后点击商店购买素材应正常生效，实际持有火种粉数量: ${emberAfter}（预期至少 1）`);
}
// 关闭商店，避免残留遮罩影响后续 localStorage 校验
await clickLogical(50, 700);
await page.waitForTimeout(200);

let localStorageFlag = await page.evaluate(() => window.localStorage.getItem('td_alchemy_tutorial_completed_v1'));
if (localStorageFlag !== '1') errors.push(`教程完成后应写入 localStorage 完成标记，实际: ${localStorageFlag}`);

// --- 6. 刷新页面，教程不应再次自动弹出（localStorage 标记已存在）---
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
state = await tutorialState();
console.log('刷新后教程状态（应为 inactive）:', state);
if (state?.active) errors.push(`刷新后教程不应再次自动弹出，实际: ${JSON.stringify(state)}`);
localStorageFlag = await page.evaluate(() => window.localStorage.getItem('td_alchemy_tutorial_completed_v1'));
if (localStorageFlag !== '1') errors.push('刷新后 localStorage 完成标记丢失');

console.log('errors found:', errors.length);
errors.forEach((e) => console.log(' -', e));

await browser.close();
await server.close();
if (errors.length > 0) process.exitCode = 1;
