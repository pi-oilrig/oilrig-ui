// Regression suite for pi-ui — style, editor, chrome, starship.
//
//   node --experimental-strip-types tests/ui.test.mjs
//
// Copies the extension into a scratch package with a stubbed pi-tui and
// asserts: style prompt appends, "normal mode" disables, :q triggers
// shutdown, selection keys are intercepted, chrome wraps install, and the
// billboard panel (folded in from pi-billboard) toggles min/max, keeps its
// slot registry on globalThis and clears on shutdown.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Per-process scratch: a fixed path collides when two runs overlap (the probe
// running every package's tests while a bare `npm test` is open), and the stale
// pi-history.jsonl makes the picker assertions fail nondeterministically.
const SCRATCH = join(process.env.TMPDIR ?? "/tmp", `pi-ui-test-${process.pid}`);

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
export const Key = { up: "up", down: "down", left: "left", right: "right", home: "home", end: "end", pageUp: "pageUp", pageDown: "pageDown", escape: "escape", enter: "enter", tab: "tab", shift: (k) => "shift+" + k };
export const wrapTextWithAnsi = (s, w) => { const out = []; let t = String(s); if (!t) return [""]; while (t.length > w) { out.push(t.slice(0, w)); t = t.slice(w); } out.push(t); return out; };
export class Editor { constructor(tui, theme){ this.tui = tui; this.theme = theme; this._t = ""; } setText(t){ this._t = String(t); } getText(){ return this._t; } handleInput(d){ if (d === "backspace") this._t = this._t.slice(0, -1); else this._t += d; } render(w){ return [this._t || " "]; } }
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
for (const part of ["index.ts", "style.ts", "editor.ts", "chrome.ts", "starship.ts", "billboard.ts", "questionnaire.ts", "colors.ts", "retro.ts"])
	writeFileSync(join(SCRATCH, "extensions", part), readFileSync(join(ROOT, "extensions", part), "utf8"));

const results = [];
const check = (name, cond, extra = "") => results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

const fg = (style, text) => text; // stub returns text
const makePi = () => {
	const handlers = new Map();
	const commands = new Map();
	return { handlers, commands, tools: new Map(), on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }, registerCommand(name, def) { commands.set(name, def); }, registerTool(def) { this.tools.set(def.name, def); } };
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
(await import(pathToFileURL(join(SCRATCH, "extensions/index.ts")).href)).default(stylePi);

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

