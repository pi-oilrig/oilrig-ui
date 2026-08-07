// Regression suite for oilrig-ui — style, editor, chrome, starship.
//
//   node --experimental-strip-types tests/ui.test.mjs
//
// Copies the extension into a scratch package with a stubbed pi-tui and
// asserts: style prompt appends, "normal mode" disables, :q triggers
// shutdown, selection keys are intercepted, chrome wraps install, and the
// billboard panel (folded in from pi-billboard) toggles min/max, keeps its
// slot registry on globalThis and clears on shutdown.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Per-process scratch: a fixed path collides when two runs overlap (the probe
// running every package's tests while a bare `npm test` is open), and the stale
// pi-history.jsonl makes the picker assertions fail nondeterministically.
const SCRATCH = join(process.env.TMPDIR ?? "/tmp", `oilrig-ui-test-${process.pid}`);

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
export const CURSOR_MARKER = "\\x1b_pi:c\\x07";
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
writeFileSync(join(SCRATCH, "package.json"), JSON.stringify({ name: "oilrig-ui-test", type: "module", pi: {} }));

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
for (const part of ["index.ts", "style.ts", "editor.ts", "chrome.ts", "starship.ts", "slot.ts", "questionnaire.ts", "retro.ts", "context.ts", "above.ts"])
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
const widgets = [];
let footerFactory = null;
const chromeCtx = {
	mode: "tui",
	ui: {
		notify: (m) => toasts.push(m),
		setStatus: (k, v) => statuses.push([k, v]),
		setHeader: (c) => headers.push(c),
		setFooter: (f) => { footerFactory = f; },
		setEditorComponent: () => {},
		setWidget: (k, v) => widgets.push([k, v]),
		theme: { fg: () => "" },
		keybindings: {},
	},
};
await fire(stylePi, "session_start", {}, chromeCtx);

chromeCtx.ui.notify("Ponytail loaded: 3 rules");
chromeCtx.ui.notify("hello");
check("notify not wrapped — ponytail toast passes", toasts.includes("Ponytail loaded: 3 rules"));
check("other toasts pass", toasts.includes("hello"));

chromeCtx.ui.setStatus("ponytail", "x");
chromeCtx.ui.setStatus("kern", "ok");
check("setStatus not wrapped — ponytail key passes", statuses.some(([k]) => k === "ponytail") && statuses.some(([k]) => k === "kern"));

