"use client";
import { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Edges, Grid, Line, OrbitControls } from "@react-three/drei";
import { Box, Segment, Vec3, Workcell } from "@/lib/types";

type P3 = [number, number, number];
// Machine Z is up; machine Y points away from the operator (three.js -Z keeps the frame right-handed).
const toThree = (p: Vec3): P3 => [p.x, p.z, -p.y];

function Solid({ box, color, opacity, edges }: { box: Box; color: string; opacity: number; edges?: boolean }) {
  const size: P3 = [box.max.x - box.min.x, box.max.z - box.min.z, box.max.y - box.min.y].map((v) => Math.max(0.01, v)) as P3;
  const center = toThree({ x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 });
  return (
    <mesh position={center}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent opacity={opacity} visible={!edges} depthWrite={false} />
      <Edges color={color} />
    </mesh>
  );
}

function Fit({ center, size }: { center: P3; size: number }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    camera.position.set(center[0] + size, center[1] + size * 0.9, center[2] + size * 1.1);
    (controls as any)?.target.set(...center);
    (controls as any)?.update();
  }, [camera, controls, center, size]);
  return null;
}

function Path({ segs, color, width }: { segs: Segment[]; color: string; width: number }) {
  if (!segs.length) return null;
  return <Line segments points={segs.flatMap((s) => [toThree(s.from), toThree(s.to)])} color={color} lineWidth={width} />;
}

export default function Viewer({ segments, workcell, flagged, selected }: { segments: Segment[]; workcell: Workcell | null; flagged: Set<number>; selected: number | null }) {
  const shown = useMemo(() => segments.filter((s) => s.anchor !== "none"), [segments]);
  const groups = useMemo(() => ({
    rapid: shown.filter((s) => s.motion === "rapid" && !flagged.has(s.line)),
    cut: shown.filter((s) => s.motion === "linear" && !flagged.has(s.line)),
    flagged: shown.filter((s) => flagged.has(s.line)),
    selected: shown.filter((s) => s.line === selected),
  }), [shown, flagged, selected]);
  // Frame the toolpath, fixtures and stock (not the whole machine travel).
  const { center, size } = useMemo(() => {
    const pts: Vec3[] = shown.flatMap((s) => [s.from, s.to]);
    for (const b of [...(workcell?.fixtures ?? []), ...(workcell?.stock ? [workcell.stock] : [])]) pts.push(b.min, b.max);
    if (!pts.length) return { center: [0, 0, 0] as P3, size: 150 };
    const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of pts) for (const ax of ["x", "y", "z"] as const) { lo[ax] = Math.min(lo[ax], p[ax]); hi[ax] = Math.max(hi[ax], p[ax]); }
    const c = toThree({ x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 });
    return { center: c, size: Math.max(60, hi.x - lo.x, hi.y - lo.y, hi.z - lo.z) * 0.95 };
  }, [shown, workcell]);

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
      <Canvas camera={{ position: [180, 140, 180], fov: 45, far: 20000 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[120, 180, 120]} intensity={1.2} />
        <Grid infiniteGrid cellSize={10} sectionSize={50} fadeDistance={1500} cellColor="#333" sectionColor="#555" />
        {workcell && <Solid box={workcell.limits} color="#525252" opacity={0} edges />}
        {workcell?.stock && <Solid box={workcell.stock} color="#a3a3a3" opacity={0.18} />}
        {workcell?.fixtures.map((f) => <Solid key={f.name} box={f} color="#ef4444" opacity={0.28} />)}
        <Path segs={groups.rapid} color="#3b82f6" width={1.5} />
        <Path segs={groups.cut} color="#f59e0b" width={2} />
        <Path segs={groups.flagged} color="#ff4fd8" width={3} />
        <Path segs={groups.selected} color="#ffffff" width={5} />
        <OrbitControls makeDefault />
        <Fit center={center} size={size} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-neutral-900/80 px-3 py-2 text-xs text-neutral-300">
        {[["#3b82f6", "Rapid"], ["#f59e0b", "Cut"], ["#ff4fd8", "Flagged line"], ["#ef4444", "Fixture"], ["#a3a3a3", "Stock"]].map(([c, label]) => (
          <span key={label} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{label}</span>
        ))}
      </div>
    </div>
  );
}
