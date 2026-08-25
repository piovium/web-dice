import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  plugins: [wasm()],
  resolve: {
    alias: {
      "@dice/physics-backend": resolve(__dirname, "src/physics/rapier-backend.ts"),
    },
  },
  define: {
    __PHYSICS_BACKEND__: JSON.stringify("rapier"),
  },
});
