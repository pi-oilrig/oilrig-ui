// Billboard — the info panel half of pi-ui: a min strip in the belowEditor
// widget, a full overlay only while toggled. Folded in from the standalone
// pi-billboard package: a top-of-terminal panel is chrome, and chrome lives
// here beside the editor, the footer and the starship bar — one owner for the
// widget slot, one keybinding table (alt+p), no cross-package globals needed
// to draw a line.
//
// Registration stays on globalThis.__billboard.register({ id, render, size,
// priority?, title?, hidden? }) — gantt and launch register slots that way and
// must keep working without knowing which package holds the panel.
//
// The panel's own title is the head of both renders (`setTitle`, or /billboard
// title). gantt sets it to its board's URL: the strip is the one place a URL
// can be printed as plain text, which every terminal linkifies on its own.
//
// No clock, no per-frame cost: the widget is message-bound (agent_settled,
// message_end, turn_end), the overlay exists only between two alt+p presses.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type SlotSize = "row" | "card";
type Mode = "min" | "max";

interface Slot {
	id: string;
	title?: string;
	priority: number;
	size: SlotSize;
	render: () => string[];
	hidden?: boolean;
}

interface RegisterInput {
	id: string;
	title?: string;
	priority?: number;
	size?: SlotSize;
	render: () => string[];
	hidden?: boolean;
}

interface Registry {
	register(s: RegisterInput): void;
	unregister(id: string): void;
	setTitle(title: string): void;
	list(): Slot[];
	repaint(): void;
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
}

// ── helpers ────────────────────────────────────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function truncate(s: string, max: number): string {
	if (max <= 0) return "";
	const plain = s.replace(ANSI_RE, "");
	if (plain.length <= max) return s;
	let visible = 0;
	let i = 0;
	while (i < s.length && visible < max - 1) {
		const m = s.slice(i).match(ANSI_RE);
		if (m && m.index === 0) {
			i += m[0].length;
			continue;
		}
		i++;
		visible++;
	}
	return s.slice(0, i) + "…";
}

// Pad to exactly `width` visible columns. The overlay composites over live
// chat, so a short line lets the message behind bleed through and the panel
// reads as half-width — every line runs to the terminal edge instead.
function padTo(s: string, width: number): string {
	if (width <= 0) return s;
	const visible = s.replace(ANSI_RE, "").length;
	return visible >= width ? s : s + " ".repeat(width - visible);
}

