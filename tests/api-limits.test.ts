import { expect, test } from "vitest";
import { POST } from "../app/api/analyze/route";

test("API rejects gcode over 2MB", async () => {
  const hugeGcode = "G0 X0 Y0\n".repeat(300000); // ~2.4MB
  const req = new Request("http://localhost/api/analyze", {
    method: "POST",
    body: JSON.stringify({ gcode: hugeGcode, workcell: "{}" })
  });
  const res = await POST(req);
  expect(res.status).toBe(413);
  const body = await res.json();
  expect(body.error).toContain("too large");
});
