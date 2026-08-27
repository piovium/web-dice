# web-dice 拆包方案：`web-dice`（WASM）与 `web-dice-oimo`（纯 JS）

> 目标：将现有单页应用重构为两个**接口与功能完全一致**的 npm 包，均对外提供"渲染一个掷骰 canvas"的组件能力；
> 调用方可配置：棋盘大小、桌面贴图、棋盘是否可转动、初始七圣骰子结果及数量（1–16 个）。
> 根目录 `index.html` 与 `minitool/index.html` 分别重构为使用 `web-dice` 与 `web-dice-oimo` 的调用方示例。

---

## 一、现状分析

### 1.1 现有模块职责

| 模块 | 职责 | 拆包去向 |
|------|------|----------|
| `src/main.ts` | 场景/灯光/相机/OrbitControls、投掷状态机（rolling → gathering → done）、preSimulate 编排 | 抽成 core 的 `DiceRenderer` 引擎类 |
| `src/physics/types.ts` | `IPhysicsBackend` / `IPhysicsWorld` 抽象接口 | core |
| `src/physics/rapier-backend.ts` | Rapier（WASM）实现 | `web-dice` 包 |
| `src/physics/oimo-backend.ts` | OimoPhysics（纯 JS）实现 | `web-dice-oimo` 包 |
| `src/physics/shared.ts` | `diceInitPosition` / `calcFinalUpFace` | core（需去全局化） |
| `src/config.ts` | **模块级可变全局变量**（`setChessboardSize`） | core（需重构为实例配置） |
| `src/setup.ts` | 棋盘网格、骰子 Mesh（八面体 + 金边 shader + 八面体朝向校正） | core |
| `src/geometries.ts` | 八面体几何 + UV + barycentric attribute | core |
| `src/textures.ts` | canvas 绘制骰面贴图（本地 assets webp/svg） | core（需资源打包策略） |
| `src/shaders/dice-edge.glsl.ts` | 镶金边 shader | core |
| `src/style.css`、两个 `index.html` | 页面 UI（控制面板等） | 留在调用方 app |

### 1.2 阻碍拆包的关键问题

1. **`config.ts` 是模块级可变单例**：`setChessboardSize()` 修改全局 `CHESSBOARD_LENGTH/WIDTH`，`physics/shared.ts`、`rapier-backend.ts`、`oimo-backend.ts`、`setup.ts` 都直接 import 读全局。包内多实例、调用方指定棋盘大小都必须改为**配置对象显式传参**。
2. **`main.ts` 是硬编码过程式入口**：固定 `DICE_COUNT = 8`、固定 UI DOM（`#dice-options` 等由 main.ts 自己创建 selector）、相机自适应棋盘尺寸逻辑与渲染耦合。需要抽成可实例化、可配置、无 UI 依赖的引擎类。
3. **贴图资源路径是相对 URL**（`./assets/dice/*.webp`）：包化后必须解决资源随包分发问题（见 §四）。
4. **聚拢布局固定 4×2**（`GATHER_COLS/ROWS`）：支持 1–16 颗骰子需按数量自适应排布。
5. **构建期 alias 切换后端**（`@dice/physics-backend`）：拆包后改为"每个包内置自己的后端"，alias 机制仅保留给 app 层（可选）。

---

## 二、目标架构

采用 **pnpm workspace monorepo**：共享渲染内核收进一个内部包 `web-dice-core`，两个公开包只负责"注入各自物理后端 + 打包资源 + 导出统一 API"。避免复制两份渲染代码导致接口漂移。

