"""Thin Python binding for NineForge (PAI-301 wedge).

Shells out to the NineForge CLI and returns the versioned JSON report.
Requires a nineforge checkout with `npm install` done. Point NINEFORGE_REPO
at the checkout if this module is used from outside the repo.
Honesty note: this is an integration wedge, not a PyPI distribution yet.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path


def _repo() -> Path:
    env = os.environ.get("NINEFORGE_REPO")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent


def check(gcode: str, workcell, state=None) -> dict:
    repo = _repo()
    with tempfile.TemporaryDirectory() as td:
        nc = Path(td, "job.nc")
        wc = Path(td, "wc.json")
        nc.write_text(gcode, encoding="utf-8")
        wc.write_text(workcell if isinstance(workcell, str) else json.dumps(workcell), encoding="utf-8")
        cmd = ["npx", "tsx", "cli/main.ts", "check", str(nc), "--workcell", str(wc), "--json"]
        if state is not None:
            st = Path(td, "st.json")
            st.write_text(state if isinstance(state, str) else json.dumps(state), encoding="utf-8")
            cmd += ["--state", str(st)]
        p = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, shell=(os.name == "nt"))
        if not p.stdout.strip():
            raise RuntimeError("nineforge CLI failed (%s): %s" % (p.returncode, p.stderr.strip()))
        return json.loads(p.stdout)["result"]
