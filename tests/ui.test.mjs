// Regression suite for pi-ui — style, editor, chrome, starship.
//
//   node --experimental-strip-types tests/ui.test.mjs
//
// Copies the extension into a scratch package with a stubbed pi-tui and
// asserts: style prompt appends, "normal mode" disables, :q triggers
// shutdown, selection keys are intercepted, chrome wraps install.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRATCH = join(process.env.TMPDIR ?? "/tmp", "pi-ui-test");

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(join(SCRATCH, "extensions", "ui"), { recursive: true });

const TUI = join(SCRATCH, "node_modules/@earendil-works/pi-tui");
mkdirSync(TUI, { recursive: true });
writeFileSync(join(TUI, "package.json"), JSON.stringify({ name: "@earendil-works/pi-tui", version: "0.0.0", main: "index.js" }));
mkdirSync(join(TUI, "components"), { recursive: true });
writeFileSync(join(TUI, "components", "editor.js"), `export function wordWrapLine(line, width, segs) { return [{ text: line, startIndex: 0, endIndex: line.length }]; }`);
mkdirSync(join(TUI, "utils"), { recursive: true });
writeFileSync(join(TUI, "utils", "index.js"), `export const extractAnsiCode = () => null; export const extractSegments = (s, start, end, after) => ({ before: s.slice(0, start), after: s.slice(end) });`);
writeFileSync(join(TUI, "utils.js"), `export const extractAnsiCode = () => null; export const extractSegments = (s, start, end, after) => ({ before: s.slice(0, start), after: s.slice(end) });`);
mkdirSync(join(TUI, "word-navigation"), { recursive: true });
writeFileSync(join(TUI, "word-navigation", "index.js"), `export const findWordBackward = () => 0; export const findWordForward = () => 0;`);
writeFileSync(join(TUI, "word-navigation.js"), `export const findWordBackward = () => 0; export const findWordForward = () => 0;`);
writeFileSync(join(TUI, "index.js"), `
export const visibleWidth = (s) => String(s).replace(/\\x1b\\[[0-9;]*m/g, "").length;
export const truncateToWidth = (s, w) => String(s).slice(0, w);
export const CURSOR_MARKER = "\\x1b[7m";
export const fuzzyFilter = (q, items, fn) => items.filter(i => fn(i).toLowerCase().includes(q.toLowerCase()));
export const matchesKey = (data, key) => data === key;
export const getKeybindings = () => ({ matches: () => false });
export const sliceByColumn = (s, start, len) => s.slice(start, start + len);
export const Key = { up: "up", down: "down", left: "left", right: "right", home: "home", end: "end", pageUp: "pageUp", pageDown: "pageDown" };
`);
for (const pkg of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
	mkdirSync(join(SCRATCH, "node_modules", pkg), { recursive: true });
	writeFileSync(join(SCRATCH, "node_modules", pkg, "index.js"), `export const CustomEditor = class CustomEditor { constructor(tui, theme, kb) { this.state = { lines: [""], cursorLine: 0, cursorCol: 0 }; this.tui = tui; this.theme = theme; this.keybindings = kb; } getText() { return this.state.lines.join("\\n"); } setText(t) { this.state.lines = t.split("\\n"); } emitChange() {} moveCursor(dl, dc) { this.state.cursorLine = Math.max(0, Math.min(this.state.lines.length - 1, this.state.cursorLine + dl)); this.state.cursorCol = Math.max(0, this.state.cursorCol + dc); } moveToLineStart() { this.state.cursorCol = 0; } moveToLineEnd() { this.state.cursorCol = (this.state.lines[this.state.cursorLine] || "").length; } pageScroll(dir) {} render(w) { return this.state.lines.map(l => l || " "); } segment(line, type) { return []; } }; export const getSelectListTheme = () => ({ selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s }); export const ExtensionAPI = {};`);
	writeFileSync(join(SCRATCH, "node_modules", pkg, "package.json"), JSON.stringify({ name: pkg, version: "0.0.0", main: "index.js", exports: { ".": "./index.js" } }));
}
writeFileSync(join(SCRATCH, "package.json"), JSON.stringify({ name: "pi-ui-test", type: "module", pi: {} }));

// Copy extension files
for (const part of ["index.ts", "style.ts", "editor.ts", "chrome.ts", "starship.ts"])
	writeFileSync(join(SCRATCH, "extensions", "ui", part), readFileSync(join(ROOT, "extensions", "ui", part), "utf8"));

const results = [];
const check = (name, cond, extra = "") => results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

