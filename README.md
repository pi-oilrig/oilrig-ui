# pi-ui

Unified TUI for [pi](https://github.com/badlogic/pi-mono). One package, one
editor slot, no double-loading.

Replaces: `pi-open-tui`, `pi-atuin`, `supi-prompt-suggestions`, `pi-chrome`,
`pi-starship`, and windmill's `advanced-input.ts`.

## What it does

| Module | What |
|--------|------|
| **style** | Terse + ADHD-friendly output discipline in system prompt, subagent injection, per-turn reminder. `normal mode` to disable. |
| **editor** | Owns the editor slot. Stack: selection (shift+arrows, ctrl+c/v/x, ctrl+shift+a, shift+del), history (↑ this session, shift+↑/ctrl+r all sessions fuzzy picker), `:q` shutdown, left bar (model + thinking level), gantt board integration. |
| **chrome** | Suppresses open-tui welcome header, silences ponytail toast/status, wraps footer with colored extension-status rows + version tag. |
| **starship** | Single-line widget below editor: model, tokens (↑in ↓out), kern ops, frontier cursor, git branch, session duration. |

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
| `shift+↑` (empty) | Fuzzy history picker — all sessions |
| `ctrl+r` | Fuzzy history picker — anywhere |

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