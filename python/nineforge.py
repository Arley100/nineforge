"""
Python bindings for NineForge. Pipes a JSON job to the compiled bridge (dist/python-bridge.js),
so the only runtime requirement is Node.js >= 20. Build it once with `npm run build:lib`.
Set NINEFORGE_REPO to your checkout if this module lives outside the repo.
"""
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, Union

Json = Union[str, Dict[str, Any]]


def _bridge_path() -> Path:
    root = os.environ.get("NINEFORGE_REPO")
    return (Path(root) if root else Path(__file__).resolve().parent.parent) / "dist" / "python-bridge.js"


def check(gcode: str, workcell: Json, state: Optional[Json] = None, rules: Optional[Json] = None, timeout: float = 60) -> Dict[str, Any]:
    """Validate a program; returns the versioned report (verdict: pass | caution | block).

    workcell/state: JSON text or dicts. rules: YAML/JSON text or a dict.
    """
    bridge = _bridge_path()
    if not bridge.exists():
        raise RuntimeError(f"Compiled NineForge bridge not found at {bridge}. Run 'npm run build:lib' in the repo root first.")
    payload = json.dumps({"gcode": gcode, "workcell": workcell, "state": state, "rules": rules})
    try:
        p = subprocess.run(["node", str(bridge)], input=payload, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    except FileNotFoundError:
        raise RuntimeError("Node.js is required to run NineForge Python bindings but was not found in PATH.") from None
    if p.returncode != 0:
        raise RuntimeError(f"NineForge bridge failed: {p.stderr.strip()}")
    try:
        return json.loads(p.stdout)["result"]
    except (json.JSONDecodeError, KeyError) as e:
        raise RuntimeError(f"Failed to parse bridge output: {e}") from None
