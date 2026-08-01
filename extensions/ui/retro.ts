// retro — 90s alien terminal UI kit.
//
// Shared rendering primitives for a CRT-monochrome aesthetic: amber/green
// palette, box-drawing borders, block-chart fill, scan-line texture, and
// fixed-width data tables. Every package's render function uses this.
//
// Design rules:
//   • Amber primary (data), green secondary (labels), dim for metadata.
//   • Every panel gets a box-drawn border — no raw text.
//   • Tables use fixed-width columns with ▏ fill indicators.
//   • Timestamps in [HH:MM:SS] always.
//   • Status uses ● (active) ○ (idle) ◆ (done) ◇ (waiting).

export const RESET = "\x1b[0m";

// ── palette ────────────────────────────────────────────────────────────────
export const AMBER   = "\x1b[33m";   // primary data
export const AMBER_B = "\x1b[43m";   // amber background
export const GREEN   = "\x1b[32m";   // secondary labels, success
export const GREEN_B = "\x1b[42m";   // green background
export const CYAN    = "\x1b[36m";   // values, measurements
export const RED     = "\x1b[31m";   // errors, alerts, stalls
export const RED_B   = "\x1b[41m";   // error background
export const MAGENTA = "\x1b[35m";   // highlights, turns
export const BLUE    = "\x1b[34m";   // info, links
export const DIM     = "\x1b[90m";   // metadata, labels
export const DIM_B   = "\x1b[100m";  // dim background
export const BOLD    = "\x1b[1m";    // bold
export const BLINK   = "\x1b[5m";    // blink (use sparingly)

// ── box-drawing ────────────────────────────────────────────────────────────
// Single borders
export const TL = "┌";  export const TR = "┐";  export const BL = "└";  export const BR = "┘";
export const H  = "─";  export const V  = "│";  export const X  = "┼";
export const LH = "├";  export const RH = "┤";  export const DH = "┬";  export const UH = "┴";

// Double borders
export const DTL = "╔"; export const DTR = "╗"; export const DBL = "╚"; export const DBR = "╝";
export const DH2 = "═"; export const DV  = "║";
export const DLH = "╠"; export const DRH = "╣"; export const DDH = "╦"; export const DUH = "╩";

// ── block elements ─────────────────────────────────────────────────────────
export const FULL = "█";  export const DARK  = "▓";  export const MED  = "▒";
export const LITE = "░";  export const UHALF = "▀";  export const LHALF = "▄";
export const LBLK = "▌";  export const RBLK  = "▐";

// ── status indicators ──────────────────────────────────────────────────────
export const ACTIVE  = `${GREEN}●${RESET}`;
export const IDLE    = `${DIM}○${RESET}`;
export const DONE    = `${AMBER}◆${RESET}`;
export const WAIT    = `${DIM}◇${RESET}`;
export const ALERT   = `${RED}●${RESET}`;
export const CHEVRON = `${AMBER}▶${RESET}`;
export const CHEV_L  = `${AMBER}◀${RESET}`;
export const TRI_U   = `${AMBER}▲${RESET}`;
export const TRI_D   = `${AMBER}▼${RESET}`;

// ── helpers ────────────────────────────────────────────────────────────────

/** Format seconds as [HH:MM:SS] or [MM:SS] */
export function ts(sec: number): string {
	const s = Math.floor(sec);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const secs = s % 60;
	if (h > 0) return `${DIM}[${RESET}${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}${DIM}]${RESET}`;
	return `${DIM}[${RESET}${m.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}${DIM}]${RESET}`;
}

