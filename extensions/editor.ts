// Editor — owns the input slot, stacks layers, provides selection, history, :q, gantt board.
//
// pi keeps exactly one editor slot (ui.setEditorComponent). This takes it once
// and stacks every foreign factory it observes on top of each other via
// prototype re-parenting, so every editor's render() lands on the layer below.
// Selection sits on top as an instance decorator; history and left bar wrap
// the outermost layer.
//
// :q shuts down the session. /input shows the layer stack.

import {
	CustomEditor,
	getSelectListTheme,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	fuzzyFilter,
	getKeybindings,
	matchesKey as matchesKeyId,
	sliceByColumn,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
// pi-tui's matchesKey narrows the key to its own KeyId union; the shortcuts
// below name raw chords, so the key is passed through as written.
const matchesKey = (data: string, key: string): boolean =>
	matchesKeyId(data, key as never);

import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const requireTui = createRequire(import.meta.resolve("@earendil-works/pi-tui"));
const { wordWrapLine } = requireTui("./components/editor.js") as any;
const { extractSegments } = requireTui("./utils.js") as any;
const { findWordBackward, findWordForward } = requireTui("./word-navigation.js") as any;

type Pos = { line: number; col: number };
type Row = {
	text: string;
	line: number;
	start: number;
	end: number;
	hasCursor: boolean;
	cursorPos?: number;
};
type Factory = (tui: any, theme: any, keybindings: any) => any;

// ── clipboard ──────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
	const p = platform();
	const candidates: string[][] =
		p === "darwin"
			? [["pbcopy"]]
			: p === "win32"
				? [["clip"]]
				: [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
	const osc52 = () =>
		process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
	const tryNext = (i: number): void => {
		if (i >= candidates.length) {
			osc52();
			return;
		}
		const [cmd, ...args] = candidates[i];
		const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"], timeout: 5000 });
		let settled = false;
		const advance = () => { if (settled) return; settled = true; tryNext(i + 1); };
		child.on("error", advance);
		child.on("exit", (code: number | null) => { if (code === 0) settled = true; else advance(); });
		child.stdin.on("error", advance);
		child.stdin.end(text);
	};
	tryNext(0);
}

// ── line geometry ──────────────────────────────────────────────────────────

function buildLayout(ed: any, layoutWidth: number): Row[] {
	const state = ed.state;
	const layout: Row[] = [];
	if (state.lines.length === 0 || (state.lines.length === 1 && state.lines[0] === "")) {
		layout.push({ text: "", line: 0, start: 0, end: 0, hasCursor: true, cursorPos: 0 });
		return layout;
	}
	for (let i = 0; i < state.lines.length; i++) {
		const line = state.lines[i] || "";
		const isCur = i === state.cursorLine;
		if (visibleWidth(line) <= layoutWidth) {
			layout.push({ text: line, line: i, start: 0, end: line.length, hasCursor: isCur, cursorPos: isCur ? state.cursorCol : undefined });
			continue;
		}
		const chunks = wordWrapLine(line, layoutWidth, [...ed.segment(line, "grapheme")]);
		for (let ci = 0; ci < chunks.length; ci++) {
			const ch = chunks[ci];
			if (!ch) continue;
			const isLast = ci === chunks.length - 1;
			let hasCursor = false;
			let cursorPos: number | undefined;
			if (isCur) {
				if (isLast) { hasCursor = state.cursorCol >= ch.startIndex; cursorPos = state.cursorCol - ch.startIndex; }
				else { hasCursor = state.cursorCol >= ch.startIndex && state.cursorCol < ch.endIndex; if (hasCursor) cursorPos = state.cursorCol - ch.startIndex; }
				if (hasCursor && cursorPos! > ch.text.length) cursorPos = ch.text.length;
			}
			layout.push({ text: ch.text, line: i, start: ch.startIndex, end: ch.endIndex, hasCursor, cursorPos });
		}
	}
	return layout;
}

function rowRange(row: Row, s: Pos, e: Pos): { from: number; len: number } | null {
	if (row.line < s.line || row.line > e.line) return null;
	let from = 0;
	let to = row.text.length;
	if (row.line === s.line) from = Math.max(0, s.col - row.start);
	if (row.line === e.line) to = Math.min(to, e.col - row.start);
	if (to <= from || from >= row.text.length) return null;
	return { from: visibleWidth(row.text.slice(0, from)), len: visibleWidth(row.text.slice(from, to)) };
}

function overlay(line: string, startCol: number, len: number, width: number): string {
	if (len <= 0) return line;
	const total = visibleWidth(line);
	const seg = extractSegments(line, startCol, startCol + len, Math.max(0, total - startCol - len));
	const mid = sliceByColumn(line, startCol, len);
	const painted = `\x1b[7m${mid.split("\x1b[0m").join("\x1b[0m\x1b[7m")}\x1b[27m`;
	let out = `${seg.before}${painted}${seg.after}`;
	if (line.includes(CURSOR_MARKER) && !out.includes(CURSOR_MARKER))
		out = `${seg.before}${painted}${CURSOR_MARKER}${seg.after}`;
	return truncateToWidth(out, width);
}

// ── selection layer ────────────────────────────────────────────────────────

const EXTEND: Array<[string, (ed: any) => void]> = [
	["shift+up", (ed) => ed.moveCursor(-1, 0)],
	["shift+down", (ed) => ed.moveCursor(1, 0)],
	["shift+left", (ed) => ed.moveCursor(0, -1)],
	["shift+right", (ed) => ed.moveCursor(0, 1)],
	["shift+home", (ed) => ed.moveToLineStart()],
	["shift+end", (ed) => ed.moveToLineEnd()],
	["shift+pageUp", (ed) => ed.pageScroll(-1)],
	["shift+pageDown", (ed) => ed.pageScroll(1)],
	["ctrl+shift+left", (ed) => wordMove(ed, -1)],
	["ctrl+shift+right", (ed) => wordMove(ed, 1)],
];

function wordMove(ed: any, dir: number): void {
	const state = ed.state;
	const { lines, cursorLine, cursorCol } = state;
	if (cursorLine < 0 || cursorLine >= lines.length) return;
	const line = lines[cursorLine] || "";
	if (dir < 0) {
		const pos = findWordBackward(line, cursorCol);
		state.cursorCol = pos;
	} else {
		const pos = findWordForward(line, cursorCol);
		state.cursorCol = pos;
	}
	ed.tui?.requestRender?.();
}

function installSelection(editor: any): void {
	const sel = { active: false, anchor: { line: 0, col: 0 } as Pos, head: { line: 0, col: 0 } as Pos };

	editor.onExtensionShortcut = ((orig: any) => function (this: any, data: string) {
		try {
			if (orig?.call(this, data)) return true;

			// ctrl+shift+a = select all
			if (matchesKey(data, "ctrl+shift+a") || matchesKey(data, "ctrl+A")) {
				const state = this.state;
				sel.active = true;
				sel.anchor = { line: 0, col: 0 };
				const last = state.lines.length - 1;
				sel.head = { line: last, col: (state.lines[last] || "").length };
				this.tui?.requestRender?.();
				return true;
			}

			// ctrl+c = copy
		if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+C")) {
			if (sel.active) {
				const text = extractSelection(this, sel.anchor, sel.head);
				if (text) copyToClipboard(text);
				// keep selection
				this.tui?.requestRender?.();
				return true;
			}
			return false;
		}

		// ctrl+x = cut
		if (matchesKey(data, "ctrl+x") || matchesKey(data, "ctrl+X")) {
			if (sel.active) {
				const text = extractSelection(this, sel.anchor, sel.head);
				if (text) copyToClipboard(text);
				deleteSelection(this, sel);
				sel.active = false;
				this.onChange?.(this.getText());
				this.tui?.requestRender?.();
				return true;
			}
			return false;
		}

		// escape = drop selection
		if (matchesKey(data, "escape") || matchesKey(data, "Escape") || matchesKey(data, "esc")) {
			if (sel.active) {
				sel.active = false;
				this.tui?.requestRender?.();
				return true;
			}
			return false;
		}

		// shift+delete = kill to end of line (or eat empty tail break)
		if (matchesKey(data, "shift+delete") || matchesKey(data, "shift+Delete") || matchesKey(data, "shift+backspace")) {
			if (!sel.active) {
				const state = this.state;
				const line: string = state.lines[state.cursorLine] || "";
				if (state.cursorCol >= line.length) {
					// empty tail, eat the line break
					if (state.lines.length > 1) {
						state.lines.splice(state.cursorLine, 1);
						if (state.cursorLine >= state.lines.length) state.cursorLine = state.lines.length - 1;
						state.cursorCol = 0;
					}
				} else {
					state.lines[state.cursorLine] = line.slice(0, state.cursorCol);
				}
				this.onChange?.(this.getText());
				this.tui?.requestRender?.();
				return true;
			}
		}

		// backspace/delete/typing with selection: replace
		if (sel.active) {
			const isDelete = matchesKey(data, "backspace") || matchesKey(data, "delete") || matchesKey(data, "Backspace") || matchesKey(data, "Delete");
			const isChar = data.length === 1 && data.codePointAt(0)! >= 0x20 && data.codePointAt(0)! <= 0x10ffff;
			if (isDelete || isChar) {
				deleteSelection(this, sel);
				sel.active = false;
				if (isDelete) {
					// selection already removed — don't let default delete one more
					this.onChange?.(this.getText());
					this.tui?.requestRender?.();
					return true;
				}
				// typing: let the char fall through to the normal insert handler
				return false;
			}
		}

		// shift+arrow etc = extend selection
		for (const [key, move] of EXTEND) {
			if (matchesKey(data, key)) {
				if (!sel.active) {
					const state = this.state;
					sel.anchor = { line: state.cursorLine, col: state.cursorCol };
				}
				move(this);
				sel.head = { line: this.state.cursorLine, col: this.state.cursorCol };
				sel.active = true;
				this.tui?.requestRender?.();
				return true;
			}
		}

		// non-shift move = drop selection
		const moveKeys = ["up", "down", "left", "right", "home", "end", "pageUp", "pageDown", "ctrl+left", "ctrl+right"];
		if (moveKeys.some((k) => matchesKey(data, k))) {
			if (sel.active) sel.active = false;
			if (matchesKey(data, "ctrl+left")) { wordMove(this, -1); return true; }
			if (matchesKey(data, "ctrl+right")) { wordMove(this, 1); return true; }
			return false; // let default handler move
		}

		return false;
	} catch (err) {
		console.error("[pi-ui] selection shortcut error:", (err as Error).message);
		return false;
	}
})(editor.onExtensionShortcut);

	// Overlay selection on rendered lines
	const origRender = editor.render.bind(editor);
	editor.render = (width: number) => {
		try {
			const lines = origRender(width);
			if (!sel.active) return lines;
			const s = normalize(sel.anchor, sel.head);
			const layout = buildLayout(editor, width);
			return lines.map((line: string, i: number) => {
				const row = layout[i];
				if (!row) return line;
				const range = rowRange(row, s.start, s.end);
				if (!range) return line;
				return overlay(line, range.from, range.len, width);
			});
		} catch (err) {
			console.error("[pi-ui] selection render error:", (err as Error).message);
			// Fallback: return the original render result without selection overlay
			return [" ".repeat(width)];
		}
	};
}

