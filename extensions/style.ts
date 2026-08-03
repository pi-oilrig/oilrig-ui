// style — terse + ADHD-friendly output discipline, always on.
// Off: "normal mode". No commands, no toggles, no config files.
//
// Subagent children spawn with --no-extensions, so the style never loads in
// them. Inject the directive into the child's task string via tool_call instead.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT = `Output discipline — terse + ADHD-friendly. Always active.

## Terseness
Drop articles (a/an/the), filler (just/really/basically), pleasantries, hedging. Fragments OK. Short synonyms (big not extensive). No tool-call narration, no decorative tables/emoji, no long raw logs — quote shortest decisive line. Known acronyms OK (DB/API/HTTP); never invent abbreviations (cfg/impl/req). Technical terms, code, API names, CLI commands, errors: byte-exact. Compress thinking too — never restate the task, no essays inside reasoning.

## ADHD-friendly
1. Lead with next action — command, path, or snippet first.
2. Number multi-step tasks — each step one bounded action.
3. End with one concrete next step — doable in under two minutes.
4. Suppress tangents — finish first, offer second separately.
5. Restate state every turn — "Step 3 of 5 done."
6. Specific time estimates — "~15 min" not "a bit of work."
7. Make completed work visible — show what now works concretely.
8. Matter-of-fact errors — state cause and fix, never "Uh oh."
9. Cap lists at 5 items — split "do now" vs "later."
10. No preamble, no recap, no closers — start with answer, end when done.

Code, commit messages, PR text: always normal. Security warnings, irreversible actions: full sentences. Off: "normal mode".`;

const REMINDER =
	"[style] Terse + ADHD. Lead with action, drop filler, number steps, one next step, no preamble/closers.";

const SUBAGENT_DIRECTIVE =
	"[subagent] Terse + ADHD-friendly: bare fragments, drop articles/filler/pleasantries. Lead with next action, number steps, suppress tangents, cap lists at 5. No preamble/recap/closers. Compress reasoning — never restate task.";

const MARKER = "<!--style-subagent-->";
const REMINDER_MARKER = "<!--style-reminder-->";

const SUBAGENT_TOOLS = new Set(["subagent"]);

function setUserText(msg: any, text: string): any {
	const content = msg?.content;
	if (typeof content === "string") return { ...msg, content: text };
	if (Array.isArray(content)) {
		const idx = content.findIndex((b: any) => b?.type === "text");
		if (idx === -1) return msg;
		const next = content.slice();
		next[idx] = { ...next[idx], text };
		return { ...msg, content: next };
	}
	return msg;
}

function userText(msg: any): string | null {
	const content = msg?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const block = content.find((b: any) => b?.type === "text");
		return block?.text ?? null;
	}
	return null;
}

function injectSubagentTasks(input: any): void {
	const apply = (obj: any) => {
		if (!obj || typeof obj !== "object") return;
		const t = obj.task;
		if (typeof t === "string" && t.length > 0 && !t.includes(MARKER)) {
			obj.task = `${t}\n\n${MARKER}\n${SUBAGENT_DIRECTIVE}`;
		}
		if (Array.isArray(obj.tasks)) obj.tasks.forEach(apply);
		if (Array.isArray(obj.chain)) obj.chain.forEach(apply);
		if (Array.isArray(obj.parallel)) obj.parallel.forEach(apply);
	};
	apply(input);
}

export function installStyle(pi: ExtensionAPI): void {
	let active = true;
	let doctrineSent = false;

	pi.on("input", async (event: any) => {
		try {
			if (event?.source === "extension") return;
			if (String(event?.text || "").trim().toLowerCase() === "normal mode") {
				active = false;
			}
		} catch (err) {
			console.error("[pi-ui] style input error:", (err as Error).message);
		}
	});

	pi.on("session_start", async () => {
		active = true;
		doctrineSent = false;
	});

	pi.on("before_agent_start", async (event: any, ctx: any) => {
		try {
			if (!active) return;
			// The 1.3KB discipline essay is sent once per session (and re-sent
			// after a history clear). The 102B REMINDER, appended per user
			// message by the context hook below, carries the drift suppression.
			const entries = ctx?.sessionManager?.getEntries?.() ?? [];
			if (doctrineSent && entries.length > 0) return;
			doctrineSent = true;
			return { systemPrompt: `${event.systemPrompt}\n\n${SYSTEM_PROMPT}` };
		} catch (err) {
			console.error("[pi-ui] style before_agent_start error:", (err as Error).message);
		}
	});

	pi.on("tool_call", async (event: any) => {
		try {
			if (!active) return;
			if (!event || typeof event !== "object") return;
			if (!SUBAGENT_TOOLS.has(event.toolName)) return;
			const input = event.input;
			if (!input || typeof input !== "object") return;
			injectSubagentTasks(input);
		} catch (err) {
			console.error("[pi-ui] style tool_call error:", (err as Error).message);
		}
	});

	pi.on("context", async (event: any) => {
		try {
			if (!active) return;
			const messages = event?.messages;
			if (!Array.isArray(messages) || messages.length === 0) return;
			let lastUserIdx = -1;
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i]?.role === "user") { lastUserIdx = i; break; }
			}
			if (lastUserIdx === -1) return;
			const msg = messages[lastUserIdx];
			const text = userText(msg);
			if (text === null || text.includes(REMINDER_MARKER)) return;
			const reminded = `${text}\n\n${REMINDER_MARKER}\n${REMINDER}`;
			const next = messages.slice();
			next[lastUserIdx] = setUserText(msg, reminded);
			return { messages: next };
		} catch (err) {
			console.error("[pi-ui] style context error:", (err as Error).message);
		}
	});
}