import type { CraftResult } from "./craftingEngine";

export const TEMP_AMMO_DURATION_SECONDS = 30;
export const TEMP_AMMO_MAX_SHOTS = 50;

export type AmmoStatus = "in_rack" | "loaded" | "depleted";

let nextAmmoId = 1;
export function resetAmmoIdCounter(): void {
  nextAmmoId = 1;
}

/**
 * 一份合成好的弹药实例。
 * 临时弹药的时效倒计时/次数只有在装填到炮塔（status 变为 loaded）之后才开始消耗；
 * 放在弹药架里（in_rack）不消耗时效。
 */
export class AmmoInstance {
  readonly id: number;
  readonly craftResult: CraftResult;
  status: AmmoStatus = "in_rack";
  remainingSeconds: number;
  remainingShots: number;

  constructor(craftResult: CraftResult) {
    this.id = nextAmmoId++;
    this.craftResult = craftResult;
    this.remainingSeconds = TEMP_AMMO_DURATION_SECONDS;
    this.remainingShots = TEMP_AMMO_MAX_SHOTS;
  }

  get isPermanent(): boolean {
    return this.craftResult.ammoTier === "permanent";
  }

  /** 装填到炮塔：从弹药架状态切换为已装填状态，临时弹药的时效从此刻开始计算 */
  load(): void {
    if (this.status === "depleted") {
      throw new Error("已失效的弹药不能被装填");
    }
    this.status = "loaded";
  }

  /** 卸下弹药，放回弹药架（不重置已消耗的时效，符合"消耗品"直觉：拔下来时间还是继续算） */
  unload(): void {
    if (this.status === "loaded") {
      this.status = "in_rack";
    }
  }

  /** 每帧调用，推进临时弹药的时间倒计时（仅在装填状态下生效） */
  tick(deltaSeconds: number): void {
    if (this.isPermanent || this.status !== "loaded") return;
    this.remainingSeconds -= deltaSeconds;
    if (this.remainingSeconds <= 0) {
      this.remainingSeconds = 0;
      this.status = "depleted";
    }
  }

  /** 塔开火时调用一次，推进临时弹药的次数消耗（仅在装填状态下生效） */
  registerShot(): void {
    if (this.isPermanent || this.status !== "loaded") return;
    this.remainingShots -= 1;
    if (this.remainingShots <= 0) {
      this.remainingShots = 0;
      this.status = "depleted";
    }
  }

  isUsable(): boolean {
    return this.status === "loaded";
  }

  isDepleted(): boolean {
    return this.status === "depleted";
  }
}

export function createAmmoInstance(craftResult: CraftResult): AmmoInstance {
  return new AmmoInstance(craftResult);
}

/** 弹药剩余量的可视化警示等级：ok(充足) / warning(≤30%,建议补货) / critical(≤10%,即将耗尽) */
export type AmmoUrgency = "ok" | "warning" | "critical";

export const AMMO_WARNING_THRESHOLD = 0.3;
export const AMMO_CRITICAL_THRESHOLD = 0.1;

/**
 * 计算一件已装填弹药的剩余量警示等级。永久弹药、未装填、非临时弹药都视为 "ok"（无需提醒）。
 * 剩余比例取"剩余时间占比"与"剩余次数占比"中较小者，任一先耗尽都算作紧迫状态。
 */
export function getAmmoUrgency(ammo: AmmoInstance | null): AmmoUrgency {
  if (!ammo || ammo.isPermanent || ammo.status !== "loaded") return "ok";
  const pct = Math.min(
    ammo.remainingSeconds / TEMP_AMMO_DURATION_SECONDS,
    ammo.remainingShots / TEMP_AMMO_MAX_SHOTS,
  );
  if (pct <= AMMO_CRITICAL_THRESHOLD) return "critical";
  if (pct <= AMMO_WARNING_THRESHOLD) return "warning";
  return "ok";
}

export const AMMO_RACK_CAPACITY = 8;

export class AmmoRackFullError extends Error {}

/** 弹药架：备战阶段合成好的弹药存放处，容量有限（6-8格，制造取舍策略） */
export class AmmoRack {
  private capacity: number;
  private slots: (AmmoInstance | null)[];

  constructor(capacity: number = AMMO_RACK_CAPACITY) {
    this.capacity = capacity;
    this.slots = new Array(capacity).fill(null);
  }

  getCapacity(): number {
    return this.capacity;
  }

  getItems(): (AmmoInstance | null)[] {
    return [...this.slots];
  }

  getUsedCount(): number {
    return this.slots.filter((s) => s !== null).length;
  }

  isFull(): boolean {
    return this.getUsedCount() >= this.capacity;
  }

  /** 放入一件新合成的弹药，返回其所在格子索引 */
  add(ammo: AmmoInstance): number {
    const idx = this.slots.findIndex((s) => s === null);
    if (idx === -1) {
      throw new AmmoRackFullError("弹药架已满，无法放入新弹药");
    }
    this.slots[idx] = ammo;
    return idx;
  }

  /** 从架上取出（例如要装填到炮塔时），返回取出的弹药 */
  removeAt(index: number): AmmoInstance | null {
    const ammo = this.slots[index] ?? null;
    this.slots[index] = null;
    return ammo;
  }

  /** 把已卸下的弹药放回架上的空位（如果还有空位） */
  returnToRack(ammo: AmmoInstance): boolean {
    if (this.isFull()) return false;
    ammo.unload();
    this.add(ammo);
    return true;
  }
}
