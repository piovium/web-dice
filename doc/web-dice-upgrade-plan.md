# web-dice 改造方案（支持小红书小工具独立构建目标）

## 变更概览

| 模块 | 内容 |
|------|------|
| 构建目标拆分 | 默认仍走普通 Web（Rapier + ESM），新增 `build:minitool` 目标（Oimo + IIFE + 独立入口 HTML） |
| 物理引擎抽象 | 抽象 `IPhysicsBackend` 接口，Vite alias 按构建目标切换 Rapier / Oimo |
| OimoPhysics 实现 | 等价实现 `IPhysicsBackend`，纯 JS 运行时，零 WASM |
| 小红书小工具合规 | 移除远程图标加载、模块脚本改为 IIFE 单文件、`index.html` 按容器模板重写、zip 打包 |
| 字符透光 | 贴图驱动 emissive，不添加真实点光源 |
| 镶金边 | barycentric coordinates 自定义 ShaderMaterial，棱边处渲染金色凸起 |
| 停止后聚拢 | 2 行 × 4 列排列，lerp 动画将 8 颗骰子从物理停止位置平滑聚拢 |

> **核心前提**：本方案的最终产物必须同时满足 [zip-artifact-spec.md](../.skill/references/zip-artifact-spec.md)、[device-capabilities.md](../.skill/references/device-capabilities.md) 与 [cross-platform-h5.md](../.skill/references/cross-platform-h5.md) 的全部约束。

---

## 一、目标架构

通过**独立的 Vite 配置文件**把两条构建线拆开，互不影响：

| 命令 | 构建目标 | 物理后端 | JS 产物 | 入口 HTML |
|------|----------|----------|---------|-----------|
| `pnpm dev` / `pnpm build` | 普通 Web | Rapier（WASM） | Vite 默认 ESM 分块 | 原 `index.html` |
| `pnpm build:minitool` | 小红书小工具 zip | Oimo（纯 JS） | IIFE 单文件 `app.js` | `minitool/index.html` |

切换方式：

- `vite.config.ts`：默认 Web，通过 `resolve.alias` 把 `@dice/physics-backend` 指向 `src/physics/rapier-backend.ts`。
- `vite.config.minitool.ts`：小工具专用，alias 指向 `src/physics/oimo-backend.ts`，`build.lib` 输出 IIFE，并关闭 WASM 相关插件。

---

## 二、目录结构

```
web-dice/
├── src/
│   ├── physics/                  # 新增：物理引擎抽象层
│   │   ├── types.ts              # IPhysicsBackend 接口 + 公共类型
│   │   ├── rapier-backend.ts     # Rapier 实现（默认 Web）
│   │   ├── oimo-backend.ts       # OimoPhysics 实现（小工具）
│   │   └── shared.ts             # diceInitPosition / calcFinalUpFace 等
│   ├── shaders/                  # 新增：自定义 shader
│   │   └── dice-edge.glsl.ts
│   ├── geometries.ts             # 修改：加入 barycentric attribute
│   ├── textures.ts               # 修改：本地 canvas 绘制，不再请求外部图片
│   ├── setup.ts                  # 修改：使用新材质和 shader，加入聚拢动画
│   ├── main.ts                   # 修改：通过 alias 引入物理后端，加入聚拢状态机
│   ├── config.ts                 # 修改：新增聚拢/动画相关常量
│   ├── style.css                 # 不变（两个目标共用）
│   └── vite-env.d.ts
├── minitool/                     # 新增：小红书小工具专用入口
│   ├── index.html                # 符合容器规范的入口 HTML
│   └── assets/                   # 新增：小工具本地静态资源
│       └── dice/                 # 从 gi-web 复制的 8 枚骰子图标
│           ├── cryo.webp
│           ├── hydro.webp
│           ├── pyro.webp
│           ├── electro.webp
│           ├── dendro.webp
│           ├── anemo.webp
│           ├── geo.webp
│           └── omni.webp
├── scripts/                      # 新增：小工具构建后处理
│   └── package-minitool.mjs      # 复制入口、清理垃圾文件、打包 zip
├── vite.config.ts                # 默认 Web 配置
├── vite.config.minitool.ts       # 小工具专用配置
└── package.json                  # 新增 build:minitool 脚本
```

---

## 三、构建目标与 Vite 配置

### 3.1 物理后端切换约定

两个后端文件导出**同名类 `PhysicsBackend`**，业务代码统一通过 alias 引入：

```ts
// src/main.ts
import { PhysicsBackend } from "@dice/physics-backend";

const backend = new PhysicsBackend();
await backend.init();
```

`vite.config.ts` / `vite.config.minitool.ts` 通过 alias 决定实际绑定哪个实现，业务代码无需改动。

