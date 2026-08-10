import { expect, test } from "vitest";
import { parseState } from "../lib/state";
test("state accepts T1 and T100 and canonicalizes keys", () => {
  const st = parseState(JSON.stringify({ tools: { T1: { diameter: 6 }, T100: { length: 50 } } }));
  expect(st.tools["T01"]).toBeDefined();
  expect(st.tools["T100"]).toBeDefined();
});
test("state accepts extended offsets like G54.1", () => {
  const st = parseState(JSON.stringify({ offsets: { "G54.1": { x: 1, y: 2, z: 3 } } }));
  expect(st.offsets["G54.1"]).toEqual({ x: 1, y: 2, z: 3 });
});
