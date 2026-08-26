import "./style.css";

import debounce from "debounce";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  SIMULATE_DT,
  DICE_MASS,
  DICE_RESTITUTION,
  setChessboardSize,
} from "./config";
import {
  GATHER_COLS,
  GATHER_ROWS,
  GATHER_SPACING_X,
  GATHER_SPACING_Z,
  GATHER_Y,
} from "./config";
import { diceGeometryPoints } from "./geometries";
import { PhysicsBackend } from "@dice/physics-backend";
import { calcFinalUpFace, diceInitPosition } from "./physics/shared";
import type { BodyTransform, DiceSimResult, IPhysicsWorld } from "./physics/types";
import { addChessboard, addDice, type DiceHandle } from "./setup";
import { DICE_COLORS } from "./textures";

const RESULT_NAMES = ["冰", "水", "火", "雷", "风", "岩", "草", "万能"];
const DICE_COUNT = 8;

function getGatherSpacing(): { x: number; z: number } {
  const isMobile = window.innerWidth <= 640;
  return {
    x: isMobile ? 2.0 : GATHER_SPACING_X,
    z: isMobile ? 2.0 : GATHER_SPACING_Z,
  };
}


const root = document.getElementById("root")!;
const options = document.getElementById("dice-options")!;
const rollButton = document.querySelector<HTMLButtonElement>("#roll-button")!;
const randomButton = document.querySelector<HTMLButtonElement>("#random-button")!;
const omniButton = document.querySelector<HTMLButtonElement>("#omni-button")!;
const status = document.getElementById("roll-status")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#070b16");
scene.fog = new THREE.Fog("#070b16", 17, 34);

const spotLight = new THREE.SpotLight("#dbeafe", 180);
spotLight.castShadow = true;
spotLight.position.set(2, 13, 4);
spotLight.angle = Math.PI / 4;
spotLight.penumbra = 0.55;
spotLight.lookAt(0, 0, 0);
scene.add(spotLight);

const rimLight = new THREE.DirectionalLight("#7c3aed", 2.4);
rimLight.position.set(-8, 7, -5);
scene.add(rimLight);

const ambientLight = new THREE.AmbientLight("#bfdbfe", 1.3);
scene.add(ambientLight);

// 粉色旋转点光源：绕场景转圈，给骰子表面增加动态粉色反光
const OMNI_LIGHT_COLOR = new THREE.Color("rgb(252, 172, 252)");
const omniLight = new THREE.PointLight(OMNI_LIGHT_COLOR, 80, 16);
const omniLightPivot = new THREE.Group();
omniLight.position.set(3.8, 1.0, 3.8);
omniLightPivot.add(omniLight);
scene.add(omniLightPivot);

const camera = new THREE.PerspectiveCamera(
  40,
  root.clientWidth / root.clientHeight,
  0.1,
  1000,
);
camera.position.set(0, 22, 9);
camera.lookAt(0, 0, 0);

