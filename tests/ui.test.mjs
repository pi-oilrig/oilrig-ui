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
// Per-process scratch: a fixed path collides when two runs overlap (the probe
// running every package's tests while a bare `npm test` is open), and the stale
// pi-history.jsonl makes the picker assertions fail nondeterministically.
const SCRATCH = join(process.env.TMPDIR ?? "/tmp", `pi-ui-test-${process.pid}`);

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
writeFileSync(join(TUI, "keys.js"), `export const decodePrintableKey = () => undefined;`);
writeFileSync(join(TUI, "index.js"), `
export const visibleWidth = (s) => String(s).replace(/\\x1b\\[[0-9;]*m/g, "").length;
export const truncateToWidth = (s, w) => { const vis = String(s).replace(/\x1b\[[0-9;]*m/g, ""); return vis.length <= w ? String(s) : String(s).slice(0, w); };
export const CURSOR_MARKER = "\\x1b[7m";
export const fuzzyFilter = (items, q, fn) => items.filter(i => fn(i).toLowerCase().includes(String(q).toLowerCase()));
export const matchesKey = (data, key) => data === key;
export const getKeybindings = () => ({ matches: () => false });
export const sliceByColumn = (s, start, len) => s.slice(start, start + len);
export const Key = { up: "up", down: "down", left: "left", right: "right", home: "home", end: "end", pageUp: "pageUp", pageDown: "pageDown" };
export class Text { constructor(t){ this._t = t; } render(w){ return [String(this._t)]; } }
export class Container { constructor(){ this._c = []; } addChild(c){ this._c.push(c); } render(w){ return this._c.flatMap(x => (x && x.render) ? x.render(w) : []); } }
`);
for (const pkg of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
	mkdirSync(join(SCRATCH, "node_modules", pkg), { recursive: true });
	writeFileSync(join(SCRATCH, "node_modules", pkg, "index.js"), `export const CustomEditor = class CustomEditor { constructor(tui, theme, kb) { this.state = { lines: [""], cursorLine: 0, cursorCol: 0 }; this.tui = tui; this.theme = theme; this.keybindings = kb; } getText() { return this.state.lines.join("\\n"); } setText(t) { this.state.lines = t.split("\\n"); } moveCursor(dl, dc) { this.state.cursorLine = Math.max(0, Math.min(this.state.lines.length - 1, this.state.cursorLine + dl)); this.state.cursorCol = Math.max(0, this.state.cursorCol + dc); } moveToLineStart() { this.state.cursorCol = 0; } moveToLineEnd() { this.state.cursorCol = (this.state.lines[this.state.cursorLine] || "").length; } pageScroll(dir) {} render(w) { return this.state.lines.map(l => l || " "); } segment(line, type) { return []; } setAutocompleteProvider(p) { this.autocompleteProvider = p; } getAutocompleteMaxVisible() { return this.maxVisible ?? 5; } setAutocompleteMaxVisible(n) { this.maxVisible = n; } cancelAutocomplete() { this.autocompleteState = null; } isShowingAutocomplete() { return !!this.autocompleteState; } async requestAutocomplete(o) { const r = await this.autocompleteProvider.getSuggestions(this.state.lines, this.state.cursorLine, this.state.cursorCol, { signal: {}, force: o.force }); if (!r || !r.items || r.items.length === 0) { this.cancelAutocomplete(); return; } this.autocompletePrefix = r.prefix; this.autocompleteItems = r.items; this.autocompleteState = o.force ? "force" : "regular"; } }; export const getSelectListTheme = () => ({ selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s }); export class DynamicBorder { constructor(color){ this._color = color || (s => s); } render(w){ return [this._color("-".repeat(Math.max(1, w)))]; } } export const ExtensionAPI = {};`);
	writeFileSync(join(SCRATCH, "node_modules", pkg, "package.json"), JSON.stringify({ name: pkg, version: "0.0.0", main: "index.js", exports: { ".": "./index.js" } }));
}
writeFileSync(join(SCRATCH, "package.json"), JSON.stringify({ name: "pi-ui-test", type: "module", pi: {} }));

