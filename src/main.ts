import "./style.css";

import debounce from "debounce";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { SIMULATE_DT } from "./config";
import { initializePhysics, preSimulate, simulate } from "./physics";
import { addChessboard, addDice, type DiceHandle } from "./setup";
import { DICE_COLORS } from "./textures";

const RESULT_NAMES = ["冰", "水", "火", "雷", "风", "岩", "草", "万能"];
const DICE_COUNT = 8;

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

const camera = new THREE.PerspectiveCamera(
  50,
  root.clientWidth / root.clientHeight,
  0.1,
  1000,
);
camera.position.set(0, 15.5, 7.5);
camera.lookAt(0, 0, 0);

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
controls.minDistance = 8;
controls.maxDistance = 26;
controls.maxPolarAngle = Math.PI * 0.47;
controls.target.y = 0.8;

const selectors = createResultSelectors();
let dice: DiceHandle[] = [];
let simulator: ReturnType<typeof simulate> | undefined;
let accumulator = 0;
let simulatedTime = 0;
let totalTime = 0;
let rolling = false;
let physicsReady = false;
let previousFrame = performance.now();

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

async function startRoll() {
  if (rolling || !physicsReady) return;

  rolling = true;
  setControlsDisabled(true);
  rollButton.classList.add("is-rolling");
  status.textContent = "正在计算这次投掷…";

  // Let the loading state paint before the deterministic pre-simulation runs.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const targets = selectors.map(({ select }) => Number(select.value));
  const result = preSimulate(DICE_COUNT);

  dice.forEach((handle) => handle.dispose());
  dice = await Promise.all(
    result.map((simulation, index) =>
      addDice(scene, targets[index], simulation),
    ),
  );
  simulator = simulate(result.map(({ initRotation }) => initRotation));
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
  setControlsDisabled(false);
  rollButton.classList.remove("is-rolling");
  status.textContent = `结果：${selectors
    .map(({ select }) => RESULT_NAMES[Number(select.value)])
    .join(" · ")}`;
}

function animate(now: number) {
  const frameDelta = Math.min((now - previousFrame) / 1000, 0.1);
  previousFrame = now;

  if (rolling && simulator) {
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
initializePhysics()
  .then(() => {
    physicsReady = true;
    setControlsDisabled(false);
    status.textContent = "选择结果后，点击开始投掷";
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize the physics engine", error);
    status.textContent = "物理引擎加载失败，请刷新页面重试";
  });
