// The sync-mode restore, run from the built main.js (npm run build first) against stand-ins for Obsidian and for
// Self-hosted LiveSync that record every call made to them (harness.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterFetch, app, built, SWITCHES } from "./harness.mjs";

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
	// The other features stay off here: the stand-ins have no editor DOM for the first two, and the status report has
	// its own tests (deviceStatus.test.mjs).
	const others = { syncDot: false, foldProperties: false, reportStatus: false };
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

test("a device with no settings saved gets every feature on", async () => {
	const QuietUi = built.default;
	const p = new QuietUi(app(afterFetch()), null);
	p.addChild = () => {};                   // only the settings are read here
	await p.onload();
	assert.deepEqual(p.settings, {
		syncDot: true,
		foldProperties: true,
		restoreSyncMode: true,
		reportStatus: true,
	});
});