```
web-dice/
├── pnpm-workspace.yaml
├── packages/
│   ├── web-dice-core/          # 内部包（不发布或 private）
│   │   ├── src/
│   │   │   ├── renderer.ts     # DiceRenderer 引擎类（原 main.ts 场景+状态机）
│   │   │   ├── board.ts        # 棋盘（原 setup.ts addChessboard，支持桌面贴图）
│   │   │   ├── dice.ts         # 骰子创建（原 setup.ts addDice + DiceHandle）
│   │   │   ├── geometry.ts     # 原 geometries.ts
│   │   │   ├── textures.ts     # 原textures.ts（资源改为打包内联/随包分发）
│   │   │   ├── shaders/dice-edge.glsl.ts
│   │   │   ├── physics/
│   │   │   │   ├── types.ts    # IPhysicsBackend / IPhysicsWorld / 配置类型
│   │   │   │   └── shared.ts   # diceInitPosition(board, i, n) / calcFinalUpFace
│   │   │   ├── config.ts       # DiceConfig 接口 + 默认值（不可变，实例内传递）
│   │   │   └── index.ts        # 导出公共类型与 DiceRenderer
│   │   └── package.json        # private: true；deps: three
│   │
│   ├── web-dice/               # 公开包 1：WASM（Rapier）后端
│   │   ├── src/index.ts        # export { WebDice } from core + RapierBackend
│   │   ├── rapier-backend.ts   # 原 physics/rapier-backend.ts（配置改为传参）
│   │   └── package.json        # name: "web-dice"；deps: three(peer), web-dice-core, @dimforge/rapier3d-compat
│   │
│   └── web-dice-oimo/          # 公开包 2：纯 JS（OimoPhysics）后端
│       ├── src/index.ts        # export { WebDice } from core + OimoBackend
│       ├── oimo-backend.ts     # 原 physics/oimo-backend.ts（配置改为传参）
│       └── package.json        # name: "web-dice-oimo"；deps: three(peer), web-dice-core, oimophysics
│
├── apps/
│   ├── web/                    # 原 index.html + src/main.ts 的 UI 壳
│   │   ├── index.html
│   │   └── src/main.ts         # 只做 UI：控制面板 + new WebDice({ ... }) 调用
│   └── minitool/               # 原小红书小工具壳
│       ├── index.html
│       └── src/main.ts         # 同样的 UI 代码，但 import "web-dice-oimo"
│
├── scripts/                    # 保留 package-minitool.mjs（路径调整）
├── vite.config.*.ts            # 每个 app 一个构建配置（见 §六）
└── doc/
```

> 若坚持"只出两个包"，也可把 core 直接作为 `web-dice` 的 `src/core/`、`web-dice-oimo` 通过 `pnpm` 引用 `web-dice` 的 core 子路径导出；但独立 core 包更清晰，推荐前者。

---

## 三、统一公开 API 设计（两个包完全一致）

两个包导出**同名同类** `WebDice`，仅内部物理后端不同。`web-dice` 因 Rapier WASM 需要异步 init，因此统一用 `WebDice.create()` 工厂（Oimo 包内 `init()` 为空实现，签名一致）。

