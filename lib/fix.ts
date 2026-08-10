import { Segment, Workcell } from "./types";

export type FixAction = {
  type: "gcode-edit" | "physical-action";
  description: string;
  autoApplicable: boolean;
};
export type FixSuggestion = { gcode: string; workcell: Workcell; notes: string[]; actions: FixAction[] };

export function suggestFixes(gcode: string, workcell: Workcell, segments: Segment[]): FixSuggestion {
  const actions: FixAction[] = [];
  const cap = workcell.feedLimit ?? 1000;
  const fixedGcode = gcode.split(/\r?\n/).map((line) => {
    const clean = line.split(";")[0];
    if (!clean.trim()) return line;
    let changed = false;
    const words = (clean.match(/[A-Za-z][^A-Za-z]*/g) || []).map((w) => {
      const u = w.toUpperCase();
      if (u.startsWith("F") && Number(u.slice(1)) > cap) { changed = true; return "F" + cap; }
      return w;
    });
    return changed ? words.join(" ") : line;
  }).join("\n");

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of segments) { for (const p of [s.from, s.to]) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); } }
  const margin = 20;
  const fixedWorkcell: Workcell = {
    ...workcell,
    fixtures: workcell.fixtures.map((f) => {
      const overlaps = f.max.x >= minX && f.min.x <= maxX && f.max.y >= minY && f.min.y <= maxY && f.max.z >= minZ && f.min.z <= maxZ;
      if (!overlaps) return f;
      const w = f.max.x - f.min.x;
      const h = f.max.y - f.min.y;
      const limits = workcell.limits;
      
      const options = [
        { desc: "+Y", box: { min: { x: f.min.x, y: maxY + margin, z: f.min.z }, max: { x: f.max.x, y: maxY + margin + h, z: f.max.z } } },
        { desc: "-Y", box: { min: { x: f.min.x, y: minY - margin - h, z: f.min.z }, max: { x: f.max.x, y: minY - margin, z: f.max.z } } },
        { desc: "+X", box: { min: { x: maxX + margin, y: f.min.y, z: f.min.z }, max: { x: maxX + margin + w, y: f.max.y, z: f.max.z } } },
        { desc: "-X", box: { min: { x: minX - margin - w, y: f.min.y, z: f.min.z }, max: { x: minX - margin, y: f.max.y, z: f.max.z } } }
      ];
      
      const validOption = options.find(opt => 
        opt.box.min.x >= limits.min.x && opt.box.max.x <= limits.max.x &&
        opt.box.min.y >= limits.min.y && opt.box.max.y <= limits.max.y
      );

      if (validOption) {
        actions.push({ type: "physical-action", autoApplicable: false, description: "Move fixture '" + f.name + "' clear of the toolpath bounding box (" + validOption.desc + "). Do not edit the file without moving the clamp." });
        return { ...f, min: validOption.box.min, max: validOption.box.max };
      }

      const newY = maxY + margin;
      actions.push({ type: "physical-action", autoApplicable: false, description: "Move fixture '" + f.name + "' clear of the toolpath bounding box (suggested: min.y = " + newY + "), then update the workcell file to match. Do not edit the file without moving the clamp." });
      return { ...f, min: { x: f.min.x, y: newY, z: f.min.z }, max: { x: f.max.x, y: newY + h, z: f.max.z } };
    })
  };
  if (fixedGcode !== gcode) actions.push({ type: "gcode-edit", autoApplicable: true, description: "Cap programmed feeds at " + cap + " mm/min (the workcell feed limit)." });
  if (actions.length === 0) actions.push({ type: "physical-action", autoApplicable: false, description: "No structural suggestions; review diagnostics manually." });
  return { gcode: fixedGcode, workcell: fixedWorkcell, notes: actions.map((a) => "Suggested: " + a.description), actions };
}
