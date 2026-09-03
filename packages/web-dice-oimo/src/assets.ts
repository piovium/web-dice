import cryoBg from "./assets/dice/cryo.webp?inline";
import hydroBg from "./assets/dice/hydro.webp?inline";
import pyroBg from "./assets/dice/pyro.webp?inline";
import electroBg from "./assets/dice/electro.webp?inline";
import anemoBg from "./assets/dice/anemo.webp?inline";
import geoBg from "./assets/dice/geo.webp?inline";
import dendroBg from "./assets/dice/dendro.webp?inline";
import omniBg from "./assets/dice/omni.webp?inline";
import symbol1 from "./assets/symbols/symbol-1.webp?inline";
import symbol2 from "./assets/symbols/symbol-2.webp?inline";
import symbol3 from "./assets/symbols/symbol-3.webp?inline";
import symbol4 from "./assets/symbols/symbol-4.webp?inline";
import symbol5 from "./assets/symbols/symbol-5.webp?inline";
import symbol6 from "./assets/symbols/symbol-6.webp?inline";
import symbol7 from "./assets/symbols/symbol-7.webp?inline";
import omniSymbol from "./assets/symbols/omni.svg?inline";
import type { DiceFaceAssets } from "gi-dice-core";

/** 内联 data URL 贴图（离线可用，满足小红书禁外链约束�?*/
export const INLINE_FACE_ASSETS: DiceFaceAssets = [
  { bgIconUrl: cryoBg, symbolUrl: symbol1 },
  { bgIconUrl: hydroBg, symbolUrl: symbol2 },
  { bgIconUrl: pyroBg, symbolUrl: symbol3 },
  { bgIconUrl: electroBg, symbolUrl: symbol4 },
  { bgIconUrl: anemoBg, symbolUrl: symbol5 },
  { bgIconUrl: geoBg, symbolUrl: symbol6 },
  { bgIconUrl: dendroBg, symbolUrl: symbol7 },
  { bgIconUrl: omniBg, symbolUrl: omniSymbol },
];
