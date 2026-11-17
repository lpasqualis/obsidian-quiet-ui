import { Component, MarkdownView, type App, type TFile } from "obsidian";

/** Obsidian's internal Properties editor on a MarkdownView (not in the public API typings). */
interface MetadataEditor {
	collapsed?: boolean;
	properties?: unknown[];
	containerEl?: HTMLElement;
	/** Obsidian 1.15: setCollapse(collapsed, userAction). userAction=false skips the animation and
	 * does not write the file's saved fold state. */
	setCollapse?: (collapsed: boolean, userAction?: boolean) => void;
}

/**
 * Opens every note with its Properties block folded to its header. It uses Obsidian's own fold
 * (the same one the header's triangle toggles), so one tap on the header still opens it, and it
 * folds only when a note is opened -- never while it is being read or edited.
 */
export class FoldProperties extends Component {
	/** The file each open view was last folded for, so a view is folded once per note it opens. */
	private folded = new WeakMap<MarkdownView, string>();

	constructor(private readonly app: App) {
		super();
	}

	onload(): void {
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.onOpen(file)));
		this.app.workspace.onLayoutReady(() => this.foldAll());
	}

	private onOpen(file: TFile | null): void {
		if (!file || file.extension !== "md") return;
		// file-open fires before the view has applied the file's saved fold state; fold after it.
		window.requestAnimationFrame(() => this.foldAll());
	}

	private foldAll(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) continue;
			const path = view.file.path;
			if (this.folded.get(view) === path) continue;
			if (this.fold(view)) this.folded.set(view, path);
		}
	}

	/** Returns false when the view has not rendered its Properties yet (try again on the next open). */
	private fold(view: MarkdownView): boolean {
		const editor = (view as unknown as { metadataEditor?: MetadataEditor }).metadataEditor;
		if (editor && typeof editor.setCollapse === "function") {
			// A note without properties is left alone, so a property added to it later shows open.
			if (Array.isArray(editor.properties) && editor.properties.length === 0) return true;
			if (!editor.collapsed) editor.setCollapse(true, false);
			return true;
		}
		// Fallback if the internal editor moves: the header's own click (this one does save the fold).
		const container = view.containerEl.querySelector(".metadata-container");
		if (!container) return false;
		if (!container.hasClass("is-collapsed")) {
			container.querySelector<HTMLElement>(".metadata-properties-heading")?.click();
		}
		return true;
	}
}
