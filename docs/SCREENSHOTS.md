# Screenshot capture guide

Keeps the README UI tour reproducible. Every image in `docs/screenshots/` maps 1:1 to a
README section and to a bundled example, so any contributor can re-capture it exactly.

## Naming convention

`NN-<slug>.png` - `NN` matches the README tour order; CLI captures continue the sequence.
Never renumber: README anchors depend on it. New captures append at the end.

## Canvas rules

- Browser at 1280x800, app default theme, no devtools, no OS chrome.
- Never crop away the verdict banner (`BLOCK` / `CAUTION` / `PASS`) or the stats row.
- Terminal captures: default profile, full command visible, exit code visible.
- Commit the image **with** the code change that altered the UI.

## Capture matrix

| File | Example triple | Steps |
|------|----------------|-------|
| `01-block-collision.png` | `bracket.*` | Load bracket example -> run check -> capture report with offending lines highlighted. |
| `02-preflight-mismatch.png` | `mismatch.*` | Load mismatch example -> capture the pre-flight BLOCK naming `G55` / `T07`. |
| `03-pass-clean.png` | `clean.*` | Load clean example -> capture PASS verdict + stats. |
| `04-stress-screen.png` | `bracket.*` | Open stress tab -> run the perturbation sweep -> capture the `survives k/N` line. |
| `05-suggested-fixes.png` | `bracket.*` | Capture the fixes panel (fixture-clear + feed-cap suggestions). |
| `06-cli-mismatch.png` | `mismatch.*` | Terminal: `npx tsx cli/main.ts check public/examples/mismatch.nc --workcell public/examples/mismatch.workcell.json --state public/examples/mismatch.state.json` -> capture full output. |

## When to re-capture

- Any change to `components/` that alters layout, colors, or verdict presentation.
- Any change to verdict logic in `lib/` (analyze/fix/perturb) that changes what these
  screens show.
- Adding an example that replaces an existing tour stop -> update the matrix above in
  the same commit.