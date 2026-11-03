"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyze, placeSegments } from "@/lib/analyze";
import { CODES } from "@/lib/codes";
import { EXAMPLES } from "@/lib/examples";
import { suggestFixes } from "@/lib/fix";
import { parseGCode } from "@/lib/parse";
import { StressRow, stress as runStress } from "@/lib/perturb";
import { parseRules } from "@/lib/rules";
import { parseState } from "@/lib/state";
import { summarize } from "@/lib/summarize";
import { AnalysisResult, MachineState, Segment, Workcell } from "@/lib/types";
import { parseWorkcell } from "@/lib/workcell";

const Viewer = dynamic(() => import("@/components/Viewer"), { ssr: false });
const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/Arley100/nineforge";
const LINE_PX = 20;
type Inputs = { gcode: string; workcell: string; state: string; rules: string };
const EMPTY: Inputs = { gcode: "", workcell: "", state: "", rules: "" };
const SEVERITY = { error: "text-red-400", warning: "text-yellow-400", info: "text-sky-400" };
const VERDICT = { block: "border-red-800 bg-red-950/60 text-red-300", caution: "border-yellow-800 bg-yellow-950/50 text-yellow-300", pass: "border-lime-800 bg-lime-950/50 text-lime-300" };
const button = "rounded-xl border border-neutral-700 px-3 py-2 text-sm font-semibold hover:bg-neutral-800 disabled:opacity-50";
const RANK = { error: 0, warning: 1, info: 2 };

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function Editor({ label, value, onChange, color, rows, textRef }: { label: string; value: string; onChange: (v: string) => void; color: string; rows: number; textRef?: React.Ref<HTMLTextAreaElement> }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      <textarea ref={textRef} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} style={{ height: rows * LINE_PX + 24 }}
        className={"w-full rounded-xl border border-neutral-800 bg-neutral-950 p-3 font-mono text-sm leading-5 " + color} />
    </label>
  );
}