function normalize(a: Pos, b: Pos): { start: Pos; end: Pos } {
	if (a.line < b.line || (a.line === b.line && a.col <= b.col))
		return { start: { line: a.line, col: a.col }, end: { line: b.line, col: b.col } };
	return { start: { line: b.line, col: b.col }, end: { line: a.line, col: a.col } };
}

function extractSelection(ed: any, a: Pos, b: Pos): string {
	const s = normalize(a, b);
	const lines = ed.state.lines;
	if (s.start.line === s.end.line)
		return (lines[s.start.line] || "").slice(s.start.col, s.end.col);
	const parts: string[] = [];
	parts.push((lines[s.start.line] || "").slice(s.start.col));
	for (let i = s.start.line + 1; i < s.end.line; i++)
		parts.push(lines[i] || "");
	parts.push((lines[s.end.line] || "").slice(0, s.end.col));
	return parts.join("\n");
}

function deleteSelection(ed: any, sel: { active: boolean; anchor: Pos; head: Pos }): void {
	const s = normalize(sel.anchor, sel.head);
	const state = ed.state;
	if (s.start.line === s.end.line) {
		const line = state.lines[s.start.line] || "";
		state.lines[s.start.line] = line.slice(0, s.start.col) + line.slice(s.end.col);
	} else {
		const first = (state.lines[s.start.line] || "").slice(0, s.start.col);
		const last = (state.lines[s.end.line] || "").slice(s.end.col);
		state.lines.splice(s.start.line, s.end.line - s.start.line + 1, first + last);
	}
	state.cursorLine = s.start.line;
	state.cursorCol = s.start.col;
}

