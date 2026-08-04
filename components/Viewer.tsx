"use client";
import { Canvas } from "@react-three/fiber";
import { Grid, Line, OrbitControls } from "@react-three/drei";
import { FixtureBox, Segment, Vec3 } from "@/lib/types";
function toThree(p: Vec3): [number, number, number] { return [p.x, p.z, p.y]; }
function Fixture({ box }: { box: FixtureBox }) {
  const sizeX = Math.max(0.01, box.max.x - box.min.x);
  const sizeY = Math.max(0.01, box.max.z - box.min.z);
  const sizeZ = Math.max(0.01, box.max.y - box.min.y);
  const centerX = box.min.x + sizeX / 2;
  const centerY = box.min.z + sizeY / 2;
  const centerZ = box.min.y + sizeZ / 2;
  return (<mesh position={[centerX, centerY, centerZ]}><boxGeometry args={[sizeX, sizeY, sizeZ]} /><meshStandardMaterial color="#ef4444" transparent opacity={0.28} /></mesh>);
}
export default function Viewer({ segments, fixtures }: { segments: Segment[]; fixtures: FixtureBox[] }) {
  return (
    <div className="h-[480px] w-full rounded-xl border bg-neutral-950">
      <Canvas camera={{ position: [180, 140, 180], fov: 45 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[120, 180, 120]} intensity={1.2} />
        <Grid infiniteGrid cellSize={10} sectionSize={50} fadeDistance={900} cellColor="#333" sectionColor="#555" />
        {fixtures.map((box, i) => (<Fixture key={i} box={box} />))}
        {segments.map((seg, i) => { const color = seg.motion === "rapid" ? "#3b82f6" : "#f59e0b"; const points: [number, number, number][] = [toThree(seg.from), toThree(seg.to)]; return <Line key={i} points={points} color={color} lineWidth={2} />; })}
        <OrbitControls />
      </Canvas>
    </div>
  );
}