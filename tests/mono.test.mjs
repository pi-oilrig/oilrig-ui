// mono.test — the billboard's monochrome funnel, in isolation.
//
// mono() is the single funnel every byte a slot renders passes through
// (AGENTS.md): it drops colour and keeps the three non-colour SGR attributes
// (bold, inverse, strike). Two bugs shipped through it — a control-character
// scrub whose class \x0b-\x1f ate the ESC off the sequences it had just kept
// (printing literal `[0m`), and a slot's `\x1b[0m` closing the panel's white
// along with its own bold. Both are silent (no visible symptom unless you
// inspect the bytes), so this file is the tripwire — split out of ui.test.mjs
// per C3 so the panel's silent-failure path has its own file.
//
//   node --experimental-strip-types tests/mono.test.mjs

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRATCH = join(process.env.TMPDIR ?? "/tmp", `pi-ui-mono-${process.pid}`);
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
export const truncateToWidth = (s, w) => { const vis = String(s).replace(/\\x1b\\[[0-9;]*m/g, ""); return vis.length <= w ? String(s) : String(s).slice(0, w); };
export const CURSOR_MARKER = "\\x1b[7m";
export const fuzzyFilter = (items, q, fn) => items.filter(i => fn(i).toLowerCase().includes(String(q).toLowerCase()));
export const matchesKey = (data, key) => data === key;
export const getKeybindings = () => ({ matches: () => false });
export const sliceByColumn = (s, start, len) => s.slice(start, start + len);
export const Key = { up: "up", down: "down", left: "left", right: "right", escape: "escape", enter: "enter", tab: "tab", shift: (k) => "shift+" + k };
export const wrapTextWithAnsi = (s, w) => { const out = []; let t = String(s); if (!t) return [""]; while (t.length > w) { out.push(t.slice(0, w)); t = t.slice(w); } out.push(t); return out; };
export class Editor { constructor(tui, theme){ this.tui = tui; this.theme = theme; this._t = ""; } setText(t){ this._t = String(t); } getText(){ return this._t; } handleInput(d){ if (d === "backspace") this._t = this._t.slice(0, -1); else this._t += d; } render(w){ return [this._t || " "]; } }
export class Text { constructor(t){ this._t = t; } render(w){ return [String(this._t)]; } }
export class Container { constructor(){ this._c = []; } addChild(c){ this._c.push(c); } render(w){ return this._c.flatMap(x => (x && x.render) ? x.render(w) : []); } }
`);
for (const pkg of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
	mkdirSync(join(SCRATCH, "node_modules", pkg), { recursive: true });
	writeFileSync(join(SCRATCH, "node_modules", pkg, "index.js"), `export const CustomEditor = class CustomEditor { constructor(tui, theme, kb) { this.state = { lines: [""], cursorLine: 0, cursorCol: 0 }; this.tui = tui; this.theme = theme; this.keybindings = kb; } getText() { return this.state.lines.join("\\n"); } setText(t) { this.state.lines = t.split("\\n"); } render(w) { return this.state.lines.map(l => l || " "); } }; export const getSelectListTheme = () => ({ selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s }); export class DynamicBorder { constructor(color){ this._color = color || (s => s); } render(w){ return [this._color("-".repeat(Math.max(1, w)))]; } } export const ExtensionAPI = {};`);
	writeFileSync(join(SCRATCH, "node_modules", pkg, "package.json"), JSON.stringify({ name: pkg, version: "0.0.0", main: "index.js", exports: { ".": "./index.js" } }));
}
writeFileSync(join(SCRATCH, "package.json"), JSON.stringify({ name: "pi-ui-mono-test", type: "module", pi: {} }));
process.env.HOME = SCRATCH;

// Copy the extension files mono() lives in / is reached through.
for (const part of ["index.ts", "style.ts", "editor.ts", "chrome.ts", "starship.ts", "billboard.ts", "slot.ts", "questionnaire.ts", "colors.ts", "retro.ts", "context.ts"])
	writeFileSync(join(SCRATCH, "extensions", part), readFileSync(join(ROOT, "extensions", part), "utf8"));

const results = [];
const check = (name, cond, extra = "") => results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

// Install the billboard directly (as ui.test.mjs's panel block does), so its
// f2 shortcut lands in a shortcuts map we can fire to open the max overlay.
const { installBillboard } = await import(pathToFileURL(join(SCRATCH, "extensions/billboard.ts")).href);
const pi = {
	handlers: new Map(), command: undefined, shortcuts: new Map(),
	on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, []); this.handlers.get(ev).push(fn); },
	registerCommand(_n, spec) { this.command = spec; },
	registerShortcut(key, spec) { this.shortcuts.set(key, spec); },
	async fire(ev, e, c) { let out; for (const fn of this.handlers.get(ev) ?? []) out = (await fn(e, c)) ?? out; return out; },
};
const bui = {
	overlays: [], tui: { renders: 0, requestRender() { this.renders++; } }, notes: [],
	custom(factory, opts) {
		const rec = { options: opts, closed: false };
		return new Promise((resolve) => {
			rec.done = (v) => { rec.closed = true; resolve(v); };
			rec.component = factory(this.tui, {}, {}, rec.done);
			this.overlays.push(rec);
		});
	},
	setWidget() {}, notify() {},
};
installBillboard(pi);
await pi.fire("session_start", {}, { ui: bui });
const sc = pi.shortcuts.get("f2");
await sc.handler({ ui: bui });
const ov = [...bui.overlays].reverse().find((o) => !o.closed);
const maxRaw = (o) => o.component.render(80);
const noAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const maxLines = (o) => o.component.render(80).map(noAnsi);

const api = globalThis.__billboard;
const SGR = /\x1b\[[0-9;]*m/g;
const params = (s) => (s.match(SGR) ?? []).flatMap((c) => c.slice(2, -1).split(";"));
api.register({
	id: "paint",
	title: "paint",
	priority: 210,
	size: "card",
	render: () => [
		`\x1b[33mamber\x1b[0m \x1b[36mcyan\x1b[0m \x1b[1mbold\x1b[0m \x1b[7minv\x1b[27m \x1b[2mdim\x1b[0m`,
		`\x1b[2J\x1b[Hcursor-move \x1b]0;title\x07osc`,
	],
});
const paint = maxRaw(ov).join("\n");
const orphaned = paint.replace(SGR, "");
check("no literal [0m leaks into the panel", !/\[[0-9;]*m/.test(orphaned));
check("colour params are stripped", !params(paint).some((p) => /^(3[0-7]|9[0-6]|4[0-7]|10[0-7]|2)$/.test(p)));
check("bold survives as weight", params(paint).includes("1"));
check("inverse survives as the cursor", params(paint).includes("7"));
check("non-SGR escapes are dropped whole", paint.includes("cursor-move") && !paint.includes("2J") && !paint.includes("title\x07"));
check("a slot's reset re-asserts the panel white", /\x1b\[0m\x1b\[97m/.test(maxRaw(ov).join("")));
api.unregister("paint");

rmSync(SCRATCH, { recursive: true, force: true });
const passed = results.filter((r) => r.startsWith("PASS")).length;
console.log(results.join("\n"));
console.log(`\n${passed}/${results.length} mono checks passed`);
if (passed !== results.length) process.exit(1);