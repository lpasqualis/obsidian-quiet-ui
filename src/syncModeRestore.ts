import { Component, Notice, type App } from "obsidian";
import { LIVESYNC_ID } from "./syncState";

/**
 * Puts Self-hosted LiveSync back in LiveSync mode after its first fetch left every automatic sync off.
 *
 * Every fetch LiveSync runs (a new device's first one after its setup link, and "Reset synchronisation on this
 * device") ends by switching off LiveSync mode, periodic sync and every sync-on-event trigger, and nothing switches
 * them back (vrtmrz/obsidian-livesync#1367). The device then syncs nothing until someone sets Sync Mode by hand.
 *
 * Once LiveSync is ready, and every 30 seconds after, this looks for exactly that state: LiveSync configured for
 * CouchDB, no fetch or rebuild pending or running, and every automatic sync switch off. Only then does it set Sync
 * Mode to LiveSync, the same two calls LiveSync's own settings screen makes. Any other combination is a choice
 * someone made and is left alone: one switch on is enough.
 */

/** The switches a fetch turns off (LiveSync 1.0.x, suspendAllSync). */
const OFF_AFTER_FETCH = [
	"liveSync",
	"periodicReplication",
	"syncOnSave",
	"syncOnEditorSave",
	"syncOnStart",
	"syncOnFileOpen",
	"syncAfterMerge",
] as const;
/** The files LiveSync leaves in the vault root while a fetch or rebuild is scheduled. */
const FLAG_FILES = ["redflag.md", "redflag2.md", "redflag3.md", "flag_rebuild.md", "flag_fetch.md"];
/** LiveSync's remoteType for CouchDB. */
const COUCHDB = "";
const FIRST_CHECK_MS = 5000;
const EVERY_MS = 30000;

type Settings = Record<string, unknown>;

/** The parts of Self-hosted LiveSync (1.0.x) this reads and calls. All optional: any of them may move. */
interface LiveSyncServices {
	setting?: {
		currentSettings?: () => Settings | undefined;
		applyPartial?: (partial: Settings, save: boolean) => Promise<unknown>;
	};
	control?: { applySettings?: () => Promise<unknown> };
	appLifecycle?: { isReady?: () => boolean; isSuspended?: () => boolean };
}

function liveSyncServices(app: App): LiveSyncServices | undefined {
	// app.plugins is not in the public API typings.
	const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
	const plugin = plugins?.plugins?.[LIVESYNC_ID] as { core?: { services?: LiveSyncServices } } | undefined;
	return plugin?.core?.services;
}

/** Why Sync Mode is not to be touched now, or "" when the state is exactly the one a fetch leaves. */
export async function whyNotRestore(app: App): Promise<string> {
	const services = liveSyncServices(app);
	const setting = services?.setting;
	const life = services?.appLifecycle;
	if (
		!setting?.currentSettings ||
		!setting.applyPartial ||
		!services?.control?.applySettings ||
		!life?.isReady ||
		!life.isSuspended
	) {
		return "LiveSync is not loaded";
	}
	if (!life.isReady() || life.isSuspended()) return "LiveSync is not ready";
	const s = setting.currentSettings();
	if (!s || !s.isConfigured) return "LiveSync is not configured";
	if ((s.remoteType || COUCHDB) !== COUCHDB) return "the remote is not CouchDB";
	if (s.suspendFileWatching || s.suspendParseReplicationResult) return "a fetch or rebuild is running";
	const on = OFF_AFTER_FETCH.filter((k) => s[k]);
	if (on.length) return "sync is on: " + on.join(", ");
	for (const f of FLAG_FILES) {
		if (await app.vault.adapter.exists(f)) return "a fetch or rebuild is scheduled (" + f + ")";
	}
	return "";
}

/** Sets Sync Mode back to LiveSync when the state is the one a fetch leaves; otherwise changes nothing. */
export async function restoreSyncMode(app: App): Promise<{ restored: boolean; why: string }> {
	const why = await whyNotRestore(app);
	if (why) return { restored: false, why };
	const services = liveSyncServices(app) as Required<LiveSyncServices>;
	await services.setting.applyPartial!({ liveSync: true }, true);
	await services.control.applySettings!();
	return { restored: true, why: "" };
}

export class SyncModeRestore extends Component {
	private busy = false;

	constructor(private readonly app: App) {
		super();
	}

	onload(): void {
		this.app.workspace.onLayoutReady(() => {
			const first = window.setTimeout(() => void this.check(), FIRST_CHECK_MS);
			this.register(() => window.clearTimeout(first));
			this.registerInterval(window.setInterval(() => void this.check(), EVERY_MS));
		});
	}

	private async check(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			const got = await restoreSyncMode(this.app);
			if (got.restored) new Notice("Quiet UI: LiveSync's fetch had turned syncing off. Sync Mode is LiveSync again.");
		} catch (e) {
			console.error("quiet-ui: could not set Sync Mode back to LiveSync", e);
		} finally {
			this.busy = false;
		}
	}
}
