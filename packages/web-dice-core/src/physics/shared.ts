import * as THREE from "three";
import type { DiceWorldConfig } from "../config";

/** 投掷阶段骰子的初始散布位置（在棋盘范围内，留出墙边距） */
export function diceInitPosition(
  board: DiceWorldConfig,
  index: number,
  total: number,
): { x: number; z: number } {
  const cols = Math.min(total, 4);
  const rows = Math.ceil(total / cols);

  const margin = 1.2;
  const availableX = Math.max(0.1, board.boardLength - margin * 2);
  const availableZ = Math.max(0.1, board.boardWidth - margin * 2);
  const gapX = cols > 1 ? availableX / (cols - 1) : 0;
  const gapZ = rows > 1 ? availableZ / (rows - 1) : 0;

  return {
    x: ((index % cols) - (cols - 1) / 2) * gapX,
    z: (Math.floor(index / cols) - (rows - 1) / 2) * gapZ,
  };
}

/** 由刚体最终姿态计算八面体朝上的面（八分区索引 0-7） */
export function calcFinalUpFace(rotation: THREE.QuaternionLike): number {
  const inv = new THREE.Quaternion(
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
  ).invert();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);
  return (+(up.x > 0) << 2) | (+(up.y > 0) << 1) | +(up.z > 0);
}

/** 将凸包顶点按 scale 预缩放（渲染 Mesh 与物理碰撞体需同步缩放） */
export function scaleHullPoints(points: Float32Array, scale: number): Float32Array {
  if (scale === 1) return points;
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i++) out[i] = points[i] * scale;
  return out;
}
