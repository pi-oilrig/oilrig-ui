// Questionnaire — the agent asks, the user answers, in an overlay.
//
// Lives in pi-ui because it is an interactive surface over the editor slot,
// the same reason the billboard panel lives here: one owner for chrome,
// keybindings and the ui.custom overlay.
//
// What it adds over a plain option list: each question carries a briefing —
// the problem being decided, a short explanation of the tradeoff, and the
// reason behind the recommendation — so the user answers with context instead
// of guessing what the bare prompt means. The agent may mark options as its
// recommendation (★), and `c` copies the highlighted option into an editable
// draft. From the draft, enter ADDS it as an extra option (the original
// survives) and ctrl+s REPLACES the original with the rewrite. Either way the
// answer records what it was based on, so the agent sees its recommendation
// was edited rather than just a bare string.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// The width handed to a custom render can exceed the real terminal width (a
// pi-tui region-sizing quirk), so every line is capped to `process.stdout.columns`.
// Without this, `─`.repeat(w) overflowed and crashed pi on a 140-col terminal.
const termCols = (): number =>
	typeof process !== "undefined" && process.stdout && process.stdout.columns ? process.stdout.columns : 0;
import { Type } from "typebox";

interface Opt {
	value: string;
	label: string;
	description?: string;
	recommended?: boolean;
	origin?: "agent" | "added" | "rewritten";
	basedOn?: string;
}

interface Question {
	id: string;
	label: string;
	prompt: string;
	problem?: string;
	explanation?: string;
	recommendation?: string;
	options: Opt[];
	allowOther: boolean;
}

interface Answer {
	id: string;
	value: string;
	label: string;
	mode: "picked" | "added" | "replaced" | "wrote";
	basedOn?: string;
	wasRecommended: boolean;
}

interface Result {
	answers: Answer[];
	cancelled: boolean;
}

const OptSchema = Type.Object({
	value: Type.String({ description: "value returned when this option wins" }),
	label: Type.String({ description: "one-line display label" }),
	description: Type.Optional(Type.String({ description: "second line, dimmed" })),
	recommended: Type.Optional(
		Type.Boolean({ description: "mark as your recommendation — starred and pre-selected" }),
	),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "unique id for this question" }),
	label: Type.Optional(Type.String({ description: "short tab label, e.g. 'Scope' (default Q1, Q2)" })),
	prompt: Type.String({ description: "the question as asked, one line" }),
	problem: Type.Optional(
		Type.String({
			description:
				"what is actually being decided and why it came up — the situation in the code or the task that forces a choice (1-3 sentences)",
		}),
	),
	explanation: Type.Optional(
		Type.String({
			description:
				"short explanation of what separates the options — the tradeoff, cost or consequence the user is weighing (1-3 sentences)",
		}),
	),
	recommendation: Type.Optional(
		Type.String({
			description: "why you recommend the starred option — your reasoning, not a restatement of its label",
		}),
	),
	options: Type.Array(OptSchema, { description: "options, best first; mark one recommended" }),
	allowOther: Type.Optional(Type.Boolean({ description: "offer a free-text option (default true)" })),
});

const Params = Type.Object({
	questions: Type.Array(QuestionSchema, { description: "one or more questions to ask" }),
});

const OTHER = "__other__";

function normalize(raw: any[]): Question[] {
	return raw.map((q, i) => ({
		id: String(q.id ?? `q${i + 1}`),
		label: String(q.label || `Q${i + 1}`),
		prompt: String(q.prompt ?? ""),
		problem: q.problem ? String(q.problem) : undefined,
		explanation: q.explanation ? String(q.explanation) : undefined,
		recommendation: q.recommendation ? String(q.recommendation) : undefined,
		allowOther: q.allowOther !== false,
		options: (q.options ?? []).map((o: any) => ({
			value: String(o.value ?? o.label ?? ""),
			label: String(o.label ?? o.value ?? ""),
			description: o.description ? String(o.description) : undefined,
			recommended: o.recommended === true,
			origin: "agent" as const,
		})),
	}));
}