### 3.2 默认 Web 配置 `vite.config.ts`

```ts
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  plugins: [wasm()],
  resolve: {
    alias: {
      "@dice/physics-backend": resolve(__dirname, "src/physics/rapier-backend.ts"),
    },
  },
  define: {
    __PHYSICS_BACKEND__: JSON.stringify("rapier"),
  },
});
```

### 3.3 小工具配置 `vite.config.minitool.ts`

```ts
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  plugins: [], // 小工具不使用 WASM 插件
  resolve: {
    alias: {
      "@dice/physics-backend": resolve(__dirname, "src/physics/oimo-backend.ts"),
    },
  },
  define: {
    __PHYSICS_BACKEND__: JSON.stringify("oimo"),
  },
  build: {
    outDir: "dist-minitool",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "DiceApp",
      formats: ["iife"],
      fileName: () => "app.js",
    },
    cssCodeSplit: false,
    rollupOptions: {
      // IIFE 下单文件输出，不保留 ESM 动态 import
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
```

### 3.4 `package.json` 脚本

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "build:minitool": "vite build --config vite.config.minitool.ts && node scripts/package-minitool.mjs"
  }
}
```

> 如果 `tsc` 对两个目标同时编译会报错（Rapier 与 Oimo 不能同时被识别为同一 alias），可以把 `build:minitool` 改为**不做全量 `tsc`**，仅依赖 Vite 内置类型检查，或在 `tsconfig.json` 里把 `noEmit` 打开，构建时不报错。

### 3.5 小工具构建后处理 `scripts/package-minitool.mjs`

```js
import { cp, readdir, rm, readFile, writeFile } from "fs/promises";
import { createWriteStream } from "fs";
import { resolve } from "path";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import archiver from "archiver"; // 或直接用 node 内置压缩

const root = resolve(process.cwd());
const dist = resolve(root, "dist-minitool");
const outZip = resolve(root, "dice-minitool.zip");

