// chrome — TUI component wraps.
//
// Three jobs:
//   1. no-header: suppress open-tui's welcome header via setHeader wrap.
//   2. status-line: wrap setFooter to append extension-status rows with
//      colored keys, greedy-packed into terminal width, plus a version tag.
//   3. silence-ponytail: only needed if ponytail is loaded — harmless no-op
//      when absent.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLUE, CYAN, GREEN, MAGENTA, RED, RESET, YELLOW } from "./colors.ts";

const PALETTE = [CYAN, GREEN, YELLOW, BLUE, MAGENTA, RED];
const MIN_GAP = 3;

const VOLATILE = new Set([
	"watch", "toolband", "loop", "touches", "launch", "trunk", "ap",
]);

// Known status keys: fixed icon + color + sort rank. Unknown keys fall back
// to a hashed color, no icon, and sort after all known keys (rank 100).
const META: Record<string, { icon: string; color: string; rank: number }> = {
	kern: { icon: "◆", color: GREEN, rank: 0 },
	ontology: { icon: "◇", color: MAGENTA, rank: 1 },
	gantt: { icon: "⊞", color: CYAN, rank: 2 },
	timeline: { icon: "◷", color: BLUE, rank: 3 },
	rigor: { icon: "✓", color: YELLOW, rank: 4 },
	pace: { icon: "▪", color: BLUE, rank: 5 },
	hub: { icon: "⊙", color: CYAN, rank: 6 },
};

function rankOf(key: string): number { return META[key]?.rank ?? 100; }

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
		return versionCache.behind > 0 ? `${RED}v${version}!${RESET}` : `v${version}`;
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
	return behind > 0 ? `${RED}v${version}!${RESET}` : `v${version}`;
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
	if (clean.includes("\x1b[")) return `${color}${icon}${RESET}${clean}`;
	return `${color}${icon}${clean}${RESET}`;
}

function buildStatusRows(statuses: Map<string, string>, width: number): string[] {
	const cap = Math.max(20, Math.floor(width / 2));
	const entries = Array.from(statuses.entries())
		.sort(([a], [b]) => rankOf(a) - rankOf(b) || a.localeCompare(b))
		.filter(([key]) => !VOLATILE.has(key))
		.map(([key, text]) => paintStatus(key, text))
		.filter((s) => visibleWidth(s) > 0)
		.map((s) => (visibleWidth(s) > cap ? truncateToWidth(s, cap, "…") : s));
	const rows: string[][] = [];
	let row: string[] = [];
	let used = 0;
	for (const entry of entries) {
		const w = visibleWidth(entry);
		if (row.length && used + MIN_GAP + w > width) { rows.push(row); row = []; used = 0; }
		used += row.length ? MIN_GAP + w : w;
		row.push(entry);
	}
	if (row.length) rows.push(row);
	return rows.map((r) => {
		if (r.length < 2) return truncateToWidth(r[0] ?? "", width, "…");
		const content = r.reduce((sum, e) => sum + visibleWidth(e), 0);
		const gaps = r.length - 1;
		let spare = Math.max(gaps * MIN_GAP, width - content);
		let line = r[0];
		for (let i = 1; i < r.length; i++) {
			const pad = Math.ceil(spare / (gaps - i + 1));
			line += " ".repeat(pad) + r[i];
			spare -= pad;
		}
		return truncateToWidth(line, width, "…");
	});
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
				try {
					const tag = pluginVersionTag();
					if (tag && lines.length > 0)
						lines[0] = truncateToWidth(`${tag} ${lines[0]}`, width, "…");
				} catch { /* best-effort */ }
				try {
					const statuses = footerData?.getExtensionStatuses?.();
					if (width > 0 && statuses && statuses.size > 0 && lines.length > 2)
						return [...lines.slice(0, 2), ...buildStatusRows(statuses, width)];
				} catch { /* keep open-tui's lines on surprise */ }
				return lines;
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

		// 1. silence ponytail toast + status bar entry (no-op if ponytail absent)
		if (typeof ui.notify === "function") {
			const origNotify = ui.notify.bind(ui);
			ui.notify = (message: string, type?: string) => {
				if (typeof message === "string" && /Ponytail loaded:/.test(message)) return;
				return origNotify(message, type);
			};
		}
		if (typeof ui.setStatus === "function") {
			const origStatus = ui.setStatus.bind(ui);
			ui.setStatus = (key: string, text?: string) => {
				if (key === "ponytail") return;
				return origStatus(key, text);
			};
		}

		// 2. suppress open-tui welcome header (no-op if open-tui absent)
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