```ts
// web-dice 与 web-dice-oimo 均导出：
/** 面索引 0..7 的中英双语名称 */
export const ELEMENT_NAMES_ZH = ["冰","水","火","雷","风","岩","草","万能"] as const;
export const ELEMENT_NAMES_EN = ["Cryo","Hydro","Pyro","Electro","Anemo","Geo","Dendro","Omni"] as const;
export const ELEMENT_NAMES: ReadonlyArray<{ zh: string; en: string }> =
  ELEMENT_NAMES_ZH.map((zh, i) => ({ zh, en: ELEMENT_NAMES_EN[i] }));

/**
 * 棋盘尺寸。单位：three.js 场景的世界单位（world unit，无量纲，与渲染/物理同一坐标系）。
 * 参照物：默认骰子外接尺寸 DICE_SIZE = 0.75 世界单位（八面体对角线 1.5），
 * 现 demo 棋盘为 18×12 世界单位，边界墙高 20。
 * 取值范围建议 [8, 30]，过大/过小会导致相机、墙高比例失真（见 §九-3）。
 *
 * 形式：
 *  - number            → 正方形边长（length = width = value）
 *  - [length, width]   → 长方形（length 对应 x 轴，width 对应 z 轴）
 *  - "18x12" / "18*12" → 长方形字符串（同样以世界单位解析）
 * 默认（不传）：以容器窄边换算成世界单位后的正方形（沿用现 demo 的可视区域逻辑，封顶 30）。
 */
export type BoardSize = number | readonly [number, number] | string;

export interface WebDiceOptions {
  /** 挂载容器，包在内部创建 canvas 并追加（或由调用方传入 canvas） */
  container: HTMLElement;

  /** 棋盘大小（世界单位，见 BoardSize 注释），默认容器窄边正方形 */
  boardSize?: BoardSize;

  /** 桌面贴图：图片 URL / 已加载的图片 / canvas / null（保持默认深色网格桌面） */
  tableTexture?: string | HTMLImageElement | HTMLCanvasElement | null;

  /**
   * 是否响应用户手势：同时控制 OrbitControls 的旋转（拖动）与缩放（滚轮/双指）。
   * 默认 false —— 完全不响应任何手势（viewControls.enabled = false）。
   */
  rotatable?: boolean;

  /**
   * 初始七圣骰子结果：数组长度即骰子数量（1–16），元素为面索引 0–7。
   * 缺省默认 8 颗，结果为 0..7 各一枚。
   */
  initialResults?: readonly number[];
}

export class WebDice {
  static async create(options: WebDiceOptions): Promise<WebDice>;

  /**
   * 投掷。返回按骰子顺序排列的最终朝上面索引数组（number[]，即天然含顺序，无需包一层对象）。
   * 不传参：沿用构造时 initialResults 的骰子数量（缺省 8），结果随机生成；
   * 传入：长度 1–16，作为本次投掷的指定结果。
   */
  roll(results?: readonly number[]): Promise<number[]>;

  /** 运行时开/关手势响应（旋转 + 缩放） */
  setRotatable(rotatable: boolean): void;
  setTableTexture(texture: NonNullable<WebDiceOptions["tableTexture"]>): void;
  /** 容器尺寸变化时由调用方触发（或内部 ResizeObserver） */
  resize(): void;

  /** 释放 three 资源、移除 canvas、终止动画循环 */
  dispose(): void;
}
```

> **类型声明文件**：两个公开包随 npm 发布 `dist/index.d.ts`（`vite-plugin-dts` 从 `src/index.ts` 生成），`package.json` 声明 `"types": "dist/index.d.ts"`、`"exports"` 指向 `dist` 的 js + dts，`"files"` 收录 `dist`。上面 TS 片段即 d.ts 的最终对外形态——所有参数单位、默认值、取值范围都必须写在 JSDoc 注释里，随 d.ts 一起发布给调用方。

> 彩蛋：当一次投掷的全部骰子结果均为"万能"（索引 7）时，引擎自动开启绕场景旋转的粉色点光源（现 `main.ts` 中 `omniLight`/`omniLightPivot` 的行为），该逻辑**保留在 core 引擎内**，对调用方透明，任何 API 组合下均生效。

校验规则（两包共用，放 core）：
- `initialResults.length ∈ [1, 16]`，否则抛 `RangeError`；
- 每个元素 ∈ `[0, 7]`（八面体 8 面），否则抛 `RangeError`；
- `boardSize`：number 须 `> 0`；元组两项均 `> 0`；字符串须匹配 `/^\s*\d+(\.\d+)?\s*[x*]\s*\d+(\.\d+)?\s*$/i`，否则抛 `RangeError`；
- `roll()` 期间重复调用直接忽略（沿用现有 `rollState` 状态机）。

内部行为映射：
- `boardSize` → 解析为 `{ boardLength, boardWidth }` 写入实例级 `DiceWorldConfig`（不再有全局 `setChessboardSize`），并按较长边调整相机距离（`camera.position.set(0, size * 1.2, size * 0.5)` 一类经验公式）；
- `tableTexture` → `board.ts` 中地板 `MeshStandardMaterial.map`；null 时保留现有纯色 + GridHelper；
- `rotatable` → 默认 `false`：`controls.enabled = false`（不响应旋转/拖动/缩放任何手势）；为 `true` 时 `controls.enabled = true`（保留 `enableDamping`，`enablePan` 仍为 false）。运行时 `setRotatable` 切换同一开关；
- `initialResults` → 决定构造后的骰子数量；`roll()` 无参时的随机结果数量沿用该值（缺省 8）；
- 全万能彩蛋 → `roll(targets)` 内部检测 `targets.every(t => t === 7)`，控制 `omniLight.visible` 与旋转（见上）。