// ── billboard (folded in from pi-billboard) ──
// Driven through installBillboard directly: the panel owns a widget key, an
// overlay and a slot registry, none of which the style/editor stubs supply.
{
	const { installBillboard } = await import(pathToFileURL(join(SCRATCH, "extensions/billboard.ts")).href);
	const makeBoardPi = () => {
		const handlers = new Map();
		return {
			handlers,
			command: undefined,
			shortcuts: new Map(),
			on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(fn); },
			registerCommand(_n, spec) { this.command = spec; },
			registerShortcut(key, spec) { this.shortcuts.set(key, spec); },
			async fire(ev, e, c) { let out; for (const fn of handlers.get(ev) ?? []) out = (await fn(e, c)) ?? out; return out; },
		};
	};
	const makeBoardUi = () => {
		const overlays = [];
		const widgetCalls = [];
		const tui = { requestRender: () => {} };
		return {
			overlays, widgetCalls, tui, notes: [],
			custom(factory, opts) {
				const rec = { options: opts, closed: false };
				return new Promise((resolve) => {
					rec.done = (v) => { rec.closed = true; resolve(v); };
					rec.component = factory(tui, {}, {}, rec.done);
					overlays.push(rec);
				});
			},
			setWidget(key, lines, opts) { widgetCalls.push({ key, lines, opts }); },
			notify(msg, type) { this.notes.push({ msg, type }); },
		};
	};
	const active = (ui) => [...ui.overlays].reverse().find((o) => !o.closed);
	const lastW = (ui) => ui.widgetCalls[ui.widgetCalls.length - 1];

	// min widget on session_start
	const pi = makeBoardPi();
	const bui = makeBoardUi();
	installBillboard(pi);
	await pi.fire("session_start", {}, { ui: bui });
	const w0 = lastW(bui);
	check("billboard widget is belowEditor, one line", w0?.key === "billboard" && w0.opts?.placement === "belowEditor" && w0.lines.length === 1);

	// alt+p toggles max (overlay) and back
	const sc = pi.shortcuts.get("alt+p");
	check("billboard shortcut is alt+p", !!sc);
	await sc.handler({ ui: bui });
	const ov = active(bui);
	check("alt+p opens a non-capturing overlay", !!ov && ov.options?.overlayOptions?.()?.nonCapturing === true);
	check("max render is multi-line and names alt+p", ov.component.render(80).length > 1 && ov.component.render(80).some((l) => l.includes("alt+p")));
	ov.component.handleInput("\x1b");
	check("Esc closes back to min", !active(bui));

	// title/items round trip, min + max. The title is the HEAD of the strip and
	// of the overlay header — gantt puts its board URL there, so it must not be
	// pushed off by another slot.
	check("default head is the panel name", lastW(bui).lines[0].startsWith("billboard"));
	await pi.command.handler("title myproject", { ui: bui });
	check("title replaces the head of the min strip", lastW(bui).lines[0].startsWith("myproject"));
	check("title is not also printed as a slot", lastW(bui).lines[0].split("myproject").length === 2);
	await pi.command.handler("add first task", { ui: bui });
	await pi.command.handler("add second task", { ui: bui });
	await sc.handler({ ui: bui });
	const ov2 = active(bui);
	check("items render in max", ov2.component.render(80).some((l) => l.includes("first task")));
	await pi.command.handler("done 1", { ui: bui });
	await pi.command.handler("clear", { ui: bui });
	const cleared = ov2.component.render(80);
	check("clear drops completed, keeps open", !cleared.some((l) => l.includes("first task")) && cleared.some((l) => l.includes("second task")));

	// slot registry — gantt/launch register through globalThis
	const api = globalThis.__billboard;
	check("slot registry exposed on globalThis", typeof api?.register === "function");
	check("registry exposes setTitle", typeof api?.setTitle === "function");
	api.setTitle("http://localhost:3333/proj-abc123");
	check("setTitle heads the max overlay", ov2.component.render(80)[0].includes("http://localhost:3333/proj-abc123"));
	api.register({ id: "stats", title: "stats", priority: 200, size: "card", render: () => ["cpu: 42%"] });
	check("external card slot renders", ov2.component.render(80).some((l) => l.includes("cpu: 42%")));
	api.register({ id: "branch", priority: 15, size: "row", render: () => ["branch: main"] });
	await sc.handler({ ui: bui }); // → min
	check("external row slot in min strip", lastW(bui).lines[0].includes("branch: main"));
	await sc.handler({ ui: bui }); // → max
	await pi.command.handler("hide stats", { ui: bui });
	check("hidden slot suppressed", !ov2.component.render(80).some((l) => l.includes("cpu: 42%")));
	await pi.command.handler("show stats", { ui: bui });
	api.unregister("stats");
	check("unregistered slot gone", !ov2.component.render(80).some((l) => l.includes("cpu: 42%")));

	// turn counter — the strip only repaints in min mode, so drop out of max first
	await sc.handler({ ui: bui });
	await pi.fire("turn_end", {}, {});
	await pi.fire("turn_end", {}, {});
	check("turn count in min strip", (lastW(bui).lines[0] ?? "").includes("turn 2"));

	// shutdown clears overlay, widget and the global
	await pi.fire("session_shutdown", {}, {});
	check("shutdown closes overlay + clears widget + registry", !active(bui) && lastW(bui)?.lines === undefined && globalThis.__billboard === undefined);
}

