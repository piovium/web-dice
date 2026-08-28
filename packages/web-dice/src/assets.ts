import cryoBg from "./assets/dice/cryo.webp?inline";
import hydroBg from "./assets/dice/hydro.webp?inline";
import pyroBg from "./assets/dice/pyro.webp?inline";
import electroBg from "./assets/dice/electro.webp?inline";
import anemoBg from "./assets/dice/anemo.webp?inline";
import geoBg from "./assets/dice/geo.webp?inline";
import dendroBg from "./assets/dice/dendro.webp?inline";
import omniBg from "./assets/dice/omni.webp?inline";
import omniSymbol from "./assets/symbols/omni.svg?inline";
import type { DiceFaceAssets } from "web-dice-core";

/**
 * 骰面贴图默认源（混合策略，包体积与完整性兼顾）：
 * - 中心元素符号（面 1..7）：沿用 CDN 远程图源，包体积最小；
 * - 骰面背景 + 万能骰图标：CDN 缺这两类资源，改为包内内联 data URL（离线亦可用）。
 */
const CDN_BASE = "https://static-data.piovium.org/api/v4/image";

export const DEFAULT_FACE_ASSETS: DiceFaceAssets = [
  { bgIconUrl: cryoBg, symbolUrl: `${CDN_BASE}/1` },
  { bgIconUrl: hydroBg, symbolUrl: `${CDN_BASE}/2` },
  { bgIconUrl: pyroBg, symbolUrl: `${CDN_BASE}/3` },
  { bgIconUrl: electroBg, symbolUrl: `${CDN_BASE}/4` },
  { bgIconUrl: anemoBg, symbolUrl: `${CDN_BASE}/5` },
  { bgIconUrl: geoBg, symbolUrl: `${CDN_BASE}/6` },
  { bgIconUrl: dendroBg, symbolUrl: `${CDN_BASE}/7` },
  { bgIconUrl: omniBg, symbolUrl: omniSymbol },
];
