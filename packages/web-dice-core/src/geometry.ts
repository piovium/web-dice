import * as THREE from "three";
import { DICE_SIZE } from "./config";

// UV 等边三角形：顶角朝上（指向极点），底边朝下（赤道方向）
// 重心落在纹理中心 (0.5, 0.5)
const uvTop = 1.0;
const uvBase = 0.25;
const uvLeft = (1 - Math.sqrt(3) / 2) / 2;
const uvRight = 1 - uvLeft;

function isPoleVertex(x: number, y: number, z: number): boolean {
  return (
    Math.abs(Math.abs(y) - DICE_SIZE) < 0.01 &&
    Math.abs(x) < 0.01 &&
    Math.abs(z) < 0.01
  );
}

export const diceGeometry = new THREE.OctahedronGeometry(DICE_SIZE);

// 分组顺序决定哪个目标色对应哪张面
const groups = [7, 5, 6, 0, 4, 3, 2, 1];
diceGeometry.clearGroups();
for (let i = 0; i < 8; i++) {
  diceGeometry.addGroup(i * 3, 3, groups[i]);
}

const positions = diceGeometry.attributes.position.array as Float32Array;
const vertexCount = diceGeometry.attributes.position.count;
const uvs = new Float32Array(vertexCount * 2);
const barycentrics = new Float32Array(vertexCount * 3);
const isPole = new Float32Array(vertexCount * 3);

for (let f = 0; f < 8; f++) {
  const faceBase = f * 3;

  let poleIndex = -1;
  for (let v = 0; v < 3; v++) {
    const idx = (faceBase + v) * 3;
    if (isPoleVertex(positions[idx], positions[idx + 1], positions[idx + 2])) {
      poleIndex = v;
      break;
    }
  }

  const writeUv = (vertIdx: number, u: number, v: number) => {
    const i = (faceBase + vertIdx) * 2;
    uvs[i] = u;
    uvs[i + 1] = v;
  };

  if (poleIndex === 0) {
    writeUv(0, 0.5, uvTop);
    writeUv(1, uvLeft, uvBase);
    writeUv(2, uvRight, uvBase);
  } else if (poleIndex === 1) {
    writeUv(0, uvRight, uvBase);
    writeUv(1, 0.5, uvTop);
    writeUv(2, uvLeft, uvBase);
  } else {
    writeUv(0, uvLeft, uvBase);
    writeUv(1, uvRight, uvBase);
    writeUv(2, 0.5, uvTop);
  }

  for (let v = 0; v < 3; v++) {
    const globalIdx = faceBase + v;
    const triVert = globalIdx % 3;
    const posIdx = globalIdx * 3;

    barycentrics[globalIdx * 3 + triVert] = 1.0;
    if (isPoleVertex(positions[posIdx], positions[posIdx + 1], positions[posIdx + 2])) {
      isPole[globalIdx * 3 + triVert] = 1.0;
    }
  }
}

diceGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
diceGeometry.setAttribute(
  "aBarycentric",
  new THREE.Float32BufferAttribute(barycentrics, 3),
);
diceGeometry.setAttribute(
  "aIsPole",
  new THREE.Float32BufferAttribute(isPole, 3),
);

export const diceGeometryPoints = new Float32Array(
  diceGeometry.attributes.position.array,
);
