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
| **chrome** | Suppresses open-tui welcome header, wraps the footer. Each footer line is one left/right pair, ordered by importance: line 1 version tag + cwd against the context bar, line 2 pi's own tokens/cost against the model, lines 3+ the extension statuses two per line by rank. No borders, no side rails, no greedy packing. |
| **context** | Session context usage as a compact bar (`████████░░ 73%`, green→amber→red) on the `context` status key, which chrome lifts out by name onto the right of footer line 1. |
| **starship** | Session telemetry — duration, turns, TPS, TTFT, tokens, stalls. Not a widget of its own: it is the first **billboard** slot (one line in the strip, a broken-out card with the in/out split in the overlay). |
| **questionnaire** | The `questionnaire` tool: the agent asks one or more questions in an overlay. Each question is briefed — `problem` (what is being decided and why it came up), `explanation` (what separates the options) and `recommendation` (why the starred option) render above the list, so the user answers with context. One option is marked `recommended` (★, pre-selected); the user picks it, rewrites it (`c`) or writes their own. The answer carries *how* it was reached — picked / added / replaced — so a rewritten recommendation reads as a rewrite, not a bare string. |
| **billboard** | **The one info surface.** A min strip in the only `belowEditor` widget, a max overlay on `f2` / `/billboard`. Every package that used to own a widget or an info overlay registers a slot here instead — see below. |

## The billboard is the only widget

There is exactly one `belowEditor` widget in a session and exactly one info
overlay, and pi-ui owns both. Before this, seven other callers of
`ctx.ui.setWidget` stacked their own blocks under the editor beside the
billboard's, and one of them (the timeline's focus mode) opened a second
info overlay on top. Input dialogs — `questionnaire`, ontology's `btw` — are not
info overlays and stay as modals.

| Mode | What | Key |
|------|------|-----|
| **min** | The widget: the title, then every `row` slot, packed to the terminal width across as many lines as they need. | default |
| **max** | Full-width overlay: every slot's card body, sectioned by title, scrollable, with `Tab` cycling focus through interactive slots. | `f2` |

The **title heads both renders** (`/billboard title <text>`, or
`globalThis.__billboard.setTitle()` — gantt sets it to its board URL, plain text
the terminal linkifies). Built-ins: turn count, last input, and items
(`/billboard add|done|clear|list`).

### Registering a slot

```ts
globalThis.__billboard.register({
  id: "jobs",
  title: "jobs",          // section heading in max
  priority: 40,           // sort order, low first
  size: "row" | "card",   // row = also in the min strip
  row:    (width) => string[],   // min body (defaults to render)
  render: (width) => string[],   // max body
  focusable: true,               // Tab stops here
  onInput: (data) => boolean,    // true swallows the key, false hands it back
  onFocus / onBlur: () => void,
});
```

Extension load order is not fixed, so a package whose install runs before
pi-ui's pushes onto `globalThis.__billboardPending` instead; the panel drains
the queue on install and on `session_start`. Everything else on the API:
`unregister(id)`, `setTitle(t)`, `repaint()`, `open(focusId?)`, `close()`,
`mode()`, `list()`. Slot admin from the command line:
`/billboard slots|hide <id>|show <id>|focus <id>`.

A slot that throws degrades to a single red error line — it never takes the
panel down.

### Who registers what

| Slot | Package | Row (min) | Card (max) |
|------|---------|-----------|------------|
| `starship` | pi-ui | telemetry one-liner | the same numbers, one per line, + in/out split |
| `gantt` | pi-gantt | mode badge + `done/total` | the rolling-lane timeline chart |
| `timeline` | pi-until | the plan's dot row | the plan as an **interactive** list (focusable) |
| `rigor` | pi-rigor | `✗ n checks` (failures only) | each failing check + its tail |
| `watch` | pi-file-awareness | `◈ n files` | file count, fires, last fire, the armed prompt |
| `launch` | pi-launch | `n up` / `n failed` | one block per job + its newest log line |
| `loop` | pi-until | `n loops` | interval, fire count, next fire, message |

Long-lived state keeps its **footer** entry as well (`setStatus`) — the UI
invariant is unchanged: per-message data belongs in the strip, session/process
data in the status bar.

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
| `f2` | Toggle the billboard panel (min strip ↔ max overlay) |
| `tab` (max) | Cycle focus through interactive slots; `shift+tab` back |
| `j` `k` / `↑` `↓` / `PgUp` `PgDn` / `g` (max) | Scroll the overlay when it overflows |
| `escape` (max) | Leave the focused slot, then close the panel; `q` closes outright |

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