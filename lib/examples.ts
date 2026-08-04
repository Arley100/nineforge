export type ExampleRef = { id: string; name: string; description: string; nc: string; workcell: string; state: string; };
export const EXAMPLES: ExampleRef[] = [
  { id: "bracket", name: "Bracket with fixture collision", description: "Demonstrates NF001 (collision) and NF003 (feed limit).", nc: "/examples/bracket.nc", workcell: "/examples/bracket.workcell.json", state: "/examples/bracket.state.json" },
  { id: "clean", name: "Clean pocket job", description: "Expected verdict: pass.", nc: "/examples/clean.nc", workcell: "/examples/clean.workcell.json", state: "/examples/clean.state.json" },
  { id: "overtravel", name: "Over-travel job", description: "Demonstrates NF002 (travel limits).", nc: "/examples/overtravel.nc", workcell: "/examples/overtravel.workcell.json", state: "/examples/overtravel.state.json" },
  { id: "messy", name: "Messy real-world file", description: "Lowercase, comments, modal feeds. Expected verdict: pass.", nc: "/examples/messy.nc", workcell: "/examples/messy.workcell.json", state: "/examples/messy.state.json" },
  { id: "mismatch", name: "Setup mismatch (pre-flight)", description: "Program assumes G55 and T07; state defines G54 and T01. NF201 + NF202.", nc: "/examples/mismatch.nc", workcell: "/examples/mismatch.workcell.json", state: "/examples/mismatch.state.json" },
];