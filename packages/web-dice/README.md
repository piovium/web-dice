# gi-dice

七圣召唤风格的八面体元素骰组件：真实物理投掷动画（Rapier / WASM 后端），指定结果必中（预模拟 + 朝向校正），渲染为一个可嵌入任意页面的 canvas。

纯 JS / 离线场景请使用接口完全一致的姊妹包 [gi-dice-oimo](https://www.npmjs.com/package/gi-dice-oimo)。

## 安装

```bash
npm install gi-dice three
```

`three` 是 peerDependency（>= 0.160.0），需自行安装。物理引擎 `@dimforge/rapier3d-compat` 随包分发（WASM 已 base64 内联，无需额外 `.wasm` 文件）。

## 快速开始

```ts
import { WebDice } from "gi-dice";

const dice = await WebDice.create({
  container: document.getElementById("stage")!,
});

// 随机投掷 8 颗，resolve 最终朝上面索引（0–7），按聚拢展示顺序排列（万能优先）
const faces = await dice.roll();

// 指定结果：长度即骰子数量（1–16），元素为面索引 0–7
await dice.roll([0, 1, 2, 3, 4, 5, 6, 7]);

// 多轮模式：3 轮重投，每轮聚拢后可点选骰子重掷
await dice.roll(undefined, 3, (record) => {
  console.log(`第 ${record.round} 轮`, record.faces);
});
```

## API

### `WebDice.create(options: WebDiceOptions): Promise<WebDice>`

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `container` | `HTMLElement` | 必填 | 挂载容器，canvas 会被 prepend 进去 |
| `boardSize` | `number \| [l, w] \| "18x12"` | 屏幕宽正方形 | 棋盘大小（世界单位） |
| `tableTexture` | `string \| HTMLImageElement \| HTMLCanvasElement \| null` | `null` | 桌面贴图（`transparent` 模式下无效） |
| `showGrid` | `boolean` | `false` | 是否显示棋盘网格线 |
| `transparent` | `boolean` | `false` | 透明模式：背景与地板全透明（保留骰子投影），可把 canvas 叠在自己的内容上 |
| `rotatable` | `boolean` | `false` | 是否响应手势（旋转 + 缩放） |
| `speed` | `number` | `1` | 投掷动画倍速，1–10 的整数 |
| `rounds` | `number` | `1` | 默认掷骰轮数；`roll()` 未显式传 rounds 时生效 |
| `initialResults` | `readonly number[]` | 8 颗 0–7 | 初始结果，长度即骰子数量（1–16） |
| `faceAssets` | `DiceFaceAssets` | CDN + 内联混合 | 覆盖默认骰面贴图来源 |
| `diceSize` | `number` | `0.6` | 骰子尺寸（世界单位） |

非法参数（数量越界、面索引越界、speed/rounds 非整数等）会抛 `RangeError`。

### 实例方法

- `roll(results?, rounds?, onRoundComplete?): Promise<number[]>` — 投掷。`results` 缺省时按构造骰子数量随机；`rounds` 缺省用构造选项的 `rounds`。`rounds > 1` 进入多轮模式：每轮聚拢后单击骰子选中重投，或点击按钮跳过。返回按聚拢展示顺序排序的面索引（万能 `7` 最优先，其余升序）。投掷进行中重复调用会被忽略并返回进行中的同一 Promise。
- `setSpeed(speed)` — 运行时调整倍速（1–10 整数），对进行中的投掷立即生效。
- `setRotatable(rotatable)` — 运行时开/关手势响应。
- `setTableTexture(texture)` — 替换桌面贴图；传 `null` 恢复默认深色桌面。
- `resize()` — 容器尺寸变化后调用（内部有 ResizeObserver 兜底）。
- `dispose()` — 释放资源、移除 canvas、终止动画循环。

### 其他导出

`ELEMENT_NAMES_ZH` / `ELEMENT_NAMES_EN` / `ELEMENT_NAMES`（面索引 0–7 的中英名称）、`DICE_COLORS`、`MIN_DICE_COUNT` / `MAX_DICE_COUNT`、`parseBoardSize`，以及 `BoardSize` / `DiceFaceAssets` / `DiceRoundRecord` 等类型。

### 彩蛋

一次投掷结果全为「万能」（索引 7）时，场景会点亮绕场旋转的粉色点光。

## License

[AGPL-3.0-only](./LICENSE)