---

## 四、资源（骰面贴图）分发策略（两包不同）

`textures.ts` 用 `new Image()` 加载 `./assets/dice/*.webp` 与 `./assets/symbols/*`。core 将贴图来源抽象为可注入的资源描述，由各包提供**不同的默认实现**：

```ts
// core/textures.ts
export interface DiceFaceAsset {
  /** 面背景图标（含渐变/边框） */
  bgIconUrl: string;
  /** 中心符号 */
  symbolUrl: string;
}
export type DiceFaceAssets = readonly DiceFaceAsset[]; // 固定 8 项，顺序 = 面索引
```

- **`web-dice`（默认 CDN 加载）**：包内默认 `DiceFaceAssets` 指向 CDN 常量 URL（沿用拆包前普通 Web 版曾使用的远程图标源），运行时 `Image` 加载。优势：包体积最小；代价：依赖网络。调用方可通过 `faceAssets` 选项覆盖。
- **`web-dice-oimo`（默认本地化内联）**：面向小红书 IIFE 场景，资源**必须随包分发**。做法：core 包内 `import bgUrl from "./assets/dice/cryo.webp?inline"`（Vite `?inline` / `assetsInlineLimit`），编译为 base64 data URL 打进产物：
  - `package-minitool.mjs` 的禁用模式（`fetch`/`XMLHttpRequest`/外链 http）全部满足——data URL 走 `Image.src` 合法且无网络请求；
  - 体积代价：8 张 webp + 8 张 symbol 均为小图（见 `minitool/assets`，单张约 1–3KB），base64 膨胀 ~33% 可接受；
  - 备选降级：包内附带 `assets/` 目录 + `assetsBase` 选项，仅当内联体积超预期时启用。

贴图合成逻辑（元素色打底 → 背景图标 → 中心符号 → emissiveMap）留在 core，不变；`WebDiceOptions` 增加可选覆盖项：

```ts
export interface WebDiceOptions {
  ...
  /** 覆盖默认骰面贴图来源（两包均可传；不传用包默认值） */
  faceAssets?: DiceFaceAssets;
}
```

---

## 五、核心重构点（逐项）

### 5.1 `config.ts` 去全局化（前置，收益最大）

```ts
// core/config.ts —— 全部改为接口 + 默认值，删除 export let / setChessboardSize
export interface DiceWorldConfig {
  boardLength: number;      // 原 CHESSBOARD_LENGTH
  boardWidth: number;       // 原 CHESSBOARD_WIDTH
  boundaryThickness: number;
  boundaryHeight: number;
  diceSize: number;
  diceMass: number;
  diceRestitution: number;
  diceInitHeight: number;
  simulateDt: number;
}
export const DEFAULT_WORLD_CONFIG: DiceWorldConfig = { boardLength: 18, boardWidth: 18, ... };
```

- `physics/shared.ts`：`diceInitPosition(cfg, index, total)`；
- 两个 backend：`createWorld({ worldConfig, colliderConfig, board: DiceWorldConfig, ... })`——`IPhysicsWorld` 创建参数里显式携带棋盘尺寸（原代码直接读全局）；
- `setup.ts`（→ `board.ts` / `dice.ts`）：函数加 `cfg` 参数。

### 5.2 `main.ts` → `core/renderer.ts` 的 `DiceRenderer`

把 `main.ts` 中与 UI 无关的部分抽成类：

```ts
export class DiceRenderer {
  constructor(container: HTMLElement, opts: {
    backend: IPhysicsBackend;         // 由具体包注入 RapierBackend / OimoBackend
    world: DiceWorldConfig;
    rotatable: boolean;
    tableTexture?: ...;
    faceAssets?: DiceFaceAssets;      // 贴图来源（CDN 或内联 data URL）
  })
  async init(): Promise<void>;        // backend.init() + 贴图预加载
  roll(targets: number[]): Promise<number[]>; // 返回最终朝上面序列（复用现有 rolling→gathering 状态机）
  setRotatable(v: boolean): void;
  dispose(): void;
}
```

