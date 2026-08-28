import { MIN_DICE_COUNT, MAX_DICE_COUNT } from "./renderer";

export { DiceRenderer, MIN_DICE_COUNT, MAX_DICE_COUNT } from "./renderer";
export type { DiceRendererOptions, DiceRoundRecord } from "./renderer";
export * from "./config";
export * from "./textures";
export * from "./physics/types";
export { diceInitPosition, calcFinalUpFace, scaleHullPoints } from "./physics/shared";
export { diceGeometry, diceGeometryPoints } from "./geometry";
export { addChessboard } from "./board";
export { addDice, deriveUpFaceElement } from "./dice";
export type { DiceHandle } from "./dice";

/** 七圣骰子面索引 0..7 的中英双语名称 */
export const ELEMENT_NAMES_ZH = ["冰", "水", "火", "雷", "风", "岩", "草", "万能"] as const;
export const ELEMENT_NAMES_EN = [
  "Cryo",
  "Hydro",
  "Pyro",
  "Electro",
  "Anemo",
  "Geo",
  "Dendro",
  "Omni",
] as const;
export const ELEMENT_NAMES: ReadonlyArray<{ zh: string; en: string }> =
  ELEMENT_NAMES_ZH.map((zh, i) => ({ zh, en: ELEMENT_NAMES_EN[i] }));

/**
 * 棋盘尺寸。单位：three.js 世界单位。
 * - number: 正方形边长
 * - [length, width]: 长方形（length=x 轴，width=z 轴）
 * - "18x12" / "18*12": 长方形字符串
 */
export type BoardSize = number | readonly [number, number] | string;

/** 解析 BoardSize 为棋盘长宽（世界单位），非法值抛 RangeError */
export function parseBoardSize(size: BoardSize): {
  boardLength: number;
  boardWidth: number;
} {
  if (typeof size === "number") {
    if (!(size > 0)) throw new RangeError(`boardSize must be > 0, got ${size}`);
    return { boardLength: size, boardWidth: size };
  }
  if (Array.isArray(size)) {
    const [l, w] = size as readonly number[];
    if (!(l > 0 && w > 0)) {
      throw new RangeError(`boardSize [length,width] must both be > 0, got ${size}`);
    }
    return { boardLength: l, boardWidth: w };
  }
  if (typeof size === "string") {
    const m = size.match(/^\s*(\d+(?:\.\d+)?)\s*[x*]\s*(\d+(?:\.\d+)?)\s*$/i);
    if (!m) {
      throw new RangeError(
        `boardSize string must match "LxW" or "L*W" (world units), got ${JSON.stringify(size)}`,
      );
    }
    const l = Number(m[1]);
    const w = Number(m[2]);
    if (!(l > 0 && w > 0)) {
      throw new RangeError(`boardSize dimensions must be > 0, got ${size}`);
    }
    return { boardLength: l, boardWidth: w };
  }
  throw new RangeError(`Invalid boardSize: ${String(size)}`);
}

/** 骰子结果数组的公共校验：长度 1–16，元素 0–7 */
export function validateResults(
  results: readonly number[],
  min = MIN_DICE_COUNT,
  max = MAX_DICE_COUNT,
): void {
  if (!Number.isInteger(results.length) || results.length < min || results.length > max) {
    throw new RangeError(`dice count must be between ${min} and ${max}, got ${results.length}`);
  }
  for (const value of results) {
    if (!Number.isInteger(value) || value < 0 || value > 7) {
      throw new RangeError(`dice face must be an integer in [0,7], got ${value}`);
    }
  }
}
