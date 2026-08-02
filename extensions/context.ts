// context — session context usage as a progress bar in the status bar.
//
// Reads `ctx.getContextUsage()` on every turn, renders a compact progress
// bar: `████████░░ 73%` with the bar coloured green→amber→red as it fills.
// The status key is "context", which chrome pulls out by name and renders as
// the right half of footer line 1, beside the cwd — it is the one status entry
// that does not fall through to the paired extension rows below it.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FULL, LITE, GREEN, AMBER, RED, DIM, RESET } from "./retro.ts";

const STATUS_KEY = "context";

// ── helpers ────────────────────────────────────────────────────────────────

/** Compact progress bar — no label, just filled/empty blocks + pct. */
function bar(value: number, max: number, width: number): string {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0;
	const filled = Math.round((pct / 100) * width);
	const empty = Math.max(0, width - filled);
	const color = pct > 90 ? RED : pct > 70 ? AMBER : GREEN;
	const bar = `${color}${FULL.repeat(filled)}${RESET}${DIM}${LITE.repeat(empty)}${RESET}`;
	return `${bar} ${color}${pct}%${RESET}`;
}

// ── extension entry ────────────────────────────────────────────────────────

export function installContextTracker(pi: ExtensionAPI): void {
	let ctx: any;

	function update(): void {
		if (!ctx?.ui?.setStatus) return;
		try {
			const usage = ctx.getContextUsage?.();
			if (!usage || usage.percent == null || usage.contextWindow <= 0) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			}
			ctx.ui.setStatus(STATUS_KEY, bar(usage.percent, 100, 8));
		} catch {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	pi.on("session_start", (_event: any, c: any) => {
		ctx = c;
		update();
	});

	pi.on("agent_settled", () => update());
	pi.on("message_end", () => update());

	pi.on("session_shutdown", () => {
		ctx?.ui?.setStatus?.(STATUS_KEY, undefined);
		ctx = undefined;
	});
}