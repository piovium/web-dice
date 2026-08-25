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
  const diceInitCols = Math.min(total, 4);
  const diceInitRows = Math.ceil(total / diceInitCols);
  const diceColsGap = 3;
  const diceRowsGap = 4;
  return {
    x: ((index % diceInitCols) - (diceInitCols - 1) / 2) * diceColsGap,
    z: (Math.floor(index / diceInitCols) - (diceInitRows - 1) / 2) * diceRowsGap,
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