chromeCtx.ui.setHeader("WELCOME");
check("header installs swallowed", headers.length > 0 && headers.every((h) => h === undefined));
check("retro footer installed", typeof footerFactory === "function");
// footer must render without throwing against a minimal footerData
{
	const comp = footerFactory({}, { fg: () => "" }, { getExtensionStatuses: () => new Map(), getGitBranch: () => null, getAvailableProviderCount: () => 1 });
	const lines = comp.render(80);
	check("footer renders a separator + lines", Array.isArray(lines) && lines.length >= 2);
	const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
	check("footer line 1 is the full-width capped mode line", plain(lines[0]) === `▶${"⠤".repeat(78)}◀`);
	check("no thin rule left in the footer", !lines.some((l) => plain(l).includes("─")));
	check("the model label left the footer", !lines.some((l) => plain(l).includes("no-model")));
	// the ▏ rail down the left of the status block is gone
	check("no ▏ gutter on any footer line", !lines.some((l) => l.includes("▏")));
	check("footer lines still fit the terminal", lines.every((l) => plain(l).length <= 80));
	// the mode bar takes the editor's live borderColor when one is published
	globalThis.__oilrigModePaint = (s) => `\x1b[35m${s}\x1b[0m`;
	check("mode bar paints with the editor's borderColor", comp.render(80)[0].startsWith("\x1b[35m"));
	delete globalThis.__oilrigModePaint;
}
// ── the above-editor stack ──
// pi has no widget ordering: re-setting a key moves it to the end of the
// renderer's Map, so two keys swap places on every repaint. One key, sorted.
{
	const above = await import(pathToFileURL(join(SCRATCH, "extensions/above.ts")).href);
	const { setAboveBlock, installAbove, teardownAbove, __aboveLinesForTest: lines } = above;

	const set = [];
	const stackUi = { setWidget: (k, v) => set.push([k, v]) };

	// a block registered before install must not be dropped
	globalThis.__oilrigAbovePending = [["early", 5, ["EARLY"]]];
	installAbove({ ui: stackUi });
	check("the pending queue is drained on install", lines().includes("EARLY"));
	check("the pending queue is emptied, not replayed", globalThis.__oilrigAbovePending.length === 0);
	check("install publishes the registry for other packages", typeof globalThis.__oilrigAbove?.set === "function");

	// order is by priority, and does not move when a block repaints
	setAboveBlock("model", 20, ["MODEL"]);
	setAboveBlock("recap", 10, ["RECAP-A", "RECAP-B"]);
	check("blocks render in priority order", lines().join("|") === "EARLY|RECAP-A|RECAP-B|MODEL");
	setAboveBlock("recap", 10, ["RECAP-C"]);
	check("repainting a block does not move it", lines().join("|") === "EARLY|RECAP-C|MODEL");
	setAboveBlock("model", 20, ["MODEL2"]);
	check("repainting the other block does not move it either", lines().join("|") === "EARLY|RECAP-C|MODEL2");

	// one widget key, always
	check("the stack sets exactly one widget key", new Set(set.map(([k]) => k)).size === 1 && set[0][0] === "above");

	// an empty block leaves no hole
	setAboveBlock("early", 5, []);
	check("an empty block is removed, not blanked", lines().join("|") === "RECAP-C|MODEL2");
	setAboveBlock("recap", 10, undefined);
	setAboveBlock("model", 20, undefined);
	check("the last block out clears the widget", set[set.length - 1][1] === undefined);

	teardownAbove();
	check("teardown drops the registry", globalThis.__oilrigAbove === undefined);
	above.__resetAboveForTest();
}

check("the model label is a block in the stack, not its own widget",
	widgets.every(([k]) => k !== "model") && widgets.some(([k, v]) => k === "above" && String(v).includes("no-model")));

