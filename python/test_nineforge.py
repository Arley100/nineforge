"""Run after `npm run build:lib`:  python -m unittest discover python"""
import unittest
from pathlib import Path

import nineforge

EXAMPLES = Path(__file__).resolve().parent.parent / "public" / "examples"
read = lambda name: (EXAMPLES / name).read_text(encoding="utf-8")


class CheckTest(unittest.TestCase):
    def test_bracket_blocks_on_fixture_collision(self):
        report = nineforge.check(read("bracket.nc"), read("bracket.workcell.json"), read("bracket.state.json"))
        self.assertEqual(report["reportVersion"], 1)
        self.assertEqual(report["verdict"], "block")
        self.assertIn("NF001", [d["code"] for d in report["diagnostics"]])

    def test_clean_passes_with_dict_inputs(self):
        import json
        report = nineforge.check(read("clean.nc"), json.loads(read("clean.workcell.json")), json.loads(read("clean.state.json")))
        self.assertEqual(report["verdict"], "pass")

    def test_yaml_rules_text(self):
        report = nineforge.check(read("high-feed.nc"), read("high-feed.workcell.json"), rules=read("custom-rules.yaml"))
        self.assertIn("NO_HIGH_FEED", [d["code"] for d in report["diagnostics"]])

    def test_invalid_workcell_fails_closed(self):
        report = nineforge.check("G0 X1", "{ nope")
        self.assertEqual(report["verdict"], "block")
        self.assertEqual(report["diagnostics"][0]["code"], "NF107")

    def test_invalid_rules_raise(self):
        with self.assertRaises(RuntimeError):
            nineforge.check("G0 X1", read("clean.workcell.json"), rules={"version": "1.0", "rules": [{"id": "X", "severity": "error", "type": "max_feed", "params": {"maximum": 5}}]})


if __name__ == "__main__":
    unittest.main()
