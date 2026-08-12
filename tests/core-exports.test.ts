import { describe, it, expect } from "vitest";
import * as core from "../lib/core";

describe("PAI-101 @nineforge/core public API surface", () => {
  it("exports the core check function and types", () => {
    expect(typeof core.check).toBe("function");
    expect(typeof core.parseGCode).toBe("function");
    expect(typeof core.analyze).toBe("function");
    expect(typeof core.parseWorkcell).toBe("function");
    expect(typeof core.parseState).toBe("function");
    expect(typeof core.evaluateRules).toBe("function");
    expect(typeof core.suggestFixes).toBe("function");
    expect(typeof core.summarize).toBe("function");
  });
});
