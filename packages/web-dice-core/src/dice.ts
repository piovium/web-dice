import * as THREE from "three";
import { DICE_COLORS, type DiceTextureSet } from "./textures";
import { diceGeometry } from "./geometry";
import { diceEdgeFragmentShader, diceEdgeVertexShader } from "./shaders/dice-edge.glsl";
import type { DiceSimResult } from "./physics/types";

const GOLD_COLOR = new THREE.Color("#c9a86c");

/** 选中态描边圈颜色（淡黄色） */
const SELECTED_COLOR = "#ffe98f";
/** 选中描边相对骰子本体的放大比例（决定描边圈宽度，越小越紧凑） */
const SELECTED_OUTLINE_SCALE = 1.08;

function octantToVector(octant: number): THREE.Vector3 {
  return new THREE.Vector3(
    octant & 4 ? 1 : -1,
    octant & 2 ? 1 : -1,
    octant & 1 ? 1 : -1,
  ).normalize();
}

const OCTAHEDRAL_ROTATIONS: THREE.Quaternion[] = [
  new THREE.Quaternion(0, 0, 0, 1),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 1).normalize(), (2 * Math.PI) / 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 1).normalize(), (-2 * Math.PI) / 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, -1).normalize(), (2 * Math.PI) / 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, -1).normalize(), (-2 * Math.PI) / 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, -1, 1).normalize(), (2 * Math.PI) / 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, -1, 1).normalize(), (-2 * Math.PI) / 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, -1, -1).normalize(), (2 * Math.PI) / 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, -1, -1).normalize(), (-2 * Math.PI) / 3),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, -1, 0).normalize(), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 1).normalize(), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, -1).normalize(), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 1).normalize(), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, -1).normalize(), Math.PI),
];

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

function createDiceShaderMaterial(
  map: THREE.Texture,
  emissiveMap: THREE.Texture,
  colorIndex: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: diceEdgeVertexShader,
    fragmentShader: diceEdgeFragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color("#ffffff") },
      uGoldColor: { value: GOLD_COLOR },
      uEdgeWidth: { value: 0.08 },
      uVertexWidth: { value: 0.3 },
      uEdgeIntensity: { value: 1.5 },
      uEmissiveColor: { value: new THREE.Color(DICE_COLORS[colorIndex]) },
      uEmissiveIntensity: { value: 0.0 },
      uBrightness: { value: 1.0 },
      uMap: { value: map },
      uEmissiveMap: { value: emissiveMap },
    },
  });
}

export interface DiceHandle {
  group: THREE.Group;
  correctionRotation: THREE.Quaternion;
  highlightAt: number;
  setHighlighted: () => void;
  /** 重投结算后按实际朝上的元素重新点亮对应面（熄灭旧面） */
  setFaceGlow: (element: number) => void;
  /** 选中态切换：淡黄色描边圈包裹轮廓（不改变任何面的外观） */
  setSelected: (selected: boolean) => void;
  /** 计算把当前朝上面经最短弧旋转至精确朝上的目标 group 旋转（聚拢摆平用，不改变结果面） */
  computeFlattenTarget: () => THREE.Quaternion;
  dispose: () => void;
}

/** 目标色 → 实际渲染朝上面的映射（八面体分组顺序） */
const TARGET_FACE_MAP = [6, 3, 1, 0, 2, 5, 4, 7];

