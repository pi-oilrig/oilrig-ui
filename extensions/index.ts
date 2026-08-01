// pi-ui — unified TUI extension.
//
// Wires every UI module into one session_start hook, owns the editor slot,
// the footer, and the style prompt. No external UI packages needed — this
// replaces pi-open-tui, pi-atuin, supi-prompt-suggestions, pi-chrome,
// pi-starship, and windmill's advanced-input.ts in one package.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installStyle } from "./style.ts";
import { installChrome } from "./chrome.ts";
import { installEditor } from "./editor.ts";
import { installStarship } from "./starship.ts";

export default function (pi: ExtensionAPI) {
	// Style prompt — terse+ADHD on every turn, subagent injection, reminder
	installStyle(pi);

	// Editor stack — selection, history, :q, gantt board, left bar
	installEditor(pi);

	// Starship widget — model, tokens, kern, frontier, git, duration
	installStarship(pi);

	// Chrome wraps — header/footer suppression, status line, version tag
	// Must be last so it wraps whatever footer the editor installs
	pi.on("session_start", (_event: any, ctx: any) => {
		installChrome(ctx);
	});
}