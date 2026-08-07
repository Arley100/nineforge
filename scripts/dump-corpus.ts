import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseGCode } from "../lib/parse";

// Regenerate golden segment dumps. Run from repo root: npx tsx scripts/dump-corpus.ts
// A regeneration is a conscious act: the resulting .expected.json diff must be reviewed in the PR.
const dir = join(process.cwd(), "tests", "corpus");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".nc"))) {
  const segs = parseGCode(readFileSync(join(dir, f), "utf8")).segments;
  writeFileSync(join(dir, f + ".expected.json"), JSON.stringify(segs, null, 2));
  console.log("wrote " + f + ".expected.json (" + segs.length + " segments)");
}