// ── history ────────────────────────────────────────────────────────────────

const HISTORY_DIR = join(homedir(), ".pi", "agent");
const HISTORY_FILE = join(HISTORY_DIR, "pi-history.jsonl");

async function ensureHistoryDir(): Promise<void> {
	await mkdir(HISTORY_DIR, { recursive: true });
}

async function record(text: string, cwd?: string): Promise<void> {
	if (!text.trim()) return;
	await ensureHistoryDir();
	const entry = JSON.stringify({ text, cwd, ts: Date.now() }) + "\n";
	try { await appendFile(HISTORY_FILE, entry, "utf8"); } catch {}
}

async function loadHistory(limit = 500): Promise<Array<{ text: string; cwd?: string; ts: number }>> {
	try {
		const data = await readFile(HISTORY_FILE, "utf8");
		const lines = data.trim().split("\n").filter(Boolean);
		const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
		return entries.slice(-limit).reverse();
	} catch { return []; }
}

// ── history menu ───────────────────────────────────────────────────────────
//
// The history menu *is* the slash menu: pi's own autocomplete SelectList,
// driven by an AutocompleteProvider that wraps whatever provider the app
// installs. The editor keeps its slot, so the input box stays on screen with
// the caret in it, the query is plain editor text, and every keystroke
// re-filters through the editor's own updateAutocomplete path.
//
// ctrl+r (shift+↑ on an empty box) arms history mode and forces a suggestion
// request; while armed every request is answered from pi-history.jsonl instead
// of being delegated. ↑/↓ move, enter/tab insert, escape closes.

