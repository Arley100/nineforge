"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { EXAMPLES } from "@/lib/examples";
import { parseGCode } from "@/lib/parse";
import { activeShift, analyze } from "@/lib/analyze";
import { parseWorkcell } from "@/lib/workcell";
import { parseState } from "@/lib/state";
import { summarize } from "@/lib/summarize";
import { suggestFixes } from "@/lib/fix";
import { PERTURBATIONS } from "@/lib/perturb";
import { AnalysisResult, MachineState, Segment, Workcell } from "@/lib/types";
const Viewer = dynamic(() => import("@/components/Viewer"), { ssr: false });
const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/Arley100/nineforge";
type StressRow = { name: string; verdict: string };
export default function Home() {
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id);
  const [gcode, setGcode] = useState("");
  const [workcellJson, setWorkcellJson] = useState("");
  const [stateJson, setStateJson] = useState("");
  const [workcell, setWorkcell] = useState<Workcell | null>(null);
  const [state, setState] = useState<MachineState | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stress, setStress] = useState<StressRow[] | null>(null);
  const [fixNotes, setFixNotes] = useState<string[] | null>(null);
  function run(nextGcode: string, nextWcJson: string, nextStJson: string) {
    setError(null); setStress(null);
    try {
      const wc = parseWorkcell(nextWcJson);
      const st = nextStJson.trim() ? parseState(nextStJson) : null;
      const pr = parseGCode(nextGcode);
      // Render the same frame analyze() checks: program coordinates shifted by the
      // active work offset. Without this, a nonzero G54 draws the path in the wrong
      // place relative to the fixtures while the verdict is computed correctly.
      const shift = activeShift(pr, st);
      const shifted = pr.segments.map((s) => ({ ...s, from: { x: s.from.x + shift.x, y: s.from.y + shift.y, z: s.from.z + shift.z }, to: { x: s.to.x + shift.x, y: s.to.y + shift.y, z: s.to.z + shift.z } }));
      setWorkcell(wc); setState(st); setSegments(shifted); setResult(analyze(pr, wc, st));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setWorkcell(null); setState(null); setResult(null); setSegments([]); }
  }
  async function loadExample(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id); if (!ex) return;
    const grab = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error("Failed to load " + url + " (" + r.status + ")"); return r.text(); };
    let nc = "", wc = "", st = "";
    try { [nc, wc, st] = await Promise.all([grab(ex.nc), grab(ex.workcell), grab(ex.state)]); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    setExampleId(id); setGcode(nc); setWorkcellJson(wc); setStateJson(st); setFixNotes(null); run(nc, wc, st);
  }
  useEffect(() => { void loadExample(EXAMPLES[0].id); }, []);
  function onFile(e: React.ChangeEvent<HTMLInputElement>, kind: "nc" | "wc" | "st") {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { const text = String(reader.result ?? ""); if (kind === "nc") { setGcode(text); run(text, workcellJson, stateJson); } else if (kind === "wc") { setWorkcellJson(text); run(gcode, text, stateJson); } else { setStateJson(text); run(gcode, workcellJson, text); } };
    reader.readAsText(f); e.target.value = "";
  }
  function doFix() { if (!workcell) return; const fix = suggestFixes(gcode, workcell, segments); setGcode(fix.gcode); setWorkcellJson(JSON.stringify(fix.workcell, null, 2)); setFixNotes(fix.notes); run(fix.gcode, JSON.stringify(fix.workcell), stateJson); }
  function doStress() { if (!workcell) return; setStress(PERTURBATIONS.map((p) => { const v = p.apply(gcode, workcell); return { name: p.name, verdict: analyze(parseGCode(v.gcode), v.workcell, state).verdict }; })); }
  function exportReport() {
    if (!result || !workcell) return;
    const lines: string[] = ["# NineForge analysis report", "", "Machine: " + workcell.machine, "State: " + (state ? state.control : "none (coordinates assumed machine-frame)"), "Date: " + new Date().toISOString(), "Verdict: " + result.verdict.toUpperCase(), "", "## Diagnostics"];
    if (result.diagnostics.length === 0) lines.push("- none");
    for (const d of result.diagnostics) lines.push("- [" + d.severity.toUpperCase() + "] " + d.code + " " + d.message);
    lines.push("", "## Stats", "- segments: " + result.stats.segments, "- distance: " + result.stats.distanceMm + " mm", "- estimated duration: " + result.stats.durationSec + " s");
    if (stress) { lines.push("", "## Stress screen"); const ok = stress.filter((s) => s.verdict !== "block").length; lines.push("Survives " + ok + "/" + stress.length + " perturbed workcells."); for (const s of stress) lines.push("- " + (s.verdict === "block" ? "FAIL" : "ok") + " " + s.name); }
    lines.push("", "---", "NineForge verifies program assumptions against the workcell and machine state. It does not replace CAM verification or a physical prove-out.");
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "nineforge-report.md"; a.click(); URL.revokeObjectURL(url);
  }
  const verdictColor = result?.verdict === "block" ? "text-red-400" : result?.verdict === "caution" ? "text-yellow-400" : "text-lime-300";
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">NineForge</h1>
          <p className="text-neutral-400">Pre-flight verification for CNC workcells: does this program&apos;s assumptions match the world it is about to run in?</p>
          <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">Scope: deterministic geometry, process rules, and state cross-checks. Reports what it does not model. Never replaces CAM verification or a prove-out.</p>
        </header>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-neutral-900 p-4">
          <select value={exampleId} onChange={(e) => loadExample(e.target.value)} className="rounded-xl border bg-neutral-950 px-3 py-2 text-sm">{EXAMPLES.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">Load .nc<input type="file" accept=".nc,.gcode,.tap,.txt" className="hidden" onChange={(e) => onFile(e, "nc")} /></label>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">Load workcell<input type="file" accept=".json" className="hidden" onChange={(e) => onFile(e, "wc")} /></label>
          <label className="cursor-pointer rounded-xl border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">Load state<input type="file" accept=".json" className="hidden" onChange={(e) => onFile(e, "st")} /></label>
          <button onClick={() => run(gcode, workcellJson, stateJson)} className="rounded-xl bg-lime-400 px-4 py-2 font-semibold text-black hover:bg-lime-300">Analyze</button>
          <button onClick={doFix} disabled={!workcell} className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">Suggest fixes</button>
          <button onClick={doStress} disabled={!workcell} className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">Stress screen</button>
          <button onClick={exportReport} disabled={!result} className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold hover:bg-neutral-800 disabled:opacity-50">Export report</button>
        </div>
        {error && (<p className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">{error}</p>)}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4 rounded-2xl border bg-neutral-900 p-5">
            <textarea value={gcode} onChange={(e) => setGcode(e.target.value)} className="h-48 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-lime-300" spellCheck={false} />
            <textarea value={workcellJson} onChange={(e) => setWorkcellJson(e.target.value)} className="h-32 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-sky-300" spellCheck={false} />
            <textarea value={stateJson} onChange={(e) => setStateJson(e.target.value)} className="h-32 w-full rounded-xl border bg-neutral-950 p-4 font-mono text-sm text-amber-300" spellCheck={false} />
            <div className="rounded-2xl border bg-neutral-950 p-4">
              <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Diagnostics</h3><span className={"font-semibold " + verdictColor}>{result ? result.verdict.toUpperCase() : "--"}</span></div>
              {result?.diagnostics.length ? (
                <ul className="space-y-2 text-sm text-neutral-300">
                  {result.diagnostics.map((d, i) => (
                    <li key={i} className="flex items-start justify-between gap-3">
                      <span><span className={d.severity === "error" ? "font-semibold text-red-400" : d.severity === "warning" ? "font-semibold text-yellow-400" : "font-semibold text-sky-400"}>{d.code}</span> {d.message}</span>
                      <a className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800" target="_blank" rel="noreferrer" href={REPO_URL + "/issues/new?template=false_positive.md&title=" + encodeURIComponent("[false positive] " + d.code)}>report</a>
                    </li>
                  ))}
                </ul>
              ) : (<p className="text-sm text-neutral-500">{result ? "No diagnostics." : "Run an analysis."}</p>)}
              {result && (<p className="mt-3 text-sm text-neutral-400">{summarize(result)}</p>)}
              {fixNotes && (<ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-neutral-400">{fixNotes.map((n, i) => (<li key={i}>{n}</li>))}</ul>)}
            </div>
          </section>
          <section className="space-y-4">
            <Viewer segments={segments} fixtures={workcell?.fixtures ?? []} />
            {result && (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border bg-neutral-900 p-4"><div className="text-sm text-neutral-500">Segments</div><div className="mt-1 text-2xl font-semibold">{result.stats.segments}</div></div>
                <div className="rounded-2xl border bg-neutral-900 p-4"><div className="text-sm text-neutral-500">Distance</div><div className="mt-1 text-2xl font-semibold">{result.stats.distanceMm} mm</div></div>
                <div className="rounded-2xl border bg-neutral-900 p-4"><div className="text-sm text-neutral-500">Est. duration</div><div className="mt-1 text-2xl font-semibold">{result.stats.durationSec} s</div></div>
              </div>
            )}
            {stress && (
              <div className="rounded-2xl border bg-neutral-900 p-5">
                <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Stress screen</h3><span className="rounded-full border px-3 py-1 text-sm">survives {stress.filter((s) => s.verdict !== "block").length}/{stress.length}</span></div>
                <ul className="grid gap-2 md:grid-cols-2">{stress.map((s, i) => (<li key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"><span>{s.name}</span><span className={s.verdict === "block" ? "text-red-400" : "text-lime-300"}>{s.verdict === "block" ? "FAIL" : "ok"}</span></li>))}</ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}