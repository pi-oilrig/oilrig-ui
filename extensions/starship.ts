// Starship — session telemetry, rendered as a billboard slot.
//
// Retro 90s alien terminal format (amber-green CRT):
//   ▶ dur 3m 26s │ turns 14 │ tps 71.7 tok/s │ ttft 6.7s │ tok 12k
//
// TPS  — output tok/s of the last agent run (out tokens / agent_start→end).
// TTFT — time to first token (agent_start → first message_update).
// dur  — session wall-clock (always present; the anchor).
// turns— completed agent runs this session (agent_end count).
// tok  — total session tokens (input + output).
// stall— count + total time of streaming gaps over STALL_MS.
//
// It no longer owns a widget. The one-liner is the slot's `row` (billboard min
// strip); `render` is the max-overlay card, which breaks the same numbers out
// one per line and adds the input/output split the strip has no room for.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AMBER, CYAN, DIM, RED, RESET, hms, fmt, ANGLE_R } from "./retro.ts";
import { registerSlot, repaintSlots, unregisterSlot } from "./slot.ts";

const SLOT_ID = "starship";

const STALL_MS = 2000;

// ── helpers ────────────────────────────────────────────────────────────────

function isAssistant(m: any): boolean {
	return !!m && typeof m === "object" && m.role === "assistant";
}

// ── extension entry ────────────────────────────────────────────────────────

export function installStarship(pi: ExtensionAPI): void {
	let sessionStart = Date.now();
	let timer: ReturnType<typeof setInterval> | undefined;
	let sessionCtx: any;

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

	// Tokens come from the running totals; a resumed session has none yet, so
	// fall back to summing the branch once.
	function tokens(): number {
		let tok = totalIn + totalOut;
		if (tok > 0) return tok;
		try {
			for (const e of sessionCtx?.sessionManager?.getBranch() ?? []) {
				if (e.type === "message" && isAssistant(e.message)) {
					tok +=
						(e.message.usage?.input ?? 0) + (e.message.usage?.output ?? 0);
				}
			}
		} catch {
			/* session not ready */
		}
		return tok;
	}

	const segment = (label: string, val: string): string =>
		`${DIM}${label}${RESET} ${CYAN}${val}${RESET}`;

	function rowLine(): string {
		const parts: string[] = [];
		// Duration is the always-present anchor.
		parts.push(segment("dur", hms(Date.now() - sessionStart)));
		if (turns > 0) parts.push(segment("turns", `${turns}`));
		if (lastTps > 0) parts.push(segment("tps", `${lastTps.toFixed(1)} tok/s`));
		if (lastTtft > 0) parts.push(segment("ttft", `${lastTtft.toFixed(1)}s`));
		const tok = tokens();
		if (tok > 0) parts.push(segment("tok", fmt(tok)));
		if (stallCount > 0)
			parts.push(`${RED}stall ${stallCount}x ${hms(stallMs)}${RESET}`);
		return `${AMBER}${ANGLE_R}${RESET} ${parts.join(` ${DIM}│${RESET} `)}`;
	}

	function cardLines(): string[] {
		const rows: string[] = [
			`  ${segment("dur", hms(Date.now() - sessionStart))}`,
			`  ${segment("turns", `${turns}`)}`,
		];
		if (lastTps > 0) rows.push(`  ${segment("tps", `${lastTps.toFixed(1)} tok/s`)}`);
		if (lastTtft > 0) rows.push(`  ${segment("ttft", `${lastTtft.toFixed(1)}s`)}`);
		const tok = tokens();
		if (tok > 0) {
			rows.push(`  ${segment("tok", fmt(tok))}`);
			if (totalIn || totalOut)
				rows.push(
					`  ${segment("in", fmt(totalIn))}  ${segment("out", fmt(totalOut))}`,
				);
		}
		rows.push(
			stallCount > 0
				? `  ${RED}stall ${stallCount}x ${hms(stallMs)}${RESET}`
				: `  ${DIM}no stalls${RESET}`,
		);
		return rows;
	}

	registerSlot({
		id: SLOT_ID,
		title: "session",
		priority: 70,
		size: "row",
		row: () => [rowLine()],
		render: () => cardLines(),
	});

	pi.on("session_start", (_event: any, ctx: any) => {
		sessionCtx = ctx;
		reset();
		startClock();
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
		sessionCtx = ctx ?? sessionCtx;
		const out = event?.message?.usage?.output ?? 0;
		if (out > 0) {
			const base = firstTokenAt || msgStartMs || Date.now();
			const genSec = (Date.now() - base) / 1000;
			if (genSec > 0.05) lastTps = out / genSec;
		}
		repaintSlots();
	});

	pi.on("agent_end", (event: any, ctx: any) => {
		sessionCtx = ctx ?? sessionCtx;
		turns++;
		for (const m of event?.messages ?? []) {
			if (!isAssistant(m)) continue;
			totalIn += m.usage?.input ?? 0;
			totalOut += m.usage?.output ?? 0;
		}
		repaintSlots();
	});

	pi.on("agent_settled", (_event: any, ctx: any) => {
		sessionCtx = ctx ?? sessionCtx;
		repaintSlots();
	});

	// The duration segment is the only thing that moves while idle; a 30s tick
	// is the whole reason this clock exists.
	function startClock(): void {
		if (timer) return;
		timer = setInterval(() => repaintSlots(), 30000);
		(timer as any).unref?.();
	}

	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
		unregisterSlot(SLOT_ID);
	});
}
