"""
Real Python bindings for NineForge via compiled JS entry point.
Replaces the subprocess wedge (PAI-301). Requires Node.js to run the bundled bridge.
"""
import json
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, Union

def _bridge_path() -> Path:
    # Resolves to <repo_root>/dist/python-bridge.js
    return Path(__file__).parent.parent / "dist" / "python-bridge.js"

def check(
    gcode: str, 
    workcell: Union[str, Dict[str, Any]], 
    state: Optional[Union[str, Dict[str, Any]]] = None,
    rules: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    bridge = _bridge_path()
    if not bridge.exists():
        raise RuntimeError(
            f"Compiled NineForge bridge not found at {bridge}. "
            "Run 'npm run build:python' in the repo root first."
        )

    payload = {
        "gcode": gcode,
        "workcell": workcell,
        "state": state,
        "rules": rules
    }

    try:
        p = subprocess.run(
            ["node", str(bridge)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            encoding="utf-8"
        )
    except FileNotFoundError:
        raise RuntimeError("Node.js is required to run NineForge Python bindings but was not found in PATH.")

    if p.returncode != 0:
        raise RuntimeError(f"NineForge bridge failed: {p.stderr.strip()}")
    
    try:
        return json.loads(p.stdout)["result"]
    except (json.JSONDecodeError, KeyError) as e:
        raise RuntimeError(f"Failed to parse bridge output: {e}")
