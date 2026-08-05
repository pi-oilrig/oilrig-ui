// retro — the colour + glyph primitives the ui status bar / footer actually
// uses. Nothing else in the workspace imports this; keep it to what's reached.

export const RESET = "\x1b[0m";

// ── palette (status bar only — the panel is monochrome) ────────────────────
export const AMBER   = "\x1b[33m";   // primary data
export const GREEN   = "\x1b[32m";   // success, secondary labels
export const CYAN    = "\x1b[36m";   // values, measurements
export const RED     = "\x1b[31m";   // errors, alerts, stalls
export const MAGENTA = "\x1b[35m";   // highlights, turns
export const DIM     = "\x1b[90m";   // metadata, labels

// ── glyphs ──────────────────────────────────────────────────────────────────
export const H       = "─";
export const FULL    = "█";
export const LITE    = "░";
export const FOLDER  = "\uF07C";  // nf-fa-folder
export const ANGLE_R = "\uF054"; // nf-fa-angle-right

/** Visible width of a string (strip ANSI). */
export function vw(s: string): number {
	return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
}

/** Format milliseconds as a human duration. */
export function hms(ms: number): string {
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ${sec % 60}s`;
	const hr = Math.floor(min / 60);
	return `${hr}h ${min % 60}m`;
}

/** Format a number with a k suffix. */
export function fmt(n: number): string {
	return n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}
