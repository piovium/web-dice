import "./style.css";

import {
  DICE_COLORS,
  ELEMENT_NAMES_ZH,
} from "web-dice";
import { WebDice } from "web-dice";

const root = document.getElementById("root")!;
const options = document.getElementById("dice-options")!;
const rollButton = document.querySelector<HTMLButtonElement>("#roll-button")!;
const randomButton =
  document.querySelector<HTMLButtonElement>("#random-button")!;
const omniButton = document.querySelector<HTMLButtonElement>("#omni-button")!;
const roundsSelect = document.querySelector<HTMLSelectElement>(
  "#rounds-select",
)!;
const speedSelect =
  document.querySelector<HTMLSelectElement>("#speed-select")!;
const status = document.getElementById("roll-status")!;

const DICE_COUNT = 8;

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
  roundsSelect.disabled = disabled;
  speedSelect.disabled = disabled;
  selectors.forEach(({ select }) => (select.disabled = disabled));
}

selectors = createResultSelectors();

setControlsDisabled(true);
status.textContent = "正在加载物理引擎…";

const dice = await WebDice.create({
  container: root,
  rotatable: true, // demo 需要手势交互；组件默认 false（不响应手势）
  showGrid: true, // demo 展示棋盘网格；组件默认 false
  diceSize: 0.8, // 桌面端适中尺寸：过大时重投停靠列会太长且间隙显大
  // 桌面端显式长方形棋盘：默认按屏宽推导的正方形会超出屏幕高度且显得空旷，
  // 12×8 世界单位保证棋盘完整可见，初始投掷散点也不会贴到上下边缘
  boardSize: [12, 8] as const,
  initialResults: Array.from({ length: DICE_COUNT }, (_, i) => i),
});

setControlsDisabled(false);
status.textContent = "选择结果后，点击开始投掷";

// 速度立即生效（对进行中的投掷同样有效）
speedSelect.addEventListener("change", () => {
  dice.setSpeed(Number(speedSelect.value));
});

rollButton.addEventListener("click", async () => {
  setControlsDisabled(true);
  rollButton.classList.add("is-rolling");
  const rounds = Number(roundsSelect.value);
  status.textContent =
    rounds > 1
      ? "多轮模式：聚拢后单击骰子选中重投，或点击按钮跳过"
      : "正在计算这次投掷…";
  try {
    const faces = await dice.roll(getSelections(), rounds, (record) => {
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
