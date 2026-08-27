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
} from "web-dice-core";
import { PhysicsBackend } from "./rapier-backend";

export {
  DICE_COLORS,
  ELEMENT_NAMES,
  ELEMENT_NAMES_EN,
  ELEMENT_NAMES_ZH,
  MIN_DICE_COUNT,
  MAX_DICE_COUNT,
  parseBoardSize,
};
export type { BoardSize, DiceFaceAsset, DiceFaceAssets };

/**
 * 骰面贴图默认从 CDN 加载（包体积最小）：
 * 用原仓库的远程图源 static-data.piovium.org（面索引 1..8 对应远程图标），
 * 作为中心符号；背景以元素色打底。可�?faceAssets 选项覆盖。
 */
const CDN_BASE = "https://static-data.piovium.org/api/v4/image";
const CDN_FACE_ASSETS: DiceFaceAssets = Array.from({ length: 8 }, (_, i) => ({
  bgIconUrl: "",
  symbolUrl: `${CDN_BASE}/${i + 1}`,
}));

export interface WebDiceOptions {
  /** 挂载容器，包在内部创�?canvas �?prepend */
  container: HTMLElement;
  /** 棋盘大小（世界单位）。缺省：容器窄边换算的正方形 */
  boardSize?: BoardSize;
  /** 桌面贴图：图�?URL / 已加载的图片 / canvas / null（默认深色网格桌面） */
  tableTexture?: string | HTMLImageElement | HTMLCanvasElement | null;
  /** 是否响应手势（旋�?缩放），默认 false */
  rotatable?: boolean;
  /** 初始七圣骰子结果：长度即骰子数量�?�?6），元素为面索引 0�?。缺�?8 �?0..7 */
  initialResults?: readonly number[];
  /** 覆盖默认骰面贴图来源（默�?CDN�?*/
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
      tableTexture: options.tableTexture ?? null,
      faceAssets: options.faceAssets ?? CDN_FACE_ASSETS,
    });
    renderer.setDiceCount(initialResults.length);
    await renderer.init();
    return new WebDice(renderer, initialResults.length);
  }

  /**
   * 投掷。返回按骰子顺序排列的最终朝上面索引数组�?   * 不传参：按构造时骰子数量随机；传入：长度 1�?6 的指定结果�?   */
  roll(results?: readonly number[]): Promise<number[]> {
    if (results === undefined) {
      const targets = Array.from(
        { length: this.defaultCount },
        () => Math.floor(Math.random() * 8),
      );
      this.renderer.setDiceCount(targets.length);
      return this.renderer.roll(targets);
    }
    validateResults(results);
    this.renderer.setDiceCount(results.length);
    return this.renderer.roll(results.slice());
  }

  /** 运行时开/关手势响应（旋转 + 缩放�?*/
  setRotatable(rotatable: boolean): void {
    this.renderer.setRotatable(rotatable);
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