async function main() {
  // 1. 复制小红书小工具入口 HTML，并改名为 index.html
  await cp(resolve(root, "minitool/index.html"), resolve(dist, "index.html"), { force: true });

  // 2. 复制本地静态资源（骰子图标等）
  await cp(resolve(root, "minitool/assets"), resolve(dist, "assets"), { recursive: true, force: true });

  // 3. 删除构建产物中的垃圾文件
  const files = await readdir(dist, { recursive: true, withFileTypes: true });
  for (const f of files) {
    if (f.isFile()) {
      const name = f.name.toLowerCase();
      if (name.endsWith(".map") || name === ".ds_store") {
        await rm(resolve(dist, f.parentPath ?? f.path, f.name));
      }
    }
  }

  // 4. 校验产物中无禁用模式
  const html = await readFile(resolve(dist, "index.html"), "utf8");
  const js = await readFile(resolve(dist, "app.js"), "utf8");
  const forbidden = [
    /type\s*=\s*["']module["']/,
    /\bimport\b/,
    /\bexport\b/,
    /eval\s*\(/,
    /new\s+Function\s*\(/,
    /WebAssembly\./,
    /fetch\s*\(/,
    /XMLHttpRequest/,
    /https?:\/\//,
    /<base\s+href/,
    /<iframe/,
    /<object/,
  ];
  for (const re of forbidden) {
    if (re.test(html) || re.test(js)) {
      throw new Error(`小红书小工具产物命中禁用模式: ${re}`);
    }
  }

  // 5. 打包 zip（压缩的是目录内容，不是目录本身）
  const output = createWriteStream(outZip);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(output);
  archive.directory(dist, false);
  await archive.finalize();

  console.log("产物路径:", outZip);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

---

## 四、物理引擎抽象层

### 4.1 接口定义 `src/physics/types.ts`

与原计划保持一致：

```ts
import type * as THREE from "three";

export interface PhysicsWorldConfig {
  gravity: [number, number, number];
  timestep: number;
}

export interface RigidBodyConfig {
  type: "static" | "dynamic";
  translation: [number, number, number];
  rotation: [number, number, number, number];
}

export interface ColliderConfig {
  shape:
    | { kind: "cuboid"; halfExtents: [number, number, number] }
    | { kind: "convexHull"; points: Float32Array };
  mass: number;
  restitution: number;
}

export interface BodyTransform {
  translation: THREE.Vector3;
  rotation: THREE.Quaternion;
}

export interface DiceSimResult {
  initRotation: THREE.QuaternionLike;
  finalUpFace: number;
  sleepTime: number;
}

export interface IPhysicsBackend {
  init(): Promise<void>;
  createWorld(options: {
    diceCount: number;
    initRotations: THREE.QuaternionLike[];
    convexHullPoints: Float32Array;
    worldConfig: PhysicsWorldConfig;
    colliderConfig: ColliderConfig;
  }): IPhysicsWorld;
}

export interface IPhysicsWorld {
  step(): BodyTransform[];
  isSleeping(index: number): boolean;
  dispose(): void;
}
```

### 4.2 公共工具 `src/physics/shared.ts`

```ts
import type * as THREE from "three";
import {
  BOUNDARY_THICKNESS,
  CHESSBOARD_LENGTH,
  CHESSBOARD_WIDTH,
} from "../config";

export function diceInitPosition(
  index: number,
  total: number,
): { x: number; z: number } {
  const diceInitCols = Math.min(total, 4);
  const diceInitRows = Math.ceil(total / diceInitCols);
  const diceColsGap = 3;
  const diceRowsGap = 4;
  return {
    x: ((index % diceInitCols) - (diceInitCols - 1) / 2) * diceColsGap,
    z: (Math.floor(index / diceInitCols) - (diceInitRows - 1) / 2) * diceRowsGap,
  };
}

export function calcFinalUpFace(rotation: THREE.QuaternionLike): number {
  const inv = new THREE.Quaternion(
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
  ).invert();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);
  return (+(up.x > 0) << 2) | (+(up.y > 0) << 1) | +(up.z > 0);
}
```

### 4.3 Rapier 实现 `src/physics/rapier-backend.ts`

类名统一为 `PhysicsBackend`，实现 `IPhysicsBackend`：

```ts
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type {
  BodyTransform,
  ColliderConfig,
  IPhysicsBackend,
  IPhysicsWorld,
  PhysicsWorldConfig,
} from "./types";
import { calcFinalUpFace, diceInitPosition } from "./shared";
import {
  BOUNDARY_HEIGHT,
  BOUNDARY_THICKNESS,
  CHESSBOARD_LENGTH,
  CHESSBOARD_WIDTH,
  DICE_INIT_HEIGHT,
} from "../config";

export class PhysicsBackend implements IPhysicsBackend {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.initialized = true;
  }

  createWorld(options: Parameters<IPhysicsBackend["createWorld"]>[0]): IPhysicsWorld {
    const {
      diceCount,
      initRotations,
      convexHullPoints,
      worldConfig,
      colliderConfig,
    } = options;

    const gravity = new RAPIER.Vector3(...worldConfig.gravity);
    const world = new RAPIER.World(gravity);
    world.timestep = worldConfig.timestep;

    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        0, -BOUNDARY_THICKNESS / 2, 0,
      ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        CHESSBOARD_LENGTH / 2,
        BOUNDARY_THICKNESS / 2,
        CHESSBOARD_WIDTH / 2,
      ),
      floorBody,
    );

    const wallConfigs = [
      { x: CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2, z: 0, isX: true },
      { x: -CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2, z: 0, isX: true },
      { x: 0, z: CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2, isX: false },
      { x: 0, z: -CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2, isX: false },
    ];
    for (const wall of wallConfigs) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          wall.x, BOUNDARY_HEIGHT / 2, wall.z,
        ),
      );
      const shape = wall.isX
        ? RAPIER.ColliderDesc.cuboid(
            BOUNDARY_THICKNESS / 2,
            BOUNDARY_HEIGHT / 2,
            CHESSBOARD_WIDTH / 2,
          )
        : RAPIER.ColliderDesc.cuboid(
            CHESSBOARD_LENGTH / 2,
            BOUNDARY_HEIGHT / 2,
            BOUNDARY_THICKNESS / 2,
          );
      world.createCollider(shape, body);
    }

    const bodies: RAPIER.RigidBody[] = [];
    for (let i = 0; i < diceCount; i++) {
      const { x, z } = diceInitPosition(i, diceCount);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, DICE_INIT_HEIGHT, z)
          .setRotation(initRotations[i]),
      );
      let shape: RAPIER.ColliderDesc;
      if (colliderConfig.shape.kind === "convexHull") {
        shape = RAPIER.ColliderDesc.convexHull(colliderConfig.shape.points)!;
      } else {
        const he = colliderConfig.shape.halfExtents;
        shape = RAPIER.ColliderDesc.cuboid(he[0], he[1], he[2]);
      }
      shape.setMass(colliderConfig.mass);
      shape.setRestitution(colliderConfig.restitution);
      world.createCollider(shape, body);
      bodies.push(body);
    }

    return {
      step: () => {
        world.step();
        return bodies.map((body) => ({
          translation: new THREE.Vector3().copy(body.translation()),
          rotation: new THREE.Quaternion().copy(body.rotation()),
        }));
      },
      isSleeping: (index: number) => bodies[index].isSleeping(),
      dispose: () => {
        // Rapier World 没有 explicit free，依赖 GC
      },
    };
  }
}
```

### 4.4 OimoPhysics 实现 `src/physics/oimo-backend.ts`

类名同样为 `PhysicsBackend`，供小工具构建专用。

> **安装建议**：`pnpm add saharan/OimoPhysics#master`。npm 上的 `oimophysics@1.2.2` 已多年未更新，API 可能与下文不一致，需先编译验证。

```ts
import * as OIMO from "oimophysics";
import * as THREE from "three";
import type {
  BodyTransform,
  ColliderConfig,
  IPhysicsBackend,
  IPhysicsWorld,
  PhysicsWorldConfig,
} from "./types";
import { calcFinalUpFace, diceInitPosition } from "./shared";
import {
  BOUNDARY_HEIGHT,
  BOUNDARY_THICKNESS,
  CHESSBOARD_LENGTH,
  CHESSBOARD_WIDTH,
  DICE_INIT_HEIGHT,
  DICE_SIZE,
} from "../config";

// 正八面体体积 = sqrt(2)/3 * R^3，R 为 OctahedronGeometry 的 radius
const OCTAHEDRON_VOLUME = (Math.sqrt(2) / 3) * Math.pow(DICE_SIZE, 3);

export class PhysicsBackend implements IPhysicsBackend {
  async init(): Promise<void> {
    // 纯 JS 引擎，无需异步初始化
  }

  createWorld(options: Parameters<IPhysicsBackend["createWorld"]>[0]): IPhysicsWorld {
    const {
      diceCount,
      initRotations,
      convexHullPoints,
      worldConfig,
      colliderConfig,
    } = options;

    const world = new OIMO.World({
      gravity: worldConfig.gravity,
      timestep: worldConfig.timestep,
    });

    const addStaticBody = (
      tx: number,
      ty: number,
      tz: number,
      shapeConfig: OIMO.ShapeConfig,
    ) => {
      const body = new OIMO.RigidBody(
        OIMO.RigidBodyType.STATIC,
        new OIMO.Vec3(tx, ty, tz),
        new OIMO.Quat(0, 0, 0, 1),
      );
      body.addShape(shapeConfig);
      world.addRigidBody(body);
    };

    // 地面
    const floorShape = new OIMO.ShapeConfig();
    floorShape.geometry = new OIMO.BoxGeometry(
      new OIMO.Vec3(CHESSBOARD_LENGTH / 2, BOUNDARY_THICKNESS / 2, CHESSBOARD_WIDTH / 2),
    );
    addStaticBody(0, -BOUNDARY_THICKNESS / 2, 0, floorShape);

    // 四面围墙
    const wallXShape = new OIMO.ShapeConfig();
    wallXShape.geometry = new OIMO.BoxGeometry(
      new OIMO.Vec3(BOUNDARY_THICKNESS / 2, BOUNDARY_HEIGHT / 2, CHESSBOARD_WIDTH / 2),
    );
    const wallZShape = new OIMO.ShapeConfig();
    wallZShape.geometry = new OIMO.BoxGeometry(
      new OIMO.Vec3(CHESSBOARD_LENGTH / 2, BOUNDARY_HEIGHT / 2, BOUNDARY_THICKNESS / 2),
    );

    addStaticBody(CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2, BOUNDARY_HEIGHT / 2, 0, wallXShape);
    addStaticBody(-CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2, BOUNDARY_HEIGHT / 2, 0, wallXShape);
    addStaticBody(0, BOUNDARY_HEIGHT / 2, CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2, wallZShape);
    addStaticBody(0, BOUNDARY_HEIGHT / 2, -CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2, wallZShape);

    // 骰子
    const bodies: OIMO.RigidBody[] = [];
    for (let i = 0; i < diceCount; i++) {
      const { x, z } = diceInitPosition(i, diceCount);
      const rot = initRotations[i];
      const body = new OIMO.RigidBody(
        OIMO.RigidBodyType.DYNAMIC,
        new OIMO.Vec3(x, DICE_INIT_HEIGHT, z),
        new OIMO.Quat(rot.x, rot.y, rot.z, rot.w),
      );

      const shapeConfig = new OIMO.ShapeConfig();
      shapeConfig.geometry = new OIMO.ConvexHullGeometry(
        Array.from(
          { length: convexHullPoints.length / 3 },
          (_, j) =>
            new OIMO.Vec3(
              convexHullPoints[j * 3],
              convexHullPoints[j * 3 + 1],
              convexHullPoints[j * 3 + 2],
            ),
        ),
      );
      shapeConfig.restitution = colliderConfig.restitution;
      shapeConfig.friction = 0.5;
      // 通过 density 控制质量：mass = density * volume
      shapeConfig.density = colliderConfig.mass / OCTAHEDRON_VOLUME;

      body.addShape(shapeConfig);
      world.addRigidBody(body);
      bodies.push(body);
    }

    return {
      step: () => {
        world.step();
        return bodies.map((body) => {
          const pos = body.getPosition();
          const quat = body.getOrientation();
          return {
            translation: new THREE.Vector3(pos.x, pos.y, pos.z),
            rotation: new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w),
          };
        });
      },
      isSleeping: (index: number) => bodies[index].isSleeping(),
      dispose: () => {
        world.clear();
      },
    };
  }
}
```

> **API 注意**：OimoPhysics 的 `World`/`RigidBody`/`ShapeConfig`/`ConvexHullGeometry` 具体字段名需要以实际安装后的 TypeScript 类型为准。如果发现 `getPosition()` / `getOrientation()` / `isSleeping()` 命名不同，按实际 API 微调即可。

### 4.5 `main.ts` 中物理层调用

```ts
import { PhysicsBackend } from "@dice/physics-backend";
import { diceInitPosition, calcFinalUpFace } from "./physics/shared";
import { diceGeometryPoints } from "./geometries";
import { SIMULATE_DT, DICE_MASS, DICE_RESTITUTION } from "./config";

const backend = new PhysicsBackend();
await backend.init();

function preSimulate(diceCount: number): DiceSimResult[] {
  const initRotations = Array.from({ length: diceCount }, () =>
    new THREE.Quaternion().random(),
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

function simulate(initRotations: THREE.QuaternionLike[]): IPhysicsWorld {
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
```

---

## 五、小红书小工具入口 HTML

新建 `minitool/index.html`，**不覆盖原 `index.html`**：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
  />
  <title>元素骰 · 投掷实验室</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      -webkit-font-smoothing: antialiased;
      -webkit-tap-highlight-color: transparent;
      -webkit-user-select: none;
      user-select: none;
      background: #070b16;
    }
  </style>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <main id="root">
    <section class="control-panel" aria-labelledby="page-title">
      <p class="eyebrow">Elemental Dice Lab</p>
      <h1 id="page-title">掌控这次投掷</h1>
      <p class="description">为每枚骰子选择结果，再让物理模拟完成剩下的表演。</p>

      <div id="dice-options" class="dice-options"></div>

      <div class="quick-actions" aria-label="快捷设置">
        <button id="random-button" type="button">随机结果</button>
        <button id="omni-button" type="button">全部万能</button>
      </div>

      <button id="roll-button" class="roll-button" type="button">开始投掷</button>
      <p id="roll-status" class="status" role="status" aria-live="polite">
        选择结果后，点击开始投掷
      </p>
    </section>

    <p class="gesture-hint">拖动旋转 · 双指缩放</p>
  </main>
  <script src="./app.js"></script>
</body>
</html>
```

> 关键点：`script` 不带 `type="module"`、路径是相对路径 `./app.js`、没有 `<base href>`、没有外部资源。

### 移动端 / 触摸适配

- 提示文案从“拖动旋转 · 滚轮缩放”改为“拖动旋转 · 双指缩放”。
- `OrbitControls` 默认支持单指旋转、双指缩放，不需要为手机/iPad 额外写滚轮逻辑。
- 小工具运行在手机 WebView，建议把 `select`、`button` 的触摸区域保持 ≥ 44×44 dp，必要时加大 `.dice-option` 内边距。

---

## 六、图标资源（从 gi-web 复制本地加载）

小红书小工具不能请求外部 CDN，因此把 8 枚骰子图标 webp 复制到本项目的 `minitool/assets/dice/`：

| 元素 | gi-web 文件名 | 复制后路径 |
|------|---------------|------------|
| 冰 cryo | `a4e8e63dd7bc0704fc1667dd49084431.webp` | `minitool/assets/dice/cryo.webp` |
| 水 hydro | `eaea276679b1693a2ef0ee7e4028f068.webp` | `minitool/assets/dice/hydro.webp` |
| 火 pyro | `eb6eaa5ba555990319638a31e9211fee.webp` | `minitool/assets/dice/pyro.webp` |
| 雷 electro | `61d3c2670daa0894f5b3453f3e733a3e.webp` | `minitool/assets/dice/electro.webp` |
| 草 dendro | `b2fd49b7f90f4e2fe56108ead43e7b72.webp` | `minitool/assets/dice/dendro.webp` |
| 风 anemo | `66c9e4d5ac76d9d2f7a7018938dd6566.webp` | `minitool/assets/dice/anemo.webp` |
| 岩 geo | `1bba17caf93fc479b6ee4e2675d8bcaa.webp` | `minitool/assets/dice/geo.webp` |
| 万能 omni | `ddff0c5839c6d73fc0ecf8fa45ba01f7.webp` | `minitool/assets/dice/omni.webp` |

构建小工具时，`scripts/package-minitool.mjs` 需要把这组 webp 一起复制到 `dist-minitool/assets/dice/`，最终打进 zip。

## 七、纹理生成改造

使用 gi-web 的配色方案，底色 + 本地图标贴图：

```ts
import * as THREE from "three";

// 与 gi-web 中元素 SVG 的 fill 色保持一致
export const DICE_COLORS = [
  "#55ddff", // 冰 cryo
  "#3e99ff", // 水 hydro
  "#ff9955", // 火 pyro
  "#b380ff", // 雷 electro
  "#80ffe6", // 风 anemo
  "#ffcc00", // 岩 geo
  "#a5c83b", // 草 dendro
  "#6b7280", // 万能 omni（灰底 + 白色图标）
];

const CANVAS_SIZE = 128;
const ICON_SIZE = CANVAS_SIZE * 0.72;

const DICE_ICON_PATHS = [
  "./assets/dice/cryo.webp",
  "./assets/dice/hydro.webp",
  "./assets/dice/pyro.webp",
  "./assets/dice/electro.webp",
  "./assets/dice/anemo.webp",
  "./assets/dice/geo.webp",
  "./assets/dice/dendro.webp",
  "./assets/dice/omni.webp",
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

export interface DiceTextureSet {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

export async function getDiceTextures(): Promise<DiceTextureSet[]> {
  // 预加载全部本地图标
  const icons = await Promise.all(DICE_ICON_PATHS.map(loadImage));

  return Promise.all(
    DICE_COLORS.map(async (color, i) => {
      const canvas = document.createElement("canvas");
      const emCanvas = document.createElement("canvas");
      for (const c of [canvas, emCanvas]) {
        c.width = CANVAS_SIZE;
        c.height = CANVAS_SIZE;
      }

      const ctx = canvas.getContext("2d")!;
      const emCtx = emCanvas.getContext("2d")!;

      // 底色
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      // emissive 底色全黑
      emCtx.fillStyle = "#000000";
      emCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // 绘制图标（居中，保持比例）
      const icon = icons[i];
      const scale = Math.min(
        ICON_SIZE / icon.naturalWidth,
        ICON_SIZE / icon.naturalHeight,
        1,
      );
      const dw = icon.naturalWidth * scale;
      const dh = icon.naturalHeight * scale;
      const dx = (CANVAS_SIZE - dw) / 2;
      const dy = (CANVAS_SIZE - dh) / 2;

      ctx.drawImage(icon, dx, dy, dw, dh);
      // emissiveMap 上图标为白色发光区域
      emCtx.drawImage(icon, dx, dy, dw, dh);

      return {
        map: new THREE.CanvasTexture(canvas),
        emissiveMap: new THREE.CanvasTexture(emCanvas),
      };
    }),
  );
}
```

> - 图标走本地相对路径，没有任何 `https://` 请求。
> - `omni` 使用灰底 + 白色图标，与 gi-web 中万能骰的白色图标风格一致。

---

## 八、镶金边 ShaderMaterial

### 7.1 几何体加 barycentric `src/geometries.ts`

在原有 `addGroup` 与 `uv` 之后追加：

```ts
const vertexCount = diceGeometry.attributes.position.count; // 24
const barycentrics = new Float32Array(vertexCount * 3);
for (let i = 0; i < vertexCount; i++) {
  const triVert = i % 3;
  barycentrics[i * 3 + triVert] = 1.0;
}
diceGeometry.setAttribute(
  "aBarycentric",
  new THREE.Float32BufferAttribute(barycentrics, 3),
);
```

### 7.2 Shader 源码 `src/shaders/dice-edge.glsl.ts`

**修正**：vertex shader 必须声明并传递 `vUv`。

```ts
export const diceEdgeVertexShader = /* glsl */ `
  attribute vec3 aBarycentric;
  varying vec3 vBarycentric;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vBarycentric = aBarycentric;
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const diceEdgeFragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uGoldColor;
  uniform float uEdgeWidth;
  uniform float uEdgeIntensity;
  uniform vec3 uEmissiveColor;
  uniform float uEmissiveIntensity;
  uniform sampler2D uMap;
  uniform sampler2D uEmissiveMap;

  varying vec3 vBarycentric;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    float edgeFactor = min(min(vBarycentric.x, vBarycentric.y), vBarycentric.z);
    float edge = 1.0 - smoothstep(0.0, uEdgeWidth, edgeFactor);
    float fresnel = pow(1.0 - abs(dot(vWorldNormal, vViewDir)), 3.0);
    float goldFactor = edge * (uEdgeIntensity + fresnel * 0.5);

    vec4 texColor = texture2D(uMap, vUv);
    vec4 emTexColor = texture2D(uEmissiveMap, vUv);

    vec3 base = uBaseColor * texColor.rgb;
    vec3 emissive = uEmissiveColor * emTexColor.rgb * uEmissiveIntensity;
    vec3 gold = uGoldColor * goldFactor;

    // 假的次表面散射透光感
    float sss = pow(max(0.0, dot(-vViewDir, vWorldNormal)), 2.0) * 0.15;

    vec3 finalColor = base + emissive + gold + uBaseColor * emTexColor.rgb * sss;

    vec3 lightDir = normalize(vec3(2.0, 13.0, 4.0));
    float diff = dot(vWorldNormal, lightDir) * 0.5 + 0.5;
    diff = diff * 0.6 + 0.4;
    finalColor *= diff;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
```

### 7.3 材质创建 `src/setup.ts`

```ts
import { diceEdgeVertexShader, diceEdgeFragmentShader } from "./shaders/dice-edge.glsl";
import { DICE_COLORS } from "./textures";

const GOLD_COLOR = new THREE.Color("#ffd700");

const createDiceShaderMaterial = (
  map: THREE.Texture,
  emissiveMap: THREE.Texture,
  colorIndex: number,
): THREE.ShaderMaterial => {
  return new THREE.ShaderMaterial({
    vertexShader: diceEdgeVertexShader,
    fragmentShader: diceEdgeFragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color(DICE_COLORS[colorIndex]) },
      uGoldColor: { value: GOLD_COLOR },
      uEdgeWidth: { value: 0.02 },
      uEdgeIntensity: { value: 0.9 },
      uEmissiveColor: { value: new THREE.Color(DICE_COLORS[colorIndex]) },
      uEmissiveIntensity: { value: 0.5 },
      uMap: { value: map },
      uEmissiveMap: { value: emissiveMap },
    },
  });
};
```

---

## 九、停止后聚拢（2 行 × 4 列）

### 8.1 新增常量 `src/config.ts`

```ts
/** 聚拢排列：列数 */
export const GATHER_COLS = 4;

/** 聚拢排列：行数 */
export const GATHER_ROWS = 2;

/** 横向间距 */
export const GATHER_SPACING_X = 2.5;

/** 纵向间距 */
export const GATHER_SPACING_Z = 2.5;

/** 聚拢后骰子中心高度 */
export const GATHER_Y = 0.6;
```

### 8.2 目标位置计算

```ts
import { GATHER_COLS, GATHER_ROWS, GATHER_SPACING_X, GATHER_SPACING_Z, GATHER_Y } from "./config";

function getGatherTarget(index: number, total: number): { x: number; y: number; z: number } {
  const col = index % GATHER_COLS;
  const row = Math.floor(index / GATHER_COLS);
  const totalWidth = (GATHER_COLS - 1) * GATHER_SPACING_X;
  const totalDepth = (GATHER_ROWS - 1) * GATHER_SPACING_Z;

  return {
    x: col * GATHER_SPACING_X - totalWidth / 2,
    y: GATHER_Y,
    z: row * GATHER_SPACING_Z - totalDepth / 2,
  };
}
```

### 8.3 状态机与动画 `src/main.ts`

```ts
type RollState = "idle" | "rolling" | "gathering" | "done";
let rollState: RollState = "idle";

function finishRoll() {
  rollState = "gathering";
  simulator = undefined;
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
      const target = getGatherTarget(index, dice.length);
      const pos = handle.group.position;

      pos.x += (target.x - pos.x) * lerpFactor;
      pos.z += (target.z - pos.z) * lerpFactor;
      pos.y += (target.y - pos.y) * lerpFactor;

      // 保持物理停止时的旋转不变，避免面朝向被改乱
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

  controls.update();
  renderer.render(scene, camera);
}
```

> 如果希望聚拢时同时把骰子 Y 轴朝向对齐，可以改为**绕世界 Y 轴乘以额外四元数**（不改变朝上的面），而不是直接修改 Euler.y。

---

## 十、打包与校验流程

执行 `pnpm build:minitool` 后应完成：

1. **产物目录** `dist-minitool/` 顶层直接是：
   - `index.html`
   - `app.js`
   - `style.css`
   - `assets/dice/*.webp`
2. **无以下文件**：`*.map`、`.DS_Store`、`vite.config.*`、`tsconfig.json`、`package.json`、lockfile、`.git`。
3. **`index.html` 校验**：
   - [ ] `<!DOCTYPE html>` + `lang="zh-CN"` + `charset=UTF-8`
   - [ ] viewport 含 `width=device-width, initial-scale=1.0, viewport-fit=cover`
   - [ ] 无 `<base href>`、无 `<iframe>` / `<object>`、无自建 CSP
   - [ ] `<script src="./app.js">`，无 `type="module"`
4. **`app.js` 校验**：
   - [ ] 无 `import` / `export`
   - [ ] 无 `eval(` / `new Function(` / `WebAssembly.`
   - [ ] 无 `fetch(` / `XMLHttpRequest` / `WebSocket`
   - [ ] 无 `https?://`
5. **zip 打包**：
   ```bash
   cd dist-minitool && zip -r ../dice-minitool.zip . -x '*.DS_Store'
   ```
   解压后顶层直接看到 `index.html`。
6. **体积**：zip ≤ 10MB，建议 ≤ 2MB。

---

## 十一、实现优先级与工作量估计

| # | 任务 | 文件 | 预计工时 | 依赖 |
|---|------|------|---------|------|
| 1 | 物理抽象层接口 + shared 工具 | `physics/types.ts`, `physics/shared.ts` | 0.5h | 无 |
| 2 | Rapier 后端实现 + Vite alias | `physics/rapier-backend.ts`, `vite.config.ts` | 1h | #1 |
| 3 | Oimo 后端实现 + 小工具 Vite 配置 | `physics/oimo-backend.ts`, `vite.config.minitool.ts` | 2h | #1 |
| 4 | main.ts 改用物理抽象层 | `main.ts` | 0.5h | #2 #3 |
| 5 | 小红书小工具入口 HTML + 打包脚本 | `minitool/index.html`, `scripts/package-minitool.mjs` | 1h | #3 |
| 6 | 复制 gi-web 图标到 `minitool/assets/dice` + 纹理生成改造 | `minitool/assets/dice/*.webp`, `textures.ts` | 0.5h | 无 |
| 7 | barycentric attribute + 金边 shader | `geometries.ts`, `shaders/dice-edge.glsl.ts` | 2h | 无 |
| 8 | 骰子材质切换为 ShaderMaterial | `setup.ts` | 1h | #6 #7 |
| 9 | 聚拢状态机 + 2×4 排列动画 | `main.ts`, `config.ts` | 1h | 无 |
| 10 | 联调 + 双构建目标验证 | — | 2h | 全部 |

**总计约 11-12 小时**。

建议执行顺序：

```
1 → 2 → 4（确保默认 Web 构建仍正常）
→ 3 → 5（小工具 IIFE 构建跑通）
→ 6 → 7 → 8 → 9（视觉效果）
→ 10（双目标打包校验）
```

---

## 十二、风险与注意事项

1. **OimoPhysics 版本与 API**：
   npm 上的 `oimophysics@1.2.2` 已多年未维护，建议从 GitHub 安装 `saharan/OimoPhysics#master`。`ConvexHullGeometry`、`getPosition()`、`getOrientation()`、`isSleeping()` 等 API 需要安装后先 `tsc` 验证，再按实际类型微调。

2. **构建参数切换 TypeScript 类型**：
   `main.ts` 通过 `@dice/physics-backend` alias 引入，TypeScript 可能无法同时识别两个后端的类型。建议在 `vite-env.d.ts` 里声明该 alias，或把 `tsconfig.json` 的 `noEmit` 打开，避免 `tsc` 在命令行报错。

3. **IIFE 产物体积**：
   Three.js + OimoPhysics 打包成单文件可能在 600KB–1.2MB 之间。如果超过 2MB，需要在 `vite.config.minitool.ts` 中开启 `build.minify: 'terser'` 并检查是否有未 tree-shake 的代码。

4. **Shader 兼容性**：
   部分老款 Android WebGL 1 设备对 `smoothstep` 精度不够。若金边出现锯齿，可把 `uEdgeWidth` 从 `0.02` 调到 `0.03`，或在 fragment shader 顶部加 `precision highp float;`。

5. **聚拢旋转安全**：
   当前方案只插值 position、保持 rotation 不变，能确保朝上面不会被改乱。如后续要加旋转对齐，请用世界 Y 轴四元数乘法，而不是直接改 Euler.y。

6. **最终产物仍需人工复核**：
   即使构建脚本做了扫描，也建议在第一次打包后手动解压 zip，确认 `index.html` 在根目录、无多余目录层、无外部 URL、无模块脚本。

7. **本地图标复制**：
   `minitool/assets/dice/*.webp` 是从 `gi-web` 复制过来的米哈游游戏素材，打包脚本必须把它们复制到 `dist-minitool/assets/dice/` 并打进 zip。首次执行后请确认 zip 里包含这 8 个 webp 文件。

---

*AI 生成（已根据小红书小工具规范校正）*
