// 新手引导（Tutorial）专项冒烟测试。
// 覆盖用户明确要求的自测点：
//   1. 首次进入（无 localStorage 标记）自动弹出教程；
//   2. 教程遮罩确实"强制聚焦"——在当前高亮目标之外点击不会产生任何效果；
//   3. 按教程指引的顺序依次完成 买素材->开熔炉->选素材->合成->建塔->装填->开始下一波，
//      教程会自动逐步推进，不会卡在任何一步；
//   4. 教程结束后，全部 UI 恢复可交互（用点击图鉴按钮验证）；
//   5. 刷新页面后（localStorage 已标记完成），教程不会再次自动弹出。
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

// --- 3. 按教程指引顺序完成整个流程 ---
// 3.1 点击商店（高亮目标）
await clickLogical(1024 - 380 + 39, 25);
await page.waitForTimeout(200);
state = await tutorialState();
if (state?.stepIndex !== 1) errors.push(`点击商店后教程未推进到第 2 步，实际: ${JSON.stringify(state)}`);

// 3.2 购买火种粉 x2（第 0 行购买按钮）
await clickLogical(766, 200);
await page.waitForTimeout(100);
await clickLogical(766, 200);
await page.waitForTimeout(200);
state = await tutorialState();
if (state?.stepIndex !== 2) errors.push(`购买 2 个素材后教程未推进到第 3 步，实际: ${JSON.stringify(state)}`);

// 3.3 点击熔炉
await clickLogical(1024 - 290 + 39, 25);
await page.waitForTimeout(200);
state = await tutorialState();
if (state?.stepIndex !== 3) errors.push(`点击熔炉后教程未推进到第 4 步，实际: ${JSON.stringify(state)}`);

// 3.4 选择火种粉素材 x2（熔炉面板第一个素材卡片）
await clickLogical(288, 185);
await page.waitForTimeout(100);
await clickLogical(288, 185);
await page.waitForTimeout(200);
state = await tutorialState();
if (state?.stepIndex !== 4) errors.push(`选够素材后教程未推进到第 5 步，实际: ${JSON.stringify(state)}`);

// 3.5 合成临时弹药
await clickLogical(268, 619);
await page.waitForTimeout(300);
state = await tutorialState();
if (state?.stepIndex !== 5) errors.push(`合成弹药后教程未推进到第 6 步，实际: ${JSON.stringify(state)}`);

// 3.6 点击塔位建造炮塔（教程会在进入本步时自动收起熔炉面板）
await clickLogical(200, 190);
await page.waitForTimeout(200);
state = await tutorialState();
if (state?.stepIndex !== 6) errors.push(`点击塔位后教程未推进到第 7 步，实际: ${JSON.stringify(state)}`);

// 3.7 选择「近程速射塔」
await clickLogical(200, 190 - 130 + 28);
await page.waitForTimeout(200);
state = await tutorialState();
if (state?.stepIndex !== 7) errors.push(`建塔后教程未推进到第 8 步，实际: ${JSON.stringify(state)}`);
const towerBuilt = await page.evaluate(() => window.__debugSession?.towers[0] != null);
if (!towerBuilt) errors.push('教程引导建塔步骤完成后，塔实际并未建造成功');

// 3.8 把弹药架第一张卡片拖到刚建造的炮塔上
const cardStart = toReal(934, 114);
const towerTarget = toReal(200, 190);
await page.mouse.move(cardStart.x, cardStart.y);
await page.mouse.down();
await page.mouse.move((cardStart.x + towerTarget.x) / 2, (cardStart.y + towerTarget.y) / 2, { steps: 5 });
await page.mouse.move(towerTarget.x, towerTarget.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
state = await tutorialState();
if (state?.stepIndex !== 8) errors.push(`拖拽装填弹药后教程未推进到第 9 步（最后一步），实际: ${JSON.stringify(state)}`);
const ammoLoaded = await page.evaluate(() => window.__debugSession?.towers[0]?.loadedAmmo != null);
if (!ammoLoaded) errors.push('教程引导拖拽装填步骤完成后，塔上实际并未装填弹药');

// 3.9 点击「开始下一波」，教程应自动完成并隐藏
await clickLogical(1024 - 55, 27);
await page.waitForTimeout(300);
state = await tutorialState();
if (state?.active) errors.push(`点击开始下一波后教程应结束，实际仍处于激活状态: ${JSON.stringify(state)}`);

// --- 4. 教程结束后 UI 应完全恢复可交互：等待波次结束回到备战阶段后，商店购买应正常生效 ---
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
// 合成弹药会消耗掉之前购买的全部火种粉，所以这里只需验证"确实新增了 1 个"，
// 而不是继续沿用之前教程阶段的持有数量假设。
if (emberAfter === null || emberAfter < 1) {
  errors.push(`教程结束后点击商店购买素材应正常生效，实际持有火种粉数量: ${emberAfter}（预期至少 1）`);
}
// 关闭商店，避免残留遮罩影响后续 localStorage 校验
await clickLogical(50, 700);
await page.waitForTimeout(200);

let localStorageFlag = await page.evaluate(() => window.localStorage.getItem('td_alchemy_tutorial_completed_v1'));
if (localStorageFlag !== '1') errors.push(`教程完成后应写入 localStorage 完成标记，实际: ${localStorageFlag}`);

// --- 5. 刷新页面，教程不应再次自动弹出（localStorage 标记已存在）---
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
