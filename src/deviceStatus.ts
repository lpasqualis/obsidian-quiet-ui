import { Component, Platform, requestUrl, type App, type ListedFiles } from "obsidian";
import { liveSyncServices, liveSyncVersion, whyNotReady } from "./liveSync";
import { readSyncState } from "./syncState";

/**
 * Writes this device's sync status to the LiveSync server, so whoever keeps the vault can see, per device, when it
 * last synced, whether files deleted elsewhere are kept here, and whether its trash holds files, without opening it.
 *
 * Where a deleted file goes is Obsidian's own choice (Settings > Files and links > Deleted files, `trashOption`):
 * "system" moves it to the system trash (where there is none, as on an iPhone, Obsidian uses "local"), "local" to the
 * vault's `.trash` folder, "none" deletes it for good. Self-hosted LiveSync deletes through the same call
 * (`fileManager.trashFile`), so a note deleted on another device follows this option too; LiveSync's own "Use the
 * trash bin" has no effect from Obsidian 1.7.2 on.
 *
 * The record is a CouchDB local document in LiveSync's own database, `_local/quiet-ui-device-<id>`, written with
 * LiveSync's own login. A local document is never replicated, so no other device ever receives it and LiveSync
 * never reads it. It holds counts only, never a file name: a vault's trash can hold notes kept off the server on
 * purpose, and their names must not travel back to it.
 *
 * Every 30 seconds it reads LiveSync's state the way the status dot does and remembers the last time it read
 * "Up to date"; 20 seconds after Obsidian starts, and every 10 minutes after, it writes the record.
 */

export const RECORD_PREFIX = "_local/quiet-ui-device-";
export const RECORD_KIND = "quiet-ui-device-status";
const ID_KEY = "quiet-ui-device-id";
const UP_TO_DATE_KEY = "quiet-ui-up-to-date-at";
const TRASH = ".trash";
const FIRST_WRITE_MS = 20000;
const WRITE_EVERY_MS = 600000;
const SAMPLE_EVERY_MS = 30000;

export interface TrashCount {
	files: number;
	notes: number;
	folders: number;
}

/** What `.trash` in the vault holds: counts only. */
export async function countTrash(app: App): Promise<TrashCount> {
	const out: TrashCount = { files: 0, notes: 0, folders: 0 };
	const adapter = app.vault.adapter;
	if (!(await adapter.exists(TRASH))) return out;
	const todo = [TRASH];
	while (todo.length) {
		const listed: ListedFiles = await adapter.list(todo.pop()!);
		out.files += listed.files.length;
		out.notes += listed.files.filter((f) => f.toLowerCase().endsWith(".md")).length;
		out.folders += listed.folders.length;
		todo.push(...listed.folders);
	}
	return out;
}

/** This device's own id, made once and kept in Obsidian's local storage (per vault, per device, never synced). */
export function deviceId(app: App): string {
	let id = app.loadLocalStorage(ID_KEY) as string | null;
	if (typeof id !== "string" || !/^[0-9a-f]{16}$/.test(id)) {
		const bytes = new Uint8Array(8);
		crypto.getRandomValues(bytes);
		id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
		app.saveLocalStorage(ID_KEY, id);
	}
	return id;
}

function hostName(): string {
	if (!Platform.isDesktopApp) return "";
	try {
		// Desktop only: Electron's Node. Not in the mobile app.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return (require("os") as { hostname: () => string }).hostname();
	} catch {
		return "";
	}
}

