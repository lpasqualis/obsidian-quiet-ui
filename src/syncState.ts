import type { App } from "obsidian";

/** What the dot shows. "unknown" means LiveSync is absent or its internals changed: show its own line. */
export type SyncState = "idle" | "busy" | "stopped" | "unknown";

export interface SyncReading {
	state: SyncState;
	/** One short phrase for the dot's tooltip and screen readers. */
	label: string;
}

interface Reactive<T> {
	value: T;
}

/** The parts of Self-hosted LiveSync (1.0.x) this plugin reads. All optional: any of them may move. */
interface LiveSyncServices {
	replicator?: {
		replicationStatics?: Reactive<{
			syncStatus?: string;
			lastSyncPushSeq?: number;
			maxPushSeq?: number;
			lastSyncPullSeq?: number;
			maxPullSeq?: number;
			couchDB?: { phase?: string; push?: { checking?: boolean }; pull?: { checking?: boolean } };
		}>;
	};
	replication?: {
		replicationResultCount?: Reactive<number>;
		databaseQueueCount?: Reactive<number>;
		storageApplyingCount?: Reactive<number>;
	};
	fileProcessing?: {
		processing?: Reactive<number>;
		totalQueued?: Reactive<number>;
		batched?: Reactive<number>;
	};
	conflict?: { conflictProcessQueueCount?: Reactive<number> };
}

interface LiveSyncPlugin {
	core?: { services?: LiveSyncServices; settings?: { liveSync?: boolean } };
}

export const LIVESYNC_ID = "obsidian-livesync";

const TRANSFERRING = new Set(["STARTED", "CONNECTED", "JOURNAL_SEND", "JOURNAL_RECEIVE"]);
const ENDED = new Set(["CLOSED", "COMPLETED", "NOT_CONNECTED"]);
const KNOWN = new Set([...TRANSFERRING, ...ENDED, "PAUSED", "ERRORED"]);

function count(r: Reactive<number> | undefined): number {
	const v = r?.value;
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Reads LiveSync's own replication state -- the same values its status line is drawn from
 * (ModuleLog.ts / ReplicationStatusLabel.ts in 1.0.50) -- rather than parsing the emoji it prints.
 */
export function readSyncState(app: App): SyncReading {
	// app.plugins is not in the public API typings.
	const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
	const plugin = plugins?.plugins?.[LIVESYNC_ID] as LiveSyncPlugin | undefined;
	const services = plugin?.core?.services;
	const stats = services?.replicator?.replicationStatics?.value;
	const status = stats?.syncStatus;
	if (!services || typeof status !== "string" || !KNOWN.has(status)) {
		return { state: "unknown", label: "LiveSync status unavailable" };
	}

	if (status === "ERRORED") return { state: "stopped", label: "Sync error" };
	const live = plugin?.core?.settings?.liveSync === true;
	// In LiveSync mode replication should never end; in the on-event and periodic modes an ended
	// replication is the normal resting state.
	if (live && ENDED.has(status)) return { state: "stopped", label: "Sync stopped" };

	const pending =
		count(services.replication?.replicationResultCount) +
		count(services.replication?.databaseQueueCount) +
		count(services.replication?.storageApplyingCount) +
		count(services.fileProcessing?.processing) +
		count(services.fileProcessing?.totalQueued) +
		count(services.fileProcessing?.batched) +
		count(services.conflict?.conflictProcessQueueCount);
	const couch = stats?.couchDB;
	const checking =
		couch !== undefined && couch.phase !== "idle" && (couch.pull?.checking === true || couch.push?.checking === true);
	if (TRANSFERRING.has(status) || checking || pending > 0) {
		return { state: "busy", label: pending > 0 ? `Syncing, ${pending} pending` : "Syncing" };
	}
	return { state: "idle", label: "Up to date" };
}
