import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  plugins: [],
  resolve: {
    alias: {
      "@dice/physics-backend": resolve(__dirname, "src/physics/oimo-backend.ts"),
    },
  },
  define: {
    __PHYSICS_BACKEND__: JSON.stringify("oimo"),
  },
  build: {
    outDir: "dist-minitool",
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
