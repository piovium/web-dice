import * as THREE from "three";
import type { DiceWorldConfig } from "./config";

/** 棋盘：地板 + 网格线 + 可选桌面贴图 */
export function addChessboard(
  scene: THREE.Scene,
  board: DiceWorldConfig,
  tableTexture?: string | HTMLImageElement | HTMLCanvasElement | null,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: "#0f172a",
    roughness: 0.72,
    metalness: 0.08,
  });

  if (tableTexture) {
    let tex: THREE.Texture | undefined;
    if (typeof tableTexture === "string") {
      tex = new THREE.TextureLoader().load(tableTexture);
    } else {
      tex = new THREE.Texture(tableTexture);
      tex.needsUpdate = true;
    }
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      material.map = tex;
      material.color.set("#ffffff");
    }
  }

  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      board.boardLength,
      board.boundaryThickness,
      board.boardWidth,
    ),
    material,
  );
  floorMesh.receiveShadow = true;
  floorMesh.position.y = -board.boundaryThickness / 2;
  scene.add(floorMesh);

  const grid = new THREE.GridHelper(
    Math.min(board.boardLength, board.boardWidth),
    12,
    "#334155",
    "#1e293b",
  );
  grid.position.y = 0.006;
  scene.add(grid);
  return material;
}
