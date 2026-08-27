import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import debounce from "debounce";

import {
  DEFAULT_WORLD_CONFIG,
  GATHER_GAP_FACTOR,
  GATHER_ROWS,
  GATHER_Y,
  type DiceWorldConfig,
  PX_PER_UNIT,
} from "./config";
import { diceGeometryPoints } from "./geometry";
import {
  calcFinalUpFace,
  diceInitPosition,
  scaleHullPoints,
} from "./physics/shared";
import type {
  BodyTransform,
  DiceSimResult,
  IPhysicsBackend,
  IPhysicsWorld,
} from "./physics/types";
import { addChessboard } from "./board";
import { addDice, type DiceHandle } from "./dice";
import { getDiceTextures, type DiceFaceAssets } from "./textures";

/** 骰子数量范围：最少 1 颗，最多 16 颗 */
export const MIN_DICE_COUNT = 1;
export const MAX_DICE_COUNT = 16;

export interface DiceRendererOptions {
  backend: IPhysicsBackend;
  /** 覆盖默认世界参数（boardLength/boardWidth 必须由 BoardSize 解析得出） */
  world?: Partial<Pick<DiceWorldConfig, "boardLength" | "boardWidth">> &
    Partial<DiceWorldConfig>;
  /** 骰子尺寸（世界单位）。仅当显式给定棋盘尺寸时也随 world 传入；
   *  单独设置时不影响默认棋盘按屏幕宽度推导。 */
  diceSize?: number;
  /** 手势总开关（旋转 + 缩放），默认 false */
  rotatable?: boolean;
  tableTexture?: string | HTMLImageElement | HTMLCanvasElement | null;
  faceAssets: DiceFaceAssets;
}

type RollState = "idle" | "rolling" | "gathering" | "done";

export class DiceRenderer {
  readonly board: DiceWorldConfig;

  private readonly container: HTMLElement;
  private readonly backend: IPhysicsBackend;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;

  private readonly omniLight: THREE.PointLight;
  private readonly omniLightPivot = new THREE.Group();

  private dice: DiceHandle[] = [];
  private simulator: IPhysicsWorld | undefined;
  private accumulator = 0;
  private simulatedTime = 0;
  private totalTime = 0;
  private previousFrame = performance.now();
  private rollState: RollState = "idle";
  private diceCount = 8;
  private diceScale = 1;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  private activeRoll: Promise<number[]> | undefined;
  private readonly faceAssets: DiceFaceAssets;
  private floorMaterial: THREE.MeshStandardMaterial | undefined;
  private currentTargets: number[] = [];
  private onRollComplete: ((faces: number[]) => void) | undefined;

  constructor(container: HTMLElement, options: DiceRendererOptions) {
    this.container = container;
    this.backend = options.backend;
    this.faceAssets = options.faceAssets;
    this.board = { ...DEFAULT_WORLD_CONFIG };
    this.diceCount = 8;

    this.scene.background = new THREE.Color("#070b16");
    this.scene.fog = new THREE.Fog("#070b16", 17, 34);

    const spotLight = new THREE.SpotLight("#dbeafe", 180);
    spotLight.castShadow = true;
    spotLight.position.set(2, 13, 4);
    spotLight.angle = Math.PI / 4;
    spotLight.penumbra = 0.55;
    spotLight.lookAt(0, 0, 0);
    this.scene.add(spotLight);

    const rimLight = new THREE.DirectionalLight("#7c3aed", 2.4);
    rimLight.position.set(-8, 7, -5);
    this.scene.add(rimLight);

    const ambientLight = new THREE.AmbientLight("#bfdbfe", 1.3);
    this.scene.add(ambientLight);

    // 全万能彩蛋：粉色点光绕场景旋转（默认关闭，roll 时按需点亮）
    this.omniLight = new THREE.PointLight(
      new THREE.Color("rgb(252, 172, 252)"),
      80,
      16,
    );
    this.omniLight.position.set(3.8, 1.0, 3.8);
    this.omniLight.visible = false;
    this.omniLightPivot.add(this.omniLight);
    this.scene.add(this.omniLightPivot);

    this.camera = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    );
    this.camera.lookAt(0, 0, 0);

