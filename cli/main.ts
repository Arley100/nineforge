import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Attestation, attest, generateKeys, sha256, verifyAttestation } from "../lib/attest";
import { check } from "../lib/check";
import { stress } from "../lib/perturb";
import { RuleFile, parseRules } from "../lib/rules";
import { toSarif } from "../lib/sarif";
import { runSuite } from "../lib/suite";
import { summarize } from "../lib/summarize";

const USAGE = `Usage:
  nineforge check <program.nc> --workcell <cell.json> [--state <state.json>] [--rules <rules.yaml>]
                  [--json] [--stress] [--strict] [--sarif <out.sarif>]
                  [--attest <out.json> [--sign <private.pem>]] [--history <runs.jsonl>]
  nineforge suite <suite.json> [--json]
  nineforge verify <attestation.json> [--key <public.pem>] [--program <file>] [--workcell <file>] [--state <file>] [--rules <file>]
  nineforge keygen [--out <dir>]

Exit codes: 0 ok, 1 blocked / failed expectation / bad signature, 2 usage or input error.`;

// ANSI colors only on a terminal (NO_COLOR / FORCE_COLOR conventions); pipes and --json stay plain.
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const paint = (code: number) => (s: string) => (useColor ? "\x1b[" + code + "m" + s + "\x1b[0m" : s);
const [red, green, yellow, cyan] = [31, 32, 33, 36].map(paint);
const SEV: Record<string, (s: string) => string> = { error: red, warning: yellow, info: cyan, block: red, caution: yellow, pass: green };

function fail(message: string): never { console.error("NineForge: " + message); process.exit(2); }
function read(path: string, what: string): string {
  try { return readFileSync(path, "utf8"); } catch (e) { fail("cannot read " + what + " file: " + path + " (" + (e instanceof Error ? e.message : String(e)) + ")"); }
}
const str = { type: "string" } as const, bool = { type: "boolean" } as const;
let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    allowPositionals: true,
    options: { workcell: str, state: str, rules: str, json: bool, stress: bool, strict: bool, sarif: str, attest: str, sign: str, history: str, key: str, program: str, out: str, help: { type: "boolean", short: "h" } },
  });
}
try { args = parse(); } catch (e) { fail((e instanceof Error ? e.message.split("\n")[0] : String(e)) + "\n" + USAGE); }
const { values: o, positionals: [command, target] } = args;
if (o.help || !command) { console.log(USAGE); process.exit(command ? 0 : 2); }

function rulesFrom(text: string | null, path?: string): RuleFile | undefined {
  if (text === null) return undefined;
  try { return parseRules(text); } catch (e) { fail("invalid rules file " + path + ": " + (e instanceof Error ? e.message : String(e))); }
}
const field = (json: string | null, key: string) => { try { return json ? JSON.parse(json)?.[key] ?? "unspecified" : "none"; } catch { return "invalid JSON"; } };

if (command === "check") {
  if (!target) fail("check needs a program file.\n" + USAGE);
  if (!o.workcell) fail("--workcell is required.\n" + USAGE);
  if (o.sign && !o.attest) fail("--sign needs --attest <out.json>.");
  const gcode = read(target, "program"), wcJson = read(o.workcell, "workcell");
  const stJson = o.state ? read(o.state, "state") : null;
  const rulesText = o.rules ? read(o.rules, "rules") : null;
  const rules = rulesFrom(rulesText, o.rules);
  const result = check(gcode, wcJson, stJson, rules);
  const rows = o.stress ? stress(gcode, wcJson, stJson, rules) : [];
  if (o.sarif) writeFileSync(o.sarif, JSON.stringify(toSarif(result, target.split("\\").join("/")), null, 2));
  if (o.attest) writeFileSync(o.attest, JSON.stringify(attest(result, { program: gcode, workcell: wcJson, state: stJson, rules: rulesText }, o.sign ? read(o.sign, "private key") : undefined), null, 2));
  if (o.history) appendFileSync(o.history, JSON.stringify({ at: new Date().toISOString(), program: target, sha256: sha256(gcode), verdict: result.verdict, codes: result.diagnostics.map((d) => d.code) }) + "\n");
  if (o.json) console.log(JSON.stringify({ file: target, result, stress: rows }, null, 2));
  else {
    console.log("NineForge check: " + target);
    console.log("Workcell: " + field(wcJson, "machine") + " | state: " + field(stJson, "control"));
    for (const d of result.diagnostics) console.log("  " + SEV[d.severity]("[" + d.severity.toUpperCase() + "] " + d.code) + " " + d.message);
    console.log("  " + SEV[result.verdict](summarize(result)));
    if (o.stress) {
      console.log("  Stress: survives " + rows.filter((s) => s.verdict !== "block").length + "/" + rows.length + " perturbed workcells.");
      for (const s of rows) console.log("    " + (s.verdict === "block" ? red("FAIL") : green("ok  ")) + "  " + s.name + (s.codes.length ? "  [" + s.codes.join(", ") + "]" : ""));
    }
  }
  process.exit(result.verdict === "block" || (o.strict && result.verdict === "caution") || rows.some((s) => s.verdict === "block") ? 1 : 0);
}

if (command === "suite") {
  if (!target) fail("suite needs a manifest file.\n" + USAGE);
  let results;
  try { results = runSuite(target); } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
  if (o.json) console.log(JSON.stringify(results, null, 2));
  else {
    console.log("NineForge suite: " + target);
    for (const r of results) console.log("  " + (r.ok ? green("ok  ") : red("FAIL")) + "  " + r.program + "  expected " + r.expect + ", got " + r.verdict + (r.missing.length ? "; missing " + r.missing.join(", ") : ""));
    console.log("  " + results.filter((r) => r.ok).length + "/" + results.length + " jobs match their expectations.");
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

if (command === "verify") {
  if (!target) fail("verify needs an attestation file.\n" + USAGE);
  let att: Attestation;
  try { att = JSON.parse(read(target, "attestation")); } catch { fail("attestation is not valid JSON: " + target); }
  const inputs: Record<string, string> = {};
  for (const k of ["program", "workcell", "state", "rules"] as const) if (o[k]) inputs[k] = read(o[k]!, k);
  const v = verifyAttestation(att, inputs, o.key ? read(o.key, "public key") : undefined);
  console.log((v.ok ? green("VALID") : red("INVALID")) + ": " + att.engine + ", verdict " + att.report?.verdict?.toUpperCase() + ", created " + att.createdAt);
  for (const p of v.problems) console.log("  - " + p);
  if (v.ok && !v.pinned) console.log("  note: verified with the embedded key; pass --key <public.pem> to pin the signer.");
  // Exit codes gate pipelines: an authentic BLOCK report is still a program that must not run.
  if (v.ok && att.report?.verdict === "block") console.log("  note: the attested verdict is BLOCK (exit 1).");
  process.exit(v.ok && att.report?.verdict !== "block" ? 0 : 1);
}

if (command === "keygen") {
  const dir = o.out ?? ".";
  const priv = join(dir, "nineforge.key"), pub = join(dir, "nineforge.pub");
  if (existsSync(priv)) fail(priv + " already exists; refusing to overwrite.");
  mkdirSync(dir, { recursive: true });
  const keys = generateKeys();
  writeFileSync(priv, keys.privateKey, { mode: 0o600 });
  writeFileSync(pub, keys.publicKey);
  console.log("Wrote " + priv + " (keep secret, never commit) and " + pub + " (share with verifiers).");
  process.exit(0);
}

fail("unknown command '" + command + "'.\n" + USAGE);
