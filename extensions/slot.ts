// slot.ts — the client side of the billboard registry, for pi-ui's own modules.
//
// Extension load order is not fixed, so a module may register before the
// billboard's install has published globalThis.__billboard. Registrations made
// early queue on globalThis.__billboardPending and the panel drains them.
// Other packages inline the same six lines rather than import across a package
// boundary — this file is not a shared library, it is ui's copy.

export interface BillboardSlot {
	id: string;
	title?: string;
	priority?: number;
	size?: "row" | "card";
	row?: (width: number) => string[];
	render: (width: number) => string[];
	hidden?: boolean;
	focusable?: boolean;
	onInput?: (data: string) => boolean | void;
	onFocus?: () => void;
	onBlur?: () => void;
}

export function billboard(): any {
	return (globalThis as any).__billboard;
}

export function registerSlot(spec: BillboardSlot): void {
	const api = billboard();
	if (api && typeof api.register === "function") {
		api.register(spec);
		return;
	}
	((globalThis as any).__billboardPending ??= []).push(spec);
}

export function unregisterSlot(id: string): void {
	const api = billboard();
	if (api && typeof api.unregister === "function") api.unregister(id);
	const pending = (globalThis as any).__billboardPending;
	if (Array.isArray(pending)) {
		const i = pending.findIndex((s: BillboardSlot) => s.id === id);
		if (i >= 0) pending.splice(i, 1);
	}
}

export function repaintSlots(): void {
	billboard()?.repaint?.();
}
