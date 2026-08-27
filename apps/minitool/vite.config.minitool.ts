import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [],
  build: {
    outDir: resolve(__dirname, "dist-minitool"),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/main.ts"),
      name: "DiceApp",
      formats: ["iife"],
      fileName: () => "app.js",
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
