import {
  DiceRenderer,
  DICE_COLORS,
  ELEMENT_NAMES,
  ELEMENT_NAMES_EN,
  ELEMENT_NAMES_ZH,
  MAX_DICE_COUNT,
  MIN_DICE_COUNT,
  parseBoardSize,
  validateResults,
  type BoardSize,
  type DiceFaceAsset,
  type DiceFaceAssets,
  type DiceRoundRecord,
} from "web-dice-core";
import { PhysicsBackend } from "./oimo-backend";
import { INLINE_FACE_ASSETS } from "./assets";

export {
  DICE_COLORS,
  ELEMENT_NAMES,
  ELEMENT_NAMES_EN,
  ELEMENT_NAMES_ZH,
  MIN_DICE_COUNT,
  MAX_DICE_COUNT,
  parseBoardSize,
};
export type {
  BoardSize,
  DiceFaceAsset,
  DiceFaceAssets,
  DiceRoundRecord,
};

export interface WebDiceOptions {
  /** 挂载容器，包在内部创建 canvas 并 prepend */
  container: HTMLElement;
  /** 棋盘大小（世界单位）。缺省：容器窄边换算的正方形 */
  boardSize?: BoardSize;
  /** 桌面贴图：图片 URL / 已加载的图片 / canvas / null（默认深色桌面） */
  tableTexture?: string | HTMLImageElement | HTMLCanvasElement | null;
  /** 是否响应手势（旋转/缩放），默认 false */
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
  /** 初始七圣骰子结果：长度即骰子数量（1–16），元素为面索引 0–7。缺省 8 颗 0..7 */
  initialResults?: readonly number[];
  /** 覆盖默认骰面贴图来源（默认为包内内联 data URL，离线可用） */
  faceAssets?: DiceFaceAssets;
  /** 骰子尺寸（世界单位）。缺省 0.6；移动端可 0.5，桌面端可 1.0 */
  diceSize?: number;
}

export class WebDice {
  private constructor(
    private readonly renderer: DiceRenderer,
    private readonly defaultCount: number,
  ) {}

  static async create(options: WebDiceOptions): Promise<WebDice> {
    const { container } = options;
    const board =
      options.boardSize !== undefined
        ? parseBoardSize(options.boardSize)
        : undefined;
    const initialResults = options.initialResults ?? [0, 1, 2, 3, 4, 5, 6, 7];
    validateResults(initialResults);

    const renderer = new DiceRenderer(container, {
      backend: new PhysicsBackend(),
      world: board,
      diceSize: options.diceSize,
      rotatable: options.rotatable ?? false,
      showGrid: options.showGrid ?? false,
      transparent: options.transparent ?? false,
      speed: options.speed,
      rounds: options.rounds,
      tableTexture: options.tableTexture ?? null,
      faceAssets: options.faceAssets ?? INLINE_FACE_ASSETS,
    });
    renderer.setDiceCount(initialResults.length);
    await renderer.init();
    return new WebDice(renderer, initialResults.length);
  }

  /**
   * 投掷。返回最终朝上面索引数组，按聚拢展示顺序排序：万能(7)最优先，其余元素
   * 升序（同面按骰子原索引稳定排序，默认行为不可关闭），即与聚拢后的视觉排布一致，
   * 不再对应投掷时的骰子传入顺序。
   * - results：长度 1–16 的指定结果；缺省按构造时骰子数量随机生成。
   * - rounds：掷骰轮数（整数 ≥ 1），缺省用创建时的 rounds 选项（默认 1）——
   *   直接渲染指定结果的投掷动画。
   *   大于 1 时为多轮模式：第一轮聚拢后进入重投选择阶段，单击骰子切换选中
   *   （淡黄色描边圈包裹轮廓），按钮在“重新投掷”（有选中）与“确认跳过后续
   *   所有重投轮次”（无选中）间切换。点击“重新投掷”后，未选中骰子平移至
   *   棋盘右上角停靠，选中骰子原地下落随机重掷，全部 sleep 后重新聚拢并进入
   *   下一轮（如还有）；点击“确认跳过…”则立即结束并返回当前结果。
   * - onRoundComplete：可选的每轮记录回调，每轮聚拢完成、进入下一轮选择前
   *   触发（纯记录用途；主结果以 resolve 值为准。已回调轮数小于 rounds 即
   *   表示中途跳过）。
   * 整个多轮流程结束（完成或跳过）后 resolve 最终结果。
   */
  roll(
    results?: readonly number[],
    rounds?: number,
    onRoundComplete?: (record: DiceRoundRecord) => void,
  ): Promise<number[]> {
    if (results === undefined) {
      const targets = Array.from(
        { length: this.defaultCount },
        () => Math.floor(Math.random() * 8),
      );
      this.renderer.setDiceCount(targets.length);
      return this.renderer.roll(targets, rounds, onRoundComplete);
    }
    validateResults(results);
    this.renderer.setDiceCount(results.length);
    return this.renderer.roll(results.slice(), rounds, onRoundComplete);
  }

  /** 运行时开/关手势响应（旋转 + 缩放） */
  setRotatable(rotatable: boolean): void {
    this.renderer.setRotatable(rotatable);
  }

  /** 运行时调整投掷倍速（1–10 整数），对进行中的投掷也立即生效 */
  setSpeed(speed: number): void {
    this.renderer.setSpeed(speed);
  }

  setTableTexture(
    texture: NonNullable<WebDiceOptions["tableTexture"]>,
  ): void {
    this.renderer.setTableTexture(texture);
  }

  resize(): void {
    this.renderer.resize();
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
