// slot.test — the ui slot client targets globalThis.__web (the per-cwd web
// surface, oilrig-web). A slot that registers before __web is published queues
// on globalThis.__webPending; once __web is up, registerSlot calls it
// directly. Split out of ui.test.mjs per C3; re-pointed at __web by the A9
// fold (billboard deleted, web replaces it).
//
//   node --experimental-strip-types tests/slot.test.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRATCH = join(process.env.TMPDIR ?? "/tmp", `oilrig-ui-slot-${process.pid}`);
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(join(SCRATCH, "extensions"), { recursive: true });
mkdirSync(join(SCRATCH, "node_modules/typebox"), { recursive: true });
writeFileSync(join(SCRATCH, "node_modules/typebox/package.json"), JSON.stringify({ name: "typebox", version: "0.0.0", type: "module", main: "index.js" }));
writeFileSync(join(SCRATCH, "node_modules/typebox/index.js"), "const mk = () => ({});\nexport const Type = new Proxy({}, { get: () => mk });\n");

const TUI = join(SCRATCH, "node_modules/@earendil-works/pi-tui");
mkdirSync(TUI, { recursive: true });
writeFileSync(join(TUI, "package.json"), JSON.stringify({ name: "@earendil-works/pi-tui", version: "0.0.0", main: "index.js" }));
mkdirSync(join(TUI, "components"), { recursive: true });
writeFileSync(join(TUI, "components", "editor.js"), `export function wordWrapLine(line, width, segs) { return [{ text: line, startIndex: 0, endIndex: line.length }]; }`);
mkdirSync(join(TUI, "utils"), { recursive: true });
writeFileSync(join(TUI, "utils", "index.js"), `export const extractAnsiCode = () => null; export const extractSegments = (s, start, end, after) => ({ before: s.slice(0, start), after: s.slice(end) });`);
writeFileSync(join(TUI, "utils.js"), `export const extractAnsiCode = () => null; export const extractSegments = (s, start, end, after) => ({ before: s.slice(0, start), after: s.slice(end) });`);
writeFileSync(join(TUI, "keys.js"), `export const decodePrintableKey = () => undefined;`);
writeFileSync(join(TUI, "index.js"), `
export const visibleWidth = (s) => String(s).replace(/\\x1b\\[[0-9;]*m/g, "").length;
export const CURSOR_MARKER = "\\x1b[7m";
export const fuzzyFilter = (items, q, fn) => items.filter(i => fn(i).toLowerCase().includes(String(q).toLowerCase()));
export const matchesKey = (data, key) => data === key;
export const getKeybindings = () => ({ matches: () => false });
export const Key = { up: "up", down: "down", left: "left", right: "right", escape: "escape", enter: "enter", tab: "tab", shift: (k) => "shift+" + k };
export class Editor { constructor(tui, theme){ this.tui = tui; this.theme = theme; this._t = ""; } setText(t){ this._t = String(t); } getText(){ return this._t; } handleInput(d){ if (d === "backspace") this._t = this._t.slice(0, -1); else this._t += d; } render(w){ return [this._t || " "]; } }
export class Text { constructor(t){ this._t = t; } render(w){ return [String(this._t)]; } }
export class Container { constructor(){ this._c = []; } addChild(c){ this._c.push(c); } render(w){ return this._c.flatMap(x => (x && x.render) ? x.render(w) : []); } }
`);
for (const pkg of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
	mkdirSync(join(SCRATCH, "node_modules", pkg), { recursive: true });
	writeFileSync(join(SCRATCH, "node_modules", pkg, "index.js"), `export const CustomEditor = class CustomEditor { constructor(){} }; export const getSelectListTheme = () => ({}); export class DynamicBorder { constructor(){} render(){ return []; } } export const ExtensionAPI = {};`);
	writeFileSync(join(SCRATCH, "node_modules", pkg, "package.json"), JSON.stringify({ name: pkg, version: "0.0.0", main: "index.js", exports: { ".": "./index.js" } }));
}
writeFileSync(join(SCRATCH, "package.json"), JSON.stringify({ name: "oilrig-ui-slot-test", type: "module", pi: {} }));
process.env.HOME = SCRATCH;
// slot.ts is the client under test; it targets __web, not the deleted billboard.
writeFileSync(join(SCRATCH, "extensions", "slot.ts"), readFileSync(join(ROOT, "extensions", "slot.ts"), "utf8"));

const results = [];
const check = (name, cond, extra = "") => results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

// Fresh process: no __web yet. registerSlot must queue on __webPending.
delete globalThis.__web;
delete globalThis.__webPending;
const { registerSlot, unregisterSlot } = await import(pathToFileURL(join(SCRATCH, "extensions/slot.ts")).href);
registerSlot({ id: "early", title: "early", priority: 30, size: "row", render: () => ["early-row"] });
check("pre-install slot queues on __webPending", Array.isArray(globalThis.__webPending) && globalThis.__webPending.length === 1);

// Once __web is published with a register fn, registerSlot calls it directly.
const reg = new Map();
globalThis.__web = {
	register(s) { reg.set(s.id, s); },
	unregister(id) { reg.delete(id); },
	repaint() {},
};
registerSlot({ id: "live", priority: 50, size: "row", render: () => ["live"] });
check("post-install slot registers directly", reg.has("live"));
check("pending queue still holds the early slot", globalThis.__webPending.length === 1);

// unregister reaches the live registry.
unregisterSlot("live");
check("unregister removes the slot", !reg.has("live"));

rmSync(SCRATCH, { recursive: true, force: true });
const passed = results.filter((r) => r.startsWith("PASS")).length;
console.log(results.join("\n"));
console.log(`\n${passed}/${results.length} slot checks passed`);
if (passed !== results.length) process.exit(1);
