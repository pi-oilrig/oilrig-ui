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
	trunk: { icon: "\uF126", color: MAGENTA, rank: 8 },     //  nf-fa-code-fork (experiment worktree)
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

function paintStatus(key: string, text: string): string {
	const clean = sanitize(text);
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

function buildStatsLine(width: number, ctx: any, footerData: any): string {
	const sm = ctx?.sessionManager;
	const totals = computeUsageTotals(sm?.getEntries?.() ?? []);
	const parts: string[] = [];
	if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheRead) parts.push(`R${formatTokens(totals.cacheRead)}`);
	if (totals.cacheWrite) parts.push(`W${formatTokens(totals.cacheWrite)}`);
	if (totals.cost) parts.push(`$${totals.cost.toFixed(3)}`);
	const cu = ctx?.getContextUsage?.();
	const ctxWindow = cu?.contextWindow ?? liveModel?.contextWindow ?? 0;
	const pct = cu?.percent;
	const pctDisp = pct === null || pct === undefined
		? `?/${formatTokens(ctxWindow)}`
		: `${pct.toFixed(1)}%/${formatTokens(ctxWindow)}`;
	parts.push(pctDisp);
	let left = `${DIM}${parts.join(" ")}${RESET}`;
	let leftW = vw(left);
	if (leftW > width) { left = truncateToWidth(left, width, "…"); leftW = vw(left); }
	const model = liveModel;
	let right = model?.id || "no-model";
	if (model?.reasoning) right = liveThinking === "off" ? `${right} • thinking off` : `${right} • ${liveThinking}`;
	const provCount = footerData?.getAvailableProviderCount?.() ?? 1;
	if (provCount > 1 && model) right = `(${model.provider}) ${right}`;
	const rightW = vw(right);
	if (leftW + 2 + rightW <= width) {
		return `${left}${" ".repeat(Math.max(0, width - leftW - rightW))}${DIM}${right}${RESET}`;
	}
	const avail = width - leftW - 2;
	if (avail > 0) {
		const tr = truncateToWidth(right, avail, "");
		return `${left}${" ".repeat(Math.max(0, width - leftW - vw(tr)))}${DIM}${tr}${RESET}`;
	}
	return left;
}

function retroLines(width: number, ctx: any, footerData: any): string[] {
	const out: string[] = [];
	out.push(`${DIM}${H.repeat(Math.max(0, width))}${RESET}`);
	try {
		const sm = ctx?.sessionManager;
		const cwd = formatCwd(sm?.getCwd?.() ?? ctx?.cwd ?? process.cwd());
		const branch = footerData?.getGitBranch?.();
		const sessionName = sm?.getSessionName?.();
		const tag = pluginVersionTag();
		const folder = `${CYAN}${FOLDER}${RESET}`;
		const sid = sessionIdTag();
		let left1 = `${tag ? `${tag}  ` : ""}${folder}  ${cwd}`;
		if (branch) left1 += ` (${branch})`;
		if (sessionName) left1 += ` • ${sessionName}`;
		if (sid) left1 += `  ${sid}`;
		const statuses = footerData?.getExtensionStatuses?.();
		const contextRaw = statuses?.get("context") || "";
		const meta = META["context"];
		const right1 = contextRaw ? `${meta.color}${meta.icon}${RESET} ${contextRaw}` : "";
		out.push(renderPair(left1, right1, width));
	} catch { /* best-effort */ }
	try { out.push(buildStatsLine(width, ctx, footerData)); } catch { /* best-effort */ }
	try {
		const statuses = footerData?.getExtensionStatuses?.();
		if (statuses && statuses.size > 0) {
			const segs = Array.from(statuses.entries())
				.filter(([key]) => !VOLATILE.has(key) && key !== "context")
				.sort(([a], [b]) => rankOf(a) - rankOf(b) || a.localeCompare(b))
				.map(([key, text]) => paintStatus(key, text));
			if (segs.length) out.push(`${truncateToWidth(segs.join(`${DIM} · ${RESET}`), Math.max(0, width), "…")}`);
		}
	} catch { /* best-effort */ }
	return out;
}

function installFooter(ctx: any): void {
	const ui = (ctx as any)?.ui;
	if (!ui?.setFooter) return;
	ui.setFooter((_tui: any, _theme: any, footerData: any) => ({
		render: (width: number) => retroLines(Math.max(0, width), ctx, footerData),
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