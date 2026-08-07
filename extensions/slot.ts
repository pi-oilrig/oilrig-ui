// slot.ts — the client side of the web surface registry, for oilrig-ui's own modules.
//
// Extension load order is not fixed, so a module may register before the
// web surface's install has published globalThis.__web. Registrations made
// early queue on globalThis.__webPending and the panel drains them.
// Other packages inline the same six lines rather than import across a package
// boundary — this file is not a shared library, it is ui's copy.

export interface WebSlot {
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

export function web(): any {
	return (globalThis as any).__web;
}

export function registerSlot(spec: WebSlot): void {
	const api = web();
	if (api && typeof api.register === "function") {
		api.register(spec);
		return;
	}
	((globalThis as any).__webPending ??= []).push(spec);
}

export function unregisterSlot(id: string): void {
	const api = web();
	if (api && typeof api.unregister === "function") api.unregister(id);
	const pending = (globalThis as any).__webPending;
	if (Array.isArray(pending)) {
		const i = pending.findIndex((s: WebSlot) => s.id === id);
		if (i >= 0) pending.splice(i, 1);
	}
}

export function repaintSlots(): void {
	web()?.repaint?.();
}