// ── one left edge ──
// pi wraps every widget line in `new Text(line, 1, 0)` (paddingX = 1), so a
// stack block lands at column 1 for free. The footer prefixes one space and
// the prompt indents one. A surface that adds its own indent on top sits a
// column right of everything else — which is what the model label did.
{
	const { Text } = await import("@earendil-works/pi-tui");
	check("pi pads widget lines by exactly one column", new Text("x", 1, 0).paddingX === 1);

	const bare = (l) => l.replace(/\x1b\[[0-9;]*m/g, "");
	const modelLines = widgets.filter(([k]) => k === "above").pop()[1];
	check("no stack block indents on top of pi's padding",
		modelLines.every((l) => !bare(l).startsWith(" ")), JSON.stringify(modelLines));

	const { renderPair } = await import(pathToFileURL(join(SCRATCH, "extensions/chrome.ts")).href);
	const footer = renderPair("left", "right", 80);
	check("the footer starts at the same column",
		footer.startsWith(" ") && !footer.startsWith("  "), JSON.stringify(footer.slice(0, 8)));
}

// ── mode bar: flat line + one travelling wave ──
{
	const chrome = await import(pathToFileURL(join(SCRATCH, "extensions/chrome.ts")).href);
	const { __barGlyphsForTest: glyphs, setBusy } = chrome;
	const isBraille = (s) => [...s].every((c) => c.codePointAt(0) >= 0x2800 && c.codePointAt(0) <= 0x28ff);
	const FLAT = "⠤";
	const INNER = 78;
	const line = (s) => s.slice(1, -1);

	const idle = glyphs(80, false, 0);
	check("idle bar has right-pointing cap on the left", idle[0] === "▶");
	check("idle bar has left-pointing cap on the right", idle[79] === "◀");
	check("the line between caps is flat braille", line(idle) === FLAT.repeat(INNER));
	check("idle line is braille, not a block rule", isBraille(line(idle)) && !idle.includes("▀"));
	check("the caps are one cell each, so the bar fits", idle.length === 80 && [...idle].length === 80);
	check("a 2-cell bar drops the caps", glyphs(2, false, 0) === FLAT.repeat(2));

	const f0 = glyphs(80, true, 40);
	const f1 = glyphs(80, true, 46);
	check("working bar keeps both caps", [f0, f1].every((f) => f[0] === "▶" && f[79] === "◀"));
	check("inner segment is braille", isBraille(line(f0)) && isBraille(line(f1)));
	check("the wave never changes the bar width", [f0, f1].every((f) => f.length === 80));
	check("every frame is exactly one cell per column", [...f1].length === 80);

	// exactly one wave: the cells that are not the flat line form a single run
	const runs = (s) => s.split("").reduce((a, c) => {
		if (c === FLAT) a.open = false;
		else if (!a.open) { a.open = true; a.n++; }
		return a;
	}, { n: 0, open: false }).n;
	check("only one wave is on the line at a time", runs(line(f0)) === 1 && runs(line(f1)) === 1);
	check("the rest of the line stays flat", line(f0).split(FLAT).length - 1 > 60);
	// a full cycle: it reaches the top row and the bottom row
	check("the wave has a crest and a trough", /[⠉⠊⠔]/.test(line(f0)) && /[⣀⡠⢄]/.test(line(f0)));

	// travelling left to right: +2 dot columns of phase == shifted one cell right
	check("the wave travels left to right",
		line(glyphs(80, true, 40)).slice(0, INNER - 1) === line(glyphs(80, true, 42)).slice(1));
	// and the line is flat again between passes — period = 78*2 + 20 + 44 = 220
	check("the line rests flat between waves", line(glyphs(80, true, 220)) === FLAT.repeat(INNER));

	// with no tui to repaint, setBusy must not spin a ticker
	delete globalThis.__oilrigRequestRender;
	setBusy(true);
	check("no ticker without a live tui to repaint", true); // asserted by the suite exiting
	setBusy(false);
}


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
// The input box carries no painted glyph: a ▌ down the left edge is inside the
// terminal's own text and gets dragged along by any copy of a prompt.
check("input box has no left bar to copy", ed.render(80).every((l) => !l.includes("▌")));
check("input lines sit at the workspace's one-column left edge",
	ed.render(80).every((l) => l.startsWith(" ") && !l.startsWith("  ")));
check("editor publishes its mode paint for the footer bar", typeof globalThis.__oilrigModePaint === "function");
check("editor publishes a repaint hook for the pulse", typeof globalThis.__oilrigRequestRender === "function");

// ── cursor: painted caret, focus + idle blink ──
{
	const ed2 = await import(pathToFileURL(join(SCRATCH, "extensions/editor.ts")).href);
	const { consumeFocusEvents, setCursorFocused, noteCursorActivity, paintCursor, teardownCursor } = ed2;

	const MARK = "\x1b_pi:c\x07"; // must equal pi-tui's CURSOR_MARKER
	const caret = (g) => `pre${MARK}\x1b[7m${g}\x1b[0m post`;
	const inverse = (s) => s.includes("\x1b[7m");

	// the cursor pi shows is painted text, not the hardware cursor
	check("focused caret keeps the inverse block", inverse(paintCursor(caret(" "))));
	check("a line with no caret marker is untouched", paintCursor("plain line") === "plain line");
	// selection highlighting is inverse too, but ends ESC[27m and has no marker
	const sel = "a\x1b[7mbc\x1b[27md";
	check("selection highlight is not mistaken for the caret", paintCursor(sel) === sel);

	// unfocused → outline, never a filled block
	check("focus-out reply is stripped from the key stream", consumeFocusEvents("\x1b[O") === "");
	const blurEmpty = paintCursor(caret(" "));
	check("unfocused caret on an empty cell is a hollow rectangle", blurEmpty.includes("▯") && !inverse(blurEmpty));
	const blurChar = paintCursor(caret("a"));
	check("unfocused caret over a character underlines it", blurChar.includes("\x1b[4ma\x1b[24m") && !inverse(blurChar));
	check("the outline caret keeps the marker for IME placement", blurEmpty.includes(MARK));

	check("focus-in reply is stripped too", consumeFocusEvents("\x1b[I") === "");
	check("refocused caret is a filled block again", inverse(paintCursor(caret(" "))));
	check("a focus reply mixed with keys keeps the keys", consumeFocusEvents("\x1b[Oab") === "ab");
	consumeFocusEvents("\x1b[I");
	check("ordinary keys pass through untouched", consumeFocusEvents("hello") === "hello");
	check("a plain escape sequence is not eaten", consumeFocusEvents("\x1b[A") === "\x1b[A");

	// idle → blink, then a keystroke → steady again
	noteCursorActivity();
	check("a caret in use does not blink", inverse(paintCursor(caret(" "))));
	await new Promise((r) => setTimeout(r, 2700));
	check("the caret blinks after the idle timeout", !inverse(paintCursor(caret(" "))));
	noteCursorActivity();
	check("typing makes the caret steady again", inverse(paintCursor(caret(" "))));

	// an unfocused window does not start blinking behind your back
	setCursorFocused(false);
	await new Promise((r) => setTimeout(r, 2700));
	const stillBlurred = paintCursor(caret(" "));
	check("an unfocused caret never blinks", stillBlurred.includes("▯"));

	const wrote = [];
	const origWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = (s) => { wrote.push(String(s)); return true; };
	teardownCursor();
	process.stdout.write = origWrite;
	check("shutdown turns focus reporting off", wrote.join("").includes("\x1b[?1004l"));
}

// The caret rewriting is anchored on pi-tui's CURSOR_MARKER, so a stub that
// spells it differently would make every check above pass vacuously.
{
	const real = ["../../../node_modules/@earendil-works/pi-tui/dist/tui.js",
		"../node_modules/@earendil-works/pi-tui/dist/tui.js"]
		.map((r) => new URL(r, import.meta.url).pathname)
		.find((f) => existsSync(f));
	if (real) {
		const m = readFileSync(real, "utf8").match(/CURSOR_MARKER\s*=\s*"((?:[^"\\]|\\.)*)"/);
		const stub = readFileSync(new URL("./ui.test.mjs", import.meta.url).pathname, "utf8")
			.match(/export const CURSOR_MARKER = "((?:[^"\\]|\\.)*)";/);
		// the stub literal is doubled once by the template that writes it
		check("the stub's CURSOR_MARKER is pi-tui's real one",
			!!m && !!stub && m[1] === stub[1].replace(/\\\\/g, "\\"));
	} else {
		check("pi-tui not installed \u2014 marker fidelity unchecked", true);
	}
}
let cutThrew = false;
try { ed.onExtensionShortcut("ctrl+x"); } catch { cutThrew = true; }
check("cut removes selection + fires onChange", !cutThrew && ed.getText() === " world" && lastChange === " world");

