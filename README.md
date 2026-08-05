# pi-ui

Unified TUI for [pi](https://github.com/badlogic/pi-mono). One package, one
editor slot, no double-loading.

Replaces: `pi-open-tui`, `pi-atuin`, `supi-prompt-suggestions`, `pi-chrome`,
`pi-starship`, and windmill's `advanced-input.ts`.

## What it does

| Module | What |
|--------|------|
| **style** | Terse + ADHD-friendly output discipline in system prompt, subagent injection, per-turn reminder. `normal mode` to disable. |
| **editor** | Owns the editor slot. Stack: selection (shift+arrows, ctrl+c/v/x, ctrl+shift+a, shift+del), history (↑ this session, shift+↑/ctrl+r = fuzzy menu over all sessions, rendered as pi's own autocomplete list so the input box stays live), `:q` shutdown, left bar (model + thinking level), gantt board integration. |
| **chrome** | Suppresses open-tui welcome header, wraps the footer. Each footer line is one left/right pair, ordered by importance: line 1 version tag + cwd against the context bar, line 2 pi's own tokens/cost against the model, lines 3+ the extension statuses two per line by rank. No borders, no side rails, no greedy packing. |
| **context** | Session context usage as a compact bar (`████████░░ 73%`, green→amber→red) on the `context` status key, which chrome lifts out by name onto the right of footer line 1. |
| **starship** | Session telemetry — duration, turns, TPS, TTFT, tokens, stalls. Not a widget of its own: it is the first **web** card (one line in the strip, a broken-out card with the in/out split). The info surface is the per-cwd local website (`pi-web`), not an in-pi panel — see that package. |
| **questionnaire** | The `questionnaire` tool: the agent asks one or more questions in an overlay. Each question is briefed — `problem` (what is being decided and why it came up), `explanation` (what separates the options) and `recommendation` (why the starred option) render above the list, so the user answers with context. One option is marked `recommended` (★, pre-selected); the user picks it, rewrites it (`c`) or writes their own. The answer carries *how* it was reached — picked / added / replaced — so a rewritten recommendation reads as a rewrite, not a bare string. |

## The info surface left the terminal

The info surface is a per-cwd local website, owned by the **`pi-web`** package
(`extensions/web/`), not an in-pi widget or overlay. `ui/extensions/billboard.ts`
was deleted in the A9 fold: extensions register HTML cards on
`globalThis.__web`, a detached node server serves them at `127.0.0.1:3344`, and
the browser polls `/state`. `f2` opens the board. The slot-registration docs
moved with the surface — see `extensions/web/README.md`. `ui` keeps the
**footer** (chrome wraps `ctx.ui.setStatus`), the editor, starship (now a
`__web` card), questionnaire, and context.

Long-lived state keeps its **footer** entry (`setStatus`) — the UI invariant is
unchanged on that axis: per-message data belongs on the web board,
session/process data in the status bar.

## Keys

| Key | Action |
|-----|--------|
| `:q` | Shutdown session |
| `shift+↑←↓→` | Extend selection |
| `ctrl+shift+←→` | Extend selection by word |
| `ctrl+shift+a` | Select all |
| `ctrl+c` | Copy (keeps selection) |
| `ctrl+x` | Cut |
| `shift+del` | Kill to end of line |
| `escape` | Drop selection |
| `↑` (empty) | Previous prompts this session |
| `shift+↑` (empty) | Fuzzy history menu — all sessions |
| `ctrl+r` | Fuzzy history menu — anywhere; type to filter, ↑/↓ to move, enter/tab to insert, escape to close |
| `f2` | Open the pi-web board in a browser |

### Questionnaire overlay

| Key | Action |
|-----|--------|
| `↑` `↓` | Move between options |
| `enter` | Choose the highlighted option (or open the draft on *Write your own…*) |
| `c` | Copy the highlighted option into an editable draft |
| `enter` (draft) | **Add** the edited text as a new option beside the original, and answer with it |
| `ctrl+s` (draft) | **Replace** the original option with the edited text, and answer with it |
| `tab` `shift+tab` `←` `→` | Move between questions (multi-question only); the last tab is submit |
| `escape` | Cancel the draft, or the whole questionnaire |

## Install

Remove these from `~/.pi/agent/settings.json` `packages`:
- `npm:pi-open-tui`
- `npm:pi-atuin`
- `npm:@mrclrchtr/supi-prompt-suggestions`

Then:
```
pi install git:github.com/yesitsfebreeze/pi-ui
```

## Development

```
npm test
```

Bump + push via `just push` inside the package directory.