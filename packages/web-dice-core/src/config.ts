/** 棋盘/世界配置（实例级，不再有模块级可变全局变量）。单位均为 three.js 世界单位。 */
export interface DiceWorldConfig {
  /** 棋盘 x 轴长度 */
  boardLength: number;
  /** 棋盘 z 轴宽度 */
  boardWidth: number;
  /** 地板厚度（也是地板下沉深度） */
  boundaryThickness: number;
  /** 四周围墙高度（防止骰子飞出） */
  boundaryHeight: number;
  /** 骰子八面体半径（外接球半径），默认骰子 */
  diceSize: number;
  diceMass: number;
  diceRestitution: number;
  /** 骰子初始下落高度 */
  diceInitHeight: number;
  /** 物理步长（秒） */
  simulateDt: number;
}

/** 屏幕像素宽度与世界单位的换算比例：默认棋盘边长 = 容器宽 / 本值（≈屏幕宽度的正方形） */
export const PX_PER_UNIT = 64;

export const DEFAULT_WORLD_CONFIG: DiceWorldConfig = {
  boardLength: 18,
  boardWidth: 12,
  boundaryThickness: 0.25,
  boundaryHeight: 20,
  diceSize: 0.6,
  diceMass: 1.5,
  diceRestitution: 1.1,
  diceInitHeight: 5,
  simulateDt: 0.016,
};

/** 聚拢后骰子中心高度（世界单位） */
export const GATHER_Y = 0.6;

/** 聚拢固定行数：始终 2 行 */
export const GATHER_ROWS = 2;

/** 聚拢时骰子中心间距 = diceSize * 本系数（即骰子间留约 (系数-1) 倍骰子宽度的空隙） */
export const GATHER_GAP_FACTOR = 2.0;

/** 默认骰子八面体半径（geometry 构建用） */
export const DICE_SIZE = DEFAULT_WORLD_CONFIG.diceSize;
