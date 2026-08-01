// Starship — single-line telemetry widget below the editor.
//
// Format (nerd-font icons, " | " separated):
//   󰓅 TPS 71.7 tok/s |  TTFT 6.7s |  3m 26s |  14 |  12k |  stall 27x / 1m 51s
//
// TPS  — output tok/s of the last assistant message (out tokens / gen time).
// TTFT — time to first token of the last message (message_start → first update).
// dur  — session wall-clock (always present; the anchor).
// turns— completed agent turns this session.
// tok  — total session tokens (input + output).
// stall— count + total time of streaming gaps over STALL_MS.
//
// All timing is derived from message_start/update/end + turn_end events.
// Renders via ctx.ui.setWidget placement "belowEditor" on settle/turn/clock.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { BLUE, CYAN, DIM, GREEN, MAGENTA, RED, RESET, YELLOW } from "./colors.ts";

const WIDGET_KEY = "starship";

// Streaming gap longer than this counts as a stall.
const STALL_MS = 2000;

// Nerd-font glyphs, one per segment. Swap these to taste — the layout is
// icon-agnostic. Only the speedometer is confirmed; the rest are sensible
// nerd-font defaults.
const ICONS = {
	tps: "\u{F04C5}", // 󰓅 md-speedometer
	ttft: "\u{F051F}", // 󰔟 md-timer-sand
	dur: "\u{F0150}", // 󰅐 md-clock-outline
	turns: "\u{F04AD}", // 󰒭 md-message-reply
	tok: "\u{F0BC5}", // 󰯅 md-pound / hash
	stall: "\u{F0026}", // 󰀦 md-alert
};

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
	return n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

// Seconds → "45s" / "3m 26s" / "1h 12m".
function hms(totalSec: number): string {
	const sec = Math.floor(totalSec);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ${sec % 60}s`;
	const hr = Math.floor(min / 60);
	return `${hr}h ${min % 60}m`;
}

// ── extension entry ────────────────────────────────────────────────────────

export function installStarship(pi: ExtensionAPI): void {
	let sessionStart = Date.now();
	let lastFrame = "";
	let timer: ReturnType<typeof setInterval> | undefined;

	// session totals
	let turns = 0;
	let totalIn = 0;
	let totalOut = 0;
	let stallCount = 0;
	let stallMs = 0;

	// per-message streaming timing
	let msgStart = 0;
	let firstTokenAt = 0;
	let lastUpdateAt = 0;
	let lastTps = 0;
	let lastTtft = 0;

	function reset(): void {
		sessionStart = Date.now();
		lastFrame = "";
		turns = 0;
		totalIn = 0;
		totalOut = 0;
		stallCount = 0;
		stallMs = 0;
		msgStart = 0;
		firstTokenAt = 0;
		lastUpdateAt = 0;
		lastTps = 0;
		lastTtft = 0;
	}

	pi.on("session_start", (_event: any, ctx: any) => {
		reset();
		startClock(ctx);
	});

	pi.on("message_start", () => {
		msgStart = Date.now();
		firstTokenAt = 0;
		lastUpdateAt = msgStart;
	});

	pi.on("message_update", () => {
		const now = Date.now();
		if (!firstTokenAt) {
			firstTokenAt = now;
		} else {
			const gap = now - lastUpdateAt;
			if (gap > STALL_MS) {
				stallCount++;
				stallMs += gap;
			}
		}
		lastUpdateAt = now;
	});

	pi.on("message_end", (event: any) => {
		const m = event?.message;
		const out = m?.usage?.output ?? 0;
		totalIn += m?.usage?.input ?? 0;
		totalOut += out;
		if (msgStart && firstTokenAt) {
			lastTtft = (firstTokenAt - msgStart) / 1000;
			const genSec = (Date.now() - firstTokenAt) / 1000;
			if (genSec > 0.05 && out > 0) lastTps = out / genSec;
		}
	});

	pi.on("turn_end", (_event: any, ctx: any) => {
		turns++;
		renderWidget(ctx);
	});

	function renderWidget(ctx: any): void {
		try {
			if (!ctx?.ui) return;

			// Token fallback: message_end usage is authoritative, but a resumed
			// session starts with prior messages already in the branch.
			let tok = totalIn + totalOut;
			if (tok === 0) {
				try {
					for (const e of ctx.sessionManager?.getBranch() ?? []) {
						if (e.type === "message" && e.message?.role === "assistant") {
							tok += (e.message.usage?.input ?? 0) + (e.message.usage?.output ?? 0);
						}
					}
				} catch { /* session not ready */ }
			}

			const seg = (color: string, icon: string, label: string): string =>
				`${color}${icon}${RESET} ${DIM}${label}${RESET}`;
			const segments: string[] = [];

			if (lastTps > 0) segments.push(seg(CYAN, ICONS.tps, `TPS ${lastTps.toFixed(1)} tok/s`));
			if (lastTtft > 0) segments.push(seg(BLUE, ICONS.ttft, `TTFT ${lastTtft.toFixed(1)}s`));
			// Duration is the always-present anchor.
			segments.push(seg(DIM, ICONS.dur, hms((Date.now() - sessionStart) / 1000)));
			if (turns > 0) segments.push(seg(MAGENTA, ICONS.turns, `${turns}`));
			if (tok > 0) segments.push(seg(GREEN, ICONS.tok, fmt(tok)));
			if (stallCount > 0)
				segments.push(seg(RED, ICONS.stall, `stall ${stallCount}x / ${hms(stallMs / 1000)}`));

			const line = segments.join(`${DIM} | ${RESET}`);
			if (line === lastFrame) return;
			lastFrame = line;

			const width = process.stdout.columns ?? 80;
			const wrapped = truncateToWidth(` ${line} `, width);
			ctx.ui.setWidget(WIDGET_KEY, [wrapped], { placement: "belowEditor" });
		} catch (err) {
			console.error("[pi-ui] starship render error:", (err as Error).message);
		}
	}

	pi.on("agent_settled", (_event: any, ctx: any) => renderWidget(ctx));

	function startClock(ctx: any): void {
		if (timer) return;
		timer = setInterval(() => {
			try {
				if (ctx?.ui) { lastFrame = ""; renderWidget(ctx); }
			} catch (err) {
				console.error("[pi-ui] starship clock error:", (err as Error).message);
			}
		}, 30000);
		(timer as any).unref?.();
	}

	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
		lastFrame = "";
	});
}