    // 默认棋盘（未显式给定 boardSize）：以“屏幕像素宽度 / PX_PER_UNIT”作为世界单位的边长，
    // 即棋盘 = 屏幕宽度的正方形。配合下面 fitView() 的相机距离公式，
    // 1 屏幕像素恒等于 1/PX_PER_UNIT 世界单位 → 任意设备（手机竖屏 / iPad / 桌面横屏）
    // 棋盘都恰好贴合屏幕宽度，无需按设备分支。
    // 注意：仅当 world 里含棋盘尺寸时才走自定义分支，单独传 diceSize 不应阻断默认推导。
    const hasBoardSize =
      options.world &&
      (options.world.boardLength !== undefined ||
        options.world.boardWidth !== undefined);
    if (hasBoardSize) {
      this.board = { ...this.board, ...options.world };
    } else {
      const side = Math.max(4, (container.clientWidth / PX_PER_UNIT) * 0.92);
      this.board.boardLength = side;
      this.board.boardWidth = side;
    }
    if (options.diceSize !== undefined) {
      this.board.diceSize = options.diceSize;
    }
    this.fitView();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.prepend(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(
      debounce(() => this.resize(), 100),
    );
    this.resizeObserver.observe(container);

    this.floorMaterial = addChessboard(
      this.scene,
      this.board,
      options.tableTexture ?? null,
    );

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableRotate = options.rotatable ?? false;
    this.controls.enableZoom = options.rotatable ?? false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 35;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    // 默认从正上方俯视：相机 up 设为 -Z，使棋盘长边沿屏幕竖直方向
    this.camera.up.set(0, 0, -1);
    this.controls.target.set(0, 0, 0);

    this.renderer.setAnimationLoop((now) => this.animate(now));
  }

  /** 物理引擎与贴图就绪（Rapier WASM init 等；Oimo 为空实现） */
  async init(): Promise<void> {
    await this.backend.init();
  }

  /**
   * 将相机摆到一个既贴合屏幕宽度、完整容纳棋盘的位置。
   * 关键公式：相机距离 = clientHeight / (2·tan(fov/2)·PX_PER_UNIT)。
   * 代入可见宽度推导可知：该距离下“屏幕宽度”恰好等于 clientWidth/PX_PER_UNIT 世界单位，
   * 而默认棋盘边长正是 clientWidth/PX_PER_UNIT，于是棋盘=屏幕宽度的正方形。
   * 当调用方显式给定更大棋盘时，取两者的较大距离保证完整可见。
   */
  private fitView(): void {
    const vfov = (this.camera.fov * Math.PI) / 180;
    const t = Math.tan(vfov / 2);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;

    const half = Math.max(this.board.boardLength, this.board.boardWidth) / 2;
    const distForBoard = Math.max(half / t, half / (t * aspect));
    const distForWidth = h / (2 * t * PX_PER_UNIT);

    const dist = Math.max(distForBoard, distForWidth);
    // 正上方俯视：相机垂直向下看向原点，俯视视角下“屏幕宽=棋盘宽”的换算关系仍成立
    this.camera.position.set(0, dist, 0);
    this.camera.lookAt(0, 0, 0);
  }