/** Format milliseconds as human duration */
export function hms(ms: number): string {
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ${sec % 60}s`;
	const hr = Math.floor(min / 60);
	return `${hr}h ${min % 60}m`;
}

/** Format number with k suffix */
export function fmt(n: number): string {
	return n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

/** Truncate with ellipsis, respecting ANSI */
export function trunc(s: string, max: number): string {
	const clean = s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
	if (clean.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}

/** Visible width of a string (strip ANSI) */
export function vw(s: string): number {
	return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
}

/** Pad a string to a fixed visible width */
export function pad(s: string, w: number): string {
	const v = vw(s);
	return v >= w ? s : s + " ".repeat(w - v);
}

/** Draw a horizontal rule with optional label */
export function hr(width: number, label?: string): string {
	if (label) {
		const inner = ` ${label} `;
		const left = Math.floor((width - inner.length) / 2);
		const right = width - left - inner.length;
		return `${DIM}${H.repeat(Math.max(0, left))}${RESET}${label}${DIM}${H.repeat(Math.max(0, right))}${RESET}`;
	}
	return `${DIM}${H.repeat(width)}${RESET}`;
}

/** Draw a labeled section header with box-drawing borders */
export function section(title: string, width: number): string[] {
	const inner = ` ${title} `;
	const padLeft = Math.floor((width - inner.length - 2) / 2);
	const padRight = width - inner.length - 2 - padLeft;
	return [
		`${DIM}${TL}${H.repeat(padLeft)}${RESET}${AMBER}${inner}${RESET}${DIM}${H.repeat(padRight)}${TR}${RESET}`,
	];
}

/** Draw a box around content lines */
export function box(lines: string[], width: number): string[] {
	if (lines.length === 0) return [];
	const out: string[] = [];
	out.push(`${DIM}${TL}${H.repeat(width - 2)}${TR}${RESET}`);
	for (const l of lines) {
		const vw = l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
		const pad = Math.max(0, width - 2 - vw);
		out.push(`${DIM}${V}${RESET}${l}${" ".repeat(pad)}${DIM}${V}${RESET}`);
	}
	out.push(`${DIM}${BL}${H.repeat(width - 2)}${BR}${RESET}`);
	return out;
}

/** A progress bar — ████████░░ 73% */
export function progressBar(value: number, max: number, width: number): string {
	const pct = max > 0 ? Math.round((value / max) * 100) : 0;
	const filled = max > 0 ? Math.round((value / max) * width) : 0;
	const empty = Math.max(0, width - filled);
	const bar = `${GREEN}${FULL.repeat(filled)}${RESET}${DIM}${LITE.repeat(empty)}${RESET}`;
	return `${bar} ${AMBER}${pct}%${RESET}`;
}

/** A sparkline from an array of values (0-1 normalized) */
export function sparkline(values: number[], width: number): string {
	if (values.length === 0) return "";
	const max = Math.max(...values, 0.001);
	const chars = [LITE, MED, DARK, FULL]; // 0-25%, 25-50%, 50-75%, 75-100%
	return values
		.map((v, i) => {
			const idx = Math.min(
				chars.length - 1,
				Math.floor((v / max) * chars.length),
			);
			return `${CYAN}${chars[idx]}${RESET}`;
		})
		.join("");
}

/** A gauge — ▏▏▏▏▏▏▏▏▏▏▏▏▏▌▌▌▌▌▌▌▌▌▌ */
export function gauge(value: number, max: number, width: number): string {
	const ratio = max > 0 ? Math.min(1, value / max) : 0;
	const full = Math.floor(ratio * width);
	const remainder = (ratio * width) - full;
	const partial = Math.floor(remainder * 8);
	const partialChar = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][partial];
	const bar = `${AMBER}${FULL.repeat(full)}${partialChar}${RESET}`;
	return bar;
}

/** Status chip — [● active] [○ idle] [◆ done] */
export function chip(label: string, kind: "active" | "idle" | "done" | "alert"): string {
	const dot =
		kind === "active" ? ACTIVE
		: kind === "alert" ? ALERT
		: kind === "done" ? DONE
		: IDLE;
	return `${DIM}[${RESET}${dot} ${AMBER}${label}${RESET}${DIM}]${RESET}`;
}

/** Key-value pair — "key: value" with colored key */
export function kv(key: string, value: string): string {
	return `${DIM}${key}${RESET}: ${AMBER}${value}${RESET}`;
}

/** Cyan-highlighted data value */
export function data(val: string | number): string {
	return `${CYAN}${val}${RESET}`;
}

/** Header row for a table — column headers separated by │ */
export function tableHeader(cols: string[], widths: number[]): string {
	const header = cols.map((c, i) => pad(c, widths[i] ?? c.length)).join(` ${DIM}│${RESET} `);
	return `${DIM}${header}${RESET}`;
}

/** Data row for a table — values aligned to column widths */
export function tableRow(vals: string[], widths: number[]): string {
	return vals
		.map((v, i) => {
			const w = widths[i] ?? v.length;
			return pad(v, w);
		})
		.join(` ${DIM}│${RESET} `);
}