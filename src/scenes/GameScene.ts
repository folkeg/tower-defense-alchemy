import Phaser from "phaser";
import { GameSession } from "../core/gameSession";
import type { EnemyInstance } from "../core/combat";
import { AmmoInstance } from "../core/ammo";
import { SHOP_MATERIALS, getMaterialById, type MaterialDef } from "../config/materials";
import { RecipeJournal, MIN_MATERIALS_PER_CRAFT, MAX_MATERIALS_PER_CRAFT } from "../core/craftingEngine";
import { TOWERS, type TowerKind } from "../config/towers";
import { ENEMY_PATH, TOWER_SLOTS, GAME_WIDTH, GAME_HEIGHT, HUD_HEIGHT, RACK_PANEL_X, RACK_PANEL_WIDTH } from "../config/map";
import { LEVEL_1 } from "../config/waves";
import { AMMO_RACK_CAPACITY, getAmmoUrgency, TEMP_AMMO_DURATION_SECONDS, TEMP_AMMO_MAX_SHOTS } from "../core/ammo";

const PANEL_BG = 0x14141f;
const PANEL_BORDER = 0x3a3a55;
const ACCENT = 0x5ad1ff;
const TEXT_COLOR = "#f0f0f5";
const MUTED_COLOR = "#9a9ab0";

function fmtGold(n: number): string {
  return `${Math.round(n)}`;
}

/**
 * 顶层按钮句柄：不再使用嵌套 Container 承载可交互对象。
 * 原因见下方 `createButton` 内的详细说明——Phaser 的相机 renderList
 * 不会单独记录 Container 子节点，导致嵌套的可交互子对象在与场景顶层对象
 * （如全屏 modalCatcher）重叠时，永远在命中测试的深度排序中失败。
 */
interface ButtonHandle {
  bg: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
  setVisible(v: boolean): void;
  setAlpha(a: number): void;
  destroy(): void;
}

/**
 * 新手引导的单个步骤。
 * - `getHoleRects` 每帧被调用，返回"当前唯一可交互"的区域（场景绝对坐标），
 *   引导遮罩会在这些区域内"打洞"放行点击，洞外的点击一律被吞掉。
 *   之所以每帧重新计算而不是缓存一次性坐标，是因为面板内的按钮/热区大多是
 *   "刷新时销毁重建"的顶层对象（见 createButton 说明），引用可能失效。
 * - `isComplete` 每帧被调用，一旦返回 true 就自动进入下一步。
 * - `onEnter`/`onLeave` 是可选的进入/离开该步骤时执行一次的副作用（例如自动关闭面板）。
 */
interface TutorialStep {
  caption: string;
  getHoleRects: () => Phaser.Geom.Rectangle[];
  isComplete: () => boolean;
  onEnter?: () => void;
}

/**
 * 唯一的游戏场景：包含地图渲染、塔防战斗、备战/合成 UI。
 * 所有数值/规则计算都委托给 core/gameSession.ts，本类只负责渲染与输入转发。
 */
export class GameScene extends Phaser.Scene {
  private session!: GameSession;

  private pathGraphics!: Phaser.GameObjects.Graphics;
  private towerNodes = new Map<number, Phaser.GameObjects.Container>();
  private enemyNodes = new Map<number, Phaser.GameObjects.Container>();
  private popupTexts: Phaser.GameObjects.Text[] = [];

  private hudGoldText!: Phaser.GameObjects.Text;
  private hudHealthText!: Phaser.GameObjects.Text;
  private hudWaveText!: Phaser.GameObjects.Text;
  private hudPhaseText!: Phaser.GameObjects.Text;
  private hudCountdownText!: Phaser.GameObjects.Text;
  private hudAmmoWarningText!: Phaser.GameObjects.Text;
  private nextWaveButton!: ButtonHandle;

  private rackContainer!: Phaser.GameObjects.Container;
  private rackCardNodes: Phaser.GameObjects.Container[] = [];

  private shopPanel!: Phaser.GameObjects.Container;
  private furnacePanel!: Phaser.GameObjects.Container;
  private journalPanel!: Phaser.GameObjects.Container;
  private resultPanel!: Phaser.GameObjects.Container;
  private buildMenu!: Phaser.GameObjects.Container;

  private modalCatcher!: Phaser.GameObjects.Rectangle;
  private selectedMaterials: string[] = [];
  private pendingBuildSlot: number | null = null;
  private resultShown = false;
  private buildMenuButtons: ButtonHandle[] = [];
  private resultButtons: ButtonHandle[] = [];
  // 备战阶段"建议倒计时"UI状态：纯提示性，不会强制切换到下一波
  private lastPhase: "prep" | "battle" | "level_complete" | "game_over" = "prep";
  private prepPhaseStartedAtMs = 0;
  private static readonly SUGGESTED_PREP_SECONDS = 30;

  // 塔位点击热区，供新手引导定位高亮使用（渲染逻辑见 createTowerSlots）
  private towerSlotHitZones: Phaser.GameObjects.Arc[] = [];
  // 顶部功能按钮句柄，供新手引导定位高亮使用
  private shopTopButton!: ButtonHandle;
  private furnaceTopButton!: ButtonHandle;
  // 弹药架卡片的实际可交互矩形（嵌套在 rackContainer/card 内），按弹药架槽位索引对应，
  // 引导系统需要它计算"拖拽起点"高亮框；游戏逻辑本身不依赖这个数组。
  private rackCardBgZones: (Phaser.GameObjects.Rectangle | null)[] = [];

  // ---------------------------------------------------------------------
  // 新手引导（Tutorial）
  // ---------------------------------------------------------------------
  private static readonly TUTORIAL_STORAGE_KEY = "td_alchemy_tutorial_completed_v1";
  private tutorialSteps: TutorialStep[] = [];
  private tutorialActive = false;
  private tutorialStepIndex = 0;
  private tutorialHoleRects: Phaser.Geom.Rectangle[] = [];
  private tutorialOverlay!: Phaser.GameObjects.Rectangle;
  private tutorialHighlightGfx!: Phaser.GameObjects.Graphics;
  private tutorialCaptionBg!: Phaser.GameObjects.Rectangle;
  private tutorialCaptionText!: Phaser.GameObjects.Text;
  private tutorialSkipButton!: ButtonHandle;
  private tutorialStepLabel!: Phaser.GameObjects.Text;
  private journalReplayTutorialButton!: ButtonHandle;

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.session = new GameSession(LEVEL_1);
    this.resultShown = false;
    this.lastPhase = "prep";
    this.prepPhaseStartedAtMs = this.time.now;
    this.cameras.main.setBackgroundColor("#0a0a12");

    // 仅用于 Playwright 冒烟测试/手动调试读取战斗数据（金币、击杀数等），不影响正常游玩逻辑。
    (window as unknown as { __debugSession?: GameSession }).__debugSession = this.session;
    // 同上，仅供自动化测试探测新手引导当前是否处于激活状态 / 处于第几步，不影响正常游玩逻辑。
    (window as unknown as { __tutorialDebug?: () => { active: boolean; stepIndex: number; totalSteps: number } }).__tutorialDebug = () => ({
      active: this.tutorialActive,
      stepIndex: this.tutorialStepIndex,
      totalSteps: this.tutorialSteps.length,
    });

    this.drawMap();
    this.createTowerSlots();
    this.createHud();
    this.createRackPanel();
    this.createModalCatcher();
    this.createShopPanel();
    this.createFurnacePanel();
    this.createJournalPanel();
    this.createBuildMenu();
    this.createResultPanel();

