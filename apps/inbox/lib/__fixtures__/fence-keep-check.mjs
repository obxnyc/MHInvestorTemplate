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
// Taking every home off the map to put them back one at a time leaves a
// plan with a line and no rows. Keyed on rows alone, the next reload
// called that park undescribed, offered the describe form again, and did
// not load the plan at all -- so the line went with the homes.
if (!/const has = Boolean\(mine\?\.rows\?\.length \|\| mine\?\.fence\?\.length\);/.test(s)) {
  bad.push("a park with a boundary and no rows reads as undescribed, so "
    + "clearing the homes to place them by hand loses the boundary too");
}
if (!/if \(has && mine\) \{\n      setPlan\(mine\);/.test(s)) {
  bad.push("the stored plan is adopted on a different test from the one "
    + "that decided the park is known, so the two can disagree");
}

// A line drawn by eye and a line off the deed look identical on screen
// and are not the same claim. The sentence above the map said "the
// property line is the county's, from parcel P139-50A" over a line
// somebody had drawn with the mouse, because it only ever asked whether
// there WAS a line. Which it is decides whether the next park takes a
// minute or another afternoon.
if (!/fenceFrom: "county" as const,/.test(s)) {
  bad.push("the county's line is not recorded as the county's");
}
if (!/fenceFrom: "hand" as const,/.test(s)) {
  bad.push("a line drawn by hand is not recorded as drawn by hand");
}
if (!/has=\{plan\.fence\?\.length \? \(plan\.fenceFrom \?\? "unsaid"\) : null\}/.test(s)) {
  bad.push("the sentence above the map is told only whether a line exists, "
    + "so it will call a hand-drawn line the county's again");
}
if (!/has === "hand"\s*\n\s*\? "The property line is the one you drew by hand/.test(s)) {
  bad.push("a hand-drawn line is not said to be hand-drawn");
}
if (!/has === "unsaid"/.test(s)) {
  bad.push("a park whose line predates the question is not allowed to say "
    + "so -- guessing county or hand there is the same lie in a new place");
}

if (bad.length) { for (const b of bad) console.error(" ✗ " + b); process.exit(1); }
console.log("nothing obviously wrong");
