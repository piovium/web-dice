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
    new THREE.MeshStandardMaterial({ color: "#f0fdf4" }),
  );
  floorMesh.receiveShadow = true;
  floorMesh.position.y = -BOUNDARY_THICKNESS / 2;
  scene.add(floorMesh);
}

const diceMaterials = await getDiceMaterials();

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

export function addDice(
  scene: THREE.Scene,
  targetColor: number,
  preSimulate: SimulateResult,
): THREE.Group {
  // targetColor = [5, 6, 4, 7, 2, 1, 3, 0][targetColor];
  const targetFace = [6, 3, 1, 5, 2, 0, 4, 7][targetColor];
  const { finalUpFace, sleepTime } = preSimulate;

  const diceGroup = new THREE.Group();

  // 每个骰子使用独立的材质数组（避免高亮时互相影响）
  const diceMesh = new THREE.Mesh(
    diceGeometry,
    diceMaterials.map((m) => m.clone()),
  );
  diceMesh.castShadow = true;

  // 施加八面体对称旋转：让 targetColor 的卦限方向对齐到 finalUpFace 的卦限方向
  const correctionRotation = getOctahedralRotation(targetFace, finalUpFace);
  diceMesh.quaternion.copy(correctionRotation);

  diceGroup.add(diceMesh);

  // 高亮：在骰子即将停下前2秒，让朝上的面自发光
  setTimeout(
    () => {
      const materials = diceMesh.material;
      const oldMat = materials[targetColor];
      const mat = oldMat.clone();
      mat.emissive.set(DICE_COLORS[targetColor]);
      mat.needsUpdate = true;
      materials[targetColor] = mat;
      oldMat.dispose();
    },
    sleepTime * 1000 - 2000,
  );

  scene.add(diceGroup);
  return diceGroup;
}