  resize(): void {
    this.camera.aspect =
      this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
    );
    // 视口尺寸/朝向变化后重新摆放相机，保证棋盘仍贴合屏幕宽度
    this.fitView();
  }

  setRotatable(rotatable: boolean): void {
    this.controls.enableRotate = rotatable;
    this.controls.enableZoom = rotatable;
  }

  /** 替换桌面贴图；传 null 恢复默认深色网格 */
  setTableTexture(
    texture: string | HTMLImageElement | HTMLCanvasElement | null,
  ): void {
    const material = this.floorMaterial;
    if (!material) return;
    if (texture === null) {
      material.map?.dispose();
      material.map = null;
      material.color.set("#0f172a");
      material.needsUpdate = true;
      return;
    }
    const tex =
      typeof texture === "string"
        ? new THREE.TextureLoader().load(texture)
        : new THREE.Texture(texture);
    if (typeof texture !== "string") tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    material.map?.dispose();
    material.map = tex;
    material.color.set("#ffffff");
    material.needsUpdate = true;
  }

  setDiceCount(count: number): void {
    this.diceCount = count;
    this.diceScale =
      count > 8 ? Math.sqrt(8 / count) : 1;
  }

  /** 聚拢布局：固定 2 行，列数随骰子数扩展；间距随骰子尺寸缩放，
   *  中心距 = diceSize * GATHER_GAP_FACTOR（即骰子间留约 1 倍骰子宽度的空隙），
   *  同时受棋盘可用空间夹取（留白也随 diceSize 缩放），保证移动端不挤、桌面端不远。 */
  private getGatherTarget(index: number): { x: number; y: number; z: number } {
    const cols = Math.ceil(this.diceCount / GATHER_ROWS);
    const s = this.board.diceSize;
    const margin = s * 1.5;
    const ideal = s * GATHER_GAP_FACTOR;
    const spacingX = Math.max(
      s,
      Math.min(ideal, (this.board.boardLength - margin * 2) / cols),
    );
    const spacingZ = Math.max(
      s,
      Math.min(ideal, (this.board.boardWidth - margin * 2) / GATHER_ROWS),
    );
    const col = index % cols;
    const row = Math.floor(index / cols);
    const totalWidth = (cols - 1) * spacingX;
    const totalDepth = (GATHER_ROWS - 1) * spacingZ;
    return {
      x: col * spacingX - totalWidth / 2,
      y: GATHER_Y,
      z: row * spacingZ - totalDepth / 2,
    };
  }

  private createWorld(initRotations: THREE.QuaternionLike[]): IPhysicsWorld {
    return this.backend.createWorld({
      diceCount: initRotations.length,
      initRotations,
      convexHullPoints: scaleHullPoints(diceGeometryPoints, this.diceScale),
      diceScale: this.diceScale,
      worldConfig: {
        gravity: [0, -9.81, 0],
        timestep: this.board.simulateDt,
      },
      colliderConfig: {
        shape: {
          kind: "convexHull",
          points: scaleHullPoints(diceGeometryPoints, this.diceScale),
        },
        mass: this.board.diceMass,
        restitution: this.board.diceRestitution,
      },
      board: this.board,
    });
  }

  private preSimulate(diceCount: number): DiceSimResult[] {
    const initRotations = Array.from(
      { length: diceCount },
      () => new THREE.Quaternion().random() as THREE.QuaternionLike,
    );
    const world = this.createWorld(initRotations);

    const results: (DiceSimResult | undefined)[] =
      Array(diceCount).fill(undefined);
    let time = 0;
    let transforms: BodyTransform[] = [];

    while (results.some((r) => !r)) {
      transforms = world.step();
      time += this.board.simulateDt;
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

  /** 投掷并播放动画，resolve 每颗骰子最终朝上的面（按传入 targets 顺序） */
  roll(targets: number[]): Promise<number[]> {
    if (this.disposed) return Promise.reject(new Error("DiceRenderer disposed"));
    if (this.rollState !== "idle" && this.rollState !== "done") {
      // 忙碌时忽略新请求，返回进行中的同一结果
      return (this.activeRoll ?? Promise.resolve([])) as Promise<number[]>;
    }

    const promise = this.startRoll(targets);
    this.currentTargets = targets.slice();
    this.activeRoll = promise;
    promise.finally(() => {
      if (this.activeRoll === promise) this.activeRoll = undefined;
    });
    return promise;
  }

  private async startRoll(targets: number[]): Promise<number[]> {
    this.rollState = "rolling";
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // 全万能彩蛋：结果全为"万能"（索引 7）时点亮旋转粉色点光
    this.omniLight.visible = targets.every((value) => value === 7);

    const result = this.preSimulate(targets.length);

    this.dice.forEach((handle) => handle.dispose());
    const textures = await getDiceTextures(this.faceAssets);
    this.dice = await Promise.all(
      result.map((simulation, index) =>
        addDice(this.scene, textures, targets[index], simulation, this.diceScale),
      ),
    );
    this.simulator = this.createWorld(result.map(({ initRotation }) => initRotation));
    this.accumulator = 0;
    this.simulatedTime = 0;
    this.totalTime = result.reduce(
      (longest, simulation) => Math.max(longest, simulation.sleepTime),
      0,
    );
    this.previousFrame = performance.now();

    return new Promise<number[]>((resolve) => {
      this.onRollComplete = resolve;
    });
  }

  private finishRoll(): void {
    this.simulator = undefined;
    this.rollState = "gathering";
  }

  private animate(now: number): void {
    if (this.disposed) return;
    const frameDelta = Math.min((now - this.previousFrame) / 1000, 0.1);
    this.previousFrame = now;

    if (this.rollState === "rolling" && this.simulator) {
      this.accumulator += frameDelta;
      while (
        this.accumulator >= this.board.simulateDt &&
        this.simulatedTime < this.totalTime
      ) {
        const transforms = this.simulator.step();
        this.simulatedTime += this.board.simulateDt;

        this.dice.forEach((handle, index) => {
          const transform = transforms[index];
          handle.group.position.copy(transform.translation);
          handle.group.quaternion.copy(transform.rotation);
          if (this.simulatedTime >= handle.highlightAt) handle.setHighlighted();
        });
        this.accumulator -= this.board.simulateDt;
      }

      if (this.simulatedTime >= this.totalTime) this.finishRoll();
    }

    if (this.rollState === "gathering") {
      let allSettled = true;
      const lerpFactor = 1 - Math.pow(0.001, frameDelta);

      this.dice.forEach((handle, index) => {
        const target = this.getGatherTarget(index);
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
        this.rollState = "done";
        this.onRollComplete?.(this.currentTargets.slice());
        this.onRollComplete = undefined;
      }
    }

    this.omniLightPivot.rotation.y += 1.2 * frameDelta;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    this.dice.forEach((handle) => handle.dispose());
    this.simulator?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
