# Runtime Error Report — oilrig-ui

## Errors Found

### 1. Editor top border overflow (CRITICAL — fixed)

**File:** `extensions/editor.ts` — `installLeftBar()`

**Error:** `Rendered line 6 exceeds terminal width (175 > 142)`

**Cause:** The function prepended the model label (` deepseek/deepseek-v4-flash high `)
to the editor's top border (`─.repeat(width)`) without reducing the separator width.
Total: barWidth + width > terminal width.

**Fix:** Truncate the separator to `width - barWidth` before prepending.

### 2. Editor theme.selectList is undefined (CRITICAL — fixed)

**File:** `extensions/editor.ts` — `stackWithTui()` and `absorb()` fallback

**Error:** `TypeError: Cannot read properties of undefined (reading 'selectedText')`
at `SelectList.renderItem` → `SelectList.render` → `Editor.render`

**Call stack:**
```
SelectList.renderItem (select-list.js:104)
  at SelectList.render (select-list.js:54)
    at CustomEditor.render (editor.js:468)
      at editor.render (editor.ts:310) installSelection wrapper
        at editor.render (editor.ts:506) installLeftBar wrapper
          at editor.render (editor.ts:521) installGanttBoard wrapper
```

**Cause:** `editorTheme` was constructed as `{ borderColor, selectList: theme.selectList }`.
The `Theme` class has no `selectList` property — it's `undefined`. The `SelectList`
constructor receives `undefined` and crashes on `this.theme.selectedText()`.
The bug existed in **both** `stackWithTui()` and the fallback path in `absorb()`.

**Fix:** Use `getSelectListTheme()` from `@earendil-works/pi-coding-agent` instead of
`theme.selectList` in both code paths.

### 2b. Catch-block recursion (CRITICAL — fixed)

**File:** `extensions/editor.ts` — all render wrapper catch blocks

**Error:** After catching the SelectList crash, the catch blocks called
`origRender(width)` (the inner render function) which threw the same error again,
creating a cascading chain of caught errors that eventually escaped as an
uncaught exception.

**Call trace:**
```
ganttBoard catch → origRender (leftBar) → throw → leftBar catch → origRender (selection) → throw → selection catch → origRender (CustomEditor) → throw → UNCAUGHT
```

**Fix:** Return `[" ".repeat(width)]` (an empty line) in catch blocks instead of
re-calling the failing render function.

### 3. ctx.ui.keybindings is undefined (CRITICAL — fixed)

**File:** `extensions/editor.ts` — `InputStack.absorb()`, line ~534

**Error:** `TypeError: Cannot read properties of undefined (reading 'matches')`
at `CustomEditor.handleInput`

**Cause:** `ctx.ui.keybindings` — the extension UI context doesn't expose a
`keybindings` property. The `CustomEditor` constructed without keybindings crashes
on the next keystroke.

**Fix:** Use `getKeybindings()` from `@earendil-works/pi-tui` (returns the module-level
singleton set by the interactive mode).

### 4. Missing error boundaries (MEDIUM — fixed)

All event handlers, render wrappers, and callback listeners lacked try-catch.
Any runtime error crashes pi entirely. Added `[oilrig-ui]`-prefixed console.error
fallthroughs in:

- `installStyle()` — all pi.on handlers
- `installEditor()` — session_start, input handlers
- `installSelection()` — onExtensionShortcut, render wrapper
- `installHistory()` — onExtensionShortcut wrapper
- `installLeftBar()` — render wrapper
- `installGanttBoard()` — render wrapper
- `installStarship()` — renderWidget, clock, session_start
- `installChrome()` — entire function body

## Recommendations

1. Add a CI step that runs the editor with various edge-case scenarios
   (empty model, missing session, rapid input) to catch regressions.
2. The `InputStack` prototype-reparenting pattern (`Object.setPrototypeOf`)
   is fragile — consider using explicit delegation instead.
3. `process.stdout.columns` in starship.ts should use the TUI's terminal
   object instead, to stay in sync with resize events.
