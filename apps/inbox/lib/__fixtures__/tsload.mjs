/**
 * Load a TypeScript module, and the local modules it imports, into the
 * running harness.
 *
 * Every harness here transpiles a source file and imports it as a `data:`
 * URL, which works until the file imports a sibling: a relative specifier has
 * nothing to be relative TO inside a data URL, and node refuses it with
 * ERR_UNSUPPORTED_RESOLVE_REQUEST. Stripping the import instead would leave
 * the module calling a function that is not there, which is a harness that
 * dies on a fault -- the thing this suite has twice been taught to avoid.
 *
 * So each dependency is built first and its own data URL is substituted for
 * the specifier. A data URL is absolute, so a data module importing another
 * data module resolves.
 */
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import ts from "typescript";

const built = new Map();

function build(file) {
  const had = built.get(file);
  if (had) return had;

  // Type-only imports carry no runtime value and their targets may not even
  // transpile on their own, so they go before anything is resolved.
  let src = readFileSync(file, "utf8").replace(/^import type [^\n]*\n/gm, "");

  const dir = dirname(file);
  // Both `from "./x"` and a bare side-effect `import "./x"`.
  src = src.replace(/((?:from|import)\s*")(\.[^"]+)(")/g, (whole, a, spec, c) => {
    const target = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts"]
      .map((ext) => resolve(dir, spec + ext))
      .find((p) => existsSync(p) && !p.endsWith("/"));
    if (!target) return whole;          // not a local file: leave it alone
    return a + build(target) + c;
  });

  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url = "data:text/javascript," + encodeURIComponent(js);
  built.set(file, url);
  return url;
}

/** `await loadTs("/abs/path/to/lib/thing.ts")` -> the module's exports. */
export function loadTs(file) {
  return import(build(resolve(file)));
}
