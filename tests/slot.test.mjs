// slot.test — the billboard slot registry: priority ordering and the
// pre-install pending drain.
//
// Slots register through globalThis.__billboard. A slot that registers before
// ui's install publishes that global queues on globalThis.__billboardPending
// and the panel drains it on install (billboard.ts). A bug in the drain is
// silent — the slot simply never appears — so this file is the tripwire,
// split out of ui.test.mjs per C3 alongside mono.test.
//
//   node --experimental-strip-types tests/slot.test.mjs

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRATCH = join(process.env.TMPDIR ?? "/tmp", `pi-ui-slot-${process.pid}`);
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
writeFileSync(join(SCRATCH, "package.json"), JSON.stringify({ name: "pi-ui-slot-test", type: "module", pi: {} }));
process.env.HOME = SCRATCH;
for (const part of ["index.ts", "style.ts", "editor.ts", "chrome.ts", "starship.ts", "billboard.ts", "slot.ts", "questionnaire.ts", "colors.ts", "retro.ts", "context.ts"])
	writeFileSync(join(SCRATCH, "extensions", part), readFileSync(join(ROOT, "extensions", part), "utf8"));

const results = [];
const check = (name, cond, extra = "") => results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

// A fresh process: no billboard installed yet. A slot that registers now must
// queue on globalThis.__billboardPending (the pre-install path every consumer
// takes when it loads before ui).
delete globalThis.__billboard;
delete globalThis.__billboardPending;
const { registerSlot } = await import(pathToFileURL(join(SCRATCH, "extensions/slot.ts")).href);
registerSlot({ id: "early", title: "early", priority: 30, size: "row", render: () => ["early-row"] });
check("pre-install slot queues on __billboardPending", Array.isArray(globalThis.__billboardPending) && globalThis.__billboardPending.length === 1);

// Now install the billboard — it must drain the pending queue into the registry.
const { installBillboard } = await import(pathToFileURL(join(SCRATCH, "extensions/billboard.ts")).href);
const pi = {
	handlers: new Map(), command: undefined, shortcuts: new Map(),
	on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, []); this.handlers.get(ev).push(fn); },
	registerCommand(_n, spec) { this.command = spec; },
	registerShortcut(key, spec) { this.shortcuts.set(key, spec); },
	async fire(ev, e, c) { let out; for (const fn of this.handlers.get(ev) ?? []) out = (await fn(e, c)) ?? out; return out; },
};
const bui = { overlays: [], tui: { renders: 0, requestRender() { this.renders++; } }, custom(f, o) { const rec = { options: o, closed: false }; return new Promise((r) => { rec.done = (v) => { rec.closed = true; r(v); }; rec.component = f(this.tui, {}, {}, rec.done); this.overlays.push(rec); }); }, setWidget() {}, notify() {} };
installBillboard(pi);
await pi.fire("session_start", {}, { ui: bui });

const api = globalThis.__billboard;
const ids = () => (api.list?.() ?? []).map((s) => s.id);
check("pending queue drained on install", ids().includes("early"));
check("pending queue emptied after drain", !(globalThis.__billboardPending?.length));

// unregister removes a slot.
api.register({ id: "mid", priority: 50, size: "row", render: () => ["mid"] });
api.unregister("mid");
check("unregister removes the slot", !ids().includes("mid"));

rmSync(SCRATCH, { recursive: true, force: true });
const passed = results.filter((r) => r.startsWith("PASS")).length;
console.log(results.join("\n"));
console.log(`\n${passed}/${results.length} slot checks passed`);
if (passed !== results.length) process.exit(1);