import { defineConfig } from "tsup";

export default defineConfig({
  entry: { core: "lib/core.ts" },
  format: ["esm", "cjs"],
  dts: true,
  outDir: "dist/core",
  platform: "node",
  target: "node18",
  clean: true
});
