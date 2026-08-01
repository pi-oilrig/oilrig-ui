// Starship — single-line telemetry widget below the editor.
//
// Retro 90s alien terminal format (box-drawn, amber-green CRT):
//   ┌─ TPS 71.7 tok/s ─ TTFT 6.7s ─ 3m 26s ─ 14 turns ─ 12k tok ─────────┐
//
// TPS  — output tok/s of the last agent run (out tokens / agent_start→end).
// TTFT — time to first token (agent_start → first message_update).
// dur  — session wall-clock (always present; the anchor).
// turns— completed agent runs this session (agent_end count).
// tok  — total session tokens (input + output).
// stall— count + total time of streaming gaps over STALL_MS.
//
// Renders via ctx.ui.setWidget placement "belowEditor" on agent_end/settle/clock.

import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { AMBER, CYAN, DIM, GREEN, MAGENTA, RED, RESET, hms, fmt, ts } from "./retro.ts";

const WIDGET_KEY = "starship";

const STALL_MS = 2000;

// ── helpers ────────────────────────────────────────────────────────────────

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

	pi.on("message_end", (event: any, ctx: any) => {
		const out = event?.message?.usage?.output ?? 0;
		if (out > 0) {
			const base = firstTokenAt || msgStartMs || Date.now();
			const genSec = (Date.now() - base) / 1000;
			if (genSec > 0.05) lastTps = out / genSec;
		}
		renderWidget(ctx);
	});

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

			// Build retro segments: amber label, cyan value, dim units
			const segment = (label: string, val: string): string =>
				`${DIM}${label}${RESET} ${CYAN}${val}${RESET}`;
			const parts: string[] = [];

			// Duration is the always-present anchor.
			parts.push(segment("dur", hms(Date.now() - sessionStart)));
			if (turns > 0) parts.push(segment("turns", `${turns}`));
			if (lastTps > 0) parts.push(segment("tps", `${lastTps.toFixed(1)} tok/s`));
			if (lastTtft > 0) parts.push(segment("ttft", `${lastTtft.toFixed(1)}s`));
			if (tok > 0) parts.push(segment("tok", fmt(tok)));
			if (stallCount > 0)
				parts.push(`${RED}stall ${stallCount}x ${hms(stallMs)}${RESET}`);

			// Retro bar: amber-filled gauge with chevron separators
			const line = `${AMBER}▶${RESET} ${parts.join(` ${DIM}│${RESET} `)}`;
			if (line === lastFrame) return;
			lastFrame = line;

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