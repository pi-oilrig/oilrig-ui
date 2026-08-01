// Starship — single-line telemetry widget below the editor.
//
// Format (nerd-font icons, " | " separated):
//   󰓅 TPS 71.7 tok/s |  TTFT 6.7s |  3m 26s |  14 |  12k |  stall 27x / 1m 51s
//
// TPS  — output tok/s of the last agent run (out tokens / agent_start→end).
// TTFT — time to first token (agent_start → first message_update).
// dur  — session wall-clock (always present; the anchor).
// turns— completed agent runs this session (agent_end count).
// tok  — total session tokens (input + output).
// stall— count + total time of streaming gaps over STALL_MS.
//
// Token/TPS math follows the proven ~/.config/assembly/share/extensions/tps.ts
// path: agent_end carries event.messages, and assistant message.usage.{input,
// output} is authoritative there. TTFT/stall come from streaming events.
// Renders via ctx.ui.setWidget placement "belowEditor" on agent_end/settle/clock.

import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { BLUE, CYAN, DIM, GREEN, MAGENTA, RED, RESET } from "./colors.ts";

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
	tok: "\u{F0BC5}", // 󰯅 md-pound
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

function isAssistant(m: any): boolean {
	return !!m && typeof m === "object" && m.role === "assistant";
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
	let msgStartMs = 0;
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
		msgStartMs = 0;
		firstTokenAt = 0;
		lastUpdateAt = 0;
		lastTps = 0;
		lastTtft = 0;
	}

	pi.on("session_start", (_event: any, ctx: any) => {
		reset();
		startClock(ctx);
	});

	// Each assistant message: reset timing, then render on completion so the
	// bar appears after every message (not once per user turn).
	pi.on("message_start", () => {
		msgStartMs = Date.now();
		firstTokenAt = 0;
		lastUpdateAt = msgStartMs;
	});

	pi.on("message_update", () => {
		const now = Date.now();
		if (!firstTokenAt) {
			firstTokenAt = now;
			if (msgStartMs) lastTtft = (now - msgStartMs) / 1000;
		} else {
			const gap = now - lastUpdateAt;
			if (gap > STALL_MS) {
				stallCount++;
				stallMs += gap;
			}
		}
		lastUpdateAt = now;
	});

	// message.usage is populated per-message for most providers; compute this
	// response's TPS from it when present, then paint the bar.
	pi.on("message_end", (event: any, ctx: any) => {
		const out = event?.message?.usage?.output ?? 0;
		if (out > 0) {
			const base = firstTokenAt || msgStartMs || Date.now();
			const genSec = (Date.now() - base) / 1000;
			if (genSec > 0.05) lastTps = out / genSec;
		}
		renderWidget(ctx);
	});

	// agent_end carries every message of the run with authoritative usage —
	// the reliable source for the session token/turn totals (see tps.ts).
	pi.on("agent_end", (event: any, ctx: any) => {
		turns++;
		for (const m of event?.messages ?? []) {
			if (!isAssistant(m)) continue;
			totalIn += m.usage?.input ?? 0;
			totalOut += m.usage?.output ?? 0;
		}
		renderWidget(ctx);
	});

	function renderWidget(ctx: any): void {
		try {
			if (!ctx?.ui) return;

			// message.usage summed across the run is authoritative; on a resumed
			// session with no run yet, fall back to the branch total.
			let tok = totalIn + totalOut;
			if (tok === 0) {
				try {
					for (const e of ctx.sessionManager?.getBranch() ?? []) {
						if (e.type === "message" && isAssistant(e.message)) {
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

			// Themed, bordered widget via the factory form (assembly pattern):
			// a dim rule separates it from the editor above, the telemetry line
			// sits below. DynamicBorder needs an explicit color fn (jiti caveat).
			ctx.ui.setWidget(
				WIDGET_KEY,
				(_tui: any, thm: any) => {
					const c = new Container();
					c.addChild(new DynamicBorder((s: string) => thm.fg("borderMuted", s)));
					c.addChild(new Text(` ${line}`, 1, 0));
					return c;
				},
				{ placement: "belowEditor" },
			);
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
