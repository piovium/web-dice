import * as THREE from "three";
import { DICE_SIZE } from "./config";

const halfSqrt3 = Math.sqrt(3) / 2;

export const diceGeometry = new THREE.OctahedronGeometry(DICE_SIZE);
diceGeometry.addGroup(0, 3, 7);
diceGeometry.addGroup(3, 3, 5);
diceGeometry.addGroup(6, 3, 6);
diceGeometry.addGroup(9, 3, 0);
diceGeometry.addGroup(12, 3, 4);
diceGeometry.addGroup(15, 3, 3);
diceGeometry.addGroup(18, 3, 2);
diceGeometry.addGroup(21, 3, 1);
diceGeometry.setAttribute(
  "uv",
  new THREE.Float32BufferAttribute(
    // prettier-ignore
    [
    halfSqrt3, 0.5,  0, 0,  0, 1,
    halfSqrt3, 0.5,  0, 0,  0, 1,
    halfSqrt3, 0.5,  0, 0,  0, 1,
    halfSqrt3, 0.5,  0, 0,  0, 1,
    halfSqrt3, 0.5,  0, 0,  0, 1,
    halfSqrt3, 0.5,  0, 0,  0, 1,
    halfSqrt3, 0.5,  0, 0,  0, 1,
    halfSqrt3, 0.5,  0, 0,  0, 1,
  ],
    2,
  ),
);
export const diceGeometryPoints = new Float32Array(
  diceGeometry.attributes.position.array,
);
