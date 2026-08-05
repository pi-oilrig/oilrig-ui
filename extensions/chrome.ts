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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AMBER, CYAN, DIM, GREEN, MAGENTA, RED, RESET, H, vw, FOLDER } from "./retro.ts";

// Retro palette: amber primary, green for active, dim for metadata
const PALETTE = [CYAN, GREEN, AMBER, MAGENTA, RED];

// Volatile keys: shown when active but filtered out of the steady-state status bar
const VOLATILE = new Set([
	"watch", "toolband", "loop", "touches", "ap",
]);

// Known status keys: nerd-font glyphs, ordered by rank
const META: Record<string, { icon: string; color: string; rank: number }> = {
	gantt: { icon: "\uF47F", color: AMBER, rank: 0 },      //  nf-fa-tasks
	kern: { icon: "\uF1C0", color: GREEN, rank: 1 },       //  nf-fa-database
	hub: { icon: "\uF126", color: AMBER, rank: 2 },        //  nf-fa-code-fork
	context: { icon: "\uF85A", color: CYAN, rank: 2.5 },   //  nf-mdi-memory
	ontology: { icon: "\uF0E7", color: MAGENTA, rank: 3 }, //  nf-fa-code
	timeline: { icon: "\uF017", color: CYAN, rank: 4 },    //  nf-fa-clock-o
	rigor: { icon: "\uF00C", color: GREEN, rank: 5 },      //  nf-fa-check
	pace: { icon: "\uF04B", color: CYAN, rank: 6 },        //  nf-fa-play
	launch: { icon: "\uF085", color: AMBER, rank: 7 },     //  nf-fa-gears
	trunk: { icon: "\uF1D3", color: MAGENTA, rank: 8 },    //  nf-fa-terminal
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

function wrapFooter(ui: any): void {
	if (!ui?.setFooter || ui.__statusLineWrapped) return;
	const orig = ui.setFooter.bind(ui);
	ui.setFooter = (factory: any) => {
		if (typeof factory !== "function") return orig(factory);
		return orig((tui: any, theme: any, footerData: any) => {
			const comp = factory(tui, theme, footerData);
			const origRender = comp?.render?.bind(comp);
			if (!origRender) return comp;
			comp.render = (width: number): string[] => {
				const lines = origRender(width);
				const retro: string[] = [];

				// Single dim separator
				retro.push(`${DIM}${H.repeat(Math.max(0, width))}${RESET}`);

				// Line 1: CWD (left) + Context bar (right)
				try {
					const cwd = (lines[0] || "").trim();
					const tag = pluginVersionTag();
					const folder = `${CYAN}${FOLDER}${RESET}`;
					const sid = sessionIdTag();
					const base1 = tag ? `${tag}  ${folder}  ${cwd}` : `${folder}  ${cwd}`;
					const left1 = sid ? `${base1}  ${sid}` : base1;
					const statuses = footerData?.getExtensionStatuses?.();
					const contextRaw = statuses?.get("context") || "";
					const meta = META["context"];
					const right1 = contextRaw ? `${meta.color}${meta.icon}${RESET} ${contextRaw}` : "";
					retro.push(renderPair(left1, right1, width));
				} catch { /* best-effort */ }

				// Line 2: pi's stats line (tokens+cost left, model right — already a pair)
				try {
					if (lines.length > 1 && lines[1].trim())
						retro.push(` ${lines[1]}`);
				} catch { /* best-effort */ }

				// Lines 3+: Extension pairs (context excluded, shown on line 1)
				try {
					const statuses = footerData?.getExtensionStatuses?.();
					if (statuses && statuses.size > 0) {
						const exts = Array.from(statuses.entries())
							.filter(([key]) => !VOLATILE.has(key) && key !== "context")
							.sort(([a], [b]) => rankOf(a) - rankOf(b) || a.localeCompare(b));
						for (let i = 0; i < exts.length; i += 2) {
							const left = paintStatus(exts[i][0], exts[i][1]);
							const right = exts[i + 1] ? paintStatus(exts[i + 1][0], exts[i + 1][1]) : "";
							retro.push(renderPair(left, right, width));
						}
					}
				} catch { /* best-effort */ }

				return retro;
			};
			return comp;
		});
	};
	ui.__statusLineWrapped = true;
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

export function installChrome(ctx: any): void {
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

		// 3. multi-row colored status line
		wrapFooter(ui);
	} catch (err) {
		console.error("[pi-ui] chrome install error:", (err as Error).message);
	}
}