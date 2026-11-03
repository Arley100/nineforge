import { defineConfig } from "tsup";

const base = { platform: "node", target: "node20", tsconfig: "tsconfig.build.json" } as const;

export default defineConfig([
  // @nineforge/core: ESM + CJS + type declarations.
  { ...base, entry: { core: "lib/core.ts" }, format: ["esm", "cjs"], dts: true, outDir: "dist/core", clean: true },
  // Executables for the package "bin" entries (dependencies stay external).
  { ...base, entry: { cli: "cli/main.ts", mcp: "mcp/server.ts" }, format: ["esm"], outDir: "dist", banner: { js: "#!/usr/bin/env node" } },
  // Python bridge: fully bundled so it only needs Node.js.
  { ...base, entry: { "python-bridge": "cli/python-bridge.ts" }, format: ["cjs"], outDir: "dist", noExternal: [/.*/] },
]);