    this.refreshAll();
    this.maybeStartTutorial();
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    this.session.update(dt);
    if (this.session.phase === "prep" && this.lastPhase !== "prep") {
      // 每次重新进入备战阶段都重置"建议倒计时"的起点（仅用于展示，不会强制切换波次）
      this.prepPhaseStartedAtMs = this.time.now;
    }
    this.lastPhase = this.session.phase;
    this.syncEnemies();
    this.syncTowers();
    this.refreshHud();
    this.showDamagePopups();
    this.showAmmoDepletionEffects();

    if ((this.session.phase === "game_over" || this.session.phase === "level_complete") && !this.resultShown) {
      this.resultShown = true;
      this.openResultPanel();
    }

    this.updateTutorial();
  }

  private refreshAll(): void {
    this.syncEnemies();
    this.syncTowers();
    this.refreshHud();
    this.refreshRack();
  }

  // -------------------------------------------------------------------------
  // 地图 / 路径 / 塔位
  // -------------------------------------------------------------------------

  private drawMap(): void {
    this.pathGraphics = this.add.graphics();
    this.pathGraphics.lineStyle(28, 0x2a2a3d, 1);
    this.pathGraphics.beginPath();
    this.pathGraphics.moveTo(ENEMY_PATH[0].x, ENEMY_PATH[0].y);
    for (let i = 1; i < ENEMY_PATH.length; i++) {
      this.pathGraphics.lineTo(ENEMY_PATH[i].x, ENEMY_PATH[i].y);
    }
    this.pathGraphics.strokePath();

    const end = ENEMY_PATH[ENEMY_PATH.length - 1];
    this.add.circle(end.x, end.y, 22, 0xff4d6a, 0.8).setStrokeStyle(3, 0xffffff, 0.6);
    this.add
      .text(end.x, end.y - 40, "能量核心", { fontSize: "14px", color: TEXT_COLOR })
      .setOrigin(0.5);
  }

  private createTowerSlots(): void {
    TOWER_SLOTS.forEach((pos, slotIndex) => {
      const container = this.add.container(pos.x, pos.y);
      const base = this.add.circle(0, 0, 26, 0x22222f, 1).setStrokeStyle(2, PANEL_BORDER, 1);
      container.add(base);
      // 用一个独立的、原生支持圆形命中检测的 Circle 对象叠在容器上方作为点击热区，
      // 避免 Container.setInteractive(customHitArea) 在部分 Phaser 版本下命中测试不稳定的问题。
      const hitZone = this.add.circle(pos.x, pos.y, 26, 0xffffff, 0.001);
      hitZone.setInteractive({ useHandCursor: true });
      hitZone.on("pointerdown", () => this.onTowerSlotTapped(slotIndex));
      this.towerNodes.set(slotIndex, container);
      this.towerSlotHitZones[slotIndex] = hitZone;
    });
  }

  private onTowerSlotTapped(slotIndex: number): void {
    const tower = this.session.towers[slotIndex];
    if (!tower) {
      if (this.session.phase !== "prep") return;
      this.openBuildMenu(slotIndex);
      return;
    }
    if (tower.loadedAmmo) {
      this.session.unloadAmmoToRack(slotIndex);
      this.refreshRack();
    }
  }

  private syncTowers(): void {
    this.session.towers.forEach((tower, slotIndex) => {
      const container = this.towerNodes.get(slotIndex);
      if (!container) return;
      // 清除除底座外的旧内容（索引 0 是底座圆）
      while (container.length > 1) container.getAt(1)?.destroy();

      if (!tower) return;
      const def = tower.def;
      const bodyColor = tower.loadedAmmo ? tower.loadedAmmo.craftResult.color : def.color;
      const body = this.add.rectangle(0, 0, 30, 30, bodyColor, 1).setStrokeStyle(2, 0xffffff, 0.5);
      container.add(body);

      const label = this.add
        .text(0, -34, def.name.slice(0, 4), { fontSize: "10px", color: MUTED_COLOR })
        .setOrigin(0.5);
      container.add(label);

      if (tower.loadedAmmo) {
        const ammo = tower.loadedAmmo;
        if (!ammo.isPermanent) {
          const pct = Math.max(
            0,
            Math.min(1, Math.min(ammo.remainingSeconds / TEMP_AMMO_DURATION_SECONDS, ammo.remainingShots / TEMP_AMMO_MAX_SHOTS)),
          );
          const urgency = getAmmoUrgency(ammo);
          // 弹药剩余量警示色：充足=绿, 告警(≤30%)=黄, 危急(≤10%)=红+闪烁，
          // 让玩家管理多个塔时能一眼分辨哪个塔最需要立刻补弹（类似 Overcooked 的计时提醒）。
          const ringColor = urgency === "critical" ? 0xff4d4d : urgency === "warning" ? 0xffd24d : 0x54e26a;
          const ringAlpha = urgency === "critical" ? 0.55 + 0.45 * Math.sin(this.time.now / 130) : 0.9;
          const ring = this.add.graphics();
          ring.lineStyle(4, ringColor, ringAlpha);
          ring.beginPath();
          ring.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2, false);
          ring.strokePath();
          container.add(ring);
        } else {
          const badge = this.add.circle(18, -18, 6, 0xffd24d, 1);
          container.add(badge);
        }
      } else if (tower.everLoadedAmmo) {
        // 曾经装填过弹药、现已耗尽回退默认弹药：用灰色描边角标提示"已掉级"，
        // 与"从未装填过"的裸塔区分开，提醒玩家这里输出已经下降，值得重新装填。
        const badge = this.add.circle(18, -18, 6, 0x8888aa, 1).setStrokeStyle(1, 0xffffff, 0.6);
        container.add(badge);
      }

      // 显示射程圈（半透明，帮助玩家判断覆盖范围）
      const range = tower.getEffectiveRange();
      const rangeCircle = this.add.circle(0, 0, range, 0xffffff, 0.03).setStrokeStyle(1, 0xffffff, 0.15);
      container.addAt(rangeCircle, 1);
    });
  }

  // -------------------------------------------------------------------------
  // 敌人渲染
  // -------------------------------------------------------------------------

  private syncEnemies(): void {
    const liveIds = new Set(this.session.enemies.map((e) => e.id));
    for (const [id, node] of this.enemyNodes) {
      if (!liveIds.has(id)) {
        node.destroy();
        this.enemyNodes.delete(id);
      }
    }

    for (const enemy of this.session.enemies) {
      let node = this.enemyNodes.get(enemy.id);
      if (!node) {
        node = this.createEnemyNode(enemy);
        this.enemyNodes.set(enemy.id, node);
      }
      node.setPosition(enemy.position.x, enemy.position.y);
      this.updateEnemyHealthBar(node, enemy);
    }
  }

  private createEnemyNode(enemy: EnemyInstance): Phaser.GameObjects.Container {
    const container = this.add.container(enemy.position.x, enemy.position.y);
    const body = this.add.circle(0, 0, enemy.def.radius, enemy.def.color, 1);
    const barBg = this.add.rectangle(0, -enemy.def.radius - 10, 26, 5, 0x000000, 0.6);
    const bar = this.add.rectangle(0, -enemy.def.radius - 10, 26, 5, 0x54e26a, 1);
    bar.setOrigin(0, 0.5);
    bar.x = -13;
    container.add([body, barBg, bar]);
    container.setData("bar", bar);
    return container;
  }

  private updateEnemyHealthBar(node: Phaser.GameObjects.Container, enemy: EnemyInstance): void {
    const bar = node.getData("bar") as Phaser.GameObjects.Rectangle;
    const pct = Math.max(0, enemy.hp / enemy.def.hp);
    bar.width = 26 * pct;
    bar.fillColor = pct > 0.5 ? 0x54e26a : pct > 0.2 ? 0xffd24d : 0xff4d4d;
  }

  private showDamagePopups(): void {
    for (const popup of this.session.lastDamagePopups) {
      const text = this.add
        .text(popup.x, popup.y - 20, `${popup.isCrit ? "暴击! " : ""}-${Math.round(popup.amount)}`, {
          fontSize: popup.isCrit ? "16px" : "12px",
          color: popup.isCrit ? "#ffd24d" : "#ffffff",
        })
        .setOrigin(0.5);
      this.popupTexts.push(text);
      this.tweens.add({
        targets: text,
        y: popup.y - 50,
        alpha: 0,
        duration: 700,
        onComplete: () => {
          text.destroy();
          this.popupTexts = this.popupTexts.filter((t) => t !== text);
        },
      });
    }
  }

  /**
   * 弹药耗尽、回退默认弹药的那一刻做一次醒目的一次性反馈：
   * 一个从塔身向外扩散并淡出的红色冲击圈 + 一句浮动提示文字，
   * 让玩家能立刻注意到"这个塔配置刚刚掉级了"，而不是要靠持续盯着倒计时圈才发现。
   */
  private showAmmoDepletionEffects(): void {
    for (const evt of this.session.lastAmmoDepletions) {
      const burst = this.add.circle(evt.x, evt.y, 18, 0xff4d4d, 0.5).setStrokeStyle(2, 0xff4d4d, 0.9);
      this.tweens.add({
        targets: burst,
        radius: 42,
        alpha: 0,
        duration: 500,
        onUpdate: () => burst.setStrokeStyle(2, 0xff4d4d, burst.alpha),
        onComplete: () => burst.destroy(),
      });
      const text = this.add
        .text(evt.x, evt.y - 40, "弹药耗尽!已切换默认弹药", { fontSize: "11px", color: "#ff8a8a" })
        .setOrigin(0.5);
      this.tweens.add({
        targets: text,
        y: evt.y - 62,
        alpha: 0,
        duration: 1400,
        delay: 300,
        onComplete: () => text.destroy(),
      });
    }
  }

  /**
   * HUD"弹药告急"提示被点击时，对所有当前处于 warning/critical 的塔位做一次
   * 醒目的定位高亮（当前地图单屏可见，无需摄像机滚动，直接在原地脉冲高亮即可）。
   */
  private highlightAmmoWarnings(): void {
    for (const warning of this.session.getAmmoWarnings()) {
      const pos = TOWER_SLOTS[warning.slotIndex];
      const color = warning.urgency === "critical" ? 0xff4d4d : 0xffd24d;
      const highlight = this.add.circle(pos.x, pos.y, 30, color, 0).setStrokeStyle(3, color, 1).setDepth(50);
      this.tweens.add({
        targets: highlight,
        radius: 60,
        alpha: 0,
        duration: 550,
        repeat: 2,
        onUpdate: () => highlight.setStrokeStyle(3, color, Math.max(0, 1 - highlight.radius / 60)),
        onComplete: () => highlight.destroy(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // HUD（顶部信息条 + 下一波按钮）
  // -------------------------------------------------------------------------

  private createHud(): void {
    const bg = this.add.rectangle(0, 0, GAME_WIDTH, HUD_HEIGHT, PANEL_BG, 0.9).setOrigin(0, 0);
    bg.setStrokeStyle(1, PANEL_BORDER, 1);

    this.hudWaveText = this.add.text(12, 14, "", { fontSize: "16px", color: TEXT_COLOR });
    this.hudHealthText = this.add.text(160, 14, "", { fontSize: "16px", color: "#ff8a8a" });
    this.hudGoldText = this.add.text(260, 14, "", { fontSize: "16px", color: "#ffd24d" });
    this.hudPhaseText = this.add.text(360, 14, "", { fontSize: "14px", color: MUTED_COLOR });
    this.hudCountdownText = this.add.text(460, 14, "", { fontSize: "13px", color: "#ffd24d" });
    this.hudAmmoWarningText = this.add.text(460, 14, "", { fontSize: "13px", color: "#ff4d4d" });
    this.hudAmmoWarningText.setInteractive({ useHandCursor: true });
    this.hudAmmoWarningText.on("pointerdown", () => this.highlightAmmoWarnings());

    this.shopTopButton = this.createTopButton(GAME_WIDTH - 380, "商店", () => this.togglePanel(this.shopPanel));
    this.furnaceTopButton = this.createTopButton(GAME_WIDTH - 290, "熔炉", () => this.togglePanel(this.furnacePanel));
    this.createTopButton(GAME_WIDTH - 200, "图鉴", () => this.togglePanel(this.journalPanel));

    this.nextWaveButton = this.createButton(GAME_WIDTH - 110, 14, 96, 26, "开始下一波", () => {
      if (this.session.phase === "prep") {
        this.session.startNextWave();
      }
    });
  }

  private createTopButton(x: number, label: string, onClick: () => void): ButtonHandle {
    return this.createButton(x, 12, 78, 26, label, onClick);
  }

  /**
   * 计算某个（可能嵌套的）Container 内局部坐标对应的场景绝对坐标。
   * 由于所有涉及的 Container 都没有旋转/缩放，逐层累加 x/y 偏移即可，
   * 无需使用较重的 getWorldTransformMatrix。
   */
  private absolutePos(
    parent: Phaser.GameObjects.Container | null,
    localX: number,
    localY: number,
  ): { x: number; y: number } {
    let x = localX;
    let y = localY;
    let node: Phaser.GameObjects.Container | null = parent;
    while (node) {
      x += node.x;
      y += node.y;
      node = node.parentContainer as Phaser.GameObjects.Container | null;
    }
    return { x, y };
  }

  /**
   * 创建一个按钮。
   *
   * 重要实现说明：按钮的可交互矩形（bg）故意创建为**场景顶层对象**（不添加进任何
   * Container），而是用 `parent` 参数把局部坐标换算成绝对坐标。这是为了绕开一个
   * Phaser 3 的底层限制：`InputPlugin.sortGameObjects` 通过
   * `pointer.camera.renderList.indexOf(gameObject)` 判断对象的显示层级，但
   * Container 的子对象从不会被单独推入 `camera.renderList`（Container 只把自己
   * 整体推入，子对象由 Container 内部合批渲染）。结果是任何嵌套在 Container 里的
   * 可交互子对象，其 indexOf 恒为 -1、按 0 处理，从而在与场景顶层的可交互对象
   * （例如全屏的 `modalCatcher` 弹窗遮罩）重叠时，**永远**排在遮罩之下，导致点击
   * 穿透失败（这也是本项目早期"按钮点不到"问题的根因）。把按钮做成顶层对象即可
   * 保证按钮和 `modalCatcher` 用同一套深度排序规则公平比较。
   */
  private createButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    parent: Phaser.GameObjects.Container | null = null,
  ): ButtonHandle {
    const pos = this.absolutePos(parent, x, y);
    const bg = this.add
      .rectangle(pos.x, pos.y, w, h, 0x2a2a45, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, ACCENT, 0.6)
      .setDepth(900);
    const text = this.add
      .text(pos.x + w / 2, pos.y + h / 2, label, { fontSize: "12px", color: TEXT_COLOR })
      .setOrigin(0.5)
      .setDepth(901);
    bg.setInteractive({ useHandCursor: true });
    bg.on("pointerdown", onClick);
    return {
      bg,
      text,
      setVisible: (v: boolean) => {
        bg.setVisible(v);
        text.setVisible(v);
        if (v) bg.setInteractive({ useHandCursor: true });
        else bg.disableInteractive();
      },
      setAlpha: (a: number) => {
        bg.setAlpha(a);
        text.setAlpha(a);
      },
      destroy: () => {
        bg.destroy();
        text.destroy();
      },
    };
  }

  private refreshHud(): void {
    const wave = this.session.getCurrentWave();
    const waveLabel = wave ? `${wave.index}/${this.session.level.waves.length}` : "-";
    this.hudWaveText.setText(`波次 ${waveLabel}`);
    this.hudHealthText.setText(`❤ ${this.session.health}`);
    this.hudGoldText.setText(`💰 ${fmtGold(this.session.wallet.getGold())}`);
    const phaseLabel =
      this.session.phase === "prep"
        ? "备战阶段"
        : this.session.phase === "battle"
          ? "战斗阶段"
          : this.session.phase === "level_complete"
            ? "通关"
            : "游戏结束";
    this.hudPhaseText.setText(phaseLabel);
    this.nextWaveButton.setVisible(this.session.phase === "prep");

    if (this.session.phase === "prep") {
      const elapsed = (this.time.now - this.prepPhaseStartedAtMs) / 1000;
      const remaining = Math.max(0, GameScene.SUGGESTED_PREP_SECONDS - elapsed);
      this.hudCountdownText.setText(
        remaining > 0 ? `建议备战 ${Math.ceil(remaining)}s（可随时开始）` : "随时可开始下一波",
      );
      this.hudAmmoWarningText.setText("");
      this.hudAmmoWarningText.disableInteractive();
    } else {
      this.hudCountdownText.setText("");
      const warnings = this.session.getAmmoWarnings();
      if (warnings.length === 0) {
        this.hudAmmoWarningText.setText("");
        this.hudAmmoWarningText.disableInteractive();
      } else {
        const criticalCount = warnings.filter((w) => w.urgency === "critical").length;
        const blink = criticalCount > 0 ? Math.sin(this.time.now / 130) > 0 : true;
        this.hudAmmoWarningText.setColor(criticalCount > 0 ? "#ff4d4d" : "#ffd24d");
        this.hudAmmoWarningText.setAlpha(blink ? 1 : 0.35);
        this.hudAmmoWarningText.setText(
          criticalCount > 0
            ? `⚠ 弹药即将耗尽 x${criticalCount}（点击定位）`
            : `⚠ 弹药偏低 x${warnings.length}（点击定位）`,
        );
        this.hudAmmoWarningText.setInteractive({ useHandCursor: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 弹药架（右侧竖排卡片，可拖拽到炮塔上）
  // -------------------------------------------------------------------------

  private createRackPanel(): void {
    const bg = this.add
      .rectangle(RACK_PANEL_X, HUD_HEIGHT, RACK_PANEL_WIDTH, GAME_HEIGHT - HUD_HEIGHT, PANEL_BG, 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_BORDER, 1);
    this.add.text(RACK_PANEL_X + 10, HUD_HEIGHT + 8, "弹药架", { fontSize: "14px", color: TEXT_COLOR });
    this.rackContainer = this.add.container(RACK_PANEL_X + 10, HUD_HEIGHT + 32);
    void bg;
  }

  private refreshRack(): void {
    this.rackCardNodes.forEach((n) => n.destroy());
    this.rackCardNodes = [];
    this.rackCardBgZones = [];

    const items = this.session.rack.getItems();
    const cardW = RACK_PANEL_WIDTH - 20;
    const cardH = 64;
    items.forEach((ammo, index) => {
      const y = index * (cardH + 8);
      const card = this.add.container(0, y);
      const slotColor = ammo ? ammo.craftResult.color : 0x1c1c28;
      const bg = this.add
        .rectangle(0, 0, cardW, cardH, slotColor, ammo ? 0.9 : 0.4)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_BORDER, 1);
      card.add(bg);
      // 引导系统需要拿到实际可拖拽的矩形来计算"拖拽起点"高亮框（见 TutorialStep 说明）。
      this.rackCardBgZones[index] = ammo ? bg : null;

      if (ammo) {
        const nameText = this.add.text(6, 4, ammo.craftResult.resultName, {
          fontSize: "11px",
          color: "#101018",
          fontStyle: "bold",
        });
        const statLine = ammo.isPermanent
          ? "永久"
          : `${Math.ceil(ammo.remainingSeconds)}s/${ammo.remainingShots}发`;
        const statText = this.add.text(6, 22, `伤${Math.round(ammo.craftResult.finalDamage)} 暴${ammo.craftResult.finalCritChance.toFixed(0)}%`, {
          fontSize: "10px",
          color: "#101018",
        });
        const timeText = this.add.text(6, 40, statLine, { fontSize: "10px", color: "#101018" });
        card.add([nameText, statText, timeText]);

        bg.setInteractive({ useHandCursor: true, draggable: true });
        this.input.setDraggable(bg);
        card.setData("rackIndex", index);
        this.wireCardDrag(card, bg, index);
      }
      this.rackContainer.add(card);
      this.rackCardNodes.push(card);
    });

    const capacityText = `${items.filter((i) => i !== null).length}/${AMMO_RACK_CAPACITY}`;
    if (this.rackContainer.getData("capacityLabel")) {
      (this.rackContainer.getData("capacityLabel") as Phaser.GameObjects.Text).setText(capacityText);
    } else {
      const label = this.add.text(cardW - 30, -22, capacityText, { fontSize: "11px", color: MUTED_COLOR });
      this.rackContainer.add(label);
      this.rackContainer.setData("capacityLabel", label);
      this.rackCardNodes.push(label as unknown as Phaser.GameObjects.Container);
    }
  }

  private wireCardDrag(card: Phaser.GameObjects.Container, bg: Phaser.GameObjects.Rectangle, rackIndex: number): void {
    const startX = card.x;
    const startY = card.y;
    bg.on("dragstart", () => {
      card.setDepth(1000);
    });
    bg.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      // 拖拽时把卡片从弹药架容器坐标系换算到场景绝对坐标显示
      const worldX = this.rackContainer.x + dragX;
      const worldY = this.rackContainer.y + dragY;
      card.setPosition(dragX, dragY);
      void worldX;
      void worldY;
    });
    bg.on("dragend", (pointer: Phaser.Input.Pointer) => {
      card.setDepth(0);
      card.setPosition(startX, startY);
      const targetSlot = this.findTowerSlotAtPointer(pointer);
      if (targetSlot !== null) {
        try {
          this.session.loadAmmoFromRack(targetSlot, rackIndex);
          this.refreshRack();
        } catch {
          // 目标格没有炮塔或其它错误，忽略并把卡片弹回原位
        }
      }
    });
  }

  private findTowerSlotAtPointer(pointer: Phaser.Input.Pointer): number | null {
    let closest: number | null = null;
    let closestDist = 40;
    TOWER_SLOTS.forEach((pos, idx) => {
      const d = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, pos.x, pos.y);
      if (d < closestDist && this.session.towers[idx]) {
        closest = idx;
        closestDist = d;
      }
    });
    return closest;
  }

  // -------------------------------------------------------------------------
  // 通用弹窗底层（点击空白处关闭）
  // -------------------------------------------------------------------------

  private createModalCatcher(): void {
    this.modalCatcher = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setDepth(500)
      .setVisible(false);
    // 注意：Phaser 的可交互对象即使 setVisible(false) 也仍会拦截输入，
    // 必须显式 disableInteractive/setInteractive 来控制命中测试。
    this.modalCatcher.disableInteractive();
    this.modalCatcher.on("pointerdown", () => this.closeAllPanels());
  }

  private closeAllPanels(): void {
    this.shopPanel.setVisible(false);
    this.furnacePanel.setVisible(false);
    this.journalPanel.setVisible(false);
    this.buildMenu.setVisible(false);
    this.modalCatcher.setVisible(false);
    this.modalCatcher.disableInteractive();
    this.journalReplayTutorialButton?.setVisible(false);
    // 面板内的按钮/热区都是场景顶层对象（见 createButton 说明），
    // 隐藏容器并不会连带隐藏/禁用它们，必须显式销毁，
    // 否则会留下看不见但仍可点击的"幽灵热区"。
    this.shopButtons.forEach((b) => b.destroy());
    this.shopButtons = [];
    this.furnaceChipHitZones.forEach((z) => z.destroy());
    this.furnaceChipHitZones = [];
    this.furnaceActionButtons.forEach((b) => b.destroy());
    this.furnaceActionButtons = [];
    this.buildMenuButtons.forEach((b) => b.destroy());
    this.buildMenuButtons = [];
  }

  private togglePanel(panel: Phaser.GameObjects.Container): void {
    const willShow = !panel.visible;
    this.closeAllPanels();
    if (willShow) {
      panel.setVisible(true);
      this.modalCatcher.setVisible(true);
      this.modalCatcher.setInteractive();
      if (panel === this.shopPanel) this.refreshShopPanel();
      if (panel === this.furnacePanel) this.refreshFurnacePanel();
      if (panel === this.journalPanel) {
        this.refreshJournalPanel();
        this.journalReplayTutorialButton?.setVisible(true);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 商店面板
  // -------------------------------------------------------------------------

  private shopRows: Phaser.GameObjects.Container[] = [];
  private shopButtons: ButtonHandle[] = [];

  private createShopPanel(): void {
    const w = 620;
    const h = 480;
    const x = (GAME_WIDTH - w) / 2;
    const y = (GAME_HEIGHT - h) / 2;
    this.shopPanel = this.add.container(x, y).setDepth(600).setVisible(false);
    const bg = this.add.rectangle(0, 0, w, h, PANEL_BG, 0.97).setOrigin(0, 0).setStrokeStyle(2, ACCENT, 0.8);
    const title = this.add.text(16, 14, "商店 — 用金币购买合成素材", { fontSize: "18px", color: TEXT_COLOR });
    this.shopPanel.add([bg, title]);
  }

  private refreshShopPanel(): void {
    this.shopRows.forEach((r) => r.destroy());
    this.shopRows = [];
    this.shopButtons.forEach((b) => b.destroy());
    this.shopButtons = [];
    SHOP_MATERIALS.forEach((material, index) => {
      const row = this.buildShopRow(material, index);
      this.shopPanel.add(row);
      this.shopRows.push(row);
    });
  }

  private buildShopRow(material: MaterialDef, index: number): Phaser.GameObjects.Container {
    const y = 56 + index * 54;
    const row = this.add.container(16, y);
    const swatch = this.add.rectangle(0, 0, 18, 18, this.tagColor(material.tag), 1);
    const name = this.add.text(26, -10, `${material.name}（${material.tag}）`, {
      fontSize: "13px",
      color: TEXT_COLOR,
    });
    const desc = this.add.text(26, 8, material.description, { fontSize: "10px", color: MUTED_COLOR });
    const owned = this.session.wallet.getMaterialCount(material.id);
    const ownedText = this.add.text(420, -2, `持有 ${owned}`, { fontSize: "11px", color: MUTED_COLOR });
    const buyBtn = this.createButton(
      16 + 500,
      y - 12,
      96,
      24,
      `购买 ${material.shopPrice}💰`,
      () => {
        try {
          this.session.buyMaterial(material.id);
          this.refreshShopPanel();
        } catch {
          // 金币不足，忽略
        }
      },
      this.shopPanel,
    );
    this.shopButtons.push(buyBtn);
    row.add([swatch, name, desc, ownedText]);
    return row;
  }

  private tagColor(tag: string): number {
    switch (tag) {
      case "fire":
        return 0xff6a3d;
      case "ice":
        return 0x63c9ff;
      case "explosive":
        return 0xffb545;
      case "poison":
        return 0x7cff6a;
      case "rare":
        return 0xc86aff;
      default:
        return 0xffffff;
    }
  }

  // -------------------------------------------------------------------------
  // 熔炉合成面板
  // -------------------------------------------------------------------------

  private furnaceMaterialRows: Phaser.GameObjects.Container[] = [];
  private furnaceChipHitZones: Phaser.GameObjects.Rectangle[] = [];
  private furnaceActionButtons: ButtonHandle[] = [];
  private furnacePredictionNode!: Phaser.GameObjects.Container;

  private createFurnacePanel(): void {
    const w = 680;
    const h = 560;
    const x = (GAME_WIDTH - w) / 2;
    const y = (GAME_HEIGHT - h) / 2;
    this.furnacePanel = this.add.container(x, y).setDepth(600).setVisible(false);
    const bg = this.add.rectangle(0, 0, w, h, PANEL_BG, 0.97).setOrigin(0, 0).setStrokeStyle(2, ACCENT, 0.8);
    const title = this.add.text(16, 14, "熔炉 — 选择 2-4 个素材合成弹药", { fontSize: "18px", color: TEXT_COLOR });
    this.furnacePanel.add([bg, title]);
    this.furnacePredictionNode = this.add.container(16, 380);
    this.furnacePanel.add(this.furnacePredictionNode);
  }

  private refreshFurnacePanel(): void {
    this.furnaceMaterialRows.forEach((r) => r.destroy());
    this.furnaceMaterialRows = [];
    this.furnaceChipHitZones.forEach((z) => z.destroy());
    this.furnaceChipHitZones = [];
    this.furnaceActionButtons.forEach((b) => b.destroy());
    this.furnaceActionButtons = [];

    const locked = this.session.phase !== "prep";
    const ownedIds = [...new Set(this.getOwnedMaterialIds())];

    ownedIds.forEach((id, index) => {
      const material = getMaterialById(id);
      const count = this.session.wallet.getMaterialCount(id);
      if (count <= 0) return;
      const row = this.buildFurnaceMaterialChip(material, count, index, locked);
      this.furnacePanel.add(row);
      this.furnaceMaterialRows.push(row);
    });

    if (locked) {
      const lockText = this.add.text(16, 340, "战斗阶段熔炉已锁定，请等待备战阶段", {
        fontSize: "13px",
        color: "#ff8a8a",
      });
      this.furnacePanel.add(lockText);
      this.furnaceMaterialRows.push(this.add.container(0, 0, [lockText]));
    }

    this.renderFurnacePrediction();
  }

  private getOwnedMaterialIds(): string[] {
    return SHOP_MATERIALS.concat(
      // rare 材料也可能持有（掉落获得），一并纳入可选列表
      [getMaterialById("starfall_shard")],
    ).map((m) => m.id);
  }

  private buildFurnaceMaterialChip(
    material: MaterialDef,
    count: number,
    index: number,
    locked: boolean,
  ): Phaser.GameObjects.Container {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 16 + col * 220;
    const y = 56 + row * 60;
    const selectedCount = this.selectedMaterials.filter((m) => m === material.id).length;
    const container = this.add.container(x, y);
    const bg = this.add
      .rectangle(0, 0, 200, 50, selectedCount > 0 ? this.tagColor(material.tag) : 0x24243a, selectedCount > 0 ? 0.8 : 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_BORDER, 1);
    const label = this.add.text(8, 6, `${material.name} x${count}`, { fontSize: "12px", color: TEXT_COLOR });
    const selectedLabel = this.add.text(8, 26, selectedCount > 0 ? `已选 ${selectedCount}` : "点击选择", {
      fontSize: "10px",
      color: MUTED_COLOR,
    });
    container.add([bg, label, selectedLabel]);

    if (!locked) {
      // bg 嵌套在 container 内，无法可靠命中测试（见 createButton 的说明），
      // 因此叠加一个场景顶层的透明热区矩形负责实际点击判定。
      const abs = this.absolutePos(this.furnacePanel, x, y);
      const hitZone = this.add
        .rectangle(abs.x, abs.y, 200, 50, 0xffffff, 0.001)
        .setOrigin(0, 0)
        .setDepth(900)
        .setInteractive({ useHandCursor: true });
      hitZone.on("pointerdown", () => {
        const totalSelected = this.selectedMaterials.length;
        if (selectedCount < count && totalSelected < MAX_MATERIALS_PER_CRAFT) {
          this.selectedMaterials.push(material.id);
        } else if (selectedCount > 0) {
          const idx = this.selectedMaterials.lastIndexOf(material.id);
          if (idx !== -1) this.selectedMaterials.splice(idx, 1);
        }
        this.refreshFurnacePanel();
      });
      this.furnaceChipHitZones.push(hitZone);
    }
    return container;
  }

  private renderFurnacePrediction(): void {
    this.furnacePredictionNode.removeAll(true);
    this.furnaceActionButtons.forEach((b) => b.destroy());
    this.furnaceActionButtons = [];
    const canPredict = this.selectedMaterials.length >= MIN_MATERIALS_PER_CRAFT;
    if (!canPredict) {
      const hint = this.add.text(
        0,
        0,
        `请选择 ${MIN_MATERIALS_PER_CRAFT}-${MAX_MATERIALS_PER_CRAFT} 个素材查看合成预测`,
        { fontSize: "12px", color: MUTED_COLOR },
      );
      this.furnacePredictionNode.add(hint);
      return;
    }

    let prediction;
    try {
      prediction = this.session.predictCraft(this.selectedMaterials);
    } catch {
      const errText = this.add.text(0, 0, "素材组合暂时无法解析", { fontSize: "12px", color: "#ff8a8a" });
      this.furnacePredictionNode.add(errText);
      return;
    }

    const nameText = this.add.text(0, 0, `预测结果：${prediction.resultName}（${prediction.isAoe ? "范围" : "单体"}）`, {
      fontSize: "14px",
      color: "#" + prediction.color.toString(16).padStart(6, "0"),
    });
    const descText = this.add.text(0, 20, prediction.description, { fontSize: "11px", color: MUTED_COLOR });
    const dmgText = this.add.text(
      0,
      40,
      `伤害区间：${prediction.predictedDamageRange[0]} ~ ${prediction.predictedDamageRange[1]}`,
      { fontSize: "12px", color: TEXT_COLOR },
    );
    const critText = this.add.text(
      0,
      58,
      `暴击率区间：${prediction.predictedCritRange[0]}% ~ ${prediction.predictedCritRange[1]}%`,
      { fontSize: "12px", color: TEXT_COLOR },
    );
    const riskBar = this.buildRiskBar(prediction.greatFailureChance, prediction.greatSuccessChance);
    riskBar.setPosition(0, 80);

    this.furnacePredictionNode.add([nameText, descText, dmgText, critText, riskBar]);

    const locked = this.session.phase !== "prep";
    const canCraftTemp = !locked;
    const canCraftPerm = !locked && prediction.hasRare;

    const tempBtn = this.createButton(
      0,
      120,
      160,
      30,
      "合成临时弹药",
      () => {
        if (canCraftTemp) this.doCraft("temporary");
      },
      this.furnacePredictionNode,
    );
    tempBtn.setAlpha(canCraftTemp ? 1 : 0.4);
    const permBtn = this.createButton(
      180,
      120,
      160,
      30,
      "合成永久弹药(-20%)",
      () => {
        if (canCraftPerm) this.doCraft("permanent");
      },
      this.furnacePredictionNode,
    );
    permBtn.setAlpha(canCraftPerm ? 1 : 0.4);
    this.furnaceActionButtons.push(tempBtn, permBtn);

    const clearBtn = this.createButton(
      360,
      120,
      80,
      30,
      "清空选择",
      () => {
        this.selectedMaterials = [];
        this.refreshFurnacePanel();
      },
      this.furnacePredictionNode,
    );
    this.furnaceActionButtons.push(clearBtn);
  }

  private buildRiskBar(failChance: number, successChance: number): Phaser.GameObjects.Container {
    const w = 400;
    const h = 14;
    const container = this.add.container(0, 0);
    const bg = this.add.rectangle(0, 0, w, h, 0x333344, 1).setOrigin(0, 0);
    const failW = (failChance / 100) * w;
    const successW = (successChance / 100) * w;
    const normalW = Math.max(0, w - failW - successW);
    const failBar = this.add.rectangle(0, 0, failW, h, 0xff4d4d, 1).setOrigin(0, 0);
    const normalBar = this.add.rectangle(failW, 0, normalW, h, 0x5ad1ff, 1).setOrigin(0, 0);
    const successBar = this.add.rectangle(failW + normalW, 0, successW, h, 0xffd24d, 1).setOrigin(0, 0);
    const label = this.add.text(0, h + 4, `大失败 ${failChance.toFixed(0)}%  |  大成功 ${successChance.toFixed(0)}%`, {
      fontSize: "10px",
      color: MUTED_COLOR,
    });
    container.add([bg, failBar, normalBar, successBar, label]);
    return container;
  }

  private doCraft(tier: "temporary" | "permanent"): void {
    if (this.selectedMaterials.length < MIN_MATERIALS_PER_CRAFT) return;
    try {
      const ammo = this.session.craftAmmo(this.selectedMaterials, tier);
      this.playCraftAnimation(ammo);
      this.selectedMaterials = [];
      this.refreshFurnacePanel();
      this.refreshRack();
    } catch {
      // 素材/金币不足或规则校验失败，忽略
    }
  }

  private playCraftAnimation(ammo: AmmoInstance): void {
    const flash = this.add.circle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 10, ammo.craftResult.color, 1).setDepth(700);
    this.tweens.add({
      targets: flash,
      radius: 120,
      alpha: 0,
      duration: 450,
      onComplete: () => flash.destroy(),
    });
    const tierLabel = ammo.craftResult.outcomeTier === "great_success" ? "大成功！" : ammo.craftResult.outcomeTier === "great_failure" ? "大失败…" : "合成完成";
    const text = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, `${tierLabel} ${ammo.craftResult.resultName}`, {
        fontSize: "20px",
        color: TEXT_COLOR,
      })
      .setOrigin(0.5)
      .setDepth(700);
    this.tweens.add({
      targets: text,
      y: GAME_HEIGHT / 2 - 100,
      alpha: 0,
      duration: 1200,
      onComplete: () => text.destroy(),
    });
  }

  // -------------------------------------------------------------------------
  // 配方图鉴面板
  // -------------------------------------------------------------------------

  private journalRows: Phaser.GameObjects.Container[] = [];

  private createJournalPanel(): void {
    const w = 620;
    const h = 480;
    const x = (GAME_WIDTH - w) / 2;
    const y = (GAME_HEIGHT - h) / 2;
    this.journalPanel = this.add.container(x, y).setDepth(600).setVisible(false);
    const bg = this.add.rectangle(0, 0, w, h, PANEL_BG, 0.97).setOrigin(0, 0).setStrokeStyle(2, ACCENT, 0.8);
    const title = this.add.text(16, 14, "配方图鉴", { fontSize: "18px", color: TEXT_COLOR });
    this.journalPanel.add([bg, title]);
    // 加分项：允许玩家随时重新观看新手引导（例如第一次跳过后想回顾流程）。
    // 按钮本身是场景顶层对象（见 createButton 说明），必须跟随图鉴面板的显隐手动同步可见性，
    // 否则会在面板关闭后仍然悬浮可见/可点击。
    this.journalReplayTutorialButton = this.createButton(
      w - 156,
      12,
      140,
      26,
      "重新查看教程",
      () => {
        this.closeAllPanels();
        this.startTutorial();
      },
      this.journalPanel,
    );
    this.journalReplayTutorialButton.setVisible(false);
  }

  private refreshJournalPanel(): void {
    this.journalRows.forEach((r) => r.destroy());
    this.journalRows = [];
    const rules = RecipeJournal.allRules();
    rules.forEach((rule, index) => {
      const discovered = this.session.journal.has(rule.key);
      const y = 56 + index * 42;
      const row = this.add.container(16, y);
      const swatch = this.add.rectangle(0, 6, 16, 16, discovered ? rule.color : 0x333344, 1);
      const name = this.add.text(26, 0, discovered ? rule.resultName : "??? 未发现的配方", {
        fontSize: "13px",
        color: discovered ? TEXT_COLOR : MUTED_COLOR,
      });
      const desc = this.add.text(26, 18, discovered ? rule.description : "合成对应素材组合以解锁", {
        fontSize: "10px",
        color: MUTED_COLOR,
      });
      row.add([swatch, name, desc]);
      this.journalPanel.add(row);
      this.journalRows.push(row);
    });
  }

  // -------------------------------------------------------------------------
  // 建塔小菜单
  // -------------------------------------------------------------------------

  private createBuildMenu(): void {
    this.buildMenu = this.add.container(0, 0).setDepth(650).setVisible(false);
  }

  private openBuildMenu(slotIndex: number): void {
    this.pendingBuildSlot = slotIndex;
    this.buildMenu.removeAll(true);
    this.buildMenuButtons.forEach((b) => b.destroy());
    this.buildMenuButtons = [];
    const pos = TOWER_SLOTS[slotIndex];
    const w = 220;
    const h = 110;
    let x = pos.x - w / 2;
    let y = pos.y - h - 20;
    x = Phaser.Math.Clamp(x, 8, GAME_WIDTH - w - 8);
    y = Phaser.Math.Clamp(y, HUD_HEIGHT + 8, GAME_HEIGHT - h - 8);
    this.buildMenu.setPosition(x, y);

    const bg = this.add.rectangle(0, 0, w, h, PANEL_BG, 0.98).setOrigin(0, 0).setStrokeStyle(2, ACCENT, 0.8);
    this.buildMenu.add(bg);

    (Object.keys(TOWERS) as TowerKind[]).forEach((kind, idx) => {
      const def = TOWERS[kind];
      const btn = this.createButton(
        10,
        10 + idx * 44,
        w - 20,
        36,
        `${def.name} (${def.cost}💰)`,
        () => {
          if (this.pendingBuildSlot === null) return;
          try {
            this.session.placeTower(kind, this.pendingBuildSlot);
          } catch {
            // 金币不足或格子已占用
          }
          this.closeAllPanels();
        },
        this.buildMenu,
      );
      this.buildMenuButtons.push(btn);
    });

    this.buildMenu.setVisible(true);
    this.modalCatcher.setVisible(true);
    this.modalCatcher.setInteractive();
    this.modalCatcher.setDepth(640);
  }

  // -------------------------------------------------------------------------
  // 结算面板（胜利/失败）
  // -------------------------------------------------------------------------

  private createResultPanel(): void {
    const w = 480;
    const h = 320;
    const x = (GAME_WIDTH - w) / 2;
    const y = (GAME_HEIGHT - h) / 2;
    this.resultPanel = this.add.container(x, y).setDepth(800).setVisible(false);
  }

  private openResultPanel(): void {
    this.resultPanel.removeAll(true);
    this.resultButtons.forEach((b) => b.destroy());
    this.resultButtons = [];
    const w = 480;
    const h = 320;
    const isVictory = this.session.phase === "level_complete";
    const bg = this.add
      .rectangle(0, 0, w, h, PANEL_BG, 0.98)
      .setOrigin(0, 0)
      .setStrokeStyle(2, isVictory ? 0xffd24d : 0xff4d4d, 1);
    const title = this.add
      .text(w / 2, 30, isVictory ? "通关！" : "游戏结束", {
        fontSize: "26px",
        color: isVictory ? "#ffd24d" : "#ff4d4d",
      })
      .setOrigin(0.5);
    const stats = this.session.stats;
    const statsText = this.add
      .text(
        w / 2,
        100,
        `击杀敌人：${stats.totalKills}\n` +
          `获得金币：${stats.totalGoldEarned}\n` +
          `完成波次：${stats.wavesCleared}\n` +
          `合成次数：${stats.craftCount}（大成功 ${stats.greatSuccessCount} / 大失败 ${stats.greatFailureCount}）`,
        { fontSize: "14px", color: TEXT_COLOR, align: "center" },
      )
      .setOrigin(0.5, 0);
    const restartBtn = this.createButton(
      w / 2 - 60,
      h - 60,
      120,
      36,
      "重新开始",
      () => {
        this.scene.restart();
      },
      this.resultPanel,
    );
    this.resultButtons.push(restartBtn);
    this.resultPanel.add([bg, title, statsText]);
    this.resultPanel.setVisible(true);
    this.modalCatcher.setInteractive();
    this.modalCatcher.setVisible(true);
    this.modalCatcher.setDepth(780);
    this.modalCatcher.off("pointerdown");
  }

  // -------------------------------------------------------------------------
  // 新手引导（Tutorial）
  //
  // 设计要点（对应用户需求）：
  // 1. 每一步只高亮一个目标 UI 元素 + 一句简短文字说明。
  // 2. "强制聚焦"：一个覆盖全屏、深度极高的遮罩(tutorialOverlay)拦截所有点击，
  //    仅在当前目标区域内用自定义 hitAreaCallback"打洞"放行——洞内点击会让遮罩自身
  //    的命中测试返回 false，从而遮罩完全不参与这次输入事件的分发，目标对象自己的
  //    命中测试完全不受影响，正常触发。这个做法特意避开了本项目已知的 Phaser 限制
  //    （Container 子对象无法在与顶层对象的深度排序中正确比较，见 createButton 的
  //    详细注释）：遮罩洞外挡的是"没有洞"，而不是依赖深度排序谁盖过谁，因此无论目标
  //    对象是否嵌套在 Container 里都不受影响。
  // 3. 结束/跳过时只需要隐藏并 disableInteractive 这一个遮罩对象即可完全恢复正常
  //    交互，不需要逐个恢复其它按钮的可交互状态，从根本上避免"引导结束后仍有区域
  //    无法交互"的风险。
  // 4. 每一步的完成判定都绑定在真实游戏状态（如"熔炉面板已打开""弹药架已有弹药"）
  //    而不是固定计时器，因为引导是在玩家真实的第一局游戏中进行，不是模拟环境。
  // -------------------------------------------------------------------------

  private maybeStartTutorial(): void {
    let completed = false;
    try {
      completed = window.localStorage.getItem(GameScene.TUTORIAL_STORAGE_KEY) === "1";
    } catch {
      // 隐私模式/localStorage 不可用时，保守地不强制弹出引导，避免报错阻断游戏。
      completed = true;
    }
    if (!completed) this.startTutorial();
  }

  /** 把一个（可能是嵌套对象的）矩形边界外扩几个像素，作为高亮/打洞区域，视觉上更宽松一点。 */
  private padRect(b: Phaser.Geom.Rectangle, pad = 6): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
  }

  private rectFromButton(btn: ButtonHandle | undefined | null): Phaser.Geom.Rectangle[] {
    if (!btn || !btn.bg.active) return [];
    return [this.padRect(btn.bg.getBounds())];
  }

  private rectFromObject(
    obj: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Arc | null | undefined,
  ): Phaser.Geom.Rectangle[] {
    if (!obj || !obj.active) return [];
    return [this.padRect(obj.getBounds())];
  }

  private buildTutorialSteps(): TutorialStep[] {
    return [
      {
        caption: "欢迎来到炼金塔防！第 1 步：点击「商店」，购买合成弹药所需的素材。",
        getHoleRects: () => this.rectFromButton(this.shopTopButton),
        isComplete: () => this.shopPanel.visible,
      },
      {
        caption: "购买 2 个「火种粉」（点击「购买」按钮两次），凑够合成所需的素材数量。",
        getHoleRects: () => this.rectFromButton(this.shopButtons[0]),
        isComplete: () => this.session.wallet.getMaterialCount("ember_dust") >= MIN_MATERIALS_PER_CRAFT,
      },
      {
        caption: "素材够了！点击「熔炉」，把素材合成为可以装填到炮塔上的弹药。",
        getHoleRects: () => this.rectFromButton(this.furnaceTopButton),
        isComplete: () => this.furnacePanel.visible,
      },
      {
        caption: `点击「火种粉」卡片 ${MIN_MATERIALS_PER_CRAFT} 次，选够素材用于合成。`,
        getHoleRects: () => this.rectFromObject(this.furnaceChipHitZones[0]),
        isComplete: () => this.selectedMaterials.length >= MIN_MATERIALS_PER_CRAFT,
      },
      {
        caption: "点击「合成临时弹药」，把素材变成弹药！",
        getHoleRects: () => this.rectFromButton(this.furnaceActionButtons[0]),
        isComplete: () => this.session.rack.getItems().some((item) => item !== null),
      },
      {
        caption: "很好，弹药已经进入弹药架！点击地图上高亮的塔位，准备建造第一座炮塔。",
        getHoleRects: () => {
          // 合成完成后自动收起熔炉面板，否则背景塔位会被弹窗遮罩挡住无法点击。
          if (this.furnacePanel.visible) this.closeAllPanels();
          return this.rectFromObject(this.towerSlotHitZones[0]);
        },
        isComplete: () => this.buildMenu.visible,
      },
      {
        caption: "选择「近程速射塔」完成建造。",
        getHoleRects: () => this.rectFromButton(this.buildMenuButtons[0]),
        isComplete: () => this.session.towers[0] !== null,
      },
      {
        caption: "最后一步：把弹药架里的弹药卡片拖到刚建好的炮塔上，完成装填。",
        getHoleRects: () => [
          ...this.rectFromObject(this.rackCardBgZones[0]),
          ...this.rectFromObject(this.towerSlotHitZones[0]),
        ],
        isComplete: () => this.session.towers[0]?.loadedAmmo != null,
      },
      {
        caption: "装填完成！点击「开始下一波」，观看炮塔自动开火作战吧。",
        getHoleRects: () => this.rectFromButton(this.nextWaveButton),
        isComplete: () => this.session.phase !== "prep",
      },
    ];
  }

  private startTutorial(): void {
    this.tutorialSteps = this.buildTutorialSteps();
    this.tutorialStepIndex = 0;
    this.tutorialActive = true;

    if (!this.tutorialOverlay) {
      this.tutorialOverlay = this.add
        .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6)
        .setOrigin(0, 0)
        .setDepth(5000);
      this.tutorialHighlightGfx = this.add.graphics().setDepth(5001);
      this.tutorialCaptionBg = this.add
        .rectangle(0, HUD_HEIGHT, GAME_WIDTH, 42, 0x0d0d16, 0.95)
        .setOrigin(0, 0)
        .setDepth(5001)
        .setStrokeStyle(1, ACCENT, 0.8);
      this.tutorialStepLabel = this.add
        .text(12, HUD_HEIGHT + 5, "", { fontSize: "11px", color: MUTED_COLOR })
        .setDepth(5002);
      this.tutorialCaptionText = this.add
        .text(GAME_WIDTH / 2, HUD_HEIGHT + 21, "", {
          fontSize: "13px",
          color: TEXT_COLOR,
          wordWrap: { width: GAME_WIDTH - 220 },
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(5002);
      this.tutorialSkipButton = this.createButton(GAME_WIDTH - 118, HUD_HEIGHT + 8, 106, 26, "跳过教程", () => {
        this.completeTutorial(true);
      });
      this.tutorialSkipButton.bg.setDepth(5002);
      this.tutorialSkipButton.text.setDepth(5003);
    }

    this.tutorialOverlay.setVisible(true);
    this.tutorialOverlay.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT),
      hitAreaCallback: (
        _hitArea: Phaser.Geom.Rectangle,
        x: number,
        y: number,
        _obj: Phaser.GameObjects.GameObject,
      ): boolean => {
        // 命中测试的局部坐标在这里等价于场景绝对坐标（遮罩原点在 (0,0) 且无旋转/缩放）。
        for (const hole of this.tutorialHoleRects) {
          if (hole.contains(x, y)) return false; // 洞内：遮罩"看不见"这次点击，交给下面的真实目标处理
        }
        return true; // 洞外：遮罩吞掉这次点击
      },
    });
    this.tutorialOverlay.off("pointerdown");
    this.tutorialOverlay.on("pointerdown", (_pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      this.flashTutorialHighlight();
    });
    this.tutorialHighlightGfx.setVisible(true);
    this.tutorialCaptionBg.setVisible(true);
    this.tutorialCaptionText.setVisible(true);
    this.tutorialStepLabel.setVisible(true);
    this.tutorialSkipButton.setVisible(true);

    this.showTutorialStep(0);
  }

  private showTutorialStep(index: number): void {
    if (index >= this.tutorialSteps.length) {
      this.completeTutorial(false);
      return;
    }
    this.tutorialStepIndex = index;
    const step = this.tutorialSteps[index];
    step.onEnter?.();
    this.tutorialStepLabel.setText(`引导 ${index + 1}/${this.tutorialSteps.length}`);
    this.tutorialCaptionText.setText(step.caption);
    this.tutorialHoleRects = step.getHoleRects();
  }

  /** 每帧调用：刷新当前步骤的打洞区域（面板可能刚被重建）、高亮描边动画，并检测该步骤是否已完成。 */
  private updateTutorial(): void {
    if (!this.tutorialActive) return;
    const step = this.tutorialSteps[this.tutorialStepIndex];
    if (!step) return;
    this.tutorialHoleRects = step.getHoleRects();
    this.redrawTutorialHighlight();
    if (step.isComplete()) {
      this.showTutorialStep(this.tutorialStepIndex + 1);
    }
  }

  private redrawTutorialHighlight(): void {
    this.tutorialHighlightGfx.clear();
    const pulse = 0.6 + 0.4 * Math.sin(this.time.now / 220);
    this.tutorialHighlightGfx.lineStyle(3, 0xffd24d, pulse);
    for (const rect of this.tutorialHoleRects) {
      this.tutorialHighlightGfx.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 8);
    }
  }

  /** 玩家点在遮罩挡住的区域时的轻反馈：高亮框短暂加粗+变红，提示"应该点旁边高亮的地方"。 */
  private flashTutorialHighlight(): void {
    if (!this.tutorialActive) return;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 220,
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        this.tutorialHighlightGfx.clear();
        this.tutorialHighlightGfx.lineStyle(3 + 3 * (1 - t), 0xff4d4d, 1 - t * 0.3);
        for (const rect of this.tutorialHoleRects) {
          this.tutorialHighlightGfx.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 8);
        }
      },
    });
  }

  private completeTutorial(_skipped: boolean): void {
    this.tutorialActive = false;
    this.tutorialHoleRects = [];
    this.tutorialOverlay.setVisible(false);
    this.tutorialOverlay.disableInteractive();
    this.tutorialHighlightGfx.clear();
    this.tutorialHighlightGfx.setVisible(false);
    this.tutorialCaptionBg.setVisible(false);
    this.tutorialCaptionText.setVisible(false);
    this.tutorialStepLabel.setVisible(false);
    this.tutorialSkipButton.setVisible(false);
    try {
      window.localStorage.setItem(GameScene.TUTORIAL_STORAGE_KEY, "1");
    } catch {
      // 忽略：localStorage 不可用时无法持久化"已完成"标记，
      // 下次刷新可能会再次弹出引导，但不影响本局正常游玩。
    }
  }
}
