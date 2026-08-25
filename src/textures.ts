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

const CANVAS_SIZE = 128;
const BG_SIZE = CANVAS_SIZE * 0.9;
const SYMBOL_SIZE = CANVAS_SIZE * 0.3;

// 背景图标（完整面背景，含渐变/边框）
const BG_ICON_PATHS = [
  "./assets/dice/cryo.webp",
  "./assets/dice/hydro.webp",
  "./assets/dice/pyro.webp",
  "./assets/dice/electro.webp",
  "./assets/dice/anemo.webp",
  "./assets/dice/geo.webp",
  "./assets/dice/dendro.webp",
  "./assets/dice/omni.webp",
];

// 原本从 CDN 下载的中心元素符号，现在本地化
const SYMBOL_PATHS = [
  "./assets/symbols/symbol-1.webp",
  "./assets/symbols/symbol-2.webp",
  "./assets/symbols/symbol-3.webp",
  "./assets/symbols/symbol-4.webp",
  "./assets/symbols/symbol-5.webp",
  "./assets/symbols/symbol-6.webp",
  "./assets/symbols/symbol-7.webp",
  "./assets/symbols/omni.svg",
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
  const bgIcons = await Promise.all(BG_ICON_PATHS.map(loadImage));
  const symbols = await Promise.all(SYMBOL_PATHS.map(loadImage));

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

      // map：先用元素色打底，再把 gi-web 背景图标放大铺满，最后叠中心符号
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      const bg = bgIcons[i];
      ctx.drawImage(
        bg,
        (CANVAS_SIZE - BG_SIZE) / 2,
        (CANVAS_SIZE - BG_SIZE) / 2,
        BG_SIZE,
        BG_SIZE,
      );

      if (i < symbols.length) {
        const symbol = symbols[i];
        const sw = SYMBOL_SIZE;
        const sh = (symbol.naturalHeight / symbol.naturalWidth) * sw;
        ctx.drawImage(
          symbol,
          (CANVAS_SIZE - sw) / 2,
          (CANVAS_SIZE - sh) / 2,
          sw,
          sh,
        );
      }

      // emissiveMap：只保留中心符号发光
      emCtx.fillStyle = "#000000";
      emCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      if (i < symbols.length) {
        const symbol = symbols[i];
        const sw = SYMBOL_SIZE;
        const sh = (symbol.naturalHeight / symbol.naturalWidth) * sw;
        emCtx.drawImage(
          symbol,
          (CANVAS_SIZE - sw) / 2,
          (CANVAS_SIZE - sh) / 2,
          sw,
          sh,
        );
      }

      return {
        map: new THREE.CanvasTexture(canvas),
        emissiveMap: new THREE.CanvasTexture(emCanvas),
      };
    }),
  );
}
