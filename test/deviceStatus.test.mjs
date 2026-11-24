// The device status record, run from the built main.js against the stand-ins in harness.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterFetch, app, built, server } from "./harness.mjs";

/** A configured, ready LiveSync with live sync running. */
function trashOn() {
	return { ...afterFetch(), liveSync: true,
		couchDB_URI: "https://hub.example:6984/", couchDB_DBNAME: "archive db", couchDB_USER: "sync",
		couchDB_PASSWORD: "pässword" };
}

// ------------------------------------------------------------------------------------------- the status record

const TRASH = [".trash/Private/Medical letter.md", ".trash/Private/scan.pdf", ".trash/old note.md",
	".trash/Private/Sub/deep.md"];

test("the trash is counted, never named", async () => {
	const a = app(trashOn(), { files: [...TRASH, "Notes/kept.md"], syncStatus: "PAUSED", name: "Lorenzo's iPhone",
		trashOption: "local" });
	assert.deepEqual(await built.countTrash(a), { files: 4, notes: 3, folders: 2 });
	const rec = await built.buildRecord(a, "1.2.0", { reportStatus: true }, new Date("2026-11-24T18:00:00Z"));
	assert.equal(rec.device, "Lorenzo's iPhone");
	assert.equal(rec.platform, "ios");
	assert.equal(rec.liveSync, "1.0.51");
	assert.equal(rec.quietUi, "1.2.0");
	assert.equal(rec.trashOption, "local");
	assert.deepEqual(rec.trash, { files: 4, notes: 3, folders: 2 });
	assert.deepEqual(rec.switches, { reportStatus: true });
	assert.equal((await built.buildRecord(app(trashOn(), { trashOption: "none" }), "1.2.0", {}, new Date())).trashOption,
		"none");
	const text = JSON.stringify(rec);
	for (const word of ["Medical", "scan", "old note", "Private", "deep", "kept"]) {
		assert.ok(!text.includes(word), `the record carries "${word}"`);
	}
	assert.deepEqual((await built.countTrash(app(trashOn()))), { files: 0, notes: 0, folders: 0 });
});

test("last up to date: now when LiveSync reads up to date, otherwise the last time it did", async () => {
	const storage = {};
	let a = app(trashOn(), { syncStatus: "PAUSED", storage });
	let rec = await built.buildRecord(a, "1.2.0", {}, new Date("2026-11-24T18:00:00Z"));
	assert.equal(rec.sync.state, "idle");
	assert.equal(rec.upToDateAt, "2026-11-24T18:00:00.000Z");
	a = app(trashOn(), { syncStatus: "ERRORED", storage });
	rec = await built.buildRecord(a, "1.2.0", {}, new Date("2026-11-24T19:00:00Z"));
	assert.equal(rec.sync.state, "stopped");
	assert.equal(rec.upToDateAt, "2026-11-24T18:00:00.000Z");
	rec = await built.buildRecord(app(trashOn()), "1.2.0", {}, new Date());
	assert.equal(rec.upToDateAt, null);
});

test("the device id is made once and kept", () => {
	const storage = {};
	const id = built.deviceId(app(trashOn(), { storage }));
	assert.match(id, /^[0-9a-f]{16}$/);
	assert.equal(built.deviceId(app(trashOn(), { storage })), id);
	assert.notEqual(built.deviceId(app(trashOn())), id);
});

test("the record goes to the device's own local document on LiveSync's server, with LiveSync's login", async () => {
	const storage = { "quiet-ui-device-id": "0123456789abcdef" };
	const a = app(trashOn(), { storage });
	server.requests = [];
	server.answer = (req) => (req.method === "GET" ? { status: 404, json: { error: "not_found" } } : { status: 201, json: {} });
	assert.deepEqual(await built.writeRecord(a, { kind: "x" }), { written: true, why: "" });
	const url = "https://hub.example:6984/archive%20db/_local/quiet-ui-device-0123456789abcdef";
	assert.deepEqual(server.requests.map((r) => [r.method, r.url]), [["GET", url], ["PUT", url]]);
	const auth = "Basic " + Buffer.from("sync:pässword", "utf8").toString("base64");
	assert.equal(server.requests[1].headers.Authorization, auth);
	assert.deepEqual(JSON.parse(server.requests[1].body), { kind: "x" });

	// An existing record is updated at its revision.
	server.requests = [];
	server.answer = (req) => (req.method === "GET" ? { status: 200, json: { _rev: "0-3" } } : { status: 201, json: {} });
	assert.equal((await built.writeRecord(a, { kind: "x" })).written, true);
	assert.deepEqual(JSON.parse(server.requests[1].body), { kind: "x", _rev: "0-3" });

	// A refusal is reported, not thrown.
	server.answer = (req) => (req.method === "GET" ? { status: 404, json: {} } : { status: 401, json: {} });
	assert.deepEqual(await built.writeRecord(a, { kind: "x" }), { written: false, why: "the server answered 401" });
	server.answer = () => { throw new Error("offline"); };
	assert.equal((await built.writeRecord(a, { kind: "x" })).written, false);
});

test("nothing is sent while LiveSync is not ready, or for a remote that is not CouchDB", async () => {
	server.requests = [];
	await built.writeRecord(app(trashOn(), { ready: false }), {});
	await built.writeRecord(app({ ...trashOn(), remoteType: "MINIO" }), {});
	await built.writeRecord(app({ ...trashOn(), suspendFileWatching: true }), {});
	assert.deepEqual(server.requests, []);
});

// ------------------------------------------------------------------------------------------- the switches

test("the switch: on by default, off stops the report, on starts it again", async () => {
	globalThis.window = { setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 2 };
	const QuietUi = built.default;
	const only = { syncDot: false, foldProperties: false, restoreSyncMode: false };
	let p = new QuietUi(app(trashOn()), { ...only });
	await p.onload();
	assert.equal(p.settings.reportStatus, true);
	assert.equal(p.children.length, 1);
	assert.equal(p.children[0].intervals.length, 2);            // the write and the up-to-date sample
	await p.update({ reportStatus: false });
	assert.equal(p.children.length, 0);
	assert.equal(p.data.reportStatus, false);
	await p.update({ reportStatus: true });
	assert.equal(p.children.length, 1);
	p = new QuietUi(app(trashOn()), { ...only, reportStatus: false });
	await p.onload();
	assert.equal(p.children.length, 0);
});