export async function addDice(
  scene: THREE.Scene,
  textures: DiceTextureSet[],
  targetColor: number,
  preSimulate: DiceSimResult,
  scale: number,
): Promise<DiceHandle> {
  const targetFace = TARGET_FACE_MAP[targetColor];
  const { finalUpFace, sleepTime } = preSimulate;

  const diceGroup = new THREE.Group();

  const diceMesh = new THREE.Mesh(
    diceGeometry,
    textures.map(({ map, emissiveMap }, i) =>
      createDiceShaderMaterial(map, emissiveMap, i),
    ),
  );
  diceMesh.castShadow = true;

  const correctionRotation = getOctahedralRotation(targetFace, finalUpFace);
  diceMesh.quaternion.copy(correctionRotation);

  // 选中描边：略微放大的背面外壳（inverted hull），只露出轮廓外一圈淡黄高光，
  // 视角无关、宽度紧凑；不选中时完全不可见也不参与渲染
  const outlineMesh = new THREE.Mesh(
    diceGeometry,
    new THREE.MeshBasicMaterial({
      color: SELECTED_COLOR,
      side: THREE.BackSide,
      fog: false,
    }),
  );
  outlineMesh.scale.setScalar(SELECTED_OUTLINE_SCALE);
  outlineMesh.visible = false;
  outlineMesh.castShadow = false;
  diceMesh.add(outlineMesh);

  diceGroup.add(diceMesh);
  diceGroup.scale.setScalar(scale);
  scene.add(diceGroup);

  // 面发光状态：null = 未点亮；否则为当前发光的元素面索引
  let glowFace: number | null = null;
  let selected = false;

  const setFaceGlowIntensity = (element: number, glowing: boolean) => {
    const material = diceMesh.material[element];
    material.uniforms.uEmissiveIntensity.value = glowing ? 0.9 : 0;
    material.uniforms.uBrightness.value = glowing
      ? element === 7
        ? 1.1
        : 1.35
      : 1.0;
  };

  return {
    group: diceGroup,
    correctionRotation: correctionRotation.clone(),
    highlightAt: Math.max(0, sleepTime - 2),
    setHighlighted() {
      if (glowFace !== null) return;
      glowFace = targetColor;
      setFaceGlowIntensity(targetColor, true);
    },
    setFaceGlow(element: number) {
      if (glowFace !== null && glowFace !== element) {
        setFaceGlowIntensity(glowFace, false);
      }
      glowFace = element;
      setFaceGlowIntensity(element, true);
    },
    setSelected(value: boolean) {
      if (selected === value) return;
      selected = value;
      outlineMesh.visible = value;
    },
    computeFlattenTarget() {
      // 当前朝上八分区：世界 up 变换到 mesh 空间后的符号位八分区
      const worldToMesh = new THREE.Quaternion()
        .multiplyQuaternions(diceGroup.quaternion, correctionRotation)
        .invert();
      const upLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(worldToMesh);
      const octant =
        ((upLocal.x > 0 ? 1 : 0) << 2) |
        ((upLocal.y > 0 ? 1 : 0) << 1) |
        (upLocal.z > 0 ? 1 : 0);
      // 该八分区面法线的当前世界方向，经最短弧旋转到精确 +Y（保持水平朝向不变）
      const faceDir = octantToVector(octant)
        .applyQuaternion(correctionRotation)
        .applyQuaternion(diceGroup.quaternion)
        .normalize();
      const flatten = new THREE.Quaternion().setFromUnitVectors(
        faceDir,
        new THREE.Vector3(0, 1, 0),
      );
      return flatten.multiply(diceGroup.quaternion.clone());
    },
    dispose() {
      scene.remove(diceGroup);
      outlineMesh.material.dispose();
      for (const material of diceMesh.material) material.dispose();
    },
  };
}

/**
 * 由骰子静止后的刚体姿态与创建时的校正旋转，推导实际朝上的元素面索引。
 * 重投走实时物理（非记录重放），结果由物理决定：校正旋转 c 是八面体群旋转，
 * 会把某个元素的目标八分区恰好转到最终朝上的八分区 f 上。
 */
export function deriveUpFaceElement(
  correction: THREE.Quaternion,
  finalUpOctant: number,
): number {
  const upLocal = octantToVector(finalUpOctant).applyQuaternion(
    correction.clone().invert(),
  );
  for (let element = 0; element < 8; element++) {
    if (octantToVector(TARGET_FACE_MAP[element]).distanceTo(upLocal) < 0.001) {
      return element;
    }
  }
  return 0;
}
