import "./style.css";

import { DICE_COLORS, ELEMENT_NAMES_ZH } from "gi-dice-oimo";
import { WebDice } from "gi-dice-oimo";

const root = document.getElementById("root")!;
const options = document.getElementById("dice-options")!;
const rollButton = document.querySelector<HTMLButtonElement>("#roll-button")!;
const randomButton =
  document.querySelector<HTMLButtonElement>("#random-button")!;
const omniButton = document.querySelector<HTMLButtonElement>("#omni-button")!;
const status = document.getElementById("roll-status")!;

const DICE_COUNT = 8;
/** 小红书面板空间有限：写死 2 轮（首轮聚拢后可点选骰子重投一次，或按钮跳过） */
const ROUNDS = 2;

type Selectors = { label: HTMLLabelElement; select: HTMLSelectElement };
let selectors: Selectors[] = [];

function createResultSelectors(): Selectors[] {
  options.replaceChildren();
  return Array.from({ length: DICE_COUNT }, (_, diceIndex) => {
    const label = document.createElement("label");
    label.className = "dice-option";
    label.style.setProperty("--result-color", DICE_COLORS[diceIndex]);

    const caption = document.createElement("span");
    caption.textContent = `骰子 ${diceIndex + 1}`;

    const select = document.createElement("select");
    select.setAttribute("aria-label", `骰子 ${diceIndex + 1} 的结果`);
    ELEMENT_NAMES_ZH.forEach((name, resultIndex) => {
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

function getSelections(): number[] {
  return selectors.map(({ select }) => Number(select.value));
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

selectors = createResultSelectors();

setControlsDisabled(true);
status.textContent = "正在初始化…";

let dice: WebDice | undefined;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

// webview 里看不到 console，把所有未捕获错误打到状态栏便于排查
function showGlobalError(scope: string) {
  return (error: unknown) => {
    status.textContent = `[${scope}] ${describeError(error)}`.slice(0, 300);
  };
}

window.addEventListener("error", (event) => {
  if (dice) return; // 初始化完成后的事务性错误不打断 UI
  showGlobalError("脚本错误")(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  if (dice) return;
  showGlobalError("异步错误")(event.reason);
});

// WebGL2 能力预检（three r163+ 仅支持 WebGL2）
function checkWebGL(): string | null {
  try {
    const canvas = document.createElement("canvas");
    if (!window.WebGL2RenderingContext) return "环境不支持 WebGL2";
    const gl = canvas.getContext("webgl2");
    if (!gl) return "无法创建 WebGL2 上下文";
    return null;
  } catch (error) {
    return describeError(error);
  }
}

async function init() {
  const webglError = checkWebGL();
  if (webglError) {
    status.textContent = `初始化失败：${webglError}`;
    return;
  }

  // 小红书端为移动端/iPad：不传 boardSize，由引擎按相机可视宽度推导正方形棋盘
  // （恰好贴合屏幕宽度、8 颗骰子不被裁切），且不响应旋转/拖动/缩放手势；
  // 移动端骰子尺寸调小到 0.5 以免拥挤
  dice = await WebDice.create({
    container: root,
    rotatable: false,
    diceSize: 0.5,
    initialResults: Array.from({ length: DICE_COUNT }, (_, i) => i),
  });

  setControlsDisabled(false);
  status.textContent = "选择结果后，点击开始投掷";
}

init().catch((error: unknown) => {
  console.error("Failed to initialize", error);
  status.textContent = `初始化失败：${describeError(error)}`.slice(0, 300);
});

rollButton.addEventListener("click", async () => {
  if (!dice) return;
  setControlsDisabled(true);
  rollButton.classList.add("is-rolling");
  status.textContent = "多轮模式：聚拢后单击骰子选中重投，或点击按钮跳过";
  try {
    const faces = await dice.roll(getSelections(), ROUNDS, (record) => {
      status.textContent = `第 ${record.round} 轮完成${
        record.rerolledIndices.length > 0
          ? `（重投 ${record.rerolledIndices.length} 枚）`
          : ""
      }：${record.faces.map((face) => ELEMENT_NAMES_ZH[face]).join(" · ")}`;
    });
    status.textContent = `结果：${faces
      .map((face) => ELEMENT_NAMES_ZH[face])
      .join(" · ")}`;
  } finally {
    setControlsDisabled(false);
    rollButton.classList.remove("is-rolling");
  }
});

randomButton.addEventListener("click", () => {
  setSelections(
    Array.from({ length: DICE_COUNT }, () =>
      Math.floor(Math.random() * ELEMENT_NAMES_ZH.length),
    ),
  );
  status.textContent = "已生成一组随机结果，点击开始投掷";
});

omniButton.addEventListener("click", () => {
  setSelections(Array(DICE_COUNT).fill(ELEMENT_NAMES_ZH.length - 1));
  status.textContent = "已将全部骰子设为万能元素";
});
