// chrome — TUI component wraps.
//
// Two jobs:
//   1. no-header: suppress open-tui's welcome header via setHeader wrap.
//   2. status-line: wrap setFooter to render a clean left/right pair layout
//      per line, ordered by importance. Line 1: the mode bar (a full-width
//      thick rule painted in the editor's live borderColor). Line 2: CWD +
//      context bar. Lines 3+: extension pairs. No box borders, no side rails,
//      no greedy packing.
//   3. model label: a block in the shared above-editor stack (above.ts).

import { truncateToWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AMBER, CYAN, DIM, GREEN, MAGENTA, RED, RESET, vw, FOLDER } from "./retro.ts";
import { installAbove, setAboveBlock, teardownAbove } from "./above.ts";

// Retro palette: amber primary, green for active, dim for metadata
const PALETTE = [CYAN, GREEN, AMBER, MAGENTA, RED];

// Volatile keys: shown only while active, filtered out of the steady-state line.
const VOLATILE = new Set([
	"watch", "loop", "touches", "ap",
]);

// Known status keys: nerd-font glyphs, ordered by rank
// Known status keys with nerd-font glyphs, ordered by the same story as the
// billboard slot table: what am I doing → who's here → what is next → what is
// broken → what is running/armed/looping → what is this called → telemetry.
const META: Record<string, { icon: string; color: string; rank: number }> = {
	timeline: { icon: "\uF017", color: CYAN, rank: 0 },    //  nf-fa-clock-o  (todo: what am I doing)
	crew: { icon: "\uF0C0", color: AMBER, rank: 1 },       //  nf-fa-users     (subagents working)
	launch: { icon: "\uF085", color: AMBER, rank: 2 },     //  nf-fa-gears    (what is running)
	wt: { icon: "\uF1D8", color: GREEN, rank: 3 },         //  nf-fa-paper-plane (walkie-talkie: peers/channels)
	gantt: { icon: "\uF47F", color: AMBER, rank: 4 },      //  nf-fa-tasks    (what is next)
	rigor: { icon: "\uF00C", color: GREEN, rank: 5 },      //  nf-fa-check    (what is broken)
	watch: { icon: "\uF06E", color: MAGENTA, rank: 6 },    //  nf-fa-eye      (what is armed)
	loop: { icon: "\uF01E", color: MAGENTA, rank: 7 },      //  nf-fa-repeat   (what is looping)
	trunk: { icon: "\uF0E69", color: MAGENTA, rank: 8 },     // nf-md-tree_outline (experiment worktree)
	ontology: { icon: "\uF0E7", color: MAGENTA, rank: 9 }, //  nf-fa-bolt     (what is this called)
	persona: { icon: "\uF007", color: CYAN, rank: 10 },     //  nf-fa-user
	toolband: { icon: "\uF0AD", color: AMBER, rank: 11 },   //  nf-fa-wrench   (active tools / schema KB)
	kern: { icon: "\uF1C0", color: GREEN, rank: 12 },       //  nf-fa-database (memory)
	hub: { icon: "\uF0E8", color: AMBER, rank: 13 },        //  nf-fa-sitemap   (loader / registry)
	mcp: { icon: "\uF1E6", color: AMBER, rank: 14 },        //  nf-fa-plug     (MCP servers)
	context: { icon: "\uF85A", color: CYAN, rank: 2.5 },   //  nf-mdi-memory  (context bar — line 1 right)
	pace: { icon: "\uF04B", color: CYAN, rank: 6.5 },      //  nf-fa-play
};

function rankOf(key: string): number { return META[key]?.rank ?? 100; }

// Compound cells: keys grouped here render as ONE cell (glyph+text · glyph+text),
// ranked by the lowest member rank. Members consumed are dropped from the
// individual stream so they don't also appear alone.
const COMPOUND: string[][] = [
	["wt", "hub"],                    // walkie-talkie + loader: communication + session knowledge
	["trunk", "toolband", "mcp"],    // worktree + active tools + MCP servers: the tool surface
	["ontology", "kern"], // entity index + memory graph: what the session knows
];