// ctrl+x with nothing selected cuts the whole prompt — no select-all first.
ed.setText("line one\nline two");
ed.state.cursorLine = 1;
ed.state.cursorCol = 4;
lastChange = null;
const wholeCut = ed.onExtensionShortcut("ctrl+x");
check("ctrl+x with no selection empties the box", wholeCut === true && ed.getText() === "");
check("whole-prompt cut resets the cursor + fires onChange", ed.state.cursorLine === 0 && ed.state.cursorCol === 0 && lastChange === "");
check("ctrl+x on an empty box falls through", ed.onExtensionShortcut("ctrl+x") === false);

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
// starship registers a slot (priority 70) at extension load via
// registerSlot — it targets globalThis.__web (the oilrig-web surface). ui no
// longer installs an info surface itself (the billboard was deleted in the
// A9 fold), so the slot queues on globalThis.__webPending until oilrig-web loads.
const starSlot = (globalThis.__webPending ?? []).find((s) => s && s.id === "starship");
check("starship slot registered", !!starSlot && typeof starSlot.row === "function" && starSlot.priority === 70);

const starCtx = {
	mode: "tui",
	model: { id: "test-model" },
	projectRoot: "/tmp",
	sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 100, output: 50 } } }] },
};
await fire(stylePi, "session_start", {}, starCtx);
await fire(stylePi, "agent_settled", {}, starCtx);

