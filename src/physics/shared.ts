import * as THREE from "three";
import {
  BOUNDARY_THICKNESS,
  CHESSBOARD_LENGTH,
  CHESSBOARD_WIDTH,
} from "../config";

export function diceInitPosition(
  index: number,
  total: number,
): { x: number; z: number } {
  const cols = Math.min(total, 4);
  const rows = Math.ceil(total / cols);

  // 让初始位置在棋盘范围内，留出墙边距
  const margin = 1.2;
  const availableX = Math.max(0.1, CHESSBOARD_LENGTH - margin * 2);
  const availableZ = Math.max(0.1, CHESSBOARD_WIDTH - margin * 2);
  const gapX = cols > 1 ? availableX / (cols - 1) : 0;
  const gapZ = rows > 1 ? availableZ / (rows - 1) : 0;

  return {
    x: ((index % cols) - (cols - 1) / 2) * gapX,
    z: (Math.floor(index / cols) - (rows - 1) / 2) * gapZ,
  };
}

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