type HistEntry = { text: string; cwd?: string; ts: number };

const HISTORY_MAX_VISIBLE = 10;
// Sentinel: keeps the menu open on a query that matches nothing — an empty item
// list makes the editor cancel autocomplete, which would drop history mode.
const NO_MATCH = "\u0000no-match";

function dedupeHistory(entries: HistEntry[]): HistEntry[] {
	const seen = new Set<string>();
	const out: HistEntry[] = [];
	for (const e of entries) {
		const text = (e?.text ?? "").trim();
		if (!text || seen.has(text)) continue;
		seen.add(text);
		out.push({ text, cwd: e.cwd, ts: e.ts });
	}
	return out;
}

function ago(ts: number): string {
	const secs = Math.max(0, Math.round((Date.now() - (ts || 0)) / 1000));
	if (secs < 60) return `${secs}s ago`;
	if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
	if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
	return `${Math.round(secs / 86400)}d ago`;
}

function historyItems(
	entries: HistEntry[],
	query: string,
): Array<{ value: string; label: string; description: string }> {
	const q = query.trim();
	// fuzzyFilter(items, query, getText) — the argument order matters: a swapped
	// call filters against the wrong string and silently matches nothing.
	const pool = q ? fuzzyFilter(entries, q, (e: HistEntry) => e.text) : entries;
	if (pool.length === 0)
		return [{ value: NO_MATCH, label: "no match", description: `${entries.length} prompts` }];
	return pool.slice(0, 200).map((e) => ({
		value: e.text,
		label: e.text.replace(/\s+/g, " ").trim(),
		description: ago(e.ts),
	}));
}

