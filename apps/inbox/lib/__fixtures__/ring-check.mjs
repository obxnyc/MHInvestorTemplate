import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
const here = "/home/user/MHInvestorTemplate/apps/inbox/lib";
const src = readFileSync(`${here}/agol.ts`, "utf8").replace(/^import type .*$/gm, "");
writeFileSync(`${here}/agol.gen.mjs`,
  ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText);
const { outerRing } = await import(`${here}/agol.gen.mjs`);

const sq = (x, y, s) => [[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]];
const cases = [
  ["a plain polygon", { type: "Polygon", coordinates: [sq(0,0,2)] }, 5, 2*2],
  ["a polygon with a hole keeps the outside",
    { type: "Polygon", coordinates: [sq(0,0,10), sq(2,2,1)] }, 5, 100],
  ["a multipolygon keeps the biggest piece",
    { type: "MultiPolygon", coordinates: [[sq(0,0,1)], [sq(5,5,8)]] }, 5, 64],
  ["a sliver with many points does not beat a big simple lot",
    { type: "MultiPolygon", coordinates: [
      [Array.from({length: 40}, (_,i) => [i*0.001, Math.sin(i)*0.001]).concat([[0,0]])],
      [sq(0,0,9)]]}, 5, 81],
  ["nothing at all", null, 0, 0],
  ["a point is not a parcel", { type: "Point", coordinates: [1,2] }, 0, 0],
];
let bad = 0;
const areaOf = (r) => { let a=0; for (let i=0;i<r.length-1;i++) a += r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1]; return Math.abs(a/2); };
for (const [name, g, pts, want] of cases) {
  const r = outerRing(g);
  const got = r.length ? areaOf(r) : 0;
  const ok = r.length === pts && Math.abs(got - want) < 1e-6;
  if (!ok) { bad++; console.error(` ✗ ${name}: ${r.length} points, area ${got}, wanted ${pts} / ${want}`); }
  else console.log(` ok  ${name}`);
}
process.exit(bad ? 1 : 0);
