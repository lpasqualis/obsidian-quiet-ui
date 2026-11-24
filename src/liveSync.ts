import type { App } from "obsidian";
import { LIVESYNC_ID } from "./syncState";

export type Settings = Record<string, unknown>;

/** The parts of Self-hosted LiveSync (1.0.x) the settings features read and call. All optional: any of them may move. */
export interface LiveSyncServices {
	setting?: {
		currentSettings?: () => Settings | undefined;
		applyPartial?: (partial: Settings, save: boolean) => Promise<unknown>;
		getDeviceAndVaultName?: () => string;
	};
	control?: { applySettings?: () => Promise<unknown> };
	appLifecycle?: { isReady?: () => boolean; isSuspended?: () => boolean };
}

export function liveSyncServices(app: App): LiveSyncServices | undefined {
	// app.plugins is not in the public API typings.
	const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
	const plugin = plugins?.plugins?.[LIVESYNC_ID] as { core?: { services?: LiveSyncServices } } | undefined;
	return plugin?.core?.services;
}

/** LiveSync's installed version, or "" when it is not loaded. */
export function liveSyncVersion(app: App): string {
	const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
	const plugin = plugins?.plugins?.[LIVESYNC_ID] as { manifest?: { version?: string } } | undefined;
	return plugin?.manifest?.version ?? "";
}

/**
 * Why LiveSync's settings are not to be touched now, or "" when LiveSync is loaded, ready and configured, with no
 * fetch or rebuild running. `needs` names the calls the caller will make.
 */
export function whyNotReady(services: LiveSyncServices | undefined, needs: { apply?: boolean } = {}): string {
	const setting = services?.setting;
	const life = services?.appLifecycle;
	if (
		!setting?.currentSettings ||
		(needs.apply && (!setting.applyPartial || !services?.control?.applySettings)) ||
		!life?.isReady ||
		!life.isSuspended
	) {
		return "LiveSync is not loaded";
	}
	if (!life.isReady() || life.isSuspended()) return "LiveSync is not ready";
	const s = setting.currentSettings();
	if (!s || !s.isConfigured) return "LiveSync is not configured";
	if (s.suspendFileWatching || s.suspendParseReplicationResult) return "a fetch or rebuild is running";
	return "";
}
