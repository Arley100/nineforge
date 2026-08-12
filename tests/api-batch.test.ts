import { describe, it, expect } from "vitest";
import { POST } from "../app/api/batch/route";

describe("API Batch Endpoint (PAI-303)", () => {
  const validJob = {
    id: "test-1",
    gcode: "G21\nG90\nG0 X0 Y0 Z5\nG1 X10 Y10 F1000\nM30\n",
    workcell: {
      machine: "Test", limits: { min: {x:-1000,y:-1000,z:-1000}, max: {x:1000,y:1000,z:1000} }, rapidFeed: 5000, fixtures: []
    }
  };

  it("processes a valid batch of jobs", async () => {
    const req = new Request("http://localhost/api/batch", {
      method: "POST",
      body: JSON.stringify([validJob, { ...validJob, id: "test-2" }])
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.results.length).toBe(2);
    expect(data.results[0].id).toBe("test-1");
    expect(data.results[0].result.verdict).toBe("pass");
  });

  it("rejects non-array payloads", async () => {
    const req = new Request("http://localhost/api/batch", {
      method: "POST",
      body: JSON.stringify({ job: validJob })
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects batches larger than 10 jobs", async () => {
    const bigBatch = Array(11).fill(validJob);
    const req = new Request("http://localhost/api/batch", {
      method: "POST",
      body: JSON.stringify(bigBatch)
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("handles invalid gcode gracefully via fail-closed check()", async () => {
    const badJob = { id: "bad-1", gcode: 12345, workcell: validJob.workcell };
    const req = new Request("http://localhost/api/batch", {
      method: "POST",
      body: JSON.stringify([badJob])
    });
    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(200); // Batch succeeds, but job returns error
    expect(data.results[0].error).toBeDefined();
  });
});
