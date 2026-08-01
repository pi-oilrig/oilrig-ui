// Starship — single-line status widget below the editor.
// Segments: tokens (↑in ↓out), kern ops, frontier cursor, git branch,
// session duration, cost. Model is intentionally omitted — pi renders it
// on the native line above the input, so repeating it here is noise.
// Renders via ctx.ui.setWidget with placement "belowEditor".

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { BLUE, CYAN, DIM, GREEN, MAGENTA, RESET, YELLOW } from "./colors.ts";

const WIDGET_KEY = "starship";

// ── frontier cursor (minimal parser, no cross-package dep) ─────────────────

type Ticket = { id: string; state: string; mode: string; blockedBy: string[]; title: string };
type Cursor = { done: number; total: number; ready: string[]; waiting: string[] };

function parseTicket(id: string, text: string): Ticket {
	const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) return { id, state: "open", mode: "afk", blockedBy: [], title: id };
	const fields: Record<string, string> = {};
	for (const line of m[1].split("\n")) {
		const kv = line.match(/^([\w-]+):\s*(.*?)\s*$/);
		if (kv) fields[kv[1]] = kv[2].trim();
	}
	const body = (m[2] ?? "").trim();
	const title = body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? id;
	return { id, state: fields["state"] ?? "open", mode: fields["mode"] ?? "afk", blockedBy: fields["blocked-by"] ? fields["blocked-by"].split(/\s+/).filter(Boolean) : [], title };
}

function frontierCursor(dir: string): Cursor | null {
	const tdir = join(dir, "tickets");
	if (!existsSync(tdir)) return null;
	const tickets: Ticket[] = [];
	const files = readdirSync(tdir).filter((f: string) => f.endsWith(".md")).sort();
	for (const f of files) {
		const p = join(tdir, f);
		tickets.push(parseTicket(f.replace(/\.md$/, ""), readFileSync(p, "utf8")));
	}
	if (tickets.length === 0) return null;
	const closed = (t: Ticket) => t.state === "done" || t.state === "out-of-scope";
	const counted = tickets.filter((t) => t.state !== "out-of-scope");
	const front = tickets.filter((t) => (t.state === "open" && !t.blockedBy.length) || t.blockedBy.every((b) => { const bt = tickets.find((t2) => t2.id === b); return bt ? closed(bt) : true; }));
	return { done: counted.filter((t) => t.state === "done").length, total: counted.length, ready: front.map((t) => t.id), waiting: front.filter((t) => t.mode === "hitl").map((t) => t.id) };
}

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number): string { return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`; }

function gitBranch(root: string): string {
	try { return execSync("git rev-parse --abbrev-ref HEAD", { cwd: root, encoding: "utf8", timeout: 2000 }).trim(); } catch { return ""; }
}

function sessionDuration(start: number): string {
	const sec = Math.floor((Date.now() - start) / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	return `${Math.floor(min / 60)}h${min % 60}m`;
}

// ── extension entry ────────────────────────────────────────────────────────

export function installStarship(pi: ExtensionAPI): void {
	let root = process.cwd();
	let sessionStart = Date.now();
	let kernCount = 0;
	let lastFrame = "";
	let timer: ReturnType<typeof setInterval> | undefined;

	pi.on("tool_call", (event: any) => {
		if (event?.toolName?.startsWith("kern_")) kernCount++;
	});

	pi.on("session_start", (_event: any, ctx: any) => {
		root = ctx.projectRoot ?? root;
		sessionStart = Date.now();
		kernCount = 0;
		lastFrame = "";
	});

	function renderWidget(ctx: any): void {
		try {
			if (!ctx?.ui) return;

			let input = 0, output = 0, cost = 0;
			try {
				for (const e of ctx.sessionManager?.getBranch() ?? []) {
					if (e.type === "message" && (e.message as AssistantMessage).role === "assistant") {
						const m = e.message as AssistantMessage;
						input += m.usage?.input ?? 0;
						output += m.usage?.output ?? 0;
						cost += m.usage?.cost?.total ?? 0;
					}
				}
			} catch { /* session not ready */ }

			const segments: string[] = [];

			const tok = input + output;
			if (tok > 0) segments.push(`${CYAN}↑${fmt(input)} ↓${fmt(output)}${RESET}`);

			if (kernCount > 0) segments.push(`${GREEN}◆ ${kernCount}${RESET}`);

			const frontierDir = join(root, "gantt");
			if (existsSync(frontierDir)) {
				const c = frontierCursor(frontierDir);
				if (c) {
					const parts = [`${c.done}/${c.total}`];
					if (c.ready.length) parts.push(c.ready[0]!);
					if (c.waiting.length) parts.push(`!${c.waiting.length}`);
					segments.push(`${YELLOW}◈ ${parts.join(" ")}${RESET}`);
				}
			}

			const branch = gitBranch(root);
			if (branch) segments.push(`${MAGENTA}⎇ ${branch}${RESET}`);

			if (cost > 0) segments.push(`${BLUE}$${cost.toFixed(4)}${RESET}`);

			// Session duration is the always-present anchor: pure arithmetic, no
			// flaky git/session I/O, so the session line renders after every settle
			// even when every other segment is empty.
			segments.push(`${DIM}◷ ${sessionDuration(sessionStart)}${RESET}`);

			const line = segments.join(`${DIM} · ${RESET}`);
			if (line === lastFrame) return;
			lastFrame = line;

			const width = process.stdout.columns ?? 80;
			const wrapped = truncateToWidth(` ${line} `, width);
			ctx.ui.setWidget(WIDGET_KEY, [wrapped], { placement: "belowEditor" });
		} catch (err) {
			console.error("[pi-ui] starship render error:", (err as Error).message);
		}
	}

	pi.on("agent_settled", (_event: any, ctx: any) => renderWidget(ctx));
	pi.on("turn_end", (_event: any, ctx: any) => renderWidget(ctx));

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

	pi.on("session_start", (_event: any, ctx: any) => {
		try {
			if (timer) { clearInterval(timer); timer = undefined; }
			startClock(ctx);
		} catch (err) {
			console.error("[pi-ui] starship session_start error:", (err as Error).message);
		}
	});

	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
		lastFrame = "";
	});
}