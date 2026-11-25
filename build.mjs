import { build } from "esbuild";
import { rmSync } from "node:fs";

await build({ entryPoints: ["src/main.ts"], outfile: "site/game.js", bundle: true, minify: true, format: "iife",
  target: "es2020", logLevel: "warning" });

if (process.argv.includes("--tests")) {
  rmSync(".test-build", { recursive: true, force: true });
  await build({ entryPoints: ["tests/net.test.ts"], outfile: ".test-build/net.test.mjs", bundle: true,
    platform: "node", format: "esm", logLevel: "warning" });
}
