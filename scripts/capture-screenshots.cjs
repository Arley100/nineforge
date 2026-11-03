// Re-captures docs/screenshots from the running app and from real CLI runs (see docs/SCREENSHOTS.md).
// Needs Playwright, which is not a project dependency:
//   npm i --no-save playwright && npx playwright install chromium
//   npm run build && npm start -- -p 5173      (in another terminal)
//   node scripts/capture-screenshots.cjs
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.resolve(__dirname, ".."), OUT = path.join(REPO, "docs", "screenshots") + path.sep, URL = process.env.NINEFORGE_URL || "http://127.0.0.1:5173/";

function run(args) {
  try { return execFileSync(process.execPath, ["--import", "tsx", "cli/main.ts", ...args], { cwd: REPO, env: { ...process.env, FORCE_COLOR: "1" }, encoding: "utf8" }); }
  catch (e) { return (e.stdout || "") + (e.stderr || ""); }
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ansi = (s) => esc(s).replace(/\x1b\[(\d+)m([\s\S]*?)\x1b\[0m/g, (_, c, t) => `<span class="c${c}">${t}</span>`);
const prompt = (cmd) => { const [head, ...rest] = cmd.split(" "); return `<div><span class="ps">PS C:\\nineforge&gt;</span> <span class="cmd">${esc(head)}</span> ${rest.map((w) => w.startsWith("-") ? `<span class="flag">${esc(w)}</span>` : esc(w)).join(" ")}</div>`; };
function terminal(steps) {
  const body = steps.map(([cmd, out]) => prompt(cmd) + (out ? `<pre>${ansi(out.trimEnd())}</pre>` : "")).join("") + `<div><span class="ps">PS C:\\nineforge&gt;</span> <span class="cursor"> </span></div>`;
  return `<html><head><style>
    body{margin:0;background:#0c0c0c;color:#cccccc;font:15px/1.45 "Cascadia Mono","DejaVu Sans Mono",monospace;}
    .tabs{background:#202020;color:#fff;padding:8px 14px;font:13px system-ui,sans-serif}.tabs span{background:#0c0c0c;padding:8px 18px;border-radius:6px 6px 0 0}
    .term{padding:12px 16px 18px}pre{margin:0 0 2px;white-space:pre-wrap;font:inherit}.ps{color:#cccccc}.cmd{color:#f9f1a5}.flag{color:#767676}
    .c31{color:#e74856}.c32{color:#16c60c}.c33{color:#f9f1a5}.c36{color:#61d6d6}.cursor{background:#ccc}
  </style></head><body><div class="tabs"><span>Windows PowerShell</span></div><div class="term">${body}</div></body></html>`;
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const load = async (name) => {
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.selectOption("select", { label: name });
    await page.waitForTimeout(1800);
  };
  const shot = async (file) => { await page.waitForTimeout(600); await page.screenshot({ path: OUT + file, fullPage: true }); console.log("wrote", file); };

  await load("Bracket with fixture collision");
  await page.locator("li", { hasText: "(line 5)" }).first().click();
  await shot("01-block-collision.png");
  await load("Setup mismatch (pre-flight)"); await shot("02-preflight-mismatch.png");
  await load("Clean pocket job"); await shot("03-pass-clean.png");
  await load("Bracket with fixture collision");
  await page.click("text=Stress screen"); await shot("04-stress-screen.png");
  await load("Bracket with fixture collision");
  await page.click("text=Suggest fixes"); await shot("05-suggested-fixes.png");
  await load("Two vises, two tools (G54/G55, G43)"); await shot("07-multi-op.png");
  await load("Custom shop rules (YAML)"); await shot("08-custom-rules.png");

  const ex = "public/examples/";
  const term = await browser.newPage({ viewport: { width: 1180, height: 300 }, deviceScaleFactor: 1 });
  const mismatch = ["check", ex + "mismatch.nc", "--workcell", ex + "mismatch.workcell.json", "--state", ex + "mismatch.state.json"];
  await term.setContent(terminal([["npx tsx cli/main.ts " + mismatch.join(" "), run(mismatch)]]));
  await term.screenshot({ path: OUT + "06-cli-mismatch.png", fullPage: true }); console.log("wrote 06-cli-mismatch.png");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-shot-")).split(path.sep).join("/");
  fs.mkdirSync(tmp + "/keys");
  const keygen = run(["keygen", "--out", tmp + "/keys"]);
  const attest = ["check", ex + "clean.nc", "--workcell", ex + "clean.workcell.json", "--attest", tmp + "/clean.attest.json", "--sign", tmp + "/keys/nineforge.key"];
  const attestOut = run(attest);
  const strip = (s) => s.split(tmp + "/").join("");
  const verify = run(["verify", tmp + "/clean.attest.json", "--key", tmp + "/keys/nineforge.pub", "--program", ex + "clean.nc"]);
  const tampered = run(["verify", tmp + "/clean.attest.json", "--key", tmp + "/keys/nineforge.pub", "--program", ex + "bracket.nc"]);

  await term.setContent(terminal([
    ["npx tsx cli/main.ts suite " + ex + "suite.json", run(["suite", ex + "suite.json"])],
    ["npx tsx cli/main.ts keygen --out keys", strip(keygen)],
    [strip("npx tsx cli/main.ts " + attest.join(" ")), attestOut],
    [strip("npx tsx cli/main.ts verify " + tmp + "/clean.attest.json --key " + tmp + "/keys/nineforge.pub --program " + ex + "clean.nc"), verify],
    [strip("npx tsx cli/main.ts verify " + tmp + "/clean.attest.json --key " + tmp + "/keys/nineforge.pub --program " + ex + "bracket.nc"), tampered],
  ]));
  await term.screenshot({ path: OUT + "09-cli-evidence.png", fullPage: true }); console.log("wrote 09-cli-evidence.png");
  fs.rmSync(tmp, { recursive: true });
  console.log("page errors:", errors.length ? errors : "none");
  await browser.close();
})();
