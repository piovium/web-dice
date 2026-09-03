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
  Vec3Like,
} from "./physics/types";
import { addChessboard } from "./board";
import {
  addDice,
  deriveUpFaceElement,
  type DiceHandle,
} from "./dice";
import { getDiceTextures, type DiceFaceAssets } from "./textures";

/** 骰子数量范围：最少 1 颗，最多 16 颗 */
export const MIN_DICE_COUNT = 1;
export const MAX_DICE_COUNT = 16;

/** 投掷倍速范围：1–10 的整数 */
export const MIN_SPEED = 1;
export const MAX_SPEED = 10;

/** 校验投掷倍速：1–10 的整数，非法值抛 RangeError */
function validateSpeed(speed: number): void {
  if (!Number.isInteger(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
    throw new RangeError(
      `speed must be an integer between ${MIN_SPEED} and ${MAX_SPEED}, got ${speed}`,
    );
  }
}

/** 单轮投掷结束的记录（roll 的 onRoundComplete 回调参数，纯记录用途） */
export interface DiceRoundRecord {
  /** 轮次，从 1 开始 */
  round: number;
  /** 本轮聚拢完成时各骰子朝上面索引，按聚拢展示顺序（万能(7)优先，其余元素升序） */
  faces: number[];
  /** 本轮实际被重投的骰子索引（第 1 轮为 []；为用户点选的骰子原始索引） */
  rerolledIndices: number[];
}

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
  /** 是否显示棋盘网格线，默认 false */
  showGrid?: boolean;
  /** 透明模式：canvas 背景与棋盘地板全透明（仅保留骰子投影），
   *  供调用方把 canvas 叠在自己的页面内容上。该模式下 tableTexture 无效，默认 false */
  transparent?: boolean;
  /** 投掷动画倍速：1–10 的整数，默认 1（原速）。作用于投掷、聚拢、重投全流程 */
  speed?: number;
  /** 默认掷骰轮数（整数 ≥ 1），默认 1；roll() 未显式传 rounds 时生效 */
  rounds?: number;
  tableTexture?: string | HTMLImageElement | HTMLCanvasElement | null;
  faceAssets: DiceFaceAssets;
}

type RollState =
  | "idle"
  | "rolling"
  | "gathering"
  | "selecting"
  | "reroll-parking"
  | "reroll-falling"
  | "done";

/** 重投：未选中骰子停靠点距棋盘角落的留白（× diceSize） */
const PARK_MARGIN_FACTOR = 1.4;
/** 重投：未选中骰子停靠点间距（× diceSize） */
const PARK_GAP_FACTOR = 1.25;
/** 重投实时模拟的保底时长（秒），超过后强制视为全部 sleep，防永不休眠卡死 */
const REROLL_MAX_SIM_TIME = 12;
/** 骰子创建后至少模拟该时长才开始判定 sleep（避免刚体初始即判定休眠） */
const SLEEP_GRACE_TIME = 0.5;

/** 停靠列中心距（×缩小后骰子外接半径）：1.25 倍直径，留出可见间隙防穿模 */
const PARK_COLUMN_GAP = 2.5;

/** 聚拢排序键：万能(7)最优先，其余元素按面索引升序 */
const gatherOrderKey = (face: number): number => (face === 7 ? -1 : face);

