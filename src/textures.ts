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
        image.crossOrigin = "anonymous";
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              image.src = "";
              reject(new Error("Timed out loading dice icon"));
            }, 4000);
            image.onload = () => {
              window.clearTimeout(timeout);
              resolve();
            };
            image.onerror = () => {
              window.clearTimeout(timeout);
              reject(new Error("Failed to load dice icon"));
            };
            image.src = `https://static-data.piovium.org/api/v4/image/${
              i + 1
            }`;
          });
          context.drawImage(
            image,
            CANVAS_SIZE / 2 - ICON_R,
            CANVAS_SIZE * (1 - Math.sqrt(3) / 6) - ICON_R,
            2 * ICON_R,
            2 * ICON_R,
          );
        } catch {
          // The dice remain usable if the optional remote icons are unavailable.
          context.fillStyle = "rgba(15, 23, 42, 0.72)";
          context.font = "700 52px system-ui";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(String(i + 1), CANVAS_SIZE / 2, CANVAS_SIZE / 2);
        }
      }
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.MeshStandardMaterial({
        map: texture,
      });
      return material;
    }),
  );
}
