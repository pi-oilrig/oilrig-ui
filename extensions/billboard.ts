// Billboard — the one info surface of pi-ui. Every package that used to own a
// belowEditor widget or an info overlay registers a *slot* here instead:
//
//   min  — the belowEditor widget: title + every `row` slot, packed to width.
//   max  — a full-screen overlay (alt+p): every slot's card body, sectioned,
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
// between two alt+p presses.

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

// ── width helpers (ANSI-aware: escapes cost no columns) ────────────
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visible(s: string): number {
	return s.replace(ANSI_RE, "").length;
}

function truncate(s: string, max: number): string {
	if (max <= 0) return "";
	if (visible(s) <= max) return s;
	let out = 0;
	let i = 0;
	while (i < s.length && out < max - 1) {
		const m = s.slice(i).match(ANSI_RE);
		if (m && m.index === 0) {
			i += m[0].length;
			continue;
		}
		i++;
		out++;
	}
	return `${s.slice(0, i)}…`;
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
		return [`\x1b[31m${slot.id}: render failed\x1b[0m`];
	}
	return out.filter((l) => l != null).map((l) => String(l));
}

// ── render min (the belowEditor strip) ─────────────────────────────
// Row slots are packed onto as many lines as they need. A slot is atomic:
// it never straddles a line break, so the strip reads as a list of segments
// rather than a wrapped sentence.
function renderMin(
	state: State,
	reg: Map<string, Slot>,
	width: number,
): string[] {
	const SEP = " \x1b[90m·\x1b[0m ";
	const segs: string[] = [];
	const head = state.title || "billboard";
	segs.push(`\x1b[1m${head}\x1b[0m`);
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
			cur = seg;
		} else {
			cur += piece;
		}
	}
	if (cur) lines.push(cur);
	return lines.map((l) => truncate(l, width));
}

// ── render max (full-screen overlay, borderless, scrollable) ───────
function renderMax(
	state: State,
	reg: Map<string, Slot>,
	width: number,
	height: number,
): string[] {
	const slots = activeSlots(reg, state.hidden);
	const focusable = slots.filter((s) => s.focusable);
	const body: string[] = [];
	let any = false;
	for (const slot of slots) {
		const lines = slotLines(slot, "card", width);
		if (lines.length === 0) continue;
		if (any) body.push("");
		any = true;
		const focused = state.focus === slot.id;
		if (slot.title || focused) {
			const mark = focused ? "\x1b[36m▸\x1b[0m " : "";
			body.push(`${mark}\x1b[1m${slot.title ?? slot.id}\x1b[0m`);
		}
		for (const raw of lines) body.push(truncate(raw, width));
	}
	if (!any) body.push("\x1b[90m(nothing to show — register a slot)\x1b[0m");

	// Header: the title is the head, then the live key legend.
	const hints = [state.focus ? "Esc unfocus" : "Esc/alt+p close"];
	if (focusable.length) hints.push("Tab focus");
	if (body.length > height) hints.push("↑↓ scroll");
	const header = `\x1b[1m${state.title || "billboard"}\x1b[0m \x1b[90m· ${hints.join(" · ")}\x1b[0m`;

	const view = Math.max(1, height - 2);
	const max = Math.max(0, body.length - view);
	if (state.scroll > max) state.scroll = max;
	if (state.scroll < 0) state.scroll = 0;
	const slice = body.slice(state.scroll, state.scroll + view);
	const out = [header, "", ...slice];
	if (max > 0)
		out.push(
			`\x1b[90m── ${state.scroll + slice.length}/${body.length} ──\x1b[0m`,
		);
	return out.map((l) => padTo(l, width));
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
		ui.setWidget?.(
			WIDGET_KEY,
			(_t: any, thm: any) => {
				const c = new Container();
				c.addChild(
					new DynamicBorder((s: string) => thm?.fg?.("borderMuted", s) ?? s),
				);
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
			priority: 10,
			size: "row",
			render: () => (state.turnCount > 0 ? [`turn ${state.turnCount}`] : []),
		},
		{
			id: "last-user",
			priority: 20,
			size: "row",
			render: () =>
				state.lastUserText
					? [`last: "${truncate(state.lastUserText, 40)}"`]
					: [],
		},
		{
			id: "items",
			title: "items",
			priority: 900,
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
		repaint: () => {
			lastContent = null;
			repaint();
		},
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

	// ── shortcut: alt+p (billboard / panel) ────────────────────
	if (typeof (pi as any).registerShortcut === "function") {
		(pi as any).registerShortcut("alt+p", {
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