/** 按聚拢展示顺序（万能优先，其余升序，稳定排序）排序面索引数组 */
const sortGatheredFaces = (faces: number[]): number[] =>
  faces.slice().sort((a, b) => gatherOrderKey(a) - gatherOrderKey(b));

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
  /** 投掷动画倍速（1–10 整数），作用于 animate 的帧时长 */
  private speed: number;
  /** roll() 未显式传 rounds 时的默认轮数 */
  private readonly defaultRounds: number;

  private activeRoll: Promise<number[]> | undefined;
  private readonly faceAssets: DiceFaceAssets;
  private floorMaterial: THREE.MeshStandardMaterial | undefined;
  /** 当前各骰子的元素结果（重投会原地更新对应项） */
  private currentFaces: number[] = [];
  /** 多轮投掷：总轮数与已进行到的轮次（均从 1 计） */
  private totalRounds = 1;
  private currentRound = 1;
  /** 外层 roll() promise 的结算器（全部轮次完成或跳过时 resolve） */
  private rollSettle:
    | {
        resolve: (faces: number[]) => void;
        reject: (error: unknown) => void;
      }
    | undefined;
  /** 每轮结束的记录回调（调用方可选传入） */
  private onRoundComplete: ((record: DiceRoundRecord) => void) | undefined;
  /** 刚结束的这一轮中实际被重投的骰子索引（第 1 轮为 []） */
  private lastRerolledIndices: number[] = [];

  // 重投：被选中重掷 / 平移停靠的骰子索引与动画目标
  private rerollIndices: number[] = [];
  private parkedIndices: number[] = [];
  private parkTargets = new Map<number, THREE.Vector3>();
  private liftTargets = new Map<number, THREE.Vector3>();
  private rerollSim: IPhysicsWorld | undefined;
  private rerollSimTime = 0;
  private lastRerollTransforms: BodyTransform[] = [];
  private rerollSelection = new Set<number>();

  /** 聚拢槽位映射：骰子索引 → 展示槽位（万能(7)优先，其余元素升序），每次进入聚拢时重算 */
  private gatherSlotOfIndex: number[] = [];
  /** 聚拢摆平目标旋转：把 sleep 后可能倾斜的结果面经最短弧转至精确朝上 */
  private gatherQuatTargets: THREE.Quaternion[] = [];
  /** 停靠阶段缩放：未参与重投的骰子列超出棋盘宽度时自动缩小，聚拢时恢复 */
  private parkScale = 1;

  // 选择交互：确认/重投按钮 + 点选拾取
  private readonly decisionButton: HTMLButtonElement;
  private readonly raycaster = new THREE.Raycaster();
  private pointerDownAt: { x: number; y: number } | undefined;

  constructor(container: HTMLElement, options: DiceRendererOptions) {
    this.container = container;
    this.backend = options.backend;
    this.faceAssets = options.faceAssets;
    this.board = { ...DEFAULT_WORLD_CONFIG };
    this.diceCount = 8;

    const speed = options.speed ?? 1;
    validateSpeed(speed);
    this.speed = speed;

    const defaultRounds = options.rounds ?? 1;
    if (!Number.isInteger(defaultRounds) || defaultRounds < 1) {
      throw new RangeError(
        `rounds must be an integer >= 1, got ${defaultRounds}`,
      );
    }
    this.defaultRounds = defaultRounds;

    const transparent = options.transparent ?? false;
    if (!transparent) {
      this.scene.background = new THREE.Color("#070b16");
      // 雾只染颜色不影响 alpha，透明模式下开启会在远处骰子边缘留下暗边，故不加
      this.scene.fog = new THREE.Fog("#070b16", 17, 34);
    }

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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent });
    if (transparent) this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.prepend(this.renderer.domElement);

    // 重投选择阶段的确认/重投按钮（DOM 覆盖层，随容器定位）
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    this.decisionButton = document.createElement("button");
    this.decisionButton.type = "button";
    this.decisionButton.className = "web-dice-decision-button";
    this.decisionButton.textContent = "确认跳过后续所有重投轮次";
    Object.assign(this.decisionButton.style, {
      position: "absolute",
      left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: "10",
      display: "none",
      padding: "10px 22px",
      borderRadius: "999px",
      border: "1px solid rgba(250, 204, 21, 0.55)",
      background: "linear-gradient(135deg, #43380f, #7a5c1a)",
      color: "#fde68a",
      fontSize: "15px",
      fontWeight: "600",
      letterSpacing: "0.04em",
      cursor: "pointer",
      whiteSpace: "nowrap",
      boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
    });
    this.decisionButton.addEventListener("click", this.handleDecisionClick);
    container.appendChild(this.decisionButton);

    // 点选骰子：按下/抬起位移小于阈值才算单击（与旋转手势区分）
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.handlePointerDown,
    );
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(
      debounce(() => this.resize(), 100),
    );
    this.resizeObserver.observe(container);

    this.floorMaterial = addChessboard(this.scene, this.board, {
      tableTexture: options.tableTexture ?? null,
      showGrid: options.showGrid ?? false,
      transparent,
    });

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
    // 选择阶段按钮跟随棋盘下边缘位置
    this.positionDecisionButton();
  }

  setRotatable(rotatable: boolean): void {
    this.controls.enableRotate = rotatable;
    this.controls.enableZoom = rotatable;
  }

  /** 运行时调整投掷倍速（1–10 整数），对进行中的投掷也立即生效 */
  setSpeed(speed: number): void {
    validateSpeed(speed);
    this.speed = speed;
  }

  /** 替换桌面贴图；传 null 恢复默认深色桌面。透明模式下无地板材质，为空操作 */
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

  private createWorld(
    initRotations: THREE.QuaternionLike[],
    overrides?: {
      initPositions?: readonly Vec3Like[];
      angularVelocities?: readonly Vec3Like[];
    },
  ): IPhysicsWorld {
    return this.backend.createWorld({
      diceCount: initRotations.length,
      initRotations,
      initPositions: overrides?.initPositions,
      angularVelocities: overrides?.angularVelocities,
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

  /**
   * 投掷并播放动画，resolve 最终各骰子朝上的面，按聚拢展示顺序排序：
   * 万能(7)最优先，其余元素升序（同面按骰子原索引稳定排序，默认行为不可关闭）。
   * rounds 缺省用构造选项的 rounds（默认 1）；> 1 时进入多轮流程：每轮聚拢后
   * 允许点选骰子重投（见 WebDice.roll 文档），全部轮次完成或用户跳过后 resolve 最终结果。
   */
  roll(
    targets: number[],
    rounds?: number,
    onRoundComplete?: (record: DiceRoundRecord) => void,
  ): Promise<number[]> {
    if (this.disposed) return Promise.reject(new Error("DiceRenderer disposed"));
    const totalRounds = rounds ?? this.defaultRounds;
    if (!Number.isInteger(totalRounds) || totalRounds < 1) {
      return Promise.reject(
        new RangeError(`rounds must be an integer >= 1, got ${totalRounds}`),
      );
    }
    if (this.rollState !== "idle" && this.rollState !== "done") {
      // 忙碌时忽略新请求，返回进行中的同一结果
      return (this.activeRoll ?? Promise.resolve([])) as Promise<number[]>;
    }

    this.totalRounds = totalRounds;
    this.currentRound = 1;
    this.currentFaces = targets.slice();
    this.lastRerolledIndices = [];
    this.onRoundComplete = onRoundComplete;

    const promise = new Promise<number[]>((resolve, reject) => {
      this.rollSettle = { resolve, reject };
    });
    this.activeRoll = promise;
    promise.finally(() => {
      if (this.activeRoll === promise) this.activeRoll = undefined;
    });

    this.startRoll(targets).catch((error) => {
      this.rollState = "done";
      const settle = this.rollSettle;
      this.rollSettle = undefined;
      settle?.reject(error);
    });
    return promise;
  }

  private async startRoll(targets: number[]): Promise<void> {
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
  }

  private finishRoll(): void {
    this.simulator = undefined;
    this.beginGathering();
  }

  /** 进入聚拢：按“万能(7)优先、其余元素升序”重算骰子的展示槽位（默认行为，不可关闭） */
  private beginGathering(): void {
    const order = this.dice
      .map((_, index) => index)
      .sort((a, b) => {
        const keyDiff =
          gatherOrderKey(this.currentFaces[a]) -
          gatherOrderKey(this.currentFaces[b]);
        return keyDiff !== 0 ? keyDiff : a - b; // 同面按骰子原索引稳定排序
      });
    this.gatherSlotOfIndex = new Array(this.dice.length);
    order.forEach((diceIndex, slot) => {
      this.gatherSlotOfIndex[diceIndex] = slot;
    });
    this.gatherQuatTargets = this.dice.map((handle) =>
      handle.computeFlattenTarget(),
    );
    this.rollState = "gathering";
  }

  /** 聚拢落定后的轮次推进：记录回调 → 还有后续轮次进入重投选择，否则结算 */
  private handleGatherSettled(): void {
    // 回调在进入选择阶段前触发，faces 已确定；调用方回调异常不应打断渲染循环
    if (this.onRoundComplete) {
      const record: DiceRoundRecord = {
        round: this.currentRound,
        faces: sortGatheredFaces(this.currentFaces),
        rerolledIndices: this.lastRerolledIndices.slice(),
      };
      const callback = this.onRoundComplete;
      try {
        callback(record);
      } catch (error) {
        setTimeout(() => {
          throw error;
        }, 0);
      }
    }

    if (this.currentRound < this.totalRounds) {
      this.enterSelection();
    } else {
      this.finishActiveRoll();
    }
  }

  /** 结算外层 roll() promise（全部轮次完成 / 用户跳过），结果按聚拢展示顺序输出 */
  private finishActiveRoll(): void {
    this.rollState = "done";
    const settle = this.rollSettle;
    this.rollSettle = undefined;
    settle?.resolve(sortGatheredFaces(this.currentFaces));
  }

  // ---- 重投选择阶段 ----

  private enterSelection(): void {
    this.rollState = "selecting";
    this.rerollSelection.clear();
    this.updateDecisionButton();
    this.positionDecisionButton();
    this.decisionButton.style.display = "block";
  }

  /**
   * 将确认/重投按钮摆在聚拢布局"第三行"的居中位置（两行骰子正下方）。
   * 锚定 canvas 元素的实际屏幕盒子（棋盘永远居中于 canvas，而 canvas 未必铺满
   * 容器——部署页里棋盘可能是顶部的正方形、下方是面板）：
   * - 位置 = canvas 中心 + 1.5·spacingZ（聚拢固定 2 行，行中心 ±spacingZ/2）；
   * - 世界单位 → 像素换算：可见世界高度 = 2·相机高度·tan(fov/2)（俯视）。
   */
  private positionDecisionButton(): void {
    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const s = this.board.diceSize;
    const margin = s * 1.5;
    const ideal = s * GATHER_GAP_FACTOR;
    const spacingZ = Math.max(
      s,
      Math.min(ideal, (this.board.boardWidth - margin * 2) / GATHER_ROWS),
    );
    const vfov = (this.camera.fov * Math.PI) / 180;
    const pxPerUnit =
      canvasRect.height / (2 * this.camera.position.y * Math.tan(vfov / 2));
    const left =
      canvasRect.left - containerRect.left + canvasRect.width / 2;
    const top =
      canvasRect.top -
      containerRect.top +
      canvasRect.height / 2 +
      1.5 * spacingZ * pxPerUnit;
    this.decisionButton.style.left = `${left}px`;
    this.decisionButton.style.top = `${top}px`;
    this.decisionButton.style.bottom = "auto";
  }

  private updateDecisionButton(): void {
    this.decisionButton.textContent =
      this.rerollSelection.size > 0 ? "重新投掷" : "确认跳过后续所有重投轮次";
  }

  private readonly handleDecisionClick = (): void => {
    if (this.rollState !== "selecting") return;
    this.decisionButton.style.display = "none";
    const selected = [...this.rerollSelection];
    this.rerollSelection.clear();
    selected.forEach((index) => this.dice[index].setSelected(false));

    if (selected.length === 0) {
      // 无选中：跳过后续所有重投轮次
      this.finishActiveRoll();
      return;
    }
    this.currentRound += 1;
    this.startReroll(selected);
  };

  /** 重投：未选中骰子平移至棋盘右上角停靠，选中骰子升起后原地下落（实时物理） */
  private startReroll(selected: number[]): void {
    this.rollState = "reroll-parking";
    this.rerollIndices = selected;
    this.lastRerolledIndices = selected.slice();
    const selectedSet = new Set(selected);
    this.parkedIndices = this.dice
      .map((_, index) => index)
      .filter((index) => !selectedSet.has(index));

    const s = this.board.diceSize;
    // 悬停停靠：抬高到重投下落起始平面之上，避免与下落/弹跳的骰子重叠穿模
    // （移动端棋盘小，右上角停靠点可能与聚拢落点水平重叠）；停靠按一列排布，
    // 整列固定缩小到一半，聚拢时恢复原尺寸
    const parkY = Math.max(GATHER_Y, this.board.diceInitHeight + s * 2.5);
    this.parkScale = this.diceScale * 0.5;
    const parkGap = s * this.parkScale * PARK_COLUMN_GAP;
    const parkX = this.board.boardLength / 2 - s * this.parkScale * PARK_MARGIN_FACTOR;
    const parkZ = -this.board.boardWidth / 2 + s * this.parkScale * PARK_MARGIN_FACTOR;
    // 透视补偿：悬停平面高于地面，越靠边越会被透视放大出画，
    // 等比向轴心收缩使其投影仍落在棋盘右上角范围内。
    // 补偿只作用于基准锚点：世界列间距若一并收缩，投影后的间隙会小于
    // 同步放大的视觉直径导致穿模，故列间距保持世界距离
    const persp =
      (this.camera.position.y - parkY) / this.camera.position.y;
    this.parkTargets = new Map();
    this.parkedIndices.forEach((diceIndex, k) => {
      this.parkTargets.set(
        diceIndex,
        new THREE.Vector3(parkX * persp, parkY, parkZ * persp + k * parkGap),
      );
    });

    const dropHeight = this.board.diceInitHeight;
    this.liftTargets = new Map();
    selected.forEach((diceIndex) => {
      const pos = this.dice[diceIndex].group.position;
      this.liftTargets.set(diceIndex, new THREE.Vector3(pos.x, dropHeight, pos.z));
    });

    // 物理世界只含重投骰：保持当前朝向 + 随机角速度原地下落，不做记录重放
    this.rerollSim = this.createWorld(
      selected.map((diceIndex) => this.dice[diceIndex].group.quaternion),
      {
        initPositions: selected.map((diceIndex) => {
          const pos = this.dice[diceIndex].group.position;
          return { x: pos.x, y: dropHeight, z: pos.z };
        }),
        angularVelocities: selected.map(() => {
          const axis = new THREE.Vector3().randomDirection();
          const speed = 6 + Math.random() * 8;
          return { x: axis.x * speed, y: axis.y * speed, z: axis.z * speed };
        }),
      },
    );
    this.rerollSimTime = 0;
    this.lastRerollTransforms = [];
  }

  /** 重投结算：由静止姿态 + 校正旋转推导实际朝上的元素，并更新结果 */
  private finishReroll(): void {
    this.rerollIndices.forEach((diceIndex, k) => {
      const transform = this.lastRerollTransforms[k];
      if (!transform) return;
      const upOctant = calcFinalUpFace(transform.rotation);
      const element = deriveUpFaceElement(
        this.dice[diceIndex].correctionRotation,
        upOctant,
      );
      this.currentFaces[diceIndex] = element;
      this.dice[diceIndex].setFaceGlow(element);
    });
    this.rerollSim?.dispose();
    this.rerollSim = undefined;
    this.omniLight.visible = this.currentFaces.every((value) => value === 7);
    this.beginGathering();
  }

  // ---- 点选拾取 ----

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const down = this.pointerDownAt;
    this.pointerDownAt = undefined;
    if (!down || this.rollState !== "selecting") return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    if (dx * dx + dy * dy > 36) return; // 位移过大视为拖动手势
    this.toggleDiceAt(event);
  };

  private toggleDiceAt(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.dice.map((handle) => handle.group),
      true,
    );
    if (hits.length === 0) return;

    let obj: THREE.Object3D | null = hits[0].object;
    while (obj && !this.dice.some((handle) => handle.group === obj)) {
      obj = obj.parent;
    }
    if (!obj) return;
    const index = this.dice.findIndex((handle) => handle.group === obj);
    if (index < 0) return;

    if (this.rerollSelection.has(index)) {
      this.rerollSelection.delete(index);
      this.dice[index].setSelected(false);
    } else {
      this.rerollSelection.add(index);
      this.dice[index].setSelected(true);
    }
    this.updateDecisionButton();
  }

  private animate(now: number): void {
    if (this.disposed) return;
    // speed 倍速：放大帧时长，物理步进、聚拢/停靠插值、彩蛋灯光随之整体加速
    const frameDelta =
      Math.min((now - this.previousFrame) / 1000, 0.1) * this.speed;
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

    // 重投第一段：未选中骰子平移到右上角停靠，重投骰子升到下落起始高度
    if (this.rollState === "reroll-parking") {
      const lerpFactor = 1 - Math.pow(0.001, frameDelta);
      let allSettled = true;
      const moveTowards = (handle: DiceHandle, target: THREE.Vector3) => {
        const pos = handle.group.position;
        pos.x += (target.x - pos.x) * lerpFactor;
        pos.y += (target.y - pos.y) * lerpFactor;
        pos.z += (target.z - pos.z) * lerpFactor;
        if (pos.distanceToSquared(target) > 0.01 * 0.01) allSettled = false;
      };
      this.parkedIndices.forEach((index) => {
        const handle = this.dice[index];
        const target = this.parkTargets.get(index);
        if (target) moveTowards(handle, target);
        // 停靠整列缩小
        const scale = handle.group.scale;
        scale.setScalar(scale.x + (this.parkScale - scale.x) * lerpFactor);
        if (Math.abs(scale.x - this.parkScale) > 0.01) allSettled = false;
      });
      this.rerollIndices.forEach((index) => {
        const target = this.liftTargets.get(index);
        if (target) moveTowards(this.dice[index], target);
      });

      if (allSettled) {
        this.rollState = "reroll-falling";
        this.accumulator = 0;
      }
    }

    // 重投第二段：实时物理原地下落，等待全部 sleep（含保底时长）
    if (this.rollState === "reroll-falling" && this.rerollSim) {
      const sim = this.rerollSim;
      this.accumulator += frameDelta;
      let transforms = this.lastRerollTransforms;
      while (this.accumulator >= this.board.simulateDt) {
        transforms = sim.step();
        this.rerollSimTime += this.board.simulateDt;
        this.accumulator -= this.board.simulateDt;
      }
      transforms.forEach((transform, k) => {
        const handle = this.dice[this.rerollIndices[k]];
        handle.group.position.copy(transform.translation);
        handle.group.quaternion.copy(transform.rotation);
      });
      this.lastRerollTransforms = transforms;

      const allSleeping =
        this.rerollSimTime > SLEEP_GRACE_TIME &&
        (this.rerollIndices.every((_, k) => sim.isSleeping(k)) ||
          this.rerollSimTime > REROLL_MAX_SIM_TIME);
      if (allSleeping) this.finishReroll();
    }

    if (this.rollState === "gathering") {
      let allSettled = true;
      const lerpFactor = 1 - Math.pow(0.001, frameDelta);

      this.dice.forEach((handle, index) => {
        const target = this.getGatherTarget(this.gatherSlotOfIndex[index]);
        const pos = handle.group.position;

        pos.x += (target.x - pos.x) * lerpFactor;
        pos.z += (target.z - pos.z) * lerpFactor;
        pos.y += (target.y - pos.y) * lerpFactor;

        // 恢复标准尺寸（停靠阶段整列缩小过）
        const scale = handle.group.scale;
        scale.setScalar(scale.x + (this.diceScale - scale.x) * lerpFactor);

        // 同步摆平：结果面经最短弧转至精确平行于地面
        const targetQuat = this.gatherQuatTargets[index];
        if (targetQuat) {
          handle.group.quaternion.slerp(targetQuat, lerpFactor);
        }

        if (
          Math.abs(pos.x - target.x) > 0.01 ||
          Math.abs(pos.z - target.z) > 0.01 ||
          Math.abs(pos.y - target.y) > 0.01 ||
          Math.abs(scale.x - this.diceScale) > 0.01 ||
          (targetQuat &&
            handle.group.quaternion.angleTo(targetQuat) > 0.01)
        ) {
          allSettled = false;
        }
      });

      if (allSettled) {
        this.rollState = "done";
        this.handleGatherSettled();
      }
    }

    this.omniLightPivot.rotation.y += 1.2 * frameDelta;

    this.controls.update();
    // 选择阶段按钮跟随棋盘（相机拖转/阻尼时保持贴合棋盘范围内侧）
    if (this.rollState === "selecting") this.positionDecisionButton();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    this.decisionButton.removeEventListener("click", this.handleDecisionClick);
    this.decisionButton.remove();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.handlePointerDown,
    );
    this.renderer.domElement.removeEventListener(
      "pointerup",
      this.handlePointerUp,
    );
    this.dice.forEach((handle) => handle.dispose());
    this.simulator?.dispose();
    this.rerollSim?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
