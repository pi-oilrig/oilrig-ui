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
import { installBillboard } from "./billboard.ts";
import { installQuestionnaire } from "./questionnaire.ts";

export default function (pi: ExtensionAPI) {
	// Style prompt — terse+ADHD on every turn, subagent injection, reminder
	installStyle(pi);

	// Editor stack — selection, history, :q, gantt board, left bar
	installEditor(pi);

	// Billboard — the one info surface: min strip in the belowEditor widget,
	// max overlay on alt+l, slot registry on globalThis.__billboard. Installed
	// before its own slot providers so they register directly rather than
	// through the pending queue.
	installBillboard(pi);

	// Starship — session telemetry, registered as the first billboard slot
	installStarship(pi);

	// Questionnaire — the agent asks, the user picks or rewrites (`c`), in an
	// overlay over the editor slot
	installQuestionnaire(pi);

	// Chrome wraps — header/footer suppression, status line, version tag
	// Must be last so it wraps whatever footer the editor installs
	pi.on("session_start", (_event: any, ctx: any) => {
		installChrome(ctx);
	});
}