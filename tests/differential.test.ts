import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseGCode } from "../lib/parse";

const dir = join(process.cwd(), "tests", "corpus");

describe("differential corpus: parser geometry must not drift", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".nc"));
  if (files.length === 0) throw new Error("corpus is empty");
  for (const f of files) {
    it("matches golden segments for " + f, () => {
      const gcode = readFileSync(join(dir, f), "utf8");
      const expected = JSON.parse(readFileSync(join(dir, f + ".expected.json"), "utf8"));
      const got = JSON.parse(JSON.stringify(parseGCode(gcode).segments));
      expect(got).toEqual(expected);
    });
  }
});