// The history picker reads ~/.pi/agent/pi-history.jsonl at homedir(). Point HOME
// at the scratch dir (before the extension is imported — HISTORY_DIR is computed
// at module load) and seed it, so the picker test is deterministic.
process.env.HOME = SCRATCH;
mkdirSync(join(SCRATCH, ".pi", "agent"), { recursive: true });
writeFileSync(
	join(SCRATCH, ".pi", "agent", "pi-history.jsonl"),
	["alpha one", "beta two", "gamma three"]
		.map((text, i) => JSON.stringify({ text, ts: i })).join("\n") + "\n",
);

// Copy extension files
for (const part of ["index.ts", "style.ts", "editor.ts", "chrome.ts", "starship.ts", "colors.ts", "retro.ts"])
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
let liveFactory = null;
const editorCtx = {
	mode: "tui",
	ui: {
		setEditorComponent: (fn) => { editorFactoryCalled = true; liveFactory = fn; },
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

// ── shift-selection (regression: emitChange was undefined → every key threw) ──
let rendered = 0;
const fakeTui = { requestRender: () => { rendered++; }, terminal: { rows: 24, columns: 80 } };
const ed = liveFactory(fakeTui, editorCtx.ui.theme, {});
let lastChange = null;
ed.onChange = (t) => { lastChange = t; };
ed.setText("hello world");
ed.state.cursorLine = 0;
ed.state.cursorCol = 0;
let threw = false, handled = false;
try { for (let i = 0; i < 5; i++) handled = ed.onExtensionShortcut("shift+right"); }
catch { threw = true; }
check("shift+select extends without throwing", !threw && handled === true);
check("shift+select requests a render", rendered > 0);
check("selection is highlighted", ed.render(80).join("\n").includes("\x1b[7m"));
check("left bar prefixes every line", ed.render(80).every((l) => l.startsWith("▌")));
let cutThrew = false;
try { ed.onExtensionShortcut("ctrl+x"); } catch { cutThrew = true; }
check("cut removes selection + fires onChange", !cutThrew && ed.getText() === " world" && lastChange === " world");

// ── history menu (regression: fuzzyFilter's args were swapped, so typing never
// filtered; and the old picker took over ui.custom, so the input box vanished.
// It is now pi's own autocomplete menu — editor keeps the slot) ──
const baseProvider = {
	triggerCharacters: ["@"],
	calls: 0,
	getSuggestions() { baseProvider.calls++; return Promise.resolve(null); },
	applyCompletion() { return { lines: ["base"], cursorLine: 0, cursorCol: 4 }; },
};
ed.setAutocompleteProvider(baseProvider);
const wrapped = ed.autocompleteProvider;
check("history wraps the app's provider", wrapped !== baseProvider && wrapped.triggerCharacters[0] === "@");

await wrapped.getSuggestions([""], 0, 0, {});
check("unarmed suggestions delegate to the app's provider", baseProvider.calls === 1);

ed.setText("");
const armed = ed.onExtensionShortcut("ctrl+r");
// arm() awaits loadHistory + requestAutocomplete, so the menu lands a few
// microtasks later — poll rather than sleep.
for (let i = 0; i < 200 && !ed.autocompleteState; i++) await new Promise(r => setTimeout(r, 10));
check("ctrl+r opens the history menu", armed === true && ed.autocompleteState === "force");
check("the editor keeps the slot — input box stays live", ed.getText() === "" && ed.autocompleteProvider === wrapped);
const order = (v) => ed.autocompleteItems.findIndex((i) => i.value === v);
check("menu lists history newest-first", order("gamma three") >= 0 && order("gamma three") < order("beta two") && order("beta two") < order("alpha one"));
check("menu shows more rows than the slash menu", ed.getAutocompleteMaxVisible() === 10);

ed.setText("bet");
await ed.requestAutocomplete({ force: true, explicitTab: false });
check("typing filters the menu", ed.autocompleteItems.length === 1 && ed.autocompleteItems[0].value === "beta two");

ed.setText("zzzz");
await ed.requestAutocomplete({ force: true, explicitTab: false });
check("a query with no match keeps the menu open", ed.autocompleteState === "force" && ed.autocompleteItems[0].label === "no match");

ed.setText("bet");
await ed.requestAutocomplete({ force: true, explicitTab: false });
const applied = wrapped.applyCompletion(ed.state.lines, 0, 3, ed.autocompleteItems[0], ed.autocompletePrefix);
check("selecting replaces the box with the whole prompt", applied.lines.join("\n") === "beta two" && applied.cursorCol === 8);
check("selecting restores the slash menu's row count", ed.getAutocompleteMaxVisible() === 5);

baseProvider.calls = 0;
await wrapped.getSuggestions(["bet"], 0, 3, {});
check("after selecting, suggestions delegate again", baseProvider.calls === 1);

ed.setText("");
ed.onExtensionShortcut("shift+up");
for (let i = 0; i < 200 && !ed.autocompleteState; i++) await new Promise(r => setTimeout(r, 10));
check("shift+up on an empty box opens the menu", ed.autocompleteState === "force");
ed.cancelAutocomplete();
baseProvider.calls = 0;
await wrapped.getSuggestions([""], 0, 0, {});
check("escape disarms history mode", baseProvider.calls === 1);

// ── starship ──
const themeStub = { fg: (k, t) => t };
const widgetText = (content) => {
	if (typeof content === "function") {
		const comp = content({}, themeStub);
		return (comp && comp.render ? comp.render(80) : []).join(" ");
	}
	return Array.isArray(content) ? content.join(" ") : "";
};
let widgetSet = false;
let statusSet = false;
const starCtx = {
	mode: "tui",
	model: { id: "test-model" },
	projectRoot: "/tmp",
	sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 100, output: 50 } } }] },
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