迁移要点：
- 相机初始位置由 `boardSize` 推导，删除 `computeVisibleWorldBoundsAtY` 的"棋盘=可视区域"逻辑（那是页面 demo 特有需求，移回 apps/web；包内默认值=容器窄边正方形，见 §三）；
- 聚拢布局：**始终 2 行**，`cols = Math.ceil(n / 2)`（n=1 时单颗居中，n=16 → 8×2），行/列间距按棋盘较长边缩放，替换固定 `GATHER_COLS=4/GATHER_ROWS=2`；
- **骰子自动缩放**：骰子总数 `n > 8` 时按 `scale = Math.sqrt(8 / n)`（或线性 `8 / n`，实测取视觉更优者）等比缩小骰子 Mesh 与对应碰撞体，保证 16 颗仍不重叠；注意碰撞体凸包需同步缩放（`scale` 传入 world config，backend 侧对 points 预缩放最稳妥——Rapier/Oimo 对已建刚体统一缩放支持不一）；
- 万能彩蛋保留：`omniLight` + `omniLightPivot`（粉色点光绕场景旋转）逻辑原样迁入 core，`roll()` 检测全万能（`every(t => t === 7)`）时点亮，其余时间隐藏（对齐当前未提交改动中 `omniLight.visible = false` 的默认关闭行为）。

### 5.3 两个 backend 的适配

改动很小：把 `CHESSBOARD_*`、`DICE_*` 全局读取改为从 `options.board` 取；`IPhysicsBackend` / `IPhysicsWorld` 接口本身不变。`web-dice` 包内保留 `await RAPIER.init()`；`web-dice-oimo` 的 `init()` 为空。

### 5.4 调用方 app 重构

`apps/web/src/main.ts`（根 `index.html` 使用）：

```ts
import { WebDice, ELEMENT_NAMES_ZH, ELEMENT_NAMES_EN } from "web-dice";

const dice = await WebDice.create({
  container: document.getElementById("dice-stage")!,
  // boardSize 缺省即"容器窄边正方形"（世界单位）；
  // 如需长方形：boardSize: "18x12" 或 [18, 12]
  rotatable: true,                        // demo 需要手势交互；组件默认 false（不响应手势）
  initialResults: [0,1,2,3,4,5,6,7],
});
rollButton.onclick = () => dice.roll(currentSelections());
```

selector 面板可基于 `ELEMENT_NAMES_ZH`/`ELEMENT_NAMES_EN` 渲染双语选项（如 `冰 Cryo`）。

`apps/minitool/src/main.ts` 完全同构，仅 `import { WebDice, ELEMENT_NAMES_ZH, ELEMENT_NAMES_EN } from "web-dice-oimo"`。两个 app 的 UI（selector 面板、随机/万能按钮、状态文案）各自保留，或进一步抽 `apps/shared-ui/`（可选，非必须）。

根目录 `index.html`、`minitool/index.html` 与构建配置随 app 目录迁移；`vite.config.minitool.ts` 的 lib/IIFE 输出与 `package-minitool.mjs` 校验流程保留，仅改入口路径。

---

## 六、构建与发布

| 产物 | 构建 | 说明 |
|------|------|------|
| `packages/web-dice-core` | `tsc` 出 dts（不打包运行时） | `private: true`，仅 workspace 内引用；three 为 dependency |
| `packages/web-dice` | vite lib mode（ESM）+ `vite-plugin-wasm` + `vite-plugin-dts` | three 设为 peerDependency；`@dimforge/rapier3d-compat` 为 dependency（其 wasm 以 base64 内联，无需额外 .wasm 文件，浏览器直接可用）。`package.json`：`types`/`exports`/`files` 指向 dist（含 index.d.ts） |
| `packages/web-dice-oimo` | vite lib mode（**单文件、无 dynamic import**）+ `vite-plugin-dts` | three peer；`oimophysics` 打进 bundle 或作为 dependency 视其包质量决定（git 依赖建议打进 bundle）。同上声明 types/exports/files |
| `apps/web` | vite 普通 app 构建（保留 wasm 插件） | 根 `index.html` |
| `apps/minitool` | vite lib IIFE（沿用现 `vite.config.minitool.ts` 思路） | 产物过 `package-minitool.mjs` 禁用模式校验 |

