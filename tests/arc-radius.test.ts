import { expect, test } from "vitest";
import { parseGCode } from "../lib/parse";
const len = (p: ReturnType<typeof parseGCode>) => p.segments.reduce((s, x) => s + Math.hypot(x.to.x - x.from.x, x.to.y - x.from.y), 0);
test("negative R selects the major arc (>180 deg)", () => {
  const minor = parseGCode("G90 G21 G2 X10 Y0 R6");
  const major = parseGCode("G90 G21 G2 X10 Y0 R-6");
  expect(len(major)).toBeGreaterThan(len(minor) * 1.5);
});
