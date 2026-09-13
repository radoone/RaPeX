import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  build: {
    outDir: resolve(rootDir, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 4174,
  },
  preview: {
    port: 4174,
  },
});