发布顺序：core（如需发布）→ web-dice / web-dice-oimo。两个公开包版本号保持同步发布（接口一致是硬约束，建议用 changesets 固定一起发版）。

---

## 七、兼容性红线（minitool / 小红书）

- `web-dice-oimo` 产物必须继续通过 `scripts/package-minitool.mjs` 的 forbidden 正则：无 `import/export`、无 `eval`/`new Function`、无 `WebAssembly`、无 `fetch`/`XMLHttpRequest`、无外链 http；
- three.js 需验证 IIFE 打包后不含上述模式（当前 minitool 构建已验证可行，迁移后回归即可）；
- 资源内联 data URL（§四）后，`Image` 加载不受影响；且 `web-dice-oimo` 产物不得出现任何 http(s) 外链（CDN 贴图只允许出现在 `web-dice` 包中）；
- 注意 rapier 包**绝不能**被 oimo 包或 minitool app 间接引入（workspace 依赖隔离，`apps/minitool` 只依赖 `web-dice-oimo`）。

---

## 八、实施里程碑

| 阶段 | 内容 | 验证 |
|------|------|------|
| M1 | monorepo 化（pnpm-workspace、apps/、packages/ 目录迁移），构建脚本跑通，功能与现状等价 | `pnpm dev` / `pnpm build` / `pnpm build:minitool` 产物可运行 |
| M2 | `config.ts` 去全局化，棋盘尺寸显式传参打通三层（renderer → backend → shared） | 现有 demo 在不同 boardSize 下渲染/物理正常 |
| M3 | `DiceRenderer` 抽取 + 统一 API（create/roll/setRotatable/setTableTexture/dispose + 参数校验） | 两 app 改为通过 API 调用，行为不变 |
| M4 | 资源分发（web-dice CDN 默认源 / oimo 内联 data URL）、1–16 颗骰子 2 行聚拢 + 自动缩放、桌面贴图支持、rotatable 开关、全万能彩蛋回归 | 手工矩阵：1/8/16 颗 × 贴图开/关 × 可转动开/关 × 全万能彩蛋触发 |
| M5 | 两包 lib 构建 + dts + minitool 禁用模式回归 + 打包 zip | `package-minitool.mjs` 通过；两包以 node_modules 方式被 app 引用（workspace:*） |
| M6 | 清理：删除根 `src/`、旧 vite 配置；README/API 文档；可选 changesets 发版流程 | 全量构建 + 双端到端手工回归 |

## 九、风险与备注

1. **Oimo 与 Rapier 行为差异**：两包"功能一致"指接口一致；同一组初始旋转在两个引擎下的落面结果不保证逐颗相同（现有架构已用 preSimulate + 朝向校正保证"结果必中"，天然抹平差异）。回归时只校验"最终朝上面 === 指定面"。
2. **16 颗骰子性能**：preSimulate 是同步 while 循环（两后端均为 JS 单线程），16 颗时长增加；可在 core 预留 `preSimulate` 分帧/Web Worker 优化位，首版不做。
3. **棋盘尺寸与墙高**：`BOUNDARY_HEIGHT = 20` 很高（防骰子飞出），boardSize 调大后相机/墙高比例需调；初版按 boardSize 线性缩放 boundaryHeight。
4. **骰子缩放与物理**：n>8 缩小骰子时，渲染 Mesh 与物理碰撞凸包必须同步缩放；Rapier/Oimo 对刚体运行时缩放支持不一，最稳妥做法是把凸包顶点按 scale 预缩放后再建 collider（两 backend 各自处理，接口不变）。
5. **web-dice 的 CDN 贴图源**：当前仓库已把远程图标本地化（`src/textures.ts` + `minitool/assets`），拆包前需确定/恢复可用 CDN URL（或改用任何稳定图源），并保留 `faceAssets` 覆盖口子以备 CDN 失效时调用方自兜底；`web-dice` 建议对加载失败做降级（纯元素色面）。
6. **three peer 版本**：peerDependency 声明 `^0.174.0`，两包一致，避免多实例 three。
