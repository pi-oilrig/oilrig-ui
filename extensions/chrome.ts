// chrome — TUI component wraps.
//
// Two jobs:
//   1. no-header: suppress open-tui's welcome header via setHeader wrap.
//   2. status-line: wrap setFooter to render a clean left/right pair layout
//      per line, ordered by importance. Line 1: CWD + context bar. Line 2:
//      pi's stats (tokens+cost left, model right). Lines 3+: extension pairs.
//      No box borders, no side rails, no greedy packing.

import { truncateToWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AMBER, CYAN, DIM, GREEN, MAGENTA, RED, RESET, H, vw, FOLDER } from "./retro.ts";

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
	return ` ${inner}`;
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

function renderPairSep(left: string, right: string, width: number): string {
	if (!right) return ` ${left}`;
	const sep = 1; // │ between columns
	const gap = 1; // one space each side of the separator
	const leftMax = Math.max(10, Math.floor((width - 1 - sep - 2 * gap) * 0.55));
	const rightMax = Math.max(10, width - 1 - sep - 2 * gap - leftMax);
	const l = truncateToWidth(left, leftMax, "…");
	const r = truncateToWidth(right, rightMax, "…");
	return ` ${l}${" ".repeat(Math.max(0, leftMax - vw(l)))} │${r}`;
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
function trackStatus(pi: any, ctx: any): void {
	liveModel = ctx?.model ?? liveModel;
	if (!statusTracked && pi) {
		statusTracked = true;
		pi.on("model_select", (e: any) => { liveModel = e?.model ?? liveModel; });
		pi.on("thinking_level_select", (e: any) => { liveThinking = e?.level ?? liveThinking; });
	}
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

function modelString(footerData: any): string {
	const model = liveModel;
	let s = model?.id || "no-model";
	if (model?.reasoning) s = liveThinking === "off" ? `${s} │ off` : `${s} │ ${liveThinking}`;
	const provCount = footerData?.getAvailableProviderCount?.() ?? 1;
	if (provCount > 1 && model) s = `(${model.provider}) ${s}`;
	return s;
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
	// Separator rule below the input, with the model right-aligned on it.
	const mdl = modelString(footerData);
	const mdlW = mdl.length;
	const lead = mdlW > 0 ? `  ${mdl} ` : "";
	const ruleW = Math.max(0, width - lead.length);
	out.push(`${DIM}${lead}${H.repeat(ruleW)}${RESET}`);
	try {
		const sm = ctx?.sessionManager;
		const cwd = formatCwd(sm?.getCwd?.() ?? ctx?.cwd ?? process.cwd());
		const branch = footerData?.getGitBranch?.();
		const sessionName = sm?.getSessionName?.();
		const tag = pluginVersionTag();
		const folder = `${CYAN}${FOLDER}${RESET}`;
		const sid = sessionIdTag();
		let left1 = `${tag ? `${tag}  ` : ""}${folder}  ${cwd}`.trimStart();
		if (tag) left1 = ` ${left1}`;
		if (branch) left1 += ` (${branch})`;
		if (sessionName) left1 += ` • ${sessionName}`;
		if (sid) left1 += `  ${sid}`;
		const statuses = footerData?.getExtensionStatuses?.();
		const gap = 2;
		const leftMax = Math.max(10, Math.floor((width - 1 - gap) * 0.55));
		const rightMax = Math.max(10, width - 1 - gap - leftMax);
		const right1 = contextUnit(statuses, ctx, rightMax);
		out.push(renderPair(left1, right1, width));
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
				out.push(renderPairSep(cells[i].text, cells[i + 1]?.text ?? "", width));
			}
		}
	} catch { /* best-effort */ }
	return out;
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
	} catch (err) {
		console.error("[pi-ui] chrome install error:", (err as Error).message);
	}
}