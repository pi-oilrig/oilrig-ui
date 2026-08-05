// pi-ui — unified TUI extension.
//
// Wires every UI module into one session_start hook, owns the editor slot,
// the footer, and the style prompt. No external UI packages needed — this
// replaces pi-open-tui, pi-atuin, supi-prompt-suggestions, pi-chrome,
// pi-starship, pi-billboard, and windmill's advanced-input.ts in one package.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installStyle } from "./style.ts";
import { installChrome } from "./chrome.ts";
import { installEditor } from "./editor.ts";
import { installStarship } from "./starship.ts";
import { installQuestionnaire } from "./questionnaire.ts";
import { installContextTracker } from "./context.ts";

export default function (pi: ExtensionAPI) {
	// Style prompt — terse+ADHD on every turn, subagent injection, reminder
	installStyle(pi);

	// Editor stack — selection, history, :q, gantt board, left bar
	installEditor(pi);

	// The info surface is the per-cwd local website (pi-web), a separate
	// package: extensions register HTML cards on globalThis.__web and a
	// detached server serves them at 127.0.0.1. No in-pi widget or overlay.

	// Starship — session telemetry, registered as the first billboard slot
	installStarship(pi);

	// Questionnaire — the agent asks, the user picks or rewrites (`c`), in an
	// overlay over the editor slot
	installQuestionnaire(pi);

	// Context tracker — progress bar in the status bar
	installContextTracker(pi);

	// Chrome wraps — header/footer suppression, status line, version tag.
	// Installs the self-contained retro footer (folder/version/session-id +
	// tokens/model + extension statuses) via ctx.ui.setFooter().
	pi.on("session_start", (_event: any, ctx: any) => {
		installChrome(pi, ctx);
	});
}