function bail(text: string): any {
	return { content: [{ type: "text", text }], details: { answers: [], cancelled: true } };
}

export function installQuestionnaire(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description:
			"Ask the user one or more questions in a TUI overlay. Brief each question first — `problem` (what is being decided and why it came up), `explanation` (what separates the options) and `recommendation` (why you recommend the starred one) — then give a few concrete options and mark one `recommended`. The user picks it, or presses `c` to rewrite it into an extra option. Use it to settle requirements, preferences and decisions instead of guessing.",
		parameters: Params,

		async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
			if (ctx.mode !== "tui") return bail("questionnaire needs the TUI (non-interactive mode)");
			const questions = normalize(params.questions ?? []);
			if (questions.length === 0) return bail("questionnaire: no questions given");

			const multi = questions.length > 1;
			const tabs = questions.length + 1;

			const result: Result = await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (r: Result) => void) => {
				let tab = 0;
				let sel = 0;
				let draft: { qid: string; from?: Opt } | null = null;
				let notice: string | null = null;
				let cache: string[] | undefined;
				const answers = new Map<string, Answer>();

				const edTheme: EditorTheme = {
					borderColor: (s: string) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t: string) => theme.fg("accent", t),
						selectedText: (t: string) => theme.fg("accent", t),
						description: (t: string) => theme.fg("muted", t),
						scrollInfo: (t: string) => theme.fg("dim", t),
						noMatch: (t: string) => theme.fg("warning", t),
					},
				};
				const editor = new Editor(tui, edTheme);

				const refresh = () => {
					cache = undefined;
					tui.requestRender();
				};
				const q = () => questions[tab];
				const rows = (): Opt[] => {
					const cur = q();
					if (!cur) return [];
					return cur.allowOther
						? [...cur.options, { value: OTHER, label: "Write your own…", origin: "agent" as const }]
						: cur.options;
				};
				const answered = () => questions.every((x) => answers.has(x.id));

				const startAt = (i: number) => {
					const cur = questions[i];
					if (!cur) return 0;
					const prev = answers.get(cur.id);
					if (prev) {
						const at = cur.options.findIndex((o) => o.value === prev.value);
						if (at >= 0) return at;
					}
					const rec = cur.options.findIndex((o) => o.recommended);
					return rec >= 0 ? rec : 0;
				};

				const goTab = (i: number) => {
					tab = ((i % tabs) + tabs) % tabs;
					sel = startAt(tab);
					notice = null;
					refresh();
				};

				const save = (a: Answer) => {
					answers.set(a.id, a);
					if (!multi) {
						done({ answers: [...answers.values()], cancelled: false });
						return;
					}
					goTab(tab < questions.length - 1 ? tab + 1 : questions.length);
				};

				const pick = (o: Opt) => {
					const cur = q();
					if (!cur) return;
					save({
						id: cur.id,
						value: o.value,
						label: o.label,
						mode: o.origin === "added" ? "added" : o.origin === "rewritten" ? "replaced" : "picked",
						basedOn: o.basedOn,
						wasRecommended: o.recommended === true,
					});
				};

				const openDraft = (from?: Opt) => {
					const cur = q();
					if (!cur) return;
					draft = { qid: cur.id, from };
					editor.setText(from ? from.label : "");
					notice = null;
					refresh();
				};

				const closeDraft = () => {
					draft = null;
					editor.setText("");
					refresh();
				};

				const commitDraft = (replace: boolean) => {
					const cur = q();
					const text = editor.getText().trim();
					if (!cur || !draft) return;
					if (!text) {
						notice = "empty — write something or esc to cancel";
						refresh();
						return;
					}
					const from = draft.from;
					if (replace && from) {
						const was = from.basedOn ?? from.value;
						from.label = text;
						from.value = text;
						from.origin = "rewritten";
						from.basedOn = was;
						from.description = undefined;
						closeDraft();
						pick(from);
						return;
					}
					const added: Opt = {
						value: text,
						label: text,
						origin: from ? "added" : "agent",
						basedOn: from?.value,
					};
					const at = from ? cur.options.indexOf(from) + 1 : cur.options.length;
					cur.options.splice(at, 0, added);
					sel = at;
					closeDraft();
					if (!from) {
						save({ id: cur.id, value: text, label: text, mode: "wrote", wasRecommended: false });
						return;
					}
					pick(added);
				};

				const handleInput = (data: string) => {
					if (draft) {
						if (matchesKey(data, Key.escape)) return closeDraft();
						if (matchesKey(data, "ctrl+s")) return commitDraft(true);
						if (matchesKey(data, Key.enter)) return commitDraft(false);
						editor.handleInput(data);
						refresh();
						return;
					}
					if (multi) {
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) return goTab(tab + 1);
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) return goTab(tab - 1);
					}
					if (tab === questions.length) {
						if (matchesKey(data, Key.enter) && answered())
							return done({ answers: [...answers.values()], cancelled: false });
						if (matchesKey(data, Key.escape)) return done({ answers: [], cancelled: true });
						return;
					}
					const opts = rows();
					if (matchesKey(data, Key.up)) {
						sel = Math.max(0, sel - 1);
						return refresh();
					}
					if (matchesKey(data, Key.down)) {
						sel = Math.min(opts.length - 1, sel + 1);
						return refresh();
					}
					if (data === "c" || data === "C") {
						const o = opts[sel];
						if (!o || o.value === OTHER) return openDraft();
						return openDraft(o);
					}
					if (matchesKey(data, Key.enter)) {
						const o = opts[sel];
						if (!o) return;
						if (o.value === OTHER) return openDraft();
						return pick(o);
					}
					if (matchesKey(data, Key.escape)) done({ answers: [], cancelled: true });
				};

				const render = (width: number): string[] => {
					if (cache) return cache;
					const tc = termCols();
					const w = Math.max(20, tc ? Math.min(width, tc) : width);
					const out: string[] = [];
					const put = (prefix: string, text: string) => {
						const pw = visibleWidth(prefix);
						if (pw >= w) {
							out.push(...wrapTextWithAnsi(prefix + text, w));
							return;
						}
						const wrapped = wrapTextWithAnsi(text, w - pw);
						for (let i = 0; i < wrapped.length; i++)
							out.push((i === 0 ? prefix : " ".repeat(pw)) + wrapped[i]);
					};
					const rule = () => out.push(theme.fg("dim", "─".repeat(w)));

					rule();
					if (multi) {
						const bar = questions.map((x, i) => {
							const mark = answers.has(x.id) ? "■" : "□";
							const t = ` ${mark} ${x.label} `;
							return i === tab ? theme.bg("selectedBg", theme.fg("text", t)) : theme.fg(answers.has(x.id) ? "success" : "muted", t);
						});
						const sub = " ✓ submit ";
						bar.push(
							tab === questions.length
								? theme.bg("selectedBg", theme.fg("text", sub))
								: theme.fg(answered() ? "success" : "dim", sub),
						);
						put(" ", bar.join(theme.fg("dim", "·")));
						out.push("");
					}

					const cur = q();
					if (tab === questions.length) {
						put(" ", theme.bold(theme.fg("accent", "ready to submit")));
						out.push("");
						for (const x of questions) {
							const a = answers.get(x.id);
							const val = a
								? `${a.mode === "picked" ? "" : `(${a.mode}) `}${a.label}`
								: theme.fg("warning", "—");
							put(" ", `${theme.fg("muted", `${x.label}: `)}${theme.fg("text", val)}`);
						}
						out.push("");
						put(
							" ",
							answered()
								? theme.fg("success", "enter submit · tab back")
								: theme.fg("warning", `unanswered: ${questions.filter((x) => !answers.has(x.id)).map((x) => x.label).join(", ")}`),
						);
						rule();
						cache = out;
						return out;
					}
					if (!cur) {
						rule();
						cache = out;
						return out;
					}

					put(" ", theme.bold(theme.fg("text", cur.prompt)));
					if (cur.problem) {
						out.push("");
						put(" ", theme.fg("text", cur.problem));
					}
					if (cur.explanation) {
						out.push("");
						put(" ", theme.fg("muted", cur.explanation));
					}
					if (cur.recommendation) {
						out.push("");
						put(theme.fg("success", " ★ "), theme.fg("muted", cur.recommendation));
					}
					out.push("");
					const opts = rows();
					for (let i = 0; i < opts.length; i++) {
						const o = opts[i];
						const on = i === sel && !draft;
						const star = o.recommended ? theme.fg("success", "★ ") : "  ";
						const tag =
							o.origin === "added"
								? theme.fg("dim", " (yours)")
								: o.origin === "rewritten"
									? theme.fg("dim", " (edited)")
									: "";
						put(
							on ? theme.fg("accent", "> ") : "  ",
							`${star}${theme.fg(on ? "accent" : "text", `${i + 1}. ${o.label}`)}${tag}`,
						);
						if (o.description) put("      ", theme.fg("muted", o.description));
					}

					if (draft) {
						out.push("");
						put(" ", theme.fg("muted", draft.from ? `rewriting: ${draft.from.label}` : "your own answer:"));
						for (const l of editor.render(Math.max(10, w - 2))) out.push(` ${l}`);
					}
					if (notice) {
						out.push("");
						put(" ", theme.fg("warning", notice));
					}
					out.push("");
					put(
						" ",
						theme.fg(
							"dim",
							draft
								? draft.from
									? "enter add as new option · ctrl+s replace the original · esc cancel"
									: "enter answer · esc cancel"
								: `↑↓ pick · enter choose · c rewrite${multi ? " · tab next" : ""} · esc cancel`,
						),
					);
					rule();
					cache = out;
					return out;
				};

				goTab(0);
				return { render, invalidate: () => { cache = undefined; }, handleInput };
			});

			if (!result || result.cancelled)
				return { content: [{ type: "text", text: "User cancelled the questionnaire" }], details: result ?? { answers: [], cancelled: true } };

			const lines = result.answers.map((a) => {
				const label = questions.find((x) => x.id === a.id)?.label ?? a.id;
				const how =
					a.mode === "picked"
						? `selected${a.wasRecommended ? " (your recommendation)" : ""}`
						: a.mode === "replaced"
							? `rewrote your option${a.basedOn ? ` "${a.basedOn}"` : ""} and used it instead`
							: a.mode === "added"
								? `added their own option${a.basedOn ? ` based on "${a.basedOn}"` : ""}`
								: "wrote";
				return `${label}: user ${how}: ${a.label}`;
			});
			return { content: [{ type: "text", text: lines.join("\n") }], details: result };
		},

		renderCall(args: any, theme: any) {
			const qs = args?.questions ?? [];
			const labels = qs.map((x: any, i: number) => x.label || x.id || `Q${i + 1}`).join(", ");
			return new Text(
				theme.fg("toolTitle", theme.bold("questionnaire ")) +
					theme.fg("muted", `${qs.length} question${qs.length === 1 ? "" : "s"}`) +
					(labels ? theme.fg("dim", ` (${labels})`) : ""),
				0,
				0,
			);
		},

		renderResult(result: any, _o: any, theme: any) {
			const d = result?.details as Result | undefined;
			if (!d) return new Text(result?.content?.[0]?.text ?? "", 0, 0);
			if (d.cancelled) return new Text(theme.fg("warning", "cancelled"), 0, 0);
			return new Text(
				d.answers
					.map(
						(a) =>
							`${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${a.mode === "picked" ? "" : theme.fg("muted", `(${a.mode}) `)}${a.label}`,
					)
					.join("\n"),
				0,
				0,
			);
		},
	});
}
