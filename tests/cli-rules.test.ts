import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("CLI Rule Engine Integration", () => {
  it("blocks a program that violates custom max_feed rules", () => {
    const cmd = [
      "npx tsx cli/main.ts check",
      "public/examples/high-feed.nc",
      "--workcell public/examples/high-feed.workcell.json",
      "--rules public/examples/custom-rules.yaml",
      "--json"
    ].join(" ");
    
    try {
      execSync(cmd, { encoding: "utf8", stdio: "pipe" });
      expect.fail("CLI should have exited with a non-zero code");
    } catch (err: any) {
      expect(err.status).toBe(1);
      const output = JSON.parse(err.stdout);
      expect(output.result.verdict).toBe("block");
      expect(output.result.diagnostics.some((d: any) => d.code === "NO_HIGH_FEED")).toBe(true);
    }
  });
});