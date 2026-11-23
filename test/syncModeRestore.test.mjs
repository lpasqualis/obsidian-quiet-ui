// The sync-mode restore, run from the built main.js (npm run build first) against stand-ins for Obsidian and for
// Self-hosted LiveSync that record every call made to them.
import { test } from "node:test";
import assert from "node:assert/strict";
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
const obsidian = {
	Component,
	Plugin: class extends Component {
		constructor(app, data) { super(); this.app = app; this.data = data; }
		async loadData() { return this.data; }
		async saveData(d) { this.data = d; }
		addSettingTab() {}
	},
	PluginSettingTab: class {},
	Setting: class {},
	Notice: class {},
	Platform: { isDesktop: false, isMobile: true },
	MarkdownView: class {},
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
const built = mod.exports;

const SWITCHES = ["liveSync", "periodicReplication", "syncOnSave", "syncOnEditorSave", "syncOnStart", "syncOnFileOpen",
	"syncAfterMerge"];

/** What a fetch leaves: configured for CouchDB, every automatic sync switch off. */
function afterFetch() {
	const s = { isConfigured: true, remoteType: "", suspendFileWatching: false, suspendParseReplicationResult: false };
	for (const k of SWITCHES) s[k] = false;
	return s;
}

function app(settings, { flags = [], ready = true } = {}) {
	const calls = [];
	const a = {
		calls,
		settings,
		plugins: { plugins: { "obsidian-livesync": { core: { services: {
			setting: {
				currentSettings: () => settings,
				applyPartial: async (p, save) => { calls.push(["applyPartial", p, save]); Object.assign(settings, p); },
			},
			control: { applySettings: async () => { calls.push(["applySettings"]); } },
			appLifecycle: { isReady: () => ready, isSuspended: () => false },
		} } } } },
		vault: { adapter: { exists: async (f) => flags.includes(f) } },
		workspace: { onLayoutReady: (fn) => fn(), on: () => ({}), getActiveViewOfType: () => null, iterateAllLeaves: () => {} },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
	return a;
}

test("after a fetch it sets Sync Mode back to LiveSync the way the settings screen does", async () => {
	const a = app(afterFetch());
	assert.deepEqual(await built.restoreSyncMode(a), { restored: true, why: "" });
	assert.deepEqual(a.calls, [["applyPartial", { liveSync: true }, true], ["applySettings"]]);
	assert.equal(a.settings.liveSync, true);
});

test("a choice someone made is left alone: any one switch on", async () => {
	for (const key of SWITCHES) {
		const s = afterFetch();
		s[key] = true;
		const a = app(s);
		assert.equal((await built.restoreSyncMode(a)).restored, false, key);
		assert.deepEqual(a.calls, [], key);
	}
});

test("a fetch or rebuild still pending or running is never interrupted", async () => {
	for (const flag of ["flag_fetch.md", "redflag3.md", "flag_rebuild.md", "redflag2.md", "redflag.md"]) {
		const a = app(afterFetch(), { flags: [flag] });
		assert.equal((await built.restoreSyncMode(a)).restored, false, flag);
		assert.deepEqual(a.calls, [], flag);
	}
	for (const key of ["suspendFileWatching", "suspendParseReplicationResult"]) {
		const s = afterFetch();
		s[key] = true;
		const a = app(s);
		await built.restoreSyncMode(a);
		assert.deepEqual(a.calls, [], key);
	}
	const a = app(afterFetch(), { ready: false });
	await built.restoreSyncMode(a);
	assert.deepEqual(a.calls, []);
});

test("an unconfigured LiveSync, another kind of remote, or no LiveSync at all is left alone", async () => {
	let a = app({ ...afterFetch(), isConfigured: false });
	await built.restoreSyncMode(a);
	assert.deepEqual(a.calls, []);
	a = app({ ...afterFetch(), remoteType: "MINIO" });
	await built.restoreSyncMode(a);
	assert.deepEqual(a.calls, []);
	const bare = { plugins: { plugins: {} }, vault: { adapter: { exists: async () => false } } };
	assert.deepEqual(await built.restoreSyncMode(bare), { restored: false, why: "LiveSync is not loaded" });
});

async function plugin(data) {
	const QuietUi = built.default;
	const p = new QuietUi(app(afterFetch()), data);
	await p.onload();
	return p;
}

const restorers = (p) => p.children.filter((c) => typeof c.check === "function");

test("the switch: on by default, off stops it, on again starts it", async () => {
	globalThis.window = { setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 2 };
	// The two older features stay off here: the stand-ins have no editor DOM for them.
	const others = { syncDot: false, foldProperties: false };
	let p = await plugin({ ...others });
	assert.equal(p.settings.restoreSyncMode, true);
	assert.equal(restorers(p).length, 1);
	assert.deepEqual(restorers(p)[0].intervals, [2]);
	await p.update({ restoreSyncMode: false });
	assert.equal(restorers(p).length, 0);
	assert.equal(p.data.restoreSyncMode, false);
	await p.update({ restoreSyncMode: true });
	assert.equal(restorers(p).length, 1);
	p = await plugin({ ...others, restoreSyncMode: false });
	assert.equal(restorers(p).length, 0);
	assert.equal(p.children.length, 0);
});

test("a device with no settings saved gets all three features on", async () => {
	const QuietUi = built.default;
	const p = new QuietUi(app(afterFetch()), null);
	p.addChild = () => {};                   // only the settings are read here
	await p.onload();
	assert.deepEqual(p.settings, { syncDot: true, foldProperties: true, restoreSyncMode: true });
});
