// Billboard — the one info surface of pi-ui. Every package that used to own a
// belowEditor widget or an info overlay registers a *slot* here instead:
//
//   min  — the belowEditor widget: title + every `row` slot, packed to width.
//   max  — a full-screen overlay (alt+l): every slot's card body, sectioned,
//          scrollable, with Tab cycling focus through interactive slots.
//
// One widget key, one overlay, one keybinding table. Before this there were
// eight competing setWidget callers stacking blocks under the editor
// (starship, gantt, launch, until, rigor, file-awareness, todo/timeline) and
// two separate ui.custom info overlays.
//
// Registration is globalThis.__billboard.register({ id, render, size, … }).
// Extension load order across packages is not fixed, so a caller whose install
// runs before ui's pushes onto globalThis.__billboardPending and is drained
// here — see registerSlot() in each consumer.
//
// No clock, no per-frame cost: the widget is message-bound (agent_settled,
// message_end, turn_end) plus explicit repaint(), and the overlay exists only
// between two alt+l presses.

import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

type SlotSize = "row" | "card";
type Mode = "min" | "max";

interface Slot {
	id: string;
	title?: string;
	priority: number;
	size: SlotSize;
	/** min-strip body. Defaults to `render` when absent. */
	row?: (width: number) => string[];
	/** max-overlay body. */
	render: (width: number) => string[];
	hidden?: boolean;
	/** Tab stops here in max mode and keys route to onInput. */
	focusable?: boolean;
	/** Return true to swallow the key; false/undefined lets the panel handle it. */
	onInput?: (data: string) => boolean | void;
	onFocus?: () => void;
	onBlur?: () => void;
}

interface RegisterInput {
	id: string;
	title?: string;
	priority?: number;
	size?: SlotSize;
	row?: (width: number) => string[];
	render: (width: number) => string[];
	hidden?: boolean;
	focusable?: boolean;
	onInput?: (data: string) => boolean | void;
	onFocus?: () => void;
	onBlur?: () => void;
}

interface Registry {
	register(s: RegisterInput): void;
	unregister(id: string): void;
	setTitle(title: string): void;
	list(): Slot[];
	/** Redraw both surfaces — the strip and, if open, the overlay. */
	repaint(): void;
	/** Open the max overlay, optionally focusing one slot. */
	open(focusId?: string): void;
	close(): void;
	mode(): Mode;
}

interface Item {
	id: number;
	text: string;
	done: boolean;
}

interface State {
	title: string;
	items: Item[];
	turnCount: number;
	lastUserText: string;
	mode: Mode;
	hidden: Set<string>;
	focus: string | null;
	scroll: number;
}

// ── width helpers ──────────────────────────────────────────────────
// The panel is monochrome by decree: one white on the terminal's own
// background, no per-slot palette. Seven packages each shipped their own
// colour scheme (amber gantt badges, green launch glyphs, red rigor, cyan
// watch, magenta pins) and stacked together they read as confetti, not as
// information. Structure now carries the meaning — glyphs, indentation,
// section headings, the focus caret — and every slot's SGR codes are stripped
// on the way in. Bold is the one exception: it is weight, not colour.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
// Non-global twin: `.test()` on a /g regex carries lastIndex between calls and
// silently alternates true/false on the same input.
const ANSI_ONE = /\x1b\[[0-9;]*m/;
const WHITE = "\x1b[97m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function visible(s: string): number {
	return s.replace(ANSI_RE, "").length;
}

// The one place anything is shortened: a built-in slot quoting the user's last
// message back at them. Slot bodies wrap, they never clip.
function clip(s: string, max: number): string {
	const plain = mono(s).replace(ANSI_RE, "");
	return plain.length <= max ? plain : `${plain.slice(0, max - 1)}…`;
}

// Every byte a slot renders passes through here. Colour is dropped; the SGR
// attributes that carry *structure* survive, because they are not colour and
// the panel would lose meaning without them: bold (1) is a heading, inverse
// (7) is the timeline's cursor row and gantt's mode badge, strike (9) is a
// completed item. Dim (2) goes with the colours — it is a second brightness,
// and the panel has one.
const KEEP_SGR = new Set(["0", "1", "7", "9", "22", "27", "29"]);

