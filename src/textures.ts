import * as THREE from "three";

export const DICE_COLORS = [
  "#55ddff",
  "#3e99ff",
  "#ff9955",
  "#b380ff",
  "#80ffe6",
  "#ffcc00",
  "#a5c83b",
  "#dcd4c2",
];

const CANVAS_SIZE = 128;
const ICON_R = (CANVAS_SIZE * Math.sqrt(3)) / 6;

export async function getDiceMaterials(): Promise<THREE.MeshStandardMaterial[]> {
  return Promise.all(
    DICE_COLORS.map(async (color, i) => {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      if (i !== 7) {
        const image = new Image();
        const { resolve, reject, promise } = Promise.withResolvers();
        image.crossOrigin = "anonymous";
        image.src = `https://gi-tcg-assets-api-hf.guyutongxue.site/api/v4/image/${
          i + 1
        }`;
        image.onload = resolve;
        image.onerror = reject;
        await promise;
        context.drawImage(
          image,
          0,
          CANVAS_SIZE / 2 - ICON_R,
          2 * ICON_R,
          2 * ICON_R,
        );
      }
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.MeshStandardMaterial({
        map: texture,
      });
      return material;
    }),
  );
}
