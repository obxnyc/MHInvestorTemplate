// Re-describing a park must not throw away a boundary already drawn.
// This is the shape of the bug, tested on the rule rather than the UI:
// the form carries `fence` through from the plan it was opened with.
import { readFileSync } from "node:fs";
const s = readFileSync("components/ParkScreen.tsx", "utf8");
const bad = [];
if (!/from=\{plan\.rows\.length \|\| plan\.fence\?\.length \? plan : null\}/.test(s)) {
  bad.push("the describe form is not given a park that has only a boundary, "
    + "so drawing a line and then describing the park would lose the line");
}
if (!/const \[fence, setFence\] = useState<number\[\]\[\] \| null>\(from\?\.fence \?\? null\);/.test(s)) {
  bad.push("the form does not start from the boundary already on file");
}
if (!/fence: fence \?\? undefined,/.test(s)) {
  bad.push("laying out a park does not carry the boundary into the new plan");
}
if (bad.length) { for (const b of bad) console.error(" ✗ " + b); process.exit(1); }
console.log("nothing obviously wrong");
