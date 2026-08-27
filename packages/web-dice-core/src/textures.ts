import * as THREE from "three";

// 仅用于 UI 高亮和 shader 自发光色调，不再作为面背景
export const DICE_COLORS = [
  "#55ddff", // 冰
  "#3e99ff", // 水
  "#ff9955", // 火
  "#b380ff", // 雷
  "#80ffe6", // 风
  "#ffcc00", // 岩
  "#a5c83b", // 草
  "#d4d4d4", // 万能
];

/** 单个骰面的贴图资源描述 */
export interface DiceFaceAsset {
  /** 面背景图标（含渐变/边框），铺满整面 */
  bgIconUrl: string;
  /** 中心符号 */
  symbolUrl: string;
}

/** 固定 8 项，顺序 = 面索引 0..7 */
export type DiceFaceAssets = readonly DiceFaceAsset[];

export interface DiceTextureSet {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  if (!src) return Promise.reject(new Error("empty src"));
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 跨域图源需 anonymous 才能在 canvas 中读取并上传为 WebGL 贴图，否则画布被污染 → 黑面
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

const CANVAS_SIZE = 128;
const BG_SIZE = CANVAS_SIZE;
const SYMBOL_SIZE = CANVAS_SIZE * 0.3;

/** 由资源 URL 合成 8 张骰面贴图（map + emissiveMap）。单张加载失败时降级为纯元素色面。 */
export async function getDiceTextures(
  assets: DiceFaceAssets,
): Promise<DiceTextureSet[]> {
  const [bgIcons, symbols] = await Promise.all([
    Promise.all(assets.map((a) => loadImage(a.bgIconUrl).catch(() => null))),
    Promise.all(assets.map((a) => loadImage(a.symbolUrl).catch(() => null))),
  ]);

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

      // map：元素色打底 → 背景图标铺满 → 中心符号
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      const bg = bgIcons[i];
      if (bg) {
        ctx.drawImage(bg, (CANVAS_SIZE - BG_SIZE) / 2, (CANVAS_SIZE - BG_SIZE) / 2, BG_SIZE, BG_SIZE);
      }

      const symbol = symbols[i];
      if (symbol) {
        const sw = SYMBOL_SIZE;
        const sh = (symbol.naturalHeight / symbol.naturalWidth) * sw;
        ctx.drawImage(symbol, (CANVAS_SIZE - sw) / 2, (CANVAS_SIZE - sh) / 2, sw, sh);
      }

      // emissiveMap：只保留中心符号发光
      emCtx.fillStyle = "#000000";
      emCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      if (symbol) {
        const sw = SYMBOL_SIZE;
        const sh = (symbol.naturalHeight / symbol.naturalWidth) * sw;
        emCtx.drawImage(symbol, (CANVAS_SIZE - sw) / 2, (CANVAS_SIZE - sh) / 2, sw, sh);
      }

      return {
        map: new THREE.CanvasTexture(canvas),
        emissiveMap: new THREE.CanvasTexture(emCanvas),
      };
    }),
  );
}
