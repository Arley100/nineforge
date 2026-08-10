import { expect, test } from "vitest";
import { parseWorkcell } from "../lib/workcell";
test("fixture missing y/z is rejected, not defaulted to 0", () => {
  const wc = { machine: "m", limits: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 100 } }, fixtures: [{ name: "clamp", min: { x: 10 }, max: { x: 20 } }] };
  expect(() => parseWorkcell(JSON.stringify(wc))).toThrow(/malformed/);
});
test("stock missing z is rejected", () => {
  const wc = { machine: "m", limits: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 100 } }, stock: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } } };
  expect(() => parseWorkcell(JSON.stringify(wc))).toThrow(/malformed/);
});
