# pi-ui

Unified TUI for [pi](https://github.com/badlogic/pi-mono). One package, one
editor slot, no double-loading.

Replaces: `pi-open-tui`, `pi-atuin`, `supi-prompt-suggestions`, `pi-chrome`,
`pi-starship`, `pi-billboard`, and windmill's `advanced-input.ts`.

## What it does

| Module | What |
|--------|------|
| **style** | Terse + ADHD-friendly output discipline in system prompt, subagent injection, per-turn reminder. `normal mode` to disable. |
| **editor** | Owns the editor slot. Stack: selection (shift+arrows, ctrl+c/v/x, ctrl+shift+a, shift+del), history (↑ this session, shift+↑/ctrl+r = fuzzy menu over all sessions, rendered as pi's own autocomplete list so the input box stays live), `:q` shutdown, left bar (model + thinking level), gantt board integration. |
| **chrome** | Suppresses open-tui welcome header, silences ponytail toast/status, wraps footer with colored extension-status rows + version tag. |
| **starship** | Single-line widget below editor: model, tokens (↑in ↓out), kern ops, frontier cursor, git branch, session duration. |
| **questionnaire** | The `questionnaire` tool: the agent asks one or more questions in an overlay. Each question is briefed — `problem` (what is being decided and why it came up), `explanation` (what separates the options) and `recommendation` (why the starred option) render above the list, so the user answers with context. One option is marked `recommended` (★, pre-selected); the user picks it, rewrites it (`c`) or writes their own. The answer carries *how* it was reached — picked / added / replaced — so a rewritten recommendation reads as a rewrite, not a bare string. |
| **billboard** | Info panel: one-line strip in the widget, full overlay on `alt+p` / `/billboard`. Title, turn count, last input, items (`add`/`done`/`clear`/`list`), plus a slot registry on `globalThis.__billboard` that gantt and launch draw into (`register({ id, render, size, priority })`, `/billboard slots|hide|show`). |

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
| `alt+p` | Toggle the billboard panel (min strip ↔ max overlay); `escape` closes the overlay |

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