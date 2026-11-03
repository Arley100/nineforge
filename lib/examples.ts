export type ExampleRef = { id: string; name: string; description: string; nc: string; workcell: string; state?: string; rules?: string };

const ex = (id: string, name: string, description: string, extra: Partial<ExampleRef> = {}): ExampleRef => ({
  id, name, description, nc: "/examples/" + id + ".nc", workcell: "/examples/" + id + ".workcell.json", state: "/examples/" + id + ".state.json", ...extra,
});

export const EXAMPLES: ExampleRef[] = [
  ex("bracket", "Bracket with fixture collision", "NF001 (collision) and NF003 (feed limit)."),
  ex("clean", "Clean pocket job", "Expected verdict: pass."),
  ex("dual-vise", "Two vises, two tools (G54/G55, G43)", "Each operation is checked under its own offset and tool. Expected verdict: pass."),
  ex("overtravel", "Over-travel job", "NF002 (travel limits)."),
  ex("messy", "Messy real-world file", "Lowercase, comments, modal feeds. Expected verdict: pass."),
  ex("mismatch", "Setup mismatch (pre-flight)", "Program assumes G55 and T07; state defines G54 and T01. NF201 + NF202."),
  ex("high-feed", "Custom shop rules (YAML)", "A 1000 mm/min feed passes the workcell but breaks the shop's 500 mm/min rule.", { state: undefined, rules: "/examples/custom-rules.yaml" }),
];
