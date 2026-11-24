import { App, Plugin, PluginSettingTab, Setting, type Component } from "obsidian";
import { FoldProperties } from "./foldProperties";
import { SyncDot } from "./syncDot";
import { SyncModeRestore } from "./syncModeRestore";
import { DeviceStatus } from "./deviceStatus";

// For tests run against the built main.js: each feature's check and act, as the plugin runs them.
export { restoreSyncMode, whyNotRestore } from "./syncModeRestore";
export { buildRecord, countTrash, deviceId, writeRecord, RECORD_PREFIX } from "./deviceStatus";

interface QuietUiSettings {
	syncDot: boolean;
	foldProperties: boolean;
	restoreSyncMode: boolean;
	reportStatus: boolean;
}

const DEFAULT_SETTINGS: QuietUiSettings = {
	syncDot: true,
	foldProperties: true,
	restoreSyncMode: true,
	reportStatus: true,
};

export default class QuietUiPlugin extends Plugin {
	settings: QuietUiSettings = { ...DEFAULT_SETTINGS };
	private parts: Record<keyof QuietUiSettings, Component | null> = {
		syncDot: null,
		foldProperties: null,
		restoreSyncMode: null,
		reportStatus: null,
	};

	async onload(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<QuietUiSettings> | null) };
		this.addSettingTab(new QuietUiSettingTab(this.app, this));
		this.apply();
	}

	/** Starts or stops each feature to match the settings. */
	apply(): void {
		this.toggle("syncDot", () => new SyncDot(this.app));
		this.toggle("foldProperties", () => new FoldProperties(this.app));
		this.toggle("restoreSyncMode", () => new SyncModeRestore(this.app));
		this.toggle("reportStatus", () => new DeviceStatus(this.app, this.manifest.version, () => ({ ...this.settings })));
	}

	private toggle(key: keyof QuietUiSettings, make: () => Component): void {
		const running = this.parts[key];
		if (this.settings[key] && !running) {
			this.parts[key] = this.addChild(make());
		} else if (!this.settings[key] && running) {
			this.removeChild(running);
			this.parts[key] = null;
		}
	}

	async update(change: Partial<QuietUiSettings>): Promise<void> {
		this.settings = { ...this.settings, ...change };
		await this.saveData(this.settings);
		this.apply();
	}
}

class QuietUiSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: QuietUiPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName("LiveSync status as a dot")
			.setDesc(
				"Show Self-hosted LiveSync's status line as a small dot: green up to date, amber syncing, red stopped or failing. Tap the dot for the full line, tap the line for the dot."
			)
			.addToggle((t) => t.setValue(this.plugin.settings.syncDot).onChange((v) => this.plugin.update({ syncDot: v })));
		new Setting(containerEl)
			.setName("Fold properties when a note opens")
			.setDesc("Every note opens with its Properties block folded to its header. Tap the header to open it.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.foldProperties).onChange((v) => this.plugin.update({ foldProperties: v }))
			);
		new Setting(containerEl)
			.setName("Turn LiveSync back on after a fetch")
			.setDesc(
				"Self-hosted LiveSync's fetch (a new device's first sync, or a reset of this device) leaves every sync trigger off. When it finds exactly that, with no fetch still pending, this sets Sync Mode back to LiveSync. Any other Sync Mode setting is left alone."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.restoreSyncMode).onChange((v) => this.plugin.update({ restoreSyncMode: v }))
			);
		new Setting(containerEl)
			.setName("Report this device's sync status to the server")
			.setDesc(
				"Every 10 minutes, writes to the LiveSync server when this device was last up to date, where Obsidian puts deleted files here, and how many files the vault's trash holds (counts only, never a file name), so the vault's keeper can check every device without opening it."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.reportStatus).onChange((v) => this.plugin.update({ reportStatus: v }))
			);
	}
}
