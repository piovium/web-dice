import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  base: "./",
  plugins: [wasm()],
  build: {
    // main.ts 使用顶层 await（WebDice.create 为异步工厂）
    target: "esnext",
  },
});