export default function Home() {
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id);
  const [inputs, setInputs] = useState<Inputs>(EMPTY);
  const [workcell, setWorkcell] = useState<Workcell | null>(null);
  const [state, setState] = useState<MachineState | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stressRows, setStressRows] = useState<StressRow[] | null>(null);
  const [fixNotes, setFixNotes] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const gcodeRef = useRef<HTMLTextAreaElement>(null);
  const flagged = useMemo(() => new Set(result?.diagnostics.filter((d) => d.line && d.severity !== "info").map((d) => d.line!) ?? []), [result]);

  function run(next: Inputs) {
    setInputs(next); setError(null); setStressRows(null); setSelected(null);
    try {
      const wc = parseWorkcell(next.workcell);
      const st = next.state.trim() ? parseState(next.state) : null;
      const rules = next.rules.trim() ? parseRules(next.rules) : undefined;
      const parse = parseGCode(next.gcode);
      // Draw the same frame analyze() checks: per-move work offset and tool tip.
      setWorkcell(wc); setState(st); setSegments(placeSegments(parse, st)); setResult(analyze(parse, wc, st, rules));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setWorkcell(null); setState(null); setResult(null); setSegments([]);
    }
  }

  async function loadExample(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    const grab = async (url?: string) => { if (!url) return ""; const r = await fetch(url); if (!r.ok) throw new Error("Failed to load " + url + " (" + r.status + ")"); return r.text(); };
    try {
      const [gcode, wc, st, rules] = await Promise.all([grab(ex.nc), grab(ex.workcell), grab(ex.state), grab(ex.rules)]);
      setExampleId(id); setFixNotes(null); run({ gcode, workcell: wc, state: st, rules });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void loadExample(EXAMPLES[0].id); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (key: keyof Inputs) => (v: string) => setInputs((i) => ({ ...i, [key]: v }));
  function onFile(e: React.ChangeEvent<HTMLInputElement>, key: keyof Inputs) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((text) => run({ ...inputs, [key]: text }));
    e.target.value = "";
  }
  function focusLine(line?: number) {
    if (!line) return;
    setSelected(line);
    const ta = gcodeRef.current;
    if (!ta) return;
    const lines = inputs.gcode.split("\n");
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    ta.scrollTop = Math.max(0, (line - 3) * LINE_PX);
  }
  function doFix() {
    if (!workcell) return;
    const fix = suggestFixes(inputs.gcode, workcell, state);
    setFixNotes(fix.actions.map((a) => (a.type === "gcode-edit" ? "[applied] " : "[human] ") + a.description));
    run({ ...inputs, gcode: fix.gcode, workcell: JSON.stringify(fix.workcell, null, 2) });
  }
  function doStress() {
    try { setStressRows(runStress(inputs.gcode, inputs.workcell, inputs.state, inputs.rules.trim() ? parseRules(inputs.rules) : undefined)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function exportMarkdown() {
    if (!result || !workcell) return;
    const lines = ["# NineForge analysis report", "", "- Machine: " + workcell.machine, "- State: " + (state ? state.control : "none (coordinates assumed machine-frame)"), "- Date: " + new Date().toISOString(), "- Verdict: **" + result.verdict.toUpperCase() + "**", "", "## Diagnostics"];
    if (!result.diagnostics.length) lines.push("- none");
    for (const d of result.diagnostics) lines.push("- [" + d.severity.toUpperCase() + "] " + d.code + " " + d.message);
    lines.push("", "## Stats", "- segments: " + result.stats.segments, "- distance: " + result.stats.distanceMm + " mm", "- estimated duration: " + result.stats.durationSec + " s");
    if (stressRows) {
      lines.push("", "## Stress screen", "Survives " + stressRows.filter((s) => s.verdict !== "block").length + "/" + stressRows.length + " perturbed workcells.");
      for (const s of stressRows) lines.push("- " + (s.verdict === "block" ? "FAIL " : "ok ") + s.name + (s.codes.length ? " (" + s.codes.join(", ") + ")" : ""));
    }
    lines.push("", "---", "NineForge verifies program assumptions against the workcell and machine state. It does not replace CAM verification or a physical prove-out.");
    download("nineforge-report.md", lines.join("\n"), "text/markdown");
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-neutral-100 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight">NineForge</h1>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-sm text-neutral-400 hover:text-neutral-200">GitHub</a>
          </div>
          <p className="text-neutral-400">Pre-flight verification for CNC workcells: do this program&apos;s assumptions match the world it is about to run in?</p>
          <p className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">Scope: deterministic geometry, process rules, and state cross-checks. Reports what it does not model. Never replaces CAM verification or a prove-out.</p>
        </header>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <select value={exampleId} onChange={(e) => loadExample(e.target.value)} className="max-w-[17rem] rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm">
            {EXAMPLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {([["gcode", "Load .nc", ".nc,.gcode,.ngc,.tap,.txt"], ["workcell", "Load workcell", ".json"], ["state", "Load state", ".json"], ["rules", "Load rules", ".yaml,.yml,.json"]] as const).map(([key, label, accept]) => (
            <label key={key} className="cursor-pointer rounded-xl border border-neutral-700 px-2.5 py-2 text-sm hover:bg-neutral-800">{label}<input type="file" accept={accept} className="hidden" onChange={(e) => onFile(e, key)} /></label>
          ))}
          <button onClick={() => run(inputs)} className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-semibold text-black hover:bg-lime-300">Analyze</button>
          <button onClick={doFix} disabled={!workcell} className={button}>Suggest fixes</button>
          <button onClick={doStress} disabled={!workcell} className={button}>Stress screen</button>
          <button onClick={exportMarkdown} disabled={!result} className={button}>Export .md</button>
          <button onClick={() => result && download("nineforge-report.json", JSON.stringify({ reportVersion: 1, ...result }, null, 2), "application/json")} disabled={!result} className={button}>.json</button>
        </div>
        <p className="-mt-3 px-1 text-xs text-neutral-500">{EXAMPLES.find((e) => e.id === exampleId)?.description}</p>
        {error && <p className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <Editor label="Program (G-code)" value={inputs.gcode} onChange={edit("gcode")} color="text-lime-300" rows={10} textRef={gcodeRef} />
            <Editor label="Workcell (JSON)" value={inputs.workcell} onChange={edit("workcell")} color="text-sky-300" rows={6} />
            <Editor label="Machine state (JSON, optional)" value={inputs.state} onChange={edit("state")} color="text-amber-300" rows={5} />
            <Editor label="Custom rules (YAML, optional)" value={inputs.rules} onChange={edit("rules")} color="text-fuchsia-300" rows={4} />
          </section>

          <section className="space-y-4">
            <Viewer segments={segments} workcell={workcell} flagged={flagged} selected={selected} />
            {result && (
              <div className={"rounded-2xl border p-4 " + VERDICT[result.verdict]}>
                <div className="text-2xl font-bold tracking-wide">{result.verdict.toUpperCase()}</div>
                <p className="mt-1 text-sm opacity-90">{summarize(result)}</p>
              </div>
            )}
            {result && (
              <div className="grid grid-cols-3 gap-3">
                {([["Segments", result.stats.segments], ["Distance", result.stats.distanceMm + " mm"], ["Est. duration", result.stats.durationSec + " s"]] as const).map(([k, v]) => (
                  <div key={k} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"><div className="text-sm text-neutral-500">{k}</div><div className="mt-1 text-2xl font-semibold">{v}</div></div>
                ))}
              </div>
            )}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <h3 className="mb-2 font-semibold">Diagnostics</h3>
              {result?.diagnostics.length ? (
                <ul className="space-y-1 text-sm text-neutral-300">
                  {[...result.diagnostics].sort((a, b) => RANK[a.severity] - RANK[b.severity]).map((d, i) => (
                    <li key={i} className={"flex items-start justify-between gap-3 rounded-lg px-2 py-1 " + (d.line ? "cursor-pointer hover:bg-neutral-800 " : "") + (d.line && d.line === selected ? "bg-neutral-800" : "")} onClick={() => focusLine(d.line)}>
                      <span><span className={"font-semibold " + SEVERITY[d.severity]} title={CODES[d.code]}>{d.code}</span> {d.message}{d.line ? <span className="ml-2 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">L{d.line}</span> : null}</span>
                      <a onClick={(e) => e.stopPropagation()} className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800" target="_blank" rel="noreferrer" href={REPO_URL + "/issues/new?template=false_positive.md&title=" + encodeURIComponent("[false positive] " + d.code)}>report</a>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-neutral-500">{result ? "No diagnostics." : "Run an analysis."}</p>}
              {fixNotes && (
                <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Suggested fixes</h4>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-300">{fixNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </div>
              )}
            </div>
            {stressRows && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Stress screen</h3><span className="rounded-full border border-neutral-700 px-3 py-1 text-sm">survives {stressRows.filter((s) => s.verdict !== "block").length}/{stressRows.length}</span></div>
                <ul className="grid gap-2 md:grid-cols-2">
                  {stressRows.map((s) => (
                    <li key={s.id} className="flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-2 text-sm">
                      <span>{s.name}</span>
                      <span className={s.verdict === "block" ? "text-red-400" : "text-lime-300"} title={s.codes.join(", ")}>{s.verdict === "block" ? "FAIL " + s.codes.join(" ") : "ok"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