// ── questionnaire ──
// Driven through the registered tool: the overlay is a ui.custom component, so
// each case opens it, feeds keys, and awaits the tool's own return value.
{
	const { installQuestionnaire } = await import(pathToFileURL(join(SCRATCH, "extensions/questionnaire.ts")).href);
	const qPi = makePi();
	installQuestionnaire(qPi);
	const tool = qPi.tools.get("questionnaire");
	check("questionnaire tool registered", !!tool && typeof tool.execute === "function");

	const makeCtx = () => {
		const live = { component: null, done: null };
		return {
			mode: "tui",
			live,
			ui: {
				custom(factory) {
					return new Promise((resolve) => {
						live.done = resolve;
						live.component = factory({ requestRender: () => {} }, { fg: (_k, t) => t, bg: (_k, t) => t, bold: (t) => t }, {}, resolve);
					});
				},
			},
		};
	};
	const ask = (questions) => {
		const ctx = makeCtx();
		const p = tool.execute("id", { questions }, null, null, ctx);
		return { ctx, p, feed: (...keys) => { for (const k of keys) ctx.live.component.handleInput(k); }, view: () => ctx.live.component.render(72).join("\n") };
	};
	const one = [{ id: "scope", prompt: "How far?", options: [
		{ value: "small", label: "Small slice" },
		{ value: "whole", label: "Whole feature", description: "more risk", recommended: true },
	] }];

	// non-TUI refuses rather than hanging
	const headless = await tool.execute("id", { questions: one }, null, null, { mode: "print" });
	check("non-TUI mode bails, cancelled", headless.details.cancelled === true && /needs the TUI/.test(headless.content[0].text));

	// recommendation is starred and pre-selected
	let s = ask(one);
	const first = s.view();
	check("recommendation is starred", first.includes("★") && first.includes("Whole feature"));
	check("recommendation is pre-selected", first.split("\n").some((l) => l.startsWith("> ") && l.includes("Whole feature")));
	check("free-text option offered by default", first.includes("Write your own"));
	s.feed("enter");
	let out = await s.p;
	check("enter answers with the recommendation", out.details.answers[0].value === "whole" && out.details.answers[0].mode === "picked" && out.details.answers[0].wasRecommended === true);
	check("result text names the recommendation", /your recommendation/.test(out.content[0].text));

	// the briefing: problem / explanation / recommendation render above the options
	s = ask([{ id: "scope", prompt: "How far?",
		problem: "The parser reads the whole file before deciding.",
		explanation: "A slice ships today; the whole feature costs a rewrite of the reader.",
		recommendation: "Start small — the reader rewrite blocks two other tickets.",
		options: [{ value: "small", label: "Small slice", recommended: true }, { value: "whole", label: "Whole feature" }] }]);
	const briefed = s.view();
	check("problem is rendered", briefed.includes("The parser reads the whole file"));
	check("explanation is rendered", briefed.includes("costs a rewrite of the reader"));
	check("recommendation is rendered above the options", briefed.includes("blocks two other tickets") && briefed.indexOf("blocks two other tickets") < briefed.indexOf("1. Small slice"));
	s.feed("escape");
	await s.p;

	// briefing fields are optional — a bare question still renders
	s = ask(one);
	check("briefing is optional", s.view().includes("How far?") && s.view().includes("1. Small slice"));
	s.feed("escape");
	await s.p;

	// c copies the highlighted option into an editable draft → enter ADDS it
	s = ask(one);
	s.feed("c");
	check("c prefills the draft with the option text", s.view().includes("rewriting: Whole feature") && s.view().includes("Whole feature"));
	s.feed(" but staged");
	s.feed("enter");
	out = await s.p;
	let a = out.details.answers[0];
	check("enter in draft adds a new option and answers with it", a.mode === "added" && a.label === "Whole feature but staged" && a.basedOn === "whole");
	check("added answer is reported as based on the original", /added their own option based on "whole"/.test(out.content[0].text));

	// ctrl+s REPLACES the original instead
	s = ask(one);
	s.feed("c", " trimmed", "ctrl+s");
	out = await s.p;
	a = out.details.answers[0];
	check("ctrl+s replaces the original option", a.mode === "replaced" && a.label === "Whole feature trimmed" && a.basedOn === "whole");

	// the added option survives in the list, the original beside it
	s = ask(one);
	s.feed("c", " plus", "enter");
	await s.p;
	s = ask(one);
	check("a fresh ask starts from the agent's options again", !s.view().includes("plus"));
	s.feed("escape");
	out = await s.p;
	check("escape cancels", out.details.cancelled === true && /cancelled/i.test(out.content[0].text));

	// free-text option with no source option
	s = ask(one);
	s.feed("down", "down", "enter");
	check("free-text option opens an empty draft", s.view().includes("your own answer:"));
	s.feed("neither", "enter");
	out = await s.p;
	check("free text answers as wrote", out.details.answers[0].mode === "wrote" && out.details.answers[0].value === "neither");

	// multi-question: tab bar, auto-advance, submit tab
	const two = [
		{ id: "scope", label: "Scope", prompt: "How far?", options: [{ value: "small", label: "Small" }, { value: "big", label: "Big", recommended: true }] },
		{ id: "when", label: "When", prompt: "When?", options: [{ value: "now", label: "Now", recommended: true }, { value: "later", label: "Later" }] },
	];
	s = ask(two);
	check("multi shows a tab bar", s.view().includes("Scope") && s.view().includes("When") && s.view().includes("submit"));
	s.feed("enter");
	check("answering advances to the next question", s.view().includes("When?"));
	s.feed("down", "enter");
	const summary = s.view();
	check("last answer lands on the submit tab", summary.includes("ready to submit") && summary.includes("Later"));
	s.feed("enter");
	out = await s.p;
	check("submit returns both answers in order", out.details.answers.map((x) => x.value).join(",") === "big,later");
	check("result text is one line per question", out.content[0].text.split("\n").length === 2 && /^Scope: /.test(out.content[0].text));

	// tab navigation and re-answering
	s = ask(two);
	s.feed("tab");
	check("tab moves to the next question", s.view().includes("When?"));
	s.feed("shift+tab");
	check("shift+tab moves back", s.view().includes("How far?"));
	s.feed("escape");
	out = await s.p;
	check("escape cancels a multi-question run", out.details.cancelled === true);

	// unanswered questions block submit
	s = ask(two);
	s.feed("tab", "tab");
	check("submit tab warns about unanswered questions", s.view().includes("unanswered:"));
	s.feed("enter");
	check("enter does not submit while unanswered", s.ctx.live.component !== null && s.view().includes("unanswered:"));
	s.feed("escape");
	await s.p;
}

for (const line of results) console.log(line);
rmSync(SCRATCH, { recursive: true, force: true });
const failed = results.filter((x) => x.startsWith("FAIL"));
if (failed.length) { console.error(`\n${failed.length} check(s) failed`); process.exit(1); }
console.log("\nall ui checks passed");