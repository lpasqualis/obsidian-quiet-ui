import { Component, Platform, type App } from "obsidian";
import { readSyncState, type SyncState } from "./syncState";

/** LiveSync's status box in the editor (mobile and desktop) and its status-bar item (desktop). */
const EDITOR_STATUS = ".livesync-status";
const EDITOR_LINE = ".livesync-status-statusline";
const STATUS_BAR = ".syncstatusbar";

const DOT_CLASS = "quiet-ui-sync-dot";
const BODY_DOT = "quiet-ui-sync-as-dot";
const BODY_LINE = "quiet-ui-sync-as-line";
const EXPANDED_KEY = "quiet-ui-sync-expanded";
const STATES: SyncState[] = ["idle", "busy", "stopped", "unknown"];
/** How often the dot looks (ms): a phone's sync of one note is over in a fraction of a second. */
const TICK_MS = 250;
/** How long the dot keeps showing activity after the last sign of it (ms), so the eye catches it. */
const BUSY_HOLD_MS = 1500;

/**
 * Replaces LiveSync's status line with a colored dot. Tapping the dot shows the full line; tapping
 * the line brings the dot back. The choice is kept per device (Obsidian's local storage, not data.json,
 * so a synced settings file cannot carry it to another device).
 */
export class SyncDot extends Component {
	private expanded: boolean;
	private barDot: HTMLElement | null = null;
	private lastState: SyncState = "unknown";
	private lastLabel = "";
	private lastActivity: number | undefined = undefined;
	private busyUntil = 0;

	constructor(private readonly app: App) {
		super();
		this.expanded = this.app.loadLocalStorage(EXPANDED_KEY) === "1";
	}

	onload(): void {
		if (Platform.isDesktop) {
			// Obsidian has no status bar on mobile; on desktop LiveSync's status-bar item gets a dot too.
			this.barDot = this.makeDot(document.createElement("div"));
		}
		// LiveSync re-creates and moves its status box (on every leaf change and settings save), so the
		// dot is re-attached on a short tick instead of once.
		this.registerInterval(window.setInterval(() => this.refresh(), TICK_MS));
		this.registerDomEvent(document, "click", (evt) => this.onClick(evt), { capture: true });
		this.refresh();
	}

	onunload(): void {
		document.body.removeClass(BODY_DOT, BODY_LINE);
		document.querySelectorAll(`.${DOT_CLASS}`).forEach((el) => el.remove());
		document.querySelectorAll(`${STATUS_BAR}.quiet-ui-hidden`).forEach((el) => el.removeClass("quiet-ui-hidden"));
		this.barDot?.closest(".status-bar-item")?.remove();
		this.barDot = null;
	}

	/** Attaches the dot `parent` will hold, with a 44 px tap target. */
	private makeDot(parent: HTMLElement): HTMLElement {
		const dot = parent.createDiv({ cls: DOT_CLASS, attr: { role: "button", tabindex: "0" } });
		dot.createSpan({ cls: "quiet-ui-sync-dot-mark" });
		return dot;
	}

	private refresh(): void {
		const { state: read, label, activity } = readSyncState(this.app);
		const now = Date.now();
		// Activity is a busy reading, or the transfer counters moving since the last look -- a short sync
		// can start and finish between two looks. Either holds the dot busy for a moment.
		const moved = activity !== undefined && this.lastActivity !== undefined && activity !== this.lastActivity;
		this.lastActivity = activity;
		if (read === "busy" || moved) this.busyUntil = now + BUSY_HOLD_MS;
		const state: SyncState = read === "idle" && now < this.busyUntil ? "busy" : read;
		this.lastState = state;
		this.lastLabel = state === "busy" && read === "idle" ? "Syncing" : label;
		const known = state !== "unknown";
		// Unknown state: neither body class, so LiveSync's own line shows exactly as LiveSync draws it.
		document.body.toggleClass(BODY_DOT, known && !this.expanded);
		document.body.toggleClass(BODY_LINE, known && this.expanded);
		if (!known) return;

		document.querySelectorAll<HTMLElement>(EDITOR_STATUS).forEach((box) => {
			let dot = box.querySelector<HTMLElement>(`:scope > .${DOT_CLASS}`);
			if (!dot) dot = this.makeDot(box);
			this.paint(dot);
		});

		const bar = document.querySelector<HTMLElement>(STATUS_BAR);
		if (this.barDot && bar) {
			if (!this.barDot.isConnected) {
				// Sits right after LiveSync's own item so it takes the same place.
				const item = createDiv({ cls: "status-bar-item quiet-ui-sync-bar-item" });
				item.appendChild(this.barDot);
				bar.insertAdjacentElement("afterend", item);
			}
			bar.toggleClass("quiet-ui-hidden", !this.expanded);
			this.barDot.parentElement?.toggleClass("quiet-ui-hidden", this.expanded);
			this.paint(this.barDot);
		}
	}

	private paint(dot: HTMLElement): void {
		for (const s of STATES) dot.toggleClass(`is-${s}`, s === this.lastState);
		const text = `LiveSync: ${this.lastLabel}. Tap for details.`;
		if (dot.getAttribute("aria-label") !== text) dot.setAttribute("aria-label", text);
	}

	private onClick(evt: MouseEvent): void {
		const target = evt.target;
		if (!(target instanceof Element)) return;
		const onDot = target.closest(`.${DOT_CLASS}`) !== null;
		const onLine =
			this.expanded &&
			(target.closest(`${EDITOR_STATUS} ${EDITOR_LINE}`) !== null || target.closest(STATUS_BAR) !== null);
		if (!onDot && !onLine) return;
		// The tap is ours: it must not also place the editor cursor under the status box.
		evt.preventDefault();
		evt.stopPropagation();
		this.setExpanded(onDot);
	}

	private setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.app.saveLocalStorage(EXPANDED_KEY, expanded ? "1" : null);
		this.refresh();
	}
}