const fg = (style, text) => text; // stub returns text
const makePi = () => {
	const handlers = new Map();
	const commands = new Map();
	return { handlers, commands, on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }, registerCommand(name, def) { commands.set(name, def); } };
};
const fire = async (pi, name, event, ctx) => {
	let last;
	for (const fn of pi.handlers.get(name) ?? []) {
		const r = await fn(event, ctx);
		if (r !== undefined) last = r;
	}
	return last;
};

// ── style ──
const stylePi = makePi();
(await import(pathToFileURL(join(SCRATCH, "extensions/ui/index.ts")).href)).default(stylePi);

let r = await fire(stylePi, "before_agent_start", { systemPrompt: "base" });
check("style prompt appended", r?.systemPrompt?.includes("Output discipline"));

const userMsg = { role: "user", content: [{ type: "text", text: "do the thing" }] };
r = await fire(stylePi, "context", { messages: [userMsg] });
const remindedText = JSON.stringify(r?.messages?.[0] ?? "");
check("reminder anchored on last user message", remindedText.includes("style"));
r = await fire(stylePi, "context", r ? { messages: r.messages } : { messages: [userMsg] });
check("reminder not doubled", r === undefined);

await fire(stylePi, "input", { text: "normal mode" });
r = await fire(stylePi, "before_agent_start", { systemPrompt: "base" });
check("normal mode disables style", r === undefined);

// ── :q shutdown ──
let shutdownCalled = false;
const qCtx = { shutdown: () => { shutdownCalled = true; }, mode: "tui", ui: { setEditorComponent: () => {}, setWidget: () => {}, setStatus: () => {}, setFooter: () => {}, notify: () => {}, setHeader: () => {}, theme: { fg: () => "" }, keybindings: {} } };
r = await fire(stylePi, "input", { text: ":q", source: "interactive" }, qCtx);
check(":q triggers shutdown", shutdownCalled === true, String(r?.action));

// ── chrome wraps ──
const toasts = [];
const statuses = [];
const headers = [];
const chromeCtx = {
	mode: "tui",
	ui: {
		notify: (m) => toasts.push(m),
		setStatus: (k, v) => statuses.push([k, v]),
		setHeader: (c) => headers.push(c),
		setFooter: () => {},
		setEditorComponent: () => {},
		setWidget: () => {},
		theme: { fg: () => "" },
		keybindings: {},
	},
};
await fire(stylePi, "session_start", {}, chromeCtx);

chromeCtx.ui.notify("Ponytail loaded: 3 rules");
chromeCtx.ui.notify("hello");
check("ponytail toast swallowed", !toasts.includes("Ponytail loaded: 3 rules"));
check("other toasts pass", toasts.includes("hello"));

chromeCtx.ui.setStatus("ponytail", "x");
chromeCtx.ui.setStatus("kern", "ok");
check("ponytail status swallowed", !statuses.some(([k]) => k === "ponytail") && statuses.some(([k]) => k === "kern"));

chromeCtx.ui.setHeader("WELCOME");
check("header installs swallowed", headers.length > 0 && headers.every((h) => h === undefined));
check("footer wrap installed", chromeCtx.ui.__statusLineWrapped === true);

// ── editor stack ──
let editorFactoryCalled = false;
const editorCtx = {
	mode: "tui",
	ui: {
		setEditorComponent: (fn) => { editorFactoryCalled = true; },
		setWidget: () => {},
		setStatus: () => {},
		setFooter: () => {},
		notify: () => {},
		setHeader: () => {},
		theme: { fg },
		keybindings: {},
		custom: async () => null,
	},
};
await fire(stylePi, "session_start", {}, editorCtx);
await new Promise(r => setTimeout(r, 200));
check("editor factory registered", editorFactoryCalled);

// ── starship ──
let widgetSet = false;
let statusSet = false;
const starCtx = {
	mode: "tui",
	model: { id: "test-model" },
	projectRoot: "/tmp",
	sessionManager: { getBranch: () => [] },
	ui: {
		setEditorComponent: () => {},
		setWidget: (...args) => { widgetSet = true; },
		setStatus: (...args) => { statusSet = true; },
		setFooter: () => {},
		notify: () => {},
		setHeader: () => {},
		theme: { fg },
		keybindings: {},
	},
};
await fire(stylePi, "session_start", {}, starCtx);
await fire(stylePi, "agent_settled", {}, starCtx);
check("starship widget set", widgetSet);

for (const line of results) console.log(line);
const failed = results.filter((x) => x.startsWith("FAIL"));
if (failed.length) { console.error(`\n${failed.length} check(s) failed`); process.exit(1); }
console.log("\nall ui checks passed");