// Short session id — the first 8 chars of PI_SESSION_ID are the walkie-talkie
// address prefix (wt_send `to`). Shown dim after the cwd so you can copy it to
// reach this session from another pi.
let sessionIdCache: string | null | undefined;
function sessionIdTag(): string | null {
	if (sessionIdCache !== undefined) return sessionIdCache;
	const id = (process.env.PI_SESSION_ID || "").trim();
	const prefix = id ? id.slice(0, 8) : "";
	sessionIdCache = prefix ? `${DIM}${prefix}${RESET}` : null;
	return sessionIdCache;
}

function pkgRoot(): string | null {
	let dir: string | null;
	try { dir = dirname(fileURLToPath(import.meta.url)); } catch { return null; }
	for (;;) {
		try {
			const m = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			if (m && typeof m === "object" && "pi" in m) return dir;
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

let versionCache: { version: string; refMtime: number; behind: number } | null = null;
function pluginVersionTag(): string | null {
	const root = pkgRoot();
	if (!root) return null;
	let version = "";
	try {
		version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "";
	} catch { return null; }
	if (!version) return null;
	const refPath = join(root, ".git/refs/remotes/origin/main");
	let mtime = 0;
	try { mtime = statSync(refPath).mtimeMs; } catch {}
	if (versionCache && versionCache.version === version && versionCache.refMtime === mtime) {
		return versionCache.behind > 0 ? `${RED}${version}!${RESET}` : `${AMBER}${version}${RESET}`;
	}
	let behind = 0;
	try {
		const out = execSync(
			`git -C ${JSON.stringify(root)} rev-list --count HEAD..origin/main`,
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		behind = Number(out) || 0;
	} catch { behind = 0; }
	versionCache = { version, refMtime: mtime, behind };
	return behind > 0 ? `${RED}${version}!${RESET}` : `${AMBER}${version}${RESET}`;
}

function colorFor(key: string): string {
	let h = 0;
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
	return PALETTE[h % PALETTE.length];
}

function sanitize(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

// mcp-adapter ships its own leading emoji + "MCP:" label + a prose count
// ("🔌 MCP: 3 servers enabled"). chrome has a nerd-font plug for the same
// key, so strip the foreign emoji + redundant label, then compact the count
// to "<n> MCPs" for mcp only — other keyed statuses keep their text.
function stripForeignIcon(key: string, text: string): string {
	if (key !== "mcp") return text;
	// mcp-adapter wraps its text in an ANSI accent colour, so strip ANSI
	// first (chrome re-colours via META), then drop the leading emoji +
	// redundant "MCP:" label, then compact "<n> servers enabled" → "<n> MCPs".
	const bare = text.replace(/\x1b\[[0-9;]*m/g, "");
	return bare.replace(/^\s*(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}])+\s*/u, "")
		.replace(/^\s*MCP:\s*/i, "")
		.replace(/^(\d+)\s*servers?\s*enabled/i, "$1 MCPs");
}

function paintStatus(key: string, text: string): string {
	const clean = stripForeignIcon(key, sanitize(text));
	const meta = META[key];
	const color = meta ? meta.color : colorFor(key);
	const icon = meta ? `${meta.icon} ` : "";
	const inner = clean.includes("\x1b[")
		? `${color}${icon}${RESET}${clean}`
		: `${color}${icon}${clean}${RESET}`;
	return inner;
}

// ── render a pair: one item left, one right ───────────────────────────────
// Each line has exactly one left and one right item, truncated to fit.
// Left gets ~55%, right ~45%. If right is empty, left fills the line.
export function renderPair(left: string, right: string, width: number): string {
	if (!right) return ` ${left}`;
	const gap = 2;
	const leftMax = Math.max(10, Math.floor((width - 1 - gap) * 0.55));
	const rightMax = Math.max(10, width - 1 - gap - leftMax);
	const l = truncateToWidth(left, leftMax, "…");
	const r = truncateToWidth(right, rightMax, "…");
	return ` ${l}${" ".repeat(Math.max(0, leftMax - vw(l)))}${r}`;
}

// ── footer ────────────────────────────────────────────────────────────────
// Self-contained retro status line installed via ctx.ui.setFooter(). The old
// design only *wrapped* setFooter, waiting for another extension to install a
// footer it could reformat — nothing ever did, so pi's built-in footer rendered
// and the folder/version/session-id never showed. This builds the footer
// directly from ctx + footerData (git branch, extension statuses, available
// provider count) so it actually replaces the built-in footer.

// ctx.model is a session_start snapshot; keep the footer's model segment live
// across /model and thinking-level changes.
let liveModel: any = undefined;
let liveThinking: string = "off";
let statusTracked = false;
let liveCtx: any = null;
// getAvailableProviderCount only reaches us through footerData; cache what the
// last footer render saw so the model widget can read it too.
let provCount = 1;
function trackStatus(pi: any, ctx: any): void {
	liveCtx = ctx ?? liveCtx;
	liveModel = ctx?.model ?? liveModel;
	// The stack owns the one aboveEditor widget; install it before any block
	// tries to paint into it.
	if (ctx?.ui) installAbove(ctx);
	// ctx.thinkingLevel is the session's initial level (settings defaultThinkingLevel,
	// e.g. "high"). Seed from it so the footer doesn't show "off" until the first
	// thinking_level_select event — that event only fires on an explicit change.
	if (ctx?.thinkingLevel) liveThinking = ctx.thinkingLevel;
	if (!statusTracked && pi) {
		statusTracked = true;
		pi.on("model_select", (e: any) => { liveModel = e?.model ?? liveModel; renderModelWidget(); });
		pi.on("thinking_level_select", (e: any) => { liveThinking = e?.level ?? liveThinking; renderModelWidget(); });
		// The working window: the mode bar pulses between these two.
		pi.on("agent_start", () => setBusy(true));
		pi.on("agent_end", () => setBusy(false));
		pi.on("session_shutdown", () => { setBusy(false); teardownAbove(); });
	}
}

// ── model label ───────────────────────────────────────────────────────────
// The label used to ride on the footer's rule line, which is the mode bar
// now. It sits above the input instead — as a block in the shared
// above-editor stack, never its own widget: two widget keys reorder
// themselves on every repaint (see above.ts). Priority 20 puts it under the
// recap, closest to the prompt.
const MODEL_PRIORITY = 20;

function renderModelWidget(): void {
	const s = modelString();
	// No indent of its own: pi wraps every widget line in `Text(line, 1, 0)`,
	// so the block already starts at column 1 — the same edge as the recap
	// above it, the prompt below it and the footer under that. A two-column
	// indent here put the label alone at column 3.
	setAboveBlock("model", MODEL_PRIORITY, s ? [`${DIM}${s}${RESET}`] : undefined);
}

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return cwd;
	const r = relative(resolve(home), resolve(cwd));
	const inside = r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
	return inside ? (r === "" ? "~" : `~${sep}${r}`) : cwd;
}

function computeUsageTotals(entries: any[]): { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number } {
	let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
	for (const e of entries) {
		let u: any = undefined;
		if (e?.type === "message" && e.message) u = e.message.usage;
		else if ((e?.type === "branch_summary" || e?.type === "compaction") && e.usage) u = e.usage;
		if (!u) continue;
		input += u.input || 0;
		output += u.output || 0;
		cacheRead += u.cacheRead || 0;
		cacheWrite += u.cacheWrite || 0;
		cost += (u.cost && typeof u.cost === "object" ? u.cost.total : u.cost) || 0;
	}
	return { input, output, cacheRead, cacheWrite, cost };
}

const THINK = "\uE28C"; //  nf-fae-brain (thinking effort)

function modelString(): string {
	const model = liveModel;
	let s = model?.id || "no-model";
	if (model?.reasoning) s = `${s} │ ${THINK} ${liveThinking}`;
	if (provCount > 1 && model) s = `(${model.provider}) ${s}`;
	return s;
}

// The mode bar: one full-width thick rule in the live editor's borderColor,
// which is what pi recolours per mode (bash, thinking accents). editor.ts
// publishes that paint fn on every input render; before the first one, or
// without the editor stack, it falls back to dim.
//
// The bar is one flat braille line. While the agent is working a *single*
// sine cycle travels along it left to right and the rest of the line stays
// flat — one wave passing, not a rippling field. Braille is the only glyph
// family with sub-cell vertical resolution (4 dot rows in one cell), so the
// wave rises and falls inside the row the bar already occupies; it can never
// spill onto a second line. It runs only between agent_start and agent_end,
// and only when something can actually repaint the frame.
const FRAME_MS = 45;
const STEP = 3;      // dot columns advanced per frame
const PACKET = 20;   // dot columns spanned by the one wave — 10 cells
const GAP = 44;      // flat dot columns between passes
const BASE_ROW = 2;  // the resting line: sin(0) lands here, so it is seamless

// A braille cell is 2 dot columns × 4 dot rows. Bit per (column, row):
// left = dots 1,2,3,7 — right = dots 4,5,6,8.
const BRAILLE = 0x2800;
const LEFT = [0x01, 0x02, 0x04, 0x40];
const RIGHT = [0x08, 0x10, 0x20, 0x80];

// Endcaps, pointing inward: the bar is a segment, and a segment reads as one
// thing when both ends are terminated. Big triangles fill the full cell height
// so they sit dead center. The inner line uses ━ (heavy horizontal, U+2501) at
// rest — same cell zone as the triangles — and switches to braille during
// animation (braille has sub-cell resolution for the traveling wave; the
// vertical mismatch doesn't matter when the eye tracks motion).
const CAP_L = "\u25B6"; // ▶
const CAP_R = "\u25C0"; // ◀

let busy = false;
let phase = 0;
let ticker: any = null;

// Dot row 0..3 for one dot column. Outside the travelling packet the line is
// flat; inside it, one full cycle: crest at a quarter, trough at three
// quarters, and BASE_ROW at both ends so the packet joins the line without a
// step.
function dotRow(x: number, head: number): number {
	const d = x - head;
	if (d < 0 || d >= PACKET) return BASE_ROW;
	const s = Math.sin((2 * Math.PI * d) / PACKET);
	return Math.round(1.5 - 1.5 * s);
}

// The line between the caps. At rest it's a single centered hard rule (━) that
// aligns with the triangles. During animation it switches to braille, the only
// glyph family with sub-cell vertical resolution — the wave still sits inside
// one row and never spills. The vertical mismatch between braille and the caps
// is invisible when the eye is tracking the traveling wave.
function lineGlyphs(width: number): string {
	if (!busy) return "\u2501".repeat(width);
	const span = width * 2;
	// The packet enters from off-screen left and leaves off-screen right, then
	// the line is flat for GAP before the next one. Phase is normalised here
	// rather than in the ticker: an ever-growing argument to sin() eventually
	// loses precision and the wave stutters.
	const period = span + PACKET + GAP;
	phase = ((phase % period) + period) % period;
	const head = phase - PACKET;
	let out = "";
	for (let i = 0; i < width; i++) {
		// Two samples per cell: the wave is smoother than the cell grid.
		out += String.fromCharCode(BRAILLE | LEFT[dotRow(2 * i, head)] | RIGHT[dotRow(2 * i + 1, head)]);
	}
	return out;
}

function barGlyphs(width: number): string {
	if (width < 3) return lineGlyphs(width);
	return CAP_L + lineGlyphs(width - 2) + CAP_R;
}

function modeBar(width: number): string {
	const bar = barGlyphs(Math.max(0, width));
	const paint = (globalThis as any).__oilrigModePaint;
	if (typeof paint === "function") {
		const painted = safePaint(paint, bar);
		if (painted !== null) return painted;
	}
	return `${DIM}${bar}${RESET}`;
}

function safePaint(paint: (s: string) => string, bar: string): string | null {
	try {
		const p = paint(bar);
		if (typeof p === "string" && vw(p) === vw(bar)) return p;
	} catch { /* fall through */ }
	return null;
}

// editor.ts publishes the live tui's repaint; without it there is no frame to
// drive and the ticker would spin for nothing.
function repaint(): void {
	const r = (globalThis as any).__oilrigRequestRender;
	if (typeof r === "function") { try { r(); } catch { /* best-effort */ } }
}

export function setBusy(next: boolean): void {
	if (busy === next) return;
	busy = next;
	if (busy) {
		phase = 0;
		if (!ticker && typeof (globalThis as any).__oilrigRequestRender === "function") {
			ticker = setInterval(() => { phase += STEP; repaint(); }, FRAME_MS);
			// A ref'd interval is a reason for node to stay alive (perf1).
			(ticker as any).unref?.();
		}
	} else if (ticker) {
		clearInterval(ticker);
		ticker = null;
	}
	repaint();
}

// Test seam: the ticker needs a live tui, the glyph maths does not.
export function __barGlyphsForTest(width: number, working: boolean, at: number): string {
	const wasBusy = busy, wasPhase = phase;
	busy = working; phase = at;
	try { return barGlyphs(width); } finally { busy = wasBusy; phase = wasPhase; }
}

// Context cell: a dynamic progress bar that grows to fill its column width
// minus the usage text. Built from ctx.getContextUsage percent (one source of
// truth) — the foreign `context` status bar (fixed-width, duplicate %) is dropped.
function contextUnit(_statuses: Map<string, string> | undefined, ctx: any, cellW: number): string {
	const totals = computeUsageTotals(ctx?.sessionManager?.getEntries?.() ?? []);
	const parts: string[] = [];
	if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cost) parts.push(`$${totals.cost.toFixed(3)}`);
	const cu = ctx?.getContextUsage?.();
	const pct = cu?.percent;
	const pctNum = (typeof pct === "number" && pct >= 0) ? pct : null;
	if (pctNum !== null) parts.push(`${pctNum.toFixed(1)}%`);
	const text = parts.join(" │ ");
	const textW = vw(text);
	const sep = textW > 0 ? 1 : 0;
	const barW = Math.max(0, cellW - 1 - sep - textW); // -1: leading space aligns with paintStatus cells
	const filled = pctNum === null ? 0 : Math.round(barW * Math.min(100, Math.max(0, pctNum)) / 100);
	const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, barW - filled))}`;
	return ` ${bar}${textW > 0 ? ` ${text}` : ""}`;
}

function retroLines(width: number, ctx: any, footerData: any): string[] {
	const out: string[] = [];
	const cw = Math.max(1, width);
	provCount = footerData?.getAvailableProviderCount?.() ?? provCount;
	try {
		const sm = ctx?.sessionManager;
		const cwd = formatCwd(sm?.getCwd?.() ?? ctx?.cwd ?? process.cwd());
		const branch = footerData?.getGitBranch?.();
		const sessionName = sm?.getSessionName?.();
		const tag = pluginVersionTag();
		const folder = `${CYAN}${FOLDER}${RESET}`;
		const sid = sessionIdTag();
		let left1 = `${tag ? `${tag}  ` : ""}${folder}  ${cwd}`.trimStart();
		if (branch) left1 += ` (${branch})`;
		if (sessionName) left1 += ` • ${sessionName}`;
		if (sid) left1 += `  ${sid}`;
		const statuses = footerData?.getExtensionStatuses?.();
		const gap = 2;
		const leftMax = Math.max(10, Math.floor((cw - 1 - gap) * 0.55));
		const rightMax = Math.max(10, cw - 1 - gap - leftMax);
		const right1 = contextUnit(statuses, ctx, rightMax);
		out.push(renderPair(left1, right1, cw));
	} catch { /* best-effort */ }
	try {
		const statuses = footerData?.getExtensionStatuses?.();
		if (statuses && statuses.size > 0) {
			const entries = Array.from(statuses.entries())
				.filter(([key, v]) => !VOLATILE.has(key) && key !== "context" && v);
			const sm = new Map(entries);
			const consumed = new Set<string>();
			const cells: { rank: number; text: string }[] = [];
			for (const group of COMPOUND) {
				const have = group.filter((k) => sm.has(k) && !consumed.has(k));
				if (have.length === 0) continue;
				cells.push({
					rank: Math.min(...have.map(rankOf)),
					text: have.map((k) => paintStatus(k, sm.get(k)!)).join(" │ "),
				});
				have.forEach((k) => consumed.add(k));
			}
			for (const [k, v] of entries) {
				if (consumed.has(k)) continue;
				cells.push({ rank: rankOf(k), text: paintStatus(k, v) });
			}
			cells.sort((a, b) => a.rank - b.rank);
			// Two columns: one item per row in a left and a right column.
			for (let i = 0; i < cells.length; i += 2) {
				out.push(renderPair(cells[i].text, cells[i + 1]?.text ?? "", cw));
			}
		}
	} catch { /* best-effort */ }
	// No gutter on any line: the ▏ rail down the left of the status block was
	// the last of the old box framing, and the mode bar above already marks
	// where the footer starts.
	return [modeBar(width), ...out];
}

// chrome owns the *renderer*; hub owns the *installation* (hub's session_start
// fires early and re-fires on reload, so the footer survives pi's
// resetExtensionUI which otherwise restores the built-in footer). chrome
// publishes its renderer on globalThis for hub's delegating factory; it also
// installs directly as a standalone fallback for sessions without hub.
function installFooter(ctx: any): void {
	const ui = (ctx as any)?.ui;
	if (!ui?.setFooter) return;
	const render = (width: number, footerData: any) =>
		retroLines(Math.max(0, width), ctx, footerData);
	(globalThis as any).__piChromeFooter = render;
	ui.setFooter((_tui: any, _theme: any, footerData: any) => ({
		render: (width: number) => render(width, footerData),
		dispose() {},
	}));
}

const THEME_NAME = "terminal";

function ensureTheme(): void {
	const root = pkgRoot();
	if (!root) return;
	const pkgTheme = join(root, "themes", `${THEME_NAME}.json`);
	if (!existsSync(pkgTheme)) return;

	// Agent themes dir: PI_CODING_AGENT_DIR/themes or ~/.pi/agent/themes
	const agentDir =
		process.env.PI_CODING_AGENT_DIR ??
		join(process.env.HOME || "/tmp", ".pi", "agent");
	const themesDir = join(agentDir, "themes");
	const dest = join(themesDir, `${THEME_NAME}.json`);
	if (existsSync(dest)) return;

	try {
		mkdirSync(themesDir, { recursive: true });
		copyFileSync(pkgTheme, dest);
	} catch {
		/* best-effort */
	}
}

export function installChrome(pi: any, ctx: any): void {
	try {
		ensureTheme();

		const ui = (ctx as any)?.ui;
		if (!ui) return;

		// suppress open-tui welcome header (no-op if open-tui absent)
		const uiHeader = ctx.ui as {
			setHeader?: ((c: unknown) => void) & { __noHeader?: boolean };
		};
		if (typeof uiHeader.setHeader === "function" && !uiHeader.setHeader.__noHeader) {
			const orig = uiHeader.setHeader.bind(uiHeader);
			const wrapped = (_c: unknown) => orig(undefined);
			wrapped.__noHeader = true;
			uiHeader.setHeader = wrapped;
			orig(undefined);
		}

		// Self-contained retro status line (replaces pi's built-in footer).
		trackStatus(pi, ctx);
		installFooter(ctx);
		renderModelWidget();
	} catch (err) {
		console.error("[oilrig-ui] chrome install error:", (err as Error).message);
	}
}