/** Where Obsidian puts a deleted file on this device: "system", "local" or "none" (what its setting shows). */
function trashOption(app: App): string {
	const fm = app.fileManager as unknown as { getTrashOption?: () => string };
	if (typeof fm?.getTrashOption === "function") return fm.getTrashOption();
	return String((app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.("trashOption") ?? "");
}

function basicAuth(user: string, password: string): string {
	const bytes = new TextEncoder().encode(`${user}:${password}`);
	return "Basic " + btoa(String.fromCharCode(...bytes));
}

/** The status record as it is written, from what LiveSync and the vault say now. */
export async function buildRecord(app: App, version: string, switches: Record<string, boolean>, now: Date) {
	const services = liveSyncServices(app);
	const reading = readSyncState(app);
	let upToDate = app.loadLocalStorage(UP_TO_DATE_KEY) as string | null;
	if (reading.state === "idle") {
		upToDate = now.toISOString();
		app.saveLocalStorage(UP_TO_DATE_KEY, upToDate);
	}
	let trash: TrashCount | { error: string };
	try {
		trash = await countTrash(app);
	} catch (e) {
		trash = { error: String(e) };
	}
	return {
		kind: RECORD_KIND,
		format: 1,
		device: services?.setting?.getDeviceAndVaultName?.() ?? "",
		host: hostName(),
		platform: Platform.isIosApp ? "ios" : Platform.isAndroidApp ? "android" : Platform.isMacOS ? "macos" : Platform.isDesktopApp ? "desktop" : "mobile",
		vault: app.vault.getName(),
		quietUi: version,
		liveSync: liveSyncVersion(app),
		writtenAt: now.toISOString(),
		sync: { state: reading.state, label: reading.label },
		upToDateAt: upToDate ?? null,
		trashOption: trashOption(app),
		switches,
		trash,
	};
}

/** Writes the record to the server; answers what happened, never throws. */
export async function writeRecord(app: App, record: Record<string, unknown>): Promise<{ written: boolean; why: string }> {
	const services = liveSyncServices(app);
	const why = whyNotReady(services);
	if (why) return { written: false, why };
	const s = services!.setting!.currentSettings!()!;
	if ((s.remoteType || "") !== "") return { written: false, why: "the remote is not CouchDB" };
	const uri = String(s.couchDB_URI || "").replace(/\/+$/, "");
	const db = String(s.couchDB_DBNAME || "");
	if (!uri || !db) return { written: false, why: "LiveSync names no server or database" };
	const url = `${uri}/${encodeURIComponent(db)}/${RECORD_PREFIX}${deviceId(app)}`;
	const headers = { Authorization: basicAuth(String(s.couchDB_USER || ""), String(s.couchDB_PASSWORD || "")) };
	try {
		const got = await requestUrl({ url, method: "GET", headers, throw: false });
		const rev = got.status === 200 ? (got.json as { _rev?: string })._rev : undefined;
		const put = await requestUrl({
			url,
			method: "PUT",
			headers,
			contentType: "application/json",
			body: JSON.stringify(rev ? { ...record, _rev: rev } : record),
			throw: false,
		});
		if (put.status !== 201 && put.status !== 200) return { written: false, why: `the server answered ${put.status}` };
		return { written: true, why: "" };
	} catch (e) {
		return { written: false, why: `the server could not be reached: ${e}` };
	}
}

export class DeviceStatus extends Component {
	private busy = false;
	lastWrite: { written: boolean; why: string } | null = null;

	constructor(
		private readonly app: App,
		private readonly version: string,
		private readonly switches: () => Record<string, boolean>
	) {
		super();
	}

	onload(): void {
		this.app.workspace.onLayoutReady(() => {
			const first = window.setTimeout(() => void this.write(), FIRST_WRITE_MS);
			this.register(() => window.clearTimeout(first));
			this.registerInterval(window.setInterval(() => void this.write(), WRITE_EVERY_MS));
			this.registerInterval(window.setInterval(() => this.sample(), SAMPLE_EVERY_MS));
		});
	}

	/** Remembers the last time LiveSync read "Up to date". */
	private sample(): void {
		if (readSyncState(this.app).state === "idle") this.app.saveLocalStorage(UP_TO_DATE_KEY, new Date().toISOString());
	}

	async write(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			const record = await buildRecord(this.app, this.version, this.switches(), new Date());
			this.lastWrite = await writeRecord(this.app, record);
			if (!this.lastWrite.written) console.debug("quiet-ui: device status not written:", this.lastWrite.why);
		} catch (e) {
			console.error("quiet-ui: could not write the device status", e);
		} finally {
			this.busy = false;
		}
	}
}
