// 完整流程冒烟测试：建塔 -> 购买素材 -> 熔炉合成 -> 拖拽装填 -> 开始波次
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 4175 } });
await server.listen();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
// 本脚本测试的是"老玩家"路径（建塔/购买/合成/拖拽/开战的核心循环回归)，
// 与新手引导教程（见 scripts/tutorialSmoke.mjs）分开验证，
// 因此提前标记教程已完成，避免全屏遮罩挡住这里手写的固定坐标点击序列。
await page.addInitScript(() => {
  window.localStorage.setItem('td_alchemy_tutorial_completed_v1', '1');
});
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
});

await page.goto('http://localhost:4175/', { waitUntil: 'networkidle' });
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

// 1. 建造一座近程速射塔（1号格，逻辑坐标 (200,190)）
await clickLogical(200, 190);
await page.waitForTimeout(200);
await clickLogical(200, 190 - 130 + 28); // 菜单第一个选项（近程速射塔）
await page.waitForTimeout(200);

// 2. 打开商店购买 2 个火种粉（面板 (202,144)，第 0 行购买按钮中心 (766,200)）
await clickLogical(684, 25);
await page.waitForTimeout(200);
await clickLogical(766, 200);
await clickLogical(766, 200);
await page.waitForTimeout(200);
// 关闭商店
await clickLogical(50, 700);
await page.waitForTimeout(200);

// 3. 打开熔炉，选择 2 个火种粉素材（面板 ((1024-680)/2, (768-560)/2)=(172,104)，第一个素材卡片中心约 (288,185)）
await clickLogical(1024 - 290 + 40, 25);
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/smoke/furnace-open-check.png' });
await clickLogical(288, 185);
await clickLogical(288, 185);
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/smoke/furnace-selected.png' });

// 4. 合成临时弹药（按钮中心约 (268,619)）
await clickLogical(268, 619);
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/smoke/after-craft.png' });
// 关闭熔炉
await clickLogical(50, 700);
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/smoke/rack-with-ammo.png' });

// 5. 把弹药架第一张卡片拖拽到刚建造的炮塔上
const cardStart = toReal(934, 114);
const towerTarget = toReal(200, 190);
await page.mouse.move(cardStart.x, cardStart.y);
await page.mouse.down();
await page.mouse.move((cardStart.x + towerTarget.x) / 2, (cardStart.y + towerTarget.y) / 2, { steps: 5 });
await page.mouse.move(towerTarget.x, towerTarget.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/smoke/tower-loaded.png' });

// 6. 开始下一波，用户报告的复现场景：观察 45 秒内金币是否真的增加、敌人是否真的被击杀
await clickLogical(1024 - 55, 27);
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/smoke/battle.png' });

const goldBefore = await page.evaluate(() => window.__debugSession?.wallet.getGold() ?? null);
const killsBefore = await page.evaluate(() => window.__debugSession?.stats.totalKills ?? null);
await page.waitForTimeout(20000);
await page.screenshot({ path: '/tmp/smoke/battle-20s.png' });
const goldAfter = await page.evaluate(() => window.__debugSession?.wallet.getGold() ?? null);
const killsAfter = await page.evaluate(() => window.__debugSession?.stats.totalKills ?? null);
console.log('gold before/after 20s battle:', goldBefore, '->', goldAfter);
console.log('kills before/after 20s battle:', killsBefore, '->', killsAfter);
if (goldBefore !== null && (goldAfter <= goldBefore || killsAfter <= killsBefore)) {
  errors.push(`回归失败：金币或击杀数在战斗中未增长 (gold ${goldBefore}->${goldAfter}, kills ${killsBefore}->${killsAfter})`);
}

console.log('errors found:', errors.length);
errors.forEach((e) => console.log(' -', e));

await browser.close();
await server.close();
if (errors.length > 0) process.exitCode = 1;
