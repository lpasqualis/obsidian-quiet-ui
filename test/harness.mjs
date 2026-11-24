// Stand-ins for Obsidian and for Self-hosted LiveSync that record every call made to them, and the built main.js
// (npm run build first) loaded against them. Each feature's tests import from here.
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

class Component {
	constructor() { this.children = []; this.intervals = []; this.loaded = false; }
	addChild(c) { this.children.push(c); c.load(); return c; }
	removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
	load() { this.loaded = true; this.onload && this.onload(); }
	register() {}
	registerInterval(id) { this.intervals.push(id); return id; }
	registerEvent() {}
	registerDomEvent() {}
}

/** What the server stand-in answers, and every request made to it. Tests set `answer` per case. */
export const server = { requests: [], answer: () => ({ status: 404, json: {} }) };

export const obsidian = {
	Component,
	Plugin: class extends Component {
		constructor(app, data) { super(); this.app = app; this.data = data; this.manifest = { version: "1.2.0" }; }
		async loadData() { return this.data; }
		async saveData(d) { this.data = d; }
		addSettingTab() {}
	},
	PluginSettingTab: class {},
	Setting: class {},
	Notice: class {},
	Platform: { isDesktop: false, isMobile: true, isDesktopApp: false, isIosApp: true, isAndroidApp: false, isMacOS: false },
	MarkdownView: class {},
	requestUrl: async (req) => {
		server.requests.push(req);
		return server.answer(req);
	},
};
const load = Module._load;
Module._load = function (name, ...rest) {
	if (name === "obsidian") return obsidian;
	return load.call(this, name, ...rest);
};
// main.js is CommonJS, as Obsidian loads it; this package is "type": "module", so compile it as CommonJS by hand.
const file = path.join(here, "..", "main.js");
const mod = new Module(file);
mod.filename = file;
mod.paths = Module._nodeModulePaths(path.dirname(file));
mod._compile(readFileSync(file, "utf8"), file);
export const built = mod.exports;

export const SWITCHES = ["liveSync", "periodicReplication", "syncOnSave", "syncOnEditorSave", "syncOnStart",
	"syncOnFileOpen", "syncAfterMerge"];

/** What a fetch leaves: configured for CouchDB, every automatic sync switch off. */
export function afterFetch() {
	const s = { isConfigured: true, remoteType: "", suspendFileWatching: false, suspendParseReplicationResult: false };
	for (const k of SWITCHES) s[k] = false;
	return s;
}

/**
 * An Obsidian app with LiveSync loaded on `settings`. `files` are the vault's files by path (a folder is implied by
 * the paths under it); `syncStatus` is LiveSync's replication status (absent: unreadable); `name` its device name;
 * `trashOption` Obsidian's Deleted files setting as its settings screen shows it.
 */
export function app(settings, { flags = [], ready = true, files = [], syncStatus, name = "", storage = {}, trashOption = "system" } = {}) {
	const calls = [];
	const has = (p) => flags.includes(p) || files.some((f) => f === p || f.startsWith(p + "/"));
	const services = {
		setting: {
			currentSettings: () => settings,
			applyPartial: async (p, save) => { calls.push(["applyPartial", p, save]); Object.assign(settings, p); },
			getDeviceAndVaultName: () => name,
		},
		control: { applySettings: async () => { calls.push(["applySettings"]); } },
		appLifecycle: { isReady: () => ready, isSuspended: () => false },
	};
	if (syncStatus) services.replicator = { replicationStatics: { value: { syncStatus } } };
	const a = {
		calls,
		settings,
		storage,
		plugins: { plugins: { "obsidian-livesync": { manifest: { version: "1.0.51" }, core: { services } } } },
		fileManager: { getTrashOption: () => trashOption },
		vault: {
			getName: () => "Archive",
			getConfig: (k) => (k === "trashOption" ? trashOption : undefined),
			adapter: {
				exists: async (p) => has(p),
				list: async (dir) => {
					const under = files.filter((f) => f.startsWith(dir + "/")).map((f) => f.slice(dir.length + 1));
					return {
						files: under.filter((r) => !r.includes("/")).map((r) => `${dir}/${r}`),
						folders: [...new Set(under.filter((r) => r.includes("/")).map((r) => `${dir}/${r.split("/")[0]}`))],
					};
				},
			},
		},
		workspace: { onLayoutReady: (fn) => fn(), on: () => ({}), getActiveViewOfType: () => null, iterateAllLeaves: () => {} },
		loadLocalStorage: (k) => (k in storage ? storage[k] : null),
		saveLocalStorage: (k, v) => { storage[k] = v; },
	};
	return a;
}
