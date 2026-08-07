// ── the above-editor stack ─────────────────────────────────────────────────
//
// pi's widget API has no ordering. `setExtensionWidget` does `map.delete(key)`
// then `map.set(key, …)` on *every* update and the renderer walks
// `widgets.values()`, so a Map's insertion order decides the layout: whichever
// widget repainted last is drawn last. Two packages writing two keys therefore
// swap places whenever either one updates — the recap sat above the model
// label on one turn and below it on the next.
//
// So the stack is ours, not pi's: one widget key, one owner, blocks sorted by
// an explicit priority. Low number = higher up, the same direction the web
// board's slots run, ending at the block closest to the prompt.
//
//   10  recap   until/timeline.ts   goal / current / next + open work
//   20  model   ui/chrome.ts        the model label, dim, above the input
//
// Registration is order-independent: a package that loads before ui pushes
// onto `__oilrigAbovePending` and this drains it on install.

const WIDGET_KEY = "above";

type Block = { id: string; priority: number; lines: string[] };

const blocks = new Map<string, Block>();
let liveUi: any = null;

function paint(): void {
	if (!liveUi?.setWidget) return;
	const ordered = [...blocks.values()].sort(
		(a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
	);
	const lines = ordered.flatMap((b) => b.lines);
	try {
		liveUi.setWidget(WIDGET_KEY, lines.length ? lines : undefined);
	} catch { /* best-effort */ }
}

// Empty lines removes the block outright — a block with nothing to say must
// not leave a hole in the stack.
export function setAboveBlock(id: string, priority: number, lines: string[] | undefined): void {
	const kept = (lines ?? []).filter((l) => l !== undefined && l !== null);
	if (!kept.length) {
		if (!blocks.delete(id)) return;
	} else {
		blocks.set(id, { id, priority, lines: kept });
	}
	paint();
}

export function __aboveLinesForTest(): string[] {
	return [...blocks.values()]
		.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
		.flatMap((b) => b.lines);
}

export function __resetAboveForTest(): void {
	blocks.clear();
	liveUi = null;
}

export function installAbove(ctx: any): void {
	liveUi = ctx?.ui;
	const g = globalThis as any;
	g.__oilrigAbove = { set: setAboveBlock };
	const pending: any[] = g.__oilrigAbovePending ?? [];
	for (const [id, priority, lines] of pending) setAboveBlock(id, priority, lines);
	g.__oilrigAbovePending = [];
	paint();
}

export function teardownAbove(): void {
	blocks.clear();
	try { liveUi?.setWidget?.(WIDGET_KEY, undefined); } catch { /* best-effort */ }
	liveUi = null;
	delete (globalThis as any).__oilrigAbove;
}