function activeSlots(reg: Map<string, Slot>, hidden: Set<string>): Slot[] {
	return [...reg.values()]
		.filter((s) => !s.hidden && !hidden.has(s.id))
		.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

// ── render min (1-line strip) ──────────────────────────────────────
function renderMin(
	state: State,
	reg: Map<string, Slot>,
	width: number,
): string[] {
	const parts = [state.title || "billboard"];
	const rows = activeSlots(reg, state.hidden).filter((s) => s.size === "row");
	for (const slot of rows) {
		for (const line of slot.render()) {
			const t = String(line ?? "").trim();
			if (t) parts.push(t);
		}
	}
	return [truncate(parts.join(" · "), width)];
}

// ── render max (full-screen overlay, borderless) ───────────────────
function renderMax(
	state: State,
	reg: Map<string, Slot>,
	width: number,
): string[] {
	const lines: string[] = [];
	lines.push(
		`\x1b[1m${state.title || "billboard"}\x1b[0m \x1b[90m· alt+p / Esc to close\x1b[0m`,
	);
	lines.push("");
	const slots = activeSlots(reg, state.hidden);
	let first = true;
	for (const slot of slots) {
		const body = slot.render().filter((l) => l != null);
		if (body.length === 0) continue;
		if (!first) lines.push("");
		first = false;
		if (slot.title) lines.push(`\x1b[1m${slot.title}\x1b[0m`);
		for (const raw of body) lines.push(truncate(String(raw), width));
	}
	if (first) lines.push("(nothing to show — register a slot)");
	return lines.map((l) => padTo(l, width));
}

// ── extension ──────────────────────────────────────────────────────
export function installBillboard(pi: ExtensionAPI): void {
	let ui: any;
	const WIDGET_KEY = "billboard";
	const state: State = {
		title: "",
		items: [],
		turnCount: 0,
		lastUserText: "",
		mode: "min",
		hidden: new Set(),
	};
	const registry = new Map<string, Slot>();

	// ── cache: only call setWidget when content actually changes ─────
	let lastContent: string | null = null;

	// ── overlay for max mode (created only when toggled, zero cost otherwise) ──
	let overlayDone: ((v: null) => void) | undefined;

	function overlayRender(width: number): string[] {
		return renderMax(state, registry, width);
	}
	function overlayInput(data: string): void {
		if (data === "\x1b" || data === "\x1bg" || data === "\x03") {
			state.mode = "min";
			updateWidget();
			closeOverlay();
		}
	}
	function openOverlay(): void {
		if (overlayDone || !ui?.custom) return;
		void ui.custom(
			(_tui: any, _theme: any, _kb: any, done: (v: null) => void) => {
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
	}

	// ── widget update (message-bound, no per-frame cost) ─────────
	function updateWidget(): void {
		if (!ui) return;
		const width = process.stdout.columns ?? 80;
		if (state.mode === "min") {
			const lines = renderMin(state, registry, width);
			const rendered = lines.join("\n");
			if (rendered === lastContent) return; // skip if unchanged
			lastContent = rendered;
			ui.setWidget?.(WIDGET_KEY, lines, { placement: "belowEditor" });
		}
		// max mode is handled by the overlay
	}

	function toggle(): void {
		if (state.mode === "max") {
			state.mode = "min";
			closeOverlay();
			updateWidget();
		} else {
			state.mode = "max";
			lastContent = null; // invalidate cache on toggle
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
	const api: Registry = {
		register(s) {
			registry.set(s.id, {
				id: s.id,
				title: s.title,
				priority: s.priority ?? 50,
				size: s.size ?? "card",
				render: s.render,
				hidden: s.hidden,
			});
			updateWidget();
		},
		unregister(id) {
			registry.delete(id);
			updateWidget();
		},
		setTitle(title) {
			state.title = String(title ?? "");
			updateWidget();
		},
		list() {
			return [...registry.values()];
		},
		repaint: () => {
			lastContent = null;
			updateWidget();
		},
	};
	(globalThis as any).__billboard = api;

	// ── events ──────────────────────────────────────────────────
	pi.on("session_start", (_event: any, ctx: any) => {
		ui = ctx.ui ?? ui;
		updateWidget();
	});

	pi.on("agent_settled", () => updateWidget());
	pi.on("message_end", () => updateWidget());
	pi.on("turn_end", () => {
		state.turnCount++;
		updateWidget();
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
				updateWidget();
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
			"Dashboard: toggle mode, manage title/items, or list/hide/show registered slots.",
		handler: async (args: string, ctx: any) => {
			const a = args.trim();
			if (a.startsWith("title ")) {
				state.title = a.slice(6).trim();
				updateWidget();
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
				updateWidget();
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
					updateWidget();
					ctx.ui?.notify?.(`billboard: done #${id} "${item.text}"`, "info");
				} else ctx.ui?.notify?.(`billboard: no item #${id}`, "warning");
				return;
			}
			if (a === "clear") {
				const n = state.items.filter((x) => x.done).length;
				state.items = state.items.filter((x) => !x.done);
				updateWidget();
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
						return `  [${st}] ${s.id}${t} · ${s.size} · p${s.priority}`;
					});
				ctx.ui?.notify?.(
					`billboard slots:\n${rows.join("\n") || "  (none)"}`,
					"info",
				);
				return;
			}
			if (a.startsWith("hide ")) {
				state.hidden.add(a.slice(5).trim());
				updateWidget();
				ctx.ui?.notify?.(`billboard: hid slot "${a.slice(5).trim()}"`, "info");
				return;
			}
			if (a.startsWith("show ")) {
				state.hidden.delete(a.slice(5).trim());
				updateWidget();
				ctx.ui?.notify?.(
					`billboard: showed slot "${a.slice(5).trim()}"`,
					"info",
				);
				return;
			}
			toggle();
			ctx.ui?.notify?.(`billboard: ${state.mode}`, "info");
		},
	});
}
