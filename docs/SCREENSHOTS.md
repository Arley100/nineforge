# Screenshot capture guide

Keeps the README UI tour reproducible. Every image in `docs/screenshots/` maps 1:1 to a
README section and to a bundled example, and is produced by `scripts/capture-screenshots.cjs`.

## Re-capture

```bash
npm i --no-save playwright && npx playwright install chromium
npm run build && npm start -- -p 5173      # keep running in another terminal
node scripts/capture-screenshots.cjs       # NINEFORGE_URL overrides the address
```

Web captures are full-page at 1440 px wide. Terminal captures render the real CLI output
(colors included) in a PowerShell-style frame with a neutral `C:\nineforge` prompt, so no
personal paths or user names end up in the repo.

## Naming convention

`NN-<slug>.png`: `NN` matches the README tour order. Never renumber, README anchors depend
on it; new captures append at the end.

## Capture matrix

| File | Example | Steps |
|------|---------|-------|
| `01-block-collision.png` | `bracket.*` | Load, click the line-5 `NF001` diagnostic. |
| `02-preflight-mismatch.png` | `mismatch.*` | Load. |
| `03-pass-clean.png` | `clean.*` | Load. |
| `04-stress-screen.png` | `bracket.*` | Load, click **Stress screen**. |
| `05-suggested-fixes.png` | `bracket.*` | Load, click **Suggest fixes**. |
| `06-cli-mismatch.png` | `mismatch.*` | Terminal: `check` with workcell and state. |
| `07-multi-op.png` | `dual-vise.*` | Load. |
| `08-custom-rules.png` | `high-feed.*` + `custom-rules.yaml` | Load. |
| `09-cli-evidence.png` | `suite.json`, `clean.*` | Terminal: `suite`, `keygen`, signed `check`, `verify` (valid, then a mismatched program). |

## When to re-capture

- Any change to `app/` or `components/` that alters layout, colors or verdict presentation.
- Any change to verdict logic in `lib/` that changes what these screens show.
- Adding an example that replaces a tour stop: update this matrix in the same commit.
