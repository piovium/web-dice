import * as THREE from "three";
import type { DiceWorldConfig } from "./config";

export interface ChessboardOptions {
  /** 桌面贴图：图片 URL / 已加载的图片 / canvas / null（默认深色桌面） */
  tableTexture?: string | HTMLImageElement | HTMLCanvasElement | null;
  /** 是否显示网格线，默认 false */
  showGrid?: boolean;
  /** 透明模式：地板仅承接骰子阴影（ShadowMaterial），不绘制桌面；
   *  该模式下 tableTexture 无效且不返回可换贴图的材质 */
  transparent?: boolean;
}

/**
 * 棋盘：地板 + 可选网格线 + 可选桌面贴图。
 * 返回地板材质供 setTableTexture 换贴图；透明模式返回 undefined。
 */
export function addChessboard(
  scene: THREE.Scene,
  board: DiceWorldConfig,
  options: ChessboardOptions = {},
): THREE.MeshStandardMaterial | undefined {
  const { tableTexture = null, showGrid = false, transparent = false } = options;

  let material: THREE.MeshStandardMaterial | undefined;
  let floorMaterial: THREE.Material;
  if (transparent) {
    // 只显示骰子投影、不绘制桌面，供调用方把 canvas 叠在自己的内容上
    floorMaterial = new THREE.ShadowMaterial({ opacity: 0.35 });
  } else {
    material = new THREE.MeshStandardMaterial({
      color: "#0f172a",
      roughness: 0.72,
      metalness: 0.08,
    });
    floorMaterial = material;

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
  }

  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      board.boardLength,
      board.boundaryThickness,
      board.boardWidth,
    ),
    floorMaterial,
  );
  floorMesh.receiveShadow = true;
  floorMesh.position.y = -board.boundaryThickness / 2;
  scene.add(floorMesh);

  if (showGrid) {
    const grid = new THREE.GridHelper(
      Math.min(board.boardLength, board.boardWidth),
      12,
      "#334155",
      "#1e293b",
    );
    grid.position.y = 0.006;
    scene.add(grid);
  }
  return material;
}
