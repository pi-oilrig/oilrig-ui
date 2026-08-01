// Shared TUI palette — raw SGR codes so both bars paint against the
// terminal's own 16-color theme (no pi-theme dependency, no throw on
// unknown color name). One authoritative palette for chrome + starship.

export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const BLUE = "\x1b[34m";
export const MAGENTA = "\x1b[35m";
export const CYAN = "\x1b[36m";
export const DIM = "\x1b[90m";
export const RESET = "\x1b[0m";