// Regression: with zero tokens and no git branch the widget must STILL render
// (session-duration anchor) — dropping the model segment used to collapse it to
// empty → early return → no session line after a response.
let bareWidget = null;
const bareCtx = {
	mode: "tui",
	projectRoot: "/nonexistent-xyzzy-" + Date.now(),
	sessionManager: { getBranch: () => [] },
	ui: { ...starCtx.ui, setWidget: (k, lines) => { bareWidget = lines; } },
};
await fire(stylePi, "session_start", {}, bareCtx);
await fire(stylePi, "agent_settled", {}, bareCtx);
check("starship renders a line with no tokens/branch", widgetText(bareWidget).trim().length > 0);

// Full telemetry: drive a streamed message + turn, assert TPS/TTFT/tokens/turns.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let teleWidget = null;
const teleCtx = {
	mode: "tui",
	projectRoot: "/tmp",
	sessionManager: { getBranch: () => [] },
	ui: { ...starCtx.ui, setWidget: (k, l) => { teleWidget = l; } },
};
const usage = { role: "assistant", usage: { input: 1000, output: 500 } };
await fire(stylePi, "session_start", {}, teleCtx);
await fire(stylePi, "message_start", {}, teleCtx);
await sleep(30);
await fire(stylePi, "message_update", {}, teleCtx); // first token
await sleep(70);
await fire(stylePi, "message_update", {}, teleCtx);
await fire(stylePi, "message_end", { message: usage }, teleCtx);
const afterMsg = widgetText(teleWidget);
check("starship renders after each message (message_end)", /tps/.test(afterMsg) && /tok\/s/.test(afterMsg));
await fire(stylePi, "agent_end", { messages: [usage] }, teleCtx);
const teleLine = widgetText(teleWidget);
check("starship telemetry: TTFT", /ttft/.test(teleLine));
check("starship telemetry: token count 1.5k", /1\.5k/.test(teleLine));
check("starship telemetry: chevron-separated", teleLine.includes("▶"));

for (const line of results) console.log(line);
rmSync(SCRATCH, { recursive: true, force: true });
const failed = results.filter((x) => x.startsWith("FAIL"));
if (failed.length) { console.error(`\n${failed.length} check(s) failed`); process.exit(1); }
console.log("\nall ui checks passed");