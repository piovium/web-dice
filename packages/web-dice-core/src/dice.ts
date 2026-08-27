import * as THREE from "three";
import { DICE_COLORS, type DiceTextureSet } from "./textures";
import { diceGeometry } from "./geometry";
import { diceEdgeFragmentShader, diceEdgeVertexShader } from "./shaders/dice-edge.glsl";
import type { DiceSimResult } from "./physics/types";

const GOLD_COLOR = new THREE.Color("#c9a86c");

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

  diceGroup.add(diceMesh);
  diceGroup.scale.setScalar(scale);
  scene.add(diceGroup);

  let isHighlighted = false;

  return {
    group: diceGroup,
    correctionRotation: correctionRotation.clone(),
    highlightAt: Math.max(0, sleepTime - 2),
    setHighlighted() {
      if (isHighlighted) return;
      isHighlighted = true;
      const material = diceMesh.material[targetColor];
      material.uniforms.uEmissiveIntensity.value = 0.9;
      material.uniforms.uBrightness.value = targetColor === 7 ? 1.1 : 1.35;
    },
    dispose() {
      scene.remove(diceGroup);
      for (const material of diceMesh.material) material.dispose();
    },
  };
}
