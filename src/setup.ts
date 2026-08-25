import * as THREE from "three";
import {
  BOUNDARY_THICKNESS,
  CHESSBOARD_LENGTH,
  CHESSBOARD_WIDTH,
} from "./config";
import { DICE_COLORS, getDiceMaterials } from "./textures";
import { diceGeometry } from "./geometries";
import { SimulateResult } from "./physics";

export function addChessboard(scene: THREE.Scene) {
  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      CHESSBOARD_LENGTH,
      BOUNDARY_THICKNESS,
      CHESSBOARD_WIDTH,
    ),
    new THREE.MeshStandardMaterial({
      color: "#0f172a",
      roughness: 0.72,
      metalness: 0.08,
    }),
  );
  floorMesh.receiveShadow = true;
  floorMesh.position.y = -BOUNDARY_THICKNESS / 2;
  scene.add(floorMesh);

  const grid = new THREE.GridHelper(
    Math.min(CHESSBOARD_LENGTH, CHESSBOARD_WIDTH),
    12,
    "#334155",
    "#1e293b",
  );
  grid.position.y = 0.006;
  scene.add(grid);
}

const diceMaterialsPromise = getDiceMaterials();

// 将卦限编码(0-7)转换为方向向量
function octantToVector(octant: number): THREE.Vector3 {
  return new THREE.Vector3(
    octant & 4 ? 1 : -1,
    octant & 2 ? 1 : -1,
    octant & 1 ? 1 : -1,
  ).normalize();
}

// 正八面体的24个合法旋转（对称群）
const OCTAHEDRAL_ROTATIONS: THREE.Quaternion[] = [
  // 恒等
  new THREE.Quaternion(0, 0, 0, 1),

  // 绕坐标轴90°/180°/270°
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2,
  ),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -Math.PI / 2,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  ),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -Math.PI / 2,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    Math.PI / 2,
  ),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    -Math.PI / 2,
  ),

  // 绕体对角线120°/240°
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 1, 1).normalize(),
    (2 * Math.PI) / 3,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 1, 1).normalize(),
    (-2 * Math.PI) / 3,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 1, -1).normalize(),
    (2 * Math.PI) / 3,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 1, -1).normalize(),
    (-2 * Math.PI) / 3,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, -1, 1).normalize(),
    (2 * Math.PI) / 3,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, -1, 1).normalize(),
    (-2 * Math.PI) / 3,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, -1, -1).normalize(),
    (2 * Math.PI) / 3,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, -1, -1).normalize(),
    (-2 * Math.PI) / 3,
  ),

  // 绕边心轴180°
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 1, 0).normalize(),
    Math.PI,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, -1, 0).normalize(),
    Math.PI,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 1).normalize(),
    Math.PI,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, -1).normalize(),
    Math.PI,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 1).normalize(),
    Math.PI,
  ),
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, -1).normalize(),
    Math.PI,
  ),
];

// 获取将 from 卦限映射到 to 卦限的八面体旋转
function getOctahedralRotation(from: number, to: number): THREE.Quaternion {
  if (from === to) return new THREE.Quaternion();

  const vFrom = octantToVector(from);
  const vTo = octantToVector(to);

  for (const q of OCTAHEDRAL_ROTATIONS) {
    const vTest = vFrom.clone().applyQuaternion(q);
    if (vTest.distanceTo(vTo) < 0.001) {
      return q.clone();
    }
  }

  throw new Error(`No octahedral rotation from ${from} to ${to}`);
}

export async function addDice(
  scene: THREE.Scene,
  targetColor: number,
  preSimulate: SimulateResult,
): Promise<DiceHandle> {
  const diceMaterials = await diceMaterialsPromise;
  const targetFace = [6, 3, 1, 0, 2, 5, 4, 7][targetColor];
  const { finalUpFace, sleepTime } = preSimulate;

  const diceGroup = new THREE.Group();

  // 每个骰子使用独立的材质数组（避免高亮时互相影响）
  const diceMesh = new THREE.Mesh(
    diceGeometry,
    diceMaterials.map((m) => m.clone()),
  );
  diceMesh.castShadow = true;

  // 施加八面体对称旋转：让 targetFace 的卦限方向对齐到 finalUpFace 的卦限方向
  const correctionRotation = getOctahedralRotation(targetFace, finalUpFace);
  diceMesh.quaternion.copy(correctionRotation);

  diceGroup.add(diceMesh);

  scene.add(diceGroup);
  let isHighlighted = false;

  return {
    group: diceGroup,
    highlightAt: Math.max(0, sleepTime - 2),
    setHighlighted() {
      if (isHighlighted) return;
      isHighlighted = true;
      const material = diceMesh.material[targetColor];
      material.emissive.set(DICE_COLORS[targetColor]);
      material.emissiveIntensity = 0.42;
      material.needsUpdate = true;
    },
    dispose() {
      scene.remove(diceGroup);
      for (const material of diceMesh.material) material.dispose();
    },
  };
}

export interface DiceHandle {
  group: THREE.Group;
  highlightAt: number;
  setHighlighted: () => void;
  dispose: () => void;
}