function installHistory(editor: any): void {
	let armed = false;
	let entries: HistEntry[] = [];
	let base: any = null;
	let prevMaxVisible = 0;

	const disarm = (): void => {
		if (!armed) return;
		armed = false;
		if (prevMaxVisible) {
			editor.setAutocompleteMaxVisible?.(prevMaxVisible);
			prevMaxVisible = 0;
		}
	};

	const provider = {
		triggerCharacters: [] as string[],
		getSuggestions(lines: string[], cl: number, cc: number, opts: any): Promise<any> {
			if (!armed) return base?.getSuggestions(lines, cl, cc, opts) ?? Promise.resolve(null);
			const query = lines.join("\n");
			return Promise.resolve({ items: historyItems(entries, query), prefix: query });
		},
		applyCompletion(lines: string[], cl: number, cc: number, item: any, prefix: string): any {
			if (!armed)
				return base
					? base.applyCompletion(lines, cl, cc, item, prefix)
					: { lines, cursorLine: cl, cursorCol: cc };
			disarm();
			const text = item?.value === NO_MATCH ? lines.join("\n") : (item?.value ?? "");
			const out = text.split("\n");
			return {
				lines: out,
				cursorLine: out.length - 1,
				cursorCol: (out[out.length - 1] ?? "").length,
			};
		},
		// The editor skips a forced request when this returns false, so an armed
		// menu must always claim the trigger.
		shouldTriggerFileCompletion(lines: string[], cl: number, cc: number): boolean {
			if (armed) return true;
			return base?.shouldTriggerFileCompletion
				? base.shouldTriggerFileCompletion(lines, cl, cc)
				: true;
		},
	};

	// pi installs its CombinedAutocompleteProvider after the factory hands the
	// editor over — intercept the setter so ours always wraps the current one.
	const origSet = editor.setAutocompleteProvider?.bind(editor);
	editor.setAutocompleteProvider = (next: any): void => {
		if (next === provider) return;
		base = next;
		provider.triggerCharacters = next?.triggerCharacters ?? [];
		origSet?.(provider);
	};
	if (editor.autocompleteProvider) editor.setAutocompleteProvider(editor.autocompleteProvider);
	else origSet?.(provider);

	// escape, submit and a fresh provider all funnel through cancelAutocomplete.
	const origCancel = editor.cancelAutocomplete?.bind(editor);
	editor.cancelAutocomplete = (): void => {
		disarm();
		origCancel?.();
	};

	const arm = async (): Promise<void> => {
		entries = dedupeHistory(await loadHistory(500));
		if (!prevMaxVisible) {
			prevMaxVisible = editor.getAutocompleteMaxVisible?.() ?? 0;
			editor.setAutocompleteMaxVisible?.(HISTORY_MAX_VISIBLE);
		}
		armed = true;
		// force = no debounce, and the "force" state keeps refilters forced too.
		await editor.requestAutocomplete?.({ force: true, explicitTab: false });
		editor.tui?.requestRender?.();
	};

	const origShortcut = editor.onExtensionShortcut?.bind(editor) ?? (() => false);
	editor.onExtensionShortcut = function (this: any, data: string) {
		try {
			// shift+↑ on an empty box = history menu
			if (matchesKey(data, "shift+up") || matchesKey(data, "shift+ArrowUp") || matchesKey(data, "shift+Up")) {
				if (this.getText().length === 0) {
					void arm();
					return true;
				}
			}
			// ctrl+r anywhere = history menu, seeded with whatever is typed
			if (matchesKey(data, "ctrl+r") || matchesKey(data, "ctrl+R")) {
				void arm();
				return true;
			}
			return origShortcut.call(this, data);
		} catch (err) {
			console.error("[pi-ui] history shortcut error:", (err as Error).message);
			return false;
		}
	};
}

// ── left bar ───────────────────────────────────────────────────────────────

