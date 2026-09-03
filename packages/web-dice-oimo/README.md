# gi-dice-oimo

七圣召唤风格的八面体元素骰组件：真实物理投掷动画（OimoPhysics / 纯 JS 后端），指定结果必中（预模拟 + 朝向校正），渲染为一个可嵌入任意页面的 canvas。

与 [gi-dice](https://www.npmjs.com/package/gi-dice)（Rapier / WASM 后端）**接口完全一致**，差异仅在内部物理引擎与贴图分发策略：

- 纯 JS，无 WASM，适合禁止 WebAssembly 的环境（如小程序、受限 WebView）；
- 骰面贴图全部以 data URL 内联进产物，运行时零网络请求，完全离线可用。

## 安装

```bash
npm install gi-dice-oimo three
```

`three` 是 peerDependency（>= 0.160.0），需自行安装。

> 注意：物理引擎 `oimophysics` 当前为 pin 到具体 commit 的 git 依赖（1.2.5，npm 尚未发布该版本），安装时需要能访问 GitHub。待官方发布 1.2.5 后会换回 npm registry 版本。

## 快速开始

```ts
import { WebDice } from "gi-dice-oimo";

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

与 `gi-dice` 完全相同，见 [gi-dice 的 API 文档](https://www.npmjs.com/package/gi-dice#api)：`WebDice.create(options)`（`boardSize` / `tableTexture` / `showGrid` / `transparent` / `rotatable` / `speed` / `rounds` / `initialResults` / `faceAssets` / `diceSize`），实例方法 `roll` / `setSpeed` / `setRotatable` / `setTableTexture` / `resize` / `dispose`，以及 `ELEMENT_NAMES_ZH` / `ELEMENT_NAMES` / `DICE_COLORS` 等导出。

唯一区别：`faceAssets` 的默认值为包内内联 data URL（而非 CDN）。

## License

[AGPL-3.0-only](./LICENSE)
