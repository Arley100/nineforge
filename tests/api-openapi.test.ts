import { describe, it, expect } from "vitest";
import { GET } from "../app/api/openapi/route";

describe("API OpenAPI Endpoint (PAI-302)", () => {
  it("returns a valid OpenAPI 3.1 spec", async () => {
    const req = new Request("http://localhost/api/openapi");
    const res = await GET(req);
    expect(res.status).toBe(200);
    
    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/api/analyze"]).toBeDefined();
    expect(spec.paths["/api/batch"]).toBeDefined();
    expect(spec.components.schemas.AnalyzeRequest).toBeDefined();
  });
});