// Any escape sequence, not just SGR: a slot that emits a cursor move or an OSC
// title would otherwise survive the SGR filter and corrupt the frame.
// eslint-disable-next-line no-control-regex
const ESC_ANY = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|\x1b[@-Z\\-_]/g;
// Control characters to drop — ESC (\x1b) is deliberately *not* in the class.
// It was, once, and it ate the ESC off the very sequences the filter above had
// just decided to keep, leaving the literal text `[0m` in the strip.
// eslint-disable-next-line no-control-regex
const CTRL = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/g;

function mono(s: string): string {
	return String(s)
		.replace(ESC_ANY, (seq) => {
			if (!seq.endsWith("m") || seq[1] !== "[") return "";
			const params = seq.slice(2, -1).split(";").filter((p) => KEEP_SGR.has(p));
			if (!params.length) return "";
			// A slot's own reset closes its attributes — and, left alone, the
			// panel's white with them, so everything after it on the line falls
			// back to the terminal default. Re-assert white immediately: the
			// reset means "end my bold", never "end the panel".
			const esc = `\x1b[${params.join(";")}m`;
			return params.includes("0") ? `${esc}${WHITE}` : esc;
		})
		.replace(/\t/g, "  ")
		.replace(CTRL, "")
		// a lone ESC with nothing valid after it is not ours — drop it
		.replace(/\x1b(?!\[)/g, "");
}

// Word-wrap to `width` visible columns, keeping the line's own leading indent
// on every continuation so a wrapped job block still reads as one block. A
// word longer than the width (a path, a URL) is hard-split rather than left to
// overflow — nothing is ever truncated, because the point of the panel is to
// show it all. Width is counted in visible columns: the SGR attributes mono()
// let through cost none.
function wrap(s: string, width: number): string[] {
	if (width <= 0) return [s];
	if (visible(s) <= width) return [s];
	const indent = (s.match(/^\s*/)?.[0] ?? "").slice(0, Math.max(0, width - 8));
	const hang = `${indent}  `;
	const lines: string[] = [];
	let cur = "";
	let lead = indent;
	const flush = () => {
		if (cur) lines.push(lead + cur);
		cur = "";
		lead = hang;
	};
	for (let word of s.trim().split(/\s+/)) {
		// A single word wider than the line: cut it at the column budget. Only
		// plain words are cut — cutting inside an escape sequence would emit
		// garbage, and a styled word that long does not occur.
		while (visible(word) > width - lead.length && !ANSI_ONE.test(word)) {
			const room = width - lead.length - (cur ? cur.length + 1 : 0);
			if (room > 4) {
				cur = cur ? `${cur} ${word.slice(0, room)}` : word.slice(0, room);
				word = word.slice(room);
			}
			flush();
		}
		const next = cur ? `${cur} ${word}` : word;
		if (lead.length + visible(next) > width) {
			flush();
			cur = word;
		} else {
			cur = next;
		}
	}
	flush();
	return lines.length ? lines : [s];
}

// Pad to exactly `width` visible columns. The overlay composites over live
// chat, so a short line lets the message behind bleed through and the panel
// reads as half-width — every line runs to the terminal edge instead.
function padTo(s: string, width: number): string {
	if (width <= 0) return s;
	const v = visible(s);
	return v >= width ? s : s + " ".repeat(width - v);
}

function activeSlots(reg: Map<string, Slot>, hidden: Set<string>): Slot[] {
	return [...reg.values()]
		.filter((s) => !s.hidden && !hidden.has(s.id))
		.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

// A slot may return embedded newlines (launch and until both build two-line
// blocks that way); split them out so wrapping and scrolling see real lines.
function slotLines(
	slot: Slot,
	which: "row" | "card",
	width: number,
): string[] {
	const fn = which === "row" ? (slot.row ?? slot.render) : slot.render;
	let out: string[];
	try {
		out = fn(width) ?? [];
	} catch {
		return [`${slot.id}: render failed`];
	}
	return out
		.filter((l) => l != null)
		.flatMap((l) => mono(l).split("\n"));
}

// ── render min (the belowEditor strip) ─────────────────────────────
// Row slots are packed onto as many lines as fit. A slot is atomic: it never
// straddles a line break, so the strip reads as a list of segments rather than
// a wrapped sentence. The strip pushes the editor down, so it is capped —
// everything past the cap lives one keypress away in the overlay.
const MIN_ROWS_MAX = 4;

function renderMin(
	state: State,
	reg: Map<string, Slot>,
	width: number,
): string[] {
	const SEP = " · ";
	const segs: string[] = [];
	const head = mono(state.title || "billboard");
	for (const slot of activeSlots(reg, state.hidden)) {
		if (slot.size !== "row") continue;
		const body = slotLines(slot, "row", width)
			.map((l) => l.trim())
			.filter(Boolean);
		if (body.length) segs.push(body.join(" "));
	}

	const lines: string[] = [];
	let cur = "";
	for (const seg of segs) {
		const piece = cur ? SEP + seg : seg;
		if (cur && visible(cur) + visible(piece) > width) {
			lines.push(cur);
			if (lines.length >= MIN_ROWS_MAX) break;
			cur = seg;
		} else {
			cur += piece;
		}
	}
	if (cur && lines.length < MIN_ROWS_MAX) lines.push(cur);
	// The title heads the first line and is the one bold thing in the strip.
	const out = lines.length ? lines : [""];
	return out.map((l, i) =>
		i === 0
			? `${WHITE}${BOLD}${head}${RESET}${WHITE}${l ? SEP + l : ""}${RESET}`
			: `${WHITE}${" ".repeat(Math.min(head.length + SEP.length, 12))}${l}${RESET}`,
	);
}

// ── render max (full-screen overlay, borderless, scrollable) ───────
// Two columns' worth of gutter is spent on structure so the eye can find a
// section without colour: the heading sits flush left, its body indents two,
// and the focused section carries a caret. Nothing is truncated — a long line
// wraps with a hanging indent and the whole thing scrolls.
function renderMax(
	state: State,
	reg: Map<string, Slot>,
	width: number,
	height: number,
): string[] {
	const slots = activeSlots(reg, state.hidden);
	const focusable = slots.filter((s) => s.focusable);
	const inner = Math.max(20, width - 2);
	const body: string[] = [];
	let any = false;
	for (const slot of slots) {
		const lines = slotLines(slot, "card", inner - 2);
		if (lines.length === 0) continue;
		if (any) body.push("");
		any = true;
		const focused = state.focus === slot.id;
		const head = (slot.title ?? slot.id).toUpperCase();
		body.push(
			`${BOLD}${focused ? "\u25b8 " : "  "}${head}${RESET}${WHITE}`,
		);
		for (const raw of lines) {
			// Slot bodies already carry their own leading spaces; add the
			// section gutter on top and wrap inside what is left.
			for (const w of wrap(`  ${raw}`, inner)) body.push(w);
		}
	}
	if (!any) body.push("  (nothing to show — register a slot)");

	// Header: the title, then the live key legend for the state we are in.
	const hints = [state.focus ? "Esc leave" : "Esc / alt+l close"];
	if (focusable.length) hints.push("Tab focus");
	const view = Math.max(1, height - 2);
	if (body.length > view) hints.push("j/k PgUp/PgDn g scroll");
	const title = mono(state.title || "billboard");
	const header = `${BOLD}${title}${RESET}${WHITE}  ${hints.join("  ·  ")}`;

	const max = Math.max(0, body.length - view);
	if (state.scroll > max) state.scroll = max;
	if (state.scroll < 0) state.scroll = 0;
	const slice = body.slice(state.scroll, state.scroll + view);
	const out = [header, "\u2500".repeat(width), ...slice];
	if (max > 0)
		out.push(`  ${state.scroll + slice.length}/${body.length}`);
	return out.map((l) => `${WHITE}${padTo(l, width)}${RESET}`);
}

// ── extension ──────────────────────────────────────────────────────
export function installBillboard(pi: ExtensionAPI): void {
	let ui: any;
	let tui: any;
	const WIDGET_KEY = "billboard";
	const state: State = {
		title: "",
		items: [],
		turnCount: 0,
		lastUserText: "",
		mode: "min",
		hidden: new Set(),
		focus: null,
		scroll: 0,
	};
	const registry = new Map<string, Slot>();

	// ── cache: only call setWidget when content actually changes ─────
	let lastContent: string | null = null;

	// ── overlay for max mode (created only when toggled) ─────────────
	let overlayDone: ((v: null) => void) | undefined;

	function termHeight(): number {
		return Math.max(6, (process.stdout.rows ?? 24) - 2);
	}

	function overlayRender(width: number): string[] {
		return renderMax(state, registry, width, termHeight());
	}

	function focusables(): Slot[] {
		return activeSlots(registry, state.hidden).filter((s) => s.focusable);
	}

	function setFocus(id: string | null): void {
		if (state.focus === id) return;
		const prev = state.focus ? registry.get(state.focus) : undefined;
		prev?.onBlur?.();
		state.focus = id;
		if (id) registry.get(id)?.onFocus?.();
		repaint();
	}

	function cycleFocus(back: boolean): void {
		const list = focusables();
		if (!list.length) return;
		const at = list.findIndex((s) => s.id === state.focus);
		const next = back
			? at <= 0
				? list.length - 1
				: at - 1
			: at < 0 || at === list.length - 1
				? 0
				: at + 1;
		// Forward off the end unfocuses, so Tab walks out of the panel too.
		if (!back && at === list.length - 1) setFocus(null);
		else setFocus(list[next].id);
	}

	function overlayInput(data: string): void {
		// A focused slot gets first refusal on every key but Tab — including Esc,
		// so a slot in its own sub-mode (timeline's inline rename) can cancel that
		// instead of losing focus. Returning false hands the key back.
		if (state.focus) {
			if (data === "\t") return cycleFocus(false);
			if (data === "\x1b[Z") return cycleFocus(true);
			const slot = registry.get(state.focus);
			if (slot?.onInput?.(data)) {
				repaint();
				return;
			}
			if (data === "\x1b") return setFocus(null);
			repaint();
			return;
		}
		if (data === "\t") return cycleFocus(false);
		if (data === "\x1b[Z") return cycleFocus(true);
		if (data === "\x1b" || data === "\x1bp" || data === "\x03" || data === "q") {
			toggle();
			return;
		}
		if (data === "j" || data === "\x1b[B") {
			state.scroll++;
			return repaint();
		}
		if (data === "k" || data === "\x1b[A") {
			state.scroll = Math.max(0, state.scroll - 1);
			return repaint();
		}
		if (data === "\x1b[6~") {
			state.scroll += termHeight() - 3;
			return repaint();
		}
		if (data === "\x1b[5~") {
			state.scroll = Math.max(0, state.scroll - (termHeight() - 3));
			return repaint();
		}
		if (data === "g") {
			state.scroll = 0;
			return repaint();
		}
	}

	function openOverlay(): void {
		if (overlayDone || !ui?.custom) return;
		void ui.custom(
			(t: any, _theme: any, _kb: any, done: (v: null) => void) => {
				tui = t;
				overlayDone = done;
				return {
					render: overlayRender,
					invalidate() {},
					handleInput: overlayInput,
				};
			},
			{
				overlay: true,
				overlayOptions: () => ({
					anchor: "top-center" as const,
					width: "100%" as const,
					maxHeight: "100%" as const,
					nonCapturing: true,
				}),
			},
		);
	}

	function closeOverlay(): void {
		overlayDone?.(null);
		overlayDone = undefined;
		tui = undefined;
	}

	// ── the one repaint entry point ─────────────────────────────────
	// min repaints the widget, max asks the tui to re-render the overlay.
	// Everything that mutates slot state calls this and nothing else.
	function repaint(): void {
		if (state.mode === "max") {
			tui?.requestRender?.();
			return;
		}
		if (!ui) return;
		const width = process.stdout.columns ?? 80;
		const lines = renderMin(state, registry, width);
		const rendered = lines.join("\n");
		if (rendered === lastContent) return;
		lastContent = rendered;
		// The rule above the strip is white too — the panel does not borrow the
		// theme's border colour, because the panel has exactly one colour.
		ui.setWidget?.(
			WIDGET_KEY,
			() => {
				const c = new Container();
				c.addChild(new DynamicBorder((b: string) => `${WHITE}${b}${RESET}`));
				for (const l of lines) c.addChild(new Text(` ${l}`, 1, 0));
				return c;
			},
			{ placement: "belowEditor" },
		);
	}

	function toggle(): void {
		if (state.mode === "max") {
			setFocus(null);
			state.mode = "min";
			state.scroll = 0;
			closeOverlay();
			lastContent = null;
			repaint();
		} else {
			state.mode = "max";
			state.scroll = 0;
			openOverlay();
		}
	}

	// ── built-in slots ──────────────────────────────────────────
	const builtins: Slot[] = [
		{
			id: "turn",
			priority: 80,
			size: "row",
			render: () => (state.turnCount > 0 ? [`turn ${state.turnCount}`] : []),
		},
		{
			id: "last-user",
			priority: 90,
			size: "row",
			render: () =>
				state.lastUserText
					? [`last: "${clip(state.lastUserText, 40)}"`]
					: [],
		},
		{
			id: "items",
			title: "items",
			priority: 100,
			size: "card",
			// Right-align the id so the text column starts at the same
			// offset for #1 and #100 alike.
			render: () => {
				if (state.items.length === 0) return [];
				const w = Math.max(...state.items.map((i) => String(i.id).length));
				return state.items.map(
					(i) =>
						`  [${i.done ? "x" : " "}] #${String(i.id).padStart(w)}  ${i.text}`,
				);
			},
		},
	];
	for (const s of builtins) registry.set(s.id, s);

	// ── cross-extension registry ────────────────────────────────
	function toSlot(s: RegisterInput): Slot {
		return {
			id: s.id,
			title: s.title,
			priority: s.priority ?? 50,
			size: s.size ?? "card",
			row: s.row,
			render: s.render,
			hidden: s.hidden,
			focusable: s.focusable,
			onInput: s.onInput,
			onFocus: s.onFocus,
			onBlur: s.onBlur,
		};
	}

	const api: Registry = {
		register(s) {
			registry.set(s.id, toSlot(s));
			repaint();
		},
		unregister(id) {
			registry.delete(id);
			if (state.focus === id) state.focus = null;
			repaint();
		},
		setTitle(title) {
			state.title = String(title ?? "");
			repaint();
		},
		list() {
			return [...registry.values()];
		},
		// Slot bodies are re-rendered on every repaint and the result is compared,
		// so this does NOT bust the cache: launch ticks every 2s and until every
		// 5s, and an unchanged frame must not cost a setWidget.
		repaint,
		open(focusId) {
			if (state.mode !== "max") toggle();
			if (focusId && registry.has(focusId)) setFocus(focusId);
			else repaint();
		},
		close() {
			if (state.mode === "max") toggle();
		},
		mode: () => state.mode,
	};
	(globalThis as any).__billboard = api;

	// Drain anything registered before ui loaded.
	const pending = (globalThis as any).__billboardPending;
	if (Array.isArray(pending)) {
		for (const s of pending.splice(0)) {
			try {
				api.register(s);
			} catch {
				/* a malformed pending slot must not kill the panel */
			}
		}
	}

	// ── events ──────────────────────────────────────────────────
	pi.on("session_start", (_event: any, ctx: any) => {
		ui = ctx.ui ?? ui;
		const late = (globalThis as any).__billboardPending;
		if (Array.isArray(late)) for (const s of late.splice(0)) api.register(s);
		lastContent = null;
		repaint();
	});

	pi.on("agent_settled", () => repaint());
	pi.on("message_end", () => repaint());
	pi.on("turn_end", () => {
		state.turnCount++;
		repaint();
	});

	pi.on("context", (event: any) => {
		const msgs = event?.messages;
		if (!Array.isArray(msgs)) return;
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i]?.role !== "user") continue;
			const content = msgs[i]?.content;
			let text: string | null = null;
			if (typeof content === "string") text = content;
			else if (Array.isArray(content)) {
				const block = content.find((b: any) => b?.type === "text");
				text = block?.text ?? null;
			}
			if (text !== null) {
				state.lastUserText = text;
				repaint();
			}
			break;
		}
	});

	pi.on("session_shutdown", () => {
		closeOverlay();
		ui?.setWidget?.(WIDGET_KEY, undefined);
		if ((globalThis as any).__billboard === api)
			delete (globalThis as any).__billboard;
	});

	// ── shortcut: alt+l ────────────────────────────────────────
	// Fourth key, and the reasoning is worth keeping so there is no fifth.
	// A shortcut has to clear three separate hurdles here:
	//
	//   1. Not on pi's RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS list. A
	//      reserved key is not merely warned about — getShortcuts() *skips*
	//      the registration outright. That rules out ctrl+l, which is
	//      app.model.select.
	//   2. Not already a built-in in pi's or pi-tui's keybinding tables, or we
	//      shadow a real editing key and print a conflict warning every start.
	//      alt+b went this way — tui.editor.cursorWordLeft.
	//   3. Its *escape sequence* must not be claimed by something else in
	//      pi-tui's LEGACY_SEQUENCES table. This is the subtle one, and it is
	//      what killed alt+p: the terminal sends `ESC p`, and keys.js maps
	//      "\x1bp" to "alt+up" (emacs readline history). `ESC p` therefore
	//      matches both alt+p and alt+up, the built-in app.message.dequeue
	//      wins, and our handler is never reached — no warning, no error,
	//      nothing happens. \x1bb, \x1bf and \x1bn are booby-trapped alike.
	//
	// alt+l clears all three: `ESC l` matches alt+l and nothing else.
	// .preventions/checks/reachable-shortcuts.sh enforces this from now on.
	if (typeof (pi as any).registerShortcut === "function") {
		(pi as any).registerShortcut("alt+l", {
			description: "Toggle billboard (min ↔ max)",
			handler: (_ctx: any) => toggle(),
		});
	}

	// ── command: /billboard ─────────────────────────────────────
	pi.registerCommand("billboard", {
		description:
			"The info panel: toggle min/max, manage title/items, or list/hide/show/focus registered slots.",
		handler: async (args: string, ctx: any) => {
			const a = args.trim();
			if (a.startsWith("title ")) {
				state.title = a.slice(6).trim();
				repaint();
				ctx.ui?.notify?.(`billboard: title set to "${state.title}"`, "info");
				return;
			}
			if (a.startsWith("add ")) {
				const text = a.slice(4).trim();
				if (!text) {
					ctx.ui?.notify?.("usage: /billboard add <text>", "warning");
					return;
				}
				const id =
					state.items.length > 0
						? Math.max(...state.items.map((x) => x.id)) + 1
						: 1;
				state.items.push({ id, text, done: false });
				repaint();
				ctx.ui?.notify?.(`billboard: added #${id} "${text}"`, "info");
				return;
			}
			if (a.startsWith("done ")) {
				const id = parseInt(a.slice(5).trim(), 10);
				if (isNaN(id)) {
					ctx.ui?.notify?.("usage: /billboard done <id>", "warning");
					return;
				}
				const item = state.items.find((x) => x.id === id);
				if (item) {
					item.done = true;
					repaint();
					ctx.ui?.notify?.(`billboard: done #${id} "${item.text}"`, "info");
				} else ctx.ui?.notify?.(`billboard: no item #${id}`, "warning");
				return;
			}
			if (a === "clear") {
				const n = state.items.filter((x) => x.done).length;
				state.items = state.items.filter((x) => !x.done);
				repaint();
				ctx.ui?.notify?.(
					`billboard: removed ${n} completed item${n !== 1 ? "s" : ""}`,
					"info",
				);
				return;
			}
			if (a === "list") {
				if (state.items.length === 0)
					ctx.ui?.notify?.("billboard: no items", "info");
				else {
					const w = Math.max(...state.items.map((x) => String(x.id).length));
					const lines = state.items.map(
						(x) =>
							`  ${x.done ? "[x]" : "[ ]"} #${String(x.id).padStart(w)}  ${x.text}`,
					);
					ctx.ui?.notify?.(`billboard items:\n${lines.join("\n")}`, "info");
				}
				return;
			}
			if (a === "slots") {
				const rows = [...registry.values()]
					.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
					.map((s) => {
						const st = state.hidden.has(s.id) ? "hidden" : "shown";
						const t = s.title ? ` "${s.title}"` : "";
						const f = s.focusable ? " · focusable" : "";
						return `  [${st}] ${s.id}${t} · ${s.size} · p${s.priority}${f}`;
					});
				ctx.ui?.notify?.(
					`billboard slots:\n${rows.join("\n") || "  (none)"}`,
					"info",
				);
				return;
			}
			if (a.startsWith("hide ")) {
				state.hidden.add(a.slice(5).trim());
				repaint();
				ctx.ui?.notify?.(`billboard: hid slot "${a.slice(5).trim()}"`, "info");
				return;
			}
			if (a.startsWith("show ")) {
				state.hidden.delete(a.slice(5).trim());
				repaint();
				ctx.ui?.notify?.(
					`billboard: showed slot "${a.slice(5).trim()}"`,
					"info",
				);
				return;
			}
			if (a.startsWith("focus ")) {
				const id = a.slice(6).trim();
				if (!registry.has(id)) {
					ctx.ui?.notify?.(`billboard: no slot "${id}"`, "warning");
					return;
				}
				api.open(id);
				return;
			}
			toggle();
			ctx.ui?.notify?.(`billboard: ${state.mode}`, "info");
		},
	});
}