// 根据当前相机视角计算 y=0 平面上可见的世界范围，让碰撞盒刚好等于屏幕可视区域
function computeVisibleWorldBoundsAtY(targetY: number) {
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  const corners = [
    new THREE.Vector3(-1, 1, 0.5),
    new THREE.Vector3(1, 1, 0.5),
    new THREE.Vector3(-1, -1, 0.5),
    new THREE.Vector3(1, -1, 0.5),
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const ndc of corners) {
    const worldPos = ndc.clone().unproject(camera);
    const dir = worldPos.sub(camera.position).normalize();
    const t = (targetY - camera.position.y) / dir.y;
    if (t > 0) {
      const p = camera.position.clone().add(dir.multiplyScalar(t));
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }

  return { minX, maxX, minZ, maxZ };
}

const bounds = computeVisibleWorldBoundsAtY(0);
const visibleWidth = bounds.maxX - bounds.minX;
const margin = visibleWidth * 0.05;
const boardSize = Math.max(4, visibleWidth - margin * 2);

// 把棋盘设为正方形（高度 = 宽度），这样不会占满整个屏幕高度，底部自然留出面板空间
setChessboardSize(boardSize, boardSize);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(root.clientWidth, root.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
root.prepend(renderer.domElement);

const resizeObserver = new ResizeObserver(
  debounce(() => {
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(root.clientWidth, root.clientHeight);
  }, 100),
);
resizeObserver.observe(root);

addChessboard(scene);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 10;
controls.maxDistance = 35;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.y = 0.5;

const backend = new PhysicsBackend();

const selectors = createResultSelectors();
let dice: DiceHandle[] = [];
let simulator: IPhysicsWorld | undefined;
let accumulator = 0;
let simulatedTime = 0;
let totalTime = 0;
let rolling = false;
let physicsReady = false;
let previousFrame = performance.now();

type RollState = "idle" | "rolling" | "gathering" | "done";
let rollState: RollState = "idle";

function createResultSelectors() {
  return Array.from({ length: DICE_COUNT }, (_, diceIndex) => {
    const label = document.createElement("label");
    label.className = "dice-option";
    label.style.setProperty("--result-color", DICE_COLORS[diceIndex]);

    const caption = document.createElement("span");
    caption.textContent = `骰子 ${diceIndex + 1}`;

    const select = document.createElement("select");
    select.setAttribute("aria-label", `骰子 ${diceIndex + 1} 的结果`);
    RESULT_NAMES.forEach((name, resultIndex) => {
      const option = document.createElement("option");
      option.value = String(resultIndex);
      option.textContent = name;
      select.append(option);
    });
    select.value = String(diceIndex);
    select.addEventListener("change", () => {
      label.style.setProperty("--result-color", DICE_COLORS[Number(select.value)]);
    });

    label.append(caption, select);
    options.append(label);
    return { label, select };
  });
}

function setSelections(values: number[]) {
  selectors.forEach(({ label, select }, index) => {
    const value = values[index];
    select.value = String(value);
    label.style.setProperty("--result-color", DICE_COLORS[value]);
  });
}

function setControlsDisabled(disabled: boolean) {
  rollButton.disabled = disabled;
  randomButton.disabled = disabled;
  omniButton.disabled = disabled;
  selectors.forEach(({ select }) => (select.disabled = disabled));
}

function preSimulate(diceCount: number): DiceSimResult[] {
  const initRotations = Array.from(
    { length: diceCount },
    () => new THREE.Quaternion().random() as THREE.QuaternionLike,
  );
  const world = backend.createWorld({
    diceCount,
    initRotations,
    convexHullPoints: diceGeometryPoints,
    worldConfig: { gravity: [0, -9.81, 0], timestep: SIMULATE_DT },
    colliderConfig: {
      shape: { kind: "convexHull", points: diceGeometryPoints },
      mass: DICE_MASS,
      restitution: DICE_RESTITUTION,
    },
  });

  const results: (DiceSimResult | undefined)[] = Array(diceCount).fill(undefined);
  let time = 0;
  let transforms: BodyTransform[] = [];

  while (results.some((r) => !r)) {
    transforms = world.step();
    time += SIMULATE_DT;
    for (let i = 0; i < diceCount; i++) {
      if (results[i]) continue;
      if (world.isSleeping(i)) {
        results[i] = {
          initRotation: initRotations[i],
          finalUpFace: calcFinalUpFace(transforms[i].rotation),
          sleepTime: time,
        };
      }
    }
  }

  world.dispose();
  return results as DiceSimResult[];
}

function createSimulator(initRotations: THREE.QuaternionLike[]): IPhysicsWorld {
  return backend.createWorld({
    diceCount: initRotations.length,
    initRotations,
    convexHullPoints: diceGeometryPoints,
    worldConfig: { gravity: [0, -9.81, 0], timestep: SIMULATE_DT },
    colliderConfig: {
      shape: { kind: "convexHull", points: diceGeometryPoints },
      mass: DICE_MASS,
      restitution: DICE_RESTITUTION,
    },
  });
}

function getGatherTarget(index: number): { x: number; y: number; z: number } {
  const spacing = getGatherSpacing();
  const col = index % GATHER_COLS;
  const row = Math.floor(index / GATHER_COLS);
  const totalWidth = (GATHER_COLS - 1) * spacing.x;
  const totalDepth = (GATHER_ROWS - 1) * spacing.z;
  return {
    x: col * spacing.x - totalWidth / 2,
    y: GATHER_Y,
    z: row * spacing.z - totalDepth / 2,
  };
}

async function startRoll() {
  if (rollState !== "idle" && rollState !== "done") return;
  if (!physicsReady) return;

  rollState = "rolling";
  rolling = true;
  setControlsDisabled(true);
  rollButton.classList.add("is-rolling");
  status.textContent = "正在计算这次投掷…";

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const targets = selectors.map(({ select }) => Number(select.value));
  const result = preSimulate(DICE_COUNT);

  dice.forEach((handle) => handle.dispose());
  dice = await Promise.all(
    result.map((simulation, index) => addDice(scene, targets[index], simulation)),
  );
  simulator = createSimulator(result.map(({ initRotation }) => initRotation));
  accumulator = 0;
  simulatedTime = 0;
  totalTime = result.reduce(
    (longest, simulation) => Math.max(longest, simulation.sleepTime),
    0,
  );
  previousFrame = performance.now();
  status.textContent = "投掷中…";
}

function finishRoll() {
  rolling = false;
  simulator = undefined;
  rollState = "gathering";
  status.textContent = "聚拢中…";
}

function animate(now: number) {
  const frameDelta = Math.min((now - previousFrame) / 1000, 0.1);
  previousFrame = now;

  if (rollState === "rolling" && simulator) {
    accumulator += frameDelta;
    while (accumulator >= SIMULATE_DT && simulatedTime < totalTime) {
      const transforms = simulator.step();
      simulatedTime += SIMULATE_DT;

      dice.forEach((handle, index) => {
        const transform = transforms[index];
        handle.group.position.copy(transform.translation);
        handle.group.quaternion.copy(transform.rotation);
        if (simulatedTime >= handle.highlightAt) handle.setHighlighted();
      });
      accumulator -= SIMULATE_DT;
    }

    if (simulatedTime >= totalTime) finishRoll();
  }

  if (rollState === "gathering") {
    let allSettled = true;
    const lerpFactor = 1 - Math.pow(0.001, frameDelta);

    dice.forEach((handle, index) => {
      const target = getGatherTarget(index);
      const pos = handle.group.position;

      pos.x += (target.x - pos.x) * lerpFactor;
      pos.z += (target.z - pos.z) * lerpFactor;
      pos.y += (target.y - pos.y) * lerpFactor;

      if (
        Math.abs(pos.x - target.x) > 0.01 ||
        Math.abs(pos.z - target.z) > 0.01 ||
        Math.abs(pos.y - target.y) > 0.01
      ) {
        allSettled = false;
      }
    });

    if (allSettled) {
      rollState = "done";
      setControlsDisabled(false);
      rollButton.classList.remove("is-rolling");
      status.textContent = `结果：${selectors
        .map(({ select }) => RESULT_NAMES[Number(select.value)])
        .join(" · ")}`;
    }
  }

  omniLightPivot.rotation.y += 1.2 * frameDelta;

  controls.update();
  renderer.render(scene, camera);
}

rollButton.addEventListener("click", startRoll);
randomButton.addEventListener("click", () => {
  setSelections(
    Array.from({ length: DICE_COUNT }, () =>
      Math.floor(Math.random() * RESULT_NAMES.length),
    ),
  );
  status.textContent = "已生成一组随机结果，点击开始投掷";
});
omniButton.addEventListener("click", () => {
  setSelections(Array(DICE_COUNT).fill(RESULT_NAMES.length - 1));
  status.textContent = "已将全部骰子设为万能元素";
});

renderer.setAnimationLoop(animate);

setControlsDisabled(true);
status.textContent = "正在加载物理引擎…";
backend
  .init()
  .then(() => {
    physicsReady = true;
    rollState = "idle";
    setControlsDisabled(false);
    status.textContent = "选择结果后，点击开始投掷";
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize the physics engine", error);
    status.textContent = "物理引擎加载失败，请刷新页面重试";
  });