// Regression: with zero tokens and no git branch the slot must STILL render
// (session-duration anchor) — dropping the model segment used to collapse it to
// empty → early return → no session line after a response.
const bareCtx = {
	mode: "tui",
	projectRoot: "/nonexistent-xyzzy-" + Date.now(),
	sessionManager: { getBranch: () => [] },
};
await fire(stylePi, "session_start", {}, bareCtx);
await fire(stylePi, "agent_settled", {}, bareCtx);
check("starship renders a line with no tokens/branch", starSlot.row(80).join(" ").trim().length > 0);

// Full telemetry: drive a streamed message + turn, assert TPS/TTFT/tokens/turns.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const teleCtx = {
	mode: "tui",
	projectRoot: "/tmp",
	sessionManager: { getBranch: () => [] },
};
const usage = { role: "assistant", usage: { input: 1000, output: 500 } };
await fire(stylePi, "session_start", {}, teleCtx);
await fire(stylePi, "message_start", {}, teleCtx);
await sleep(30);
await fire(stylePi, "message_update", {}, teleCtx); // first token
await sleep(70);
await fire(stylePi, "message_update", {}, teleCtx);
await fire(stylePi, "message_end", { message: usage }, teleCtx);
const afterMsg = starSlot.row(80).join(" ");
check("starship renders after each message (message_end)", /tps/.test(afterMsg) && /tok\/s/.test(afterMsg));
await fire(stylePi, "agent_end", { messages: [usage] }, teleCtx);
const teleLine = starSlot.row(80).join(" ");
check("starship telemetry: TTFT", /ttft/.test(teleLine));
check("starship telemetry: token count 1.5k", /1\.5k/.test(teleLine));
check("starship telemetry: chevron-separated", teleLine.includes("\uF054"));

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

// ── status bar render pair at 40/80/200 ──
// The subject is chrome's own renderPair, imported — a local reimplementation
// of the same arithmetic would pass no matter what chrome.ts does.
{
	const { renderPair } = await import(pathToFileURL(join(SCRATCH, "extensions/chrome.ts")).href);
	const vis = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
	const testPair = (left, right, width) => vis(renderPair(left, right, width)).length <= width;
	[
		[40, "~/dev/_pi_extensions", "████████░░ 73%"],
		[40, "0.3.9    ~/dev/_pi_extensions", " ████████░░ 73%"],
		[80, "0.3.9    ~/dev/_pi_extensions (main) • session-42", " ████████░░ 73%"],
		[80, "↑1.5k ↓2.3k $0.045", "claude-3.5-sonnet • thinking off"],
		[200, "0.3.9    ~/dev/_pi_extensions/subdir/src (feature-branch)", " ████████████████████████░░░░ 95%"],
	].forEach(([w, l, r]) => check(`pair fits at ${w}: ${l.slice(0, 20)}…`, testPair(l, r, w)));
	check("pair with no right fits at 40", testPair("0.3.9    ~/dev", "", 40));
}

for (const line of results) console.log(line);
rmSync(SCRATCH, { recursive: true, force: true });
const failed = results.filter((x) => x.startsWith("FAIL"));
if (failed.length) { console.error(`\n${failed.length} check(s) failed`); process.exit(1); }
console.log("\nall ui checks passed");