// The prompt arrives framed twice: pi's base editor draws full-width `─`
// rules, and a stacked layer may wrap that in a rounded box (`╭─╮`, `│` rails,
// `╰─╯`). Replace all of it with one fat bar down the left edge — rule lines
// and box caps dropped (scroll labels like `↑ 2 more` survive), side rails
// peeled, every remaining line prefixed. The bar paints with the live editor's
// borderColor so pi's recoloring (bash mode, thinking accents) lands on it.
const BAR = "▌";
const ANSI_RE = /\x1b\[[0-9;]*m/g;

const plainText = (line: string): string => line.replace(ANSI_RE, "");

function isRule(line: string): boolean {
	const plain = plainText(line).trim();
	if (!plain) return false;
	for (const ch of plain) if (ch !== "─") return false;
	return true;
}

function frameCap(line: string): { label?: string } | null {
	const plain = plainText(line).trim();
	if (plain.length < 2) return null;
	const first = plain[0];
	const last = plain[plain.length - 1];
	if ((first !== "╭" && first !== "╰") || (last !== "╮" && last !== "╯"))
		return null;
	const m = plain.match(/[↑↓]\s+\d+\s+more/);
	return m ? { label: m[0] } : {};
}

function stripRails(line: string): string | null {
	const plain = plainText(line);
	if (!plain.startsWith("│") || !plain.trimEnd().endsWith("│")) return null;
	const first = line.indexOf("│");
	const last = line.lastIndexOf("│");
	if (last <= first) return null;
	let inner = line
		.slice(first + 1, last)
		.replace(/^\x1b\[[0-9;]*m/, "")
		.replace(/\x1b\[[0-9;]*m$/, "");
	if (inner.startsWith(" ")) inner = inner.slice(1);
	if (inner.endsWith(" ")) inner = inner.slice(0, -1);
	return inner;
}

function installLeftBar(editor: any, theme: any): void {
	const origRender = editor.render.bind(editor);
	const fallback = (s: string) =>
		typeof theme?.borderColor === "function"
			? theme.borderColor(s)
			: typeof theme?.fg === "function"
				? theme.fg("borderMuted", s)
				: s;
	editor.render = (width: number): string[] => {
		try {
			const paint =
				typeof editor.borderColor === "function"
					? editor.borderColor
					: typeof editor.theme?.borderColor === "function"
						? editor.theme.borderColor
						: fallback;
			const prefix = paint(BAR) + " ";
			const lines = origRender(Math.max(1, width - 2));
			const out: string[] = [];
			for (const line of lines) {
				if (isRule(line)) continue;
				const cap = frameCap(line);
				if (cap) {
					if (cap.label) out.push(prefix + paint(`─── ${cap.label}`));
					continue;
				}
				const inner = stripRails(line);
				out.push(prefix + (inner ?? line));
			}
			return out;
		} catch (err) {
			console.error("[pi-ui] leftBar render error:", (err as Error).message);
			return origRender(width);
		}
	};
}

// ── gantt board integration ────────────────────────────────────────────────

function installGanttBoard(editor: any): void {
	const origRender = editor.render.bind(editor);
	editor.render = (width: number) => {
		try {
			const lines = origRender(width);
			return lines;
		} catch (err) {
			console.error("[pi-ui] ganttBoard render error:", (err as Error).message);
			return [" ".repeat(width)];
		}
	};
}

// ── editor stack ───────────────────────────────────────────────────────────

class InputStack {
	private layers: string[] = [];
	private stacked = false;
	private notes: string[] = [];
	private ctx: any = null;

	absorb(ctx: any): void {
		this.ctx = ctx;
		const ui = ctx.ui;
		if (!ui || ui.__editorStackAbsorbed) return;
		ui.__editorStackAbsorbed = true;

		// Poll for editor factories that register late
		const factories: Factory[] = [];
		const origSet = ui.setEditorComponent.bind(ui);
		ui.setEditorComponent = (fn: Factory) => {
			factories.push(fn);
		};

		// After a short delay, stack them — the factory receives the real TUI
		setTimeout(() => {
			const theme = ctx.ui.theme;
			const keybindings = getKeybindings();
			origSet((realTui: any, _theme: any, _kb: any) => {
				const live = this.stackWithTui(realTui, theme, keybindings, factories);
				if (live) {
					live.__ctx = ctx;
					return live;
				}
				// Fallback: bare CustomEditor with real TUI
				const editorTheme = {
					borderColor: (text: string) => theme.fg("borderMuted", text),
					selectList: getSelectListTheme(),
				};
				const ed = new CustomEditor(realTui, editorTheme, keybindings as any);
				installSelection(ed);
				installHistory(ed);
				installLeftBar(ed, theme);
				installGanttBoard(ed);
				(ed as any).__ctx = ctx;
				return ed;
			});
		}, 100);
	}

	private stackWithTui(realTui: any, theme: any, keybindings: any, factories: Factory[]): any {
		const editorTheme = {
			borderColor: (text: string) => theme.fg("borderMuted", text),
			selectList: getSelectListTheme(),
		};

		let live: any = null;
		let liveIdx = -1;
		const probes: any[] = [];

		for (let i = 0; i < factories.length; i++) {
			try {
				const ed = factories[i](realTui, editorTheme, keybindings);
				if (!ed) continue;
				probes.push(ed);
				if (!live) { live = ed; liveIdx = i; }
				if (live && ed !== live && Object.getPrototypeOf(ed) instanceof CustomEditor) {
					this.stacked = true;
					const proto = Object.getPrototypeOf(ed);
					Object.setPrototypeOf(proto, Object.getPrototypeOf(live));
					live = ed;
					liveIdx = i;
				}
			} catch (err) {
				this.notes.push(`layer ${i} failed: ${(err as Error).message}`);
			}
		}

		if (live) {
			installSelection(live);
			installHistory(live);
			installLeftBar(live, theme);
			installGanttBoard(live);
			this.layers = probes.map((p, i) =>
				p ? `${p.constructor?.name ?? "?"}${i === liveIdx ? " (live)" : ""}` : "failed");
			live.__editorStack = { layers: this.layers, stacked: this.stacked, notes: this.notes };
		}
		return live ?? null;
	}

	describe(): string {
		const stack = this.layers.length ? this.layers.join(" → ") : "none";
		return [
			`layers: ${stack} → selection → history → left bar`,
			`prototype stacking: ${this.stacked ? "on" : "off"}`,
			"keys: shift+move extend · ctrl+shift+←/→ word · ctrl+shift+a all · ctrl+c copy · ctrl+x cut · shift+del kill to line end",
			`history: ↑ this session · ctrl+r (or shift+↑ on an empty box) = fuzzy menu over all sessions · ${HISTORY_FILE}`,
			...this.notes.map((n) => `note: ${n}`),
		].join("\n");
	}
}

// ── extension entry ────────────────────────────────────────────────────────

export function installEditor(pi: ExtensionAPI): void {
	const stack = new InputStack();

	pi.on("session_start", (_event: any, ctx: any) => {
		try {
			if (ctx.mode !== "tui") return;
			stack.absorb(ctx);
			// Poll for late-registering editors
			const until = Date.now() + 2000;
			const poll = setInterval(() => {
				stack.absorb(ctx);
				if (Date.now() > until) clearInterval(poll);
			}, 10);
			(poll as any).unref?.();
		} catch (err) {
			console.error("[pi-ui] editor session_start error:", (err as Error).message);
		}
	});

	pi.on("input", (event: any, ctx: any) => {
		try {
			if (ctx) stack.absorb(ctx);
			if (event?.source === "interactive" && typeof event.text === "string") {
				void record(event.text, ctx?.cwd);
			}
			if (event.text?.trim() === ":q") {
				if (ctx) ctx.shutdown();
				return { action: "handled" };
			}
		} catch (err) {
			console.error("[pi-ui] editor input error:", (err as Error).message);
		}
		return { action: "continue" as const };
	});

	pi.registerCommand("input", {
		description: "Editor — show the layer stack",
		handler: async (_args: string, ctx: any) => {
			ctx.ui.notify(stack.describe(), "info");
		},
	});
}