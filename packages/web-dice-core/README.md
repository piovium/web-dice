# gi-dice-core

[gi-dice](https://www.npmjs.com/package/gi-dice) 与 [gi-dice-oimo](https://www.npmjs.com/package/gi-dice-oimo) 共用的渲染内核：three.js 场景、投掷/聚拢/重投状态机、骰面贴图合成、物理后端抽象（`IPhysicsBackend` / `IPhysicsWorld`）。

**不建议直接使用**：请安装 `gi-dice`（Rapier / WASM）或 `gi-dice-oimo`（OimoPhysics / 纯 JS），它们内置物理后端并提供稳定的 `WebDice` API。本包作为二者的运行时依赖被自动安装，其导出接口不保证跨版本稳定。

## License

[AGPL-3.0-only](./LICENSE)
