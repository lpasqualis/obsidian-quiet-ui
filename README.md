# Quiet UI

An Obsidian plugin that takes two distractions off the screen, on phone and desktop, keeps Self-hosted LiveSync
syncing after a fetch, and tells the vault's keeper how each device is doing:

1. **Self-hosted LiveSync's status line becomes a dot.** The line in the top-right corner of the editor
   (`Sync: 💤 ↑ 21 ↓ 0`) shows as a small colored dot instead. Tap the dot to see the full line; tap the line
   to go back to the dot. The dot is the default, and each device remembers your choice.
2. **Properties open folded.** Every note opens with its Properties block folded to its header, so the note
   starts with its content. One tap on "Properties" opens them, exactly as Obsidian's own fold does.
3. **LiveSync is turned back on after a fetch.** LiveSync's fetch leaves every sync trigger off; when the plugin
   finds exactly that, it sets Sync Mode back to LiveSync, so a new device keeps syncing without a trip to the
   settings.
4. **The device reports its sync status.** Every 10 minutes the device writes to the LiveSync server when it was
   last up to date, where deleted files go on it, and how many files its trash holds, so whoever keeps the vault can
   check every device without opening it.

Each one has its own switch in the plugin's settings; all four are on by default.

![Before and after: a note with LiveSync's line and its Properties open, and the same note with the dot and the Properties folded](docs/before-after.png)

## The dot

![The dot in each state, in the dark and light themes, and the full line after a tap](docs/dot-states.png)

| Dot | Means |
|---|---|
| Green | Up to date: LiveSync is connected and idle (or, in the on-event and periodic modes, its last sync finished and nothing is waiting). |
| Amber | Syncing: LiveSync is transferring, comparing changes with the server, or has files or database entries waiting to be processed. |
| Red | Stopped or failing: LiveSync reported an error, or LiveSync mode is on and replication has ended. |

The color comes from LiveSync's own state, not from reading the emoji it prints: the replication status
(`syncStatus`) and the pending counters LiveSync keeps for files, database entries and conflicts. The dot
checks them once a second.

If LiveSync is not installed, not running, or a future version stores its state differently, the plugin
steps aside and LiveSync's own line shows exactly as LiveSync draws it.

On desktop, LiveSync's item in the status bar gets a dot too; tapping either one switches both.

## Properties folded

The plugin uses Obsidian's own fold, the one the triangle next to "Properties" toggles, so nothing is
hidden or restyled. It folds a note once, when the note opens; if you open the Properties, they stay open
while you work on that note. Notes without properties are left alone.

Obsidian remembers folds per note on each device, so a note you leave folded is remembered folded. That
memory is Obsidian's, and it stays if you turn the plugin off: a note then opens the way you last left it.

For comparison, Obsidian's built-in setting (Settings > Editor > Properties in document) offers:

- **Visible** (the default): the Properties block is shown at the top of the note, open unless you fold it.
- **Hidden**: no Properties block in the note at all; you edit properties in the Properties side panel.
- **Source**: the raw YAML front matter is shown as text at the top of the note.

Quiet UI keeps Visible and only folds the block, so properties stay one tap away in the note itself.

## LiveSync back on after a fetch

Every fetch Self-hosted LiveSync runs (a new device's first sync after its setup link, and "Reset synchronisation
on this device") ends by switching off LiveSync mode, periodic sync and every sync-on-event trigger, and nothing
switches them back ([vrtmrz/obsidian-livesync#1367](https://github.com/vrtmrz/obsidian-livesync/issues/1367)).
The device then shows Sync Mode "On events" with no event turned on, and syncs nothing until someone sets Sync
Mode by hand.

Once LiveSync is ready, and every 30 seconds after, the plugin looks for exactly that state: LiveSync set up for
CouchDB, no fetch or rebuild still pending or running, and every automatic sync switch off. Only then does it set
Sync Mode to LiveSync, the same change LiveSync's own settings screen makes, and shows a short notice saying so.
Any other combination is a choice someone made and is left alone: if even one sync switch is on (periodic sync,
sync on save, sync on start, and so on), nothing changes.

Turn the switch off ("Turn LiveSync back on after a fetch") if you want a device to stay in the state a fetch
leaves.

## The device's sync status

Every 10 minutes (and 20 seconds after Obsidian starts) the plugin writes one small record to the LiveSync server:
the device name LiveSync knows it by, the platform, the plugin and LiveSync versions, when the record was written,
when LiveSync last read "Up to date" on this device, where Obsidian puts a deleted file here, which of this plugin's
switches are on, and how many files, notes and folders the vault's `.trash` folder holds. Counts only, never a file
name.

Where a deleted file goes is Obsidian's own setting (Settings > Files and links > Deleted files, `trashOption` in
`.obsidian/app.json`): "system" moves it to the system trash, "local" to the vault's `.trash` folder, "none" deletes
it for good. Where there is no system trash, as on an iPhone, Obsidian treats "system" as "local". Self-hosted
LiveSync removes a file deleted on another device through the same Obsidian call, so it follows this setting too
(LiveSync's own "Use the trash bin" has no effect from Obsidian 1.7.2 on, as its description says). The record
reports the setting as Obsidian's settings screen shows it; the system trash itself is not read.

The record is a CouchDB local document in LiveSync's own database (`_local/quiet-ui-device-<id>`, where the id is
made once per device and vault and kept in Obsidian's local storage), written with LiveSync's own login. CouchDB
never replicates a local document, so no other device receives it and LiveSync itself never reads it. Reading every
device's record is one request: `GET /<database>/_local_docs?include_docs=true`, then the ids starting
`_local/quiet-ui-device-`.

A phone writes only while Obsidian is open on it, so the record's time is also the last time the device was seen.
Turn the switch off ("Report this device's sync status to the server") to stop it.

## Install

With [BRAT](https://github.com/TfTHacker/obsidian42-brat): *Add beta plugin* and enter `lpasqualis/obsidian-quiet-ui`,
then enable **Quiet UI** under Community plugins.

By hand: download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/lpasqualis/obsidian-quiet-ui/releases/latest) into
`<vault>/.obsidian/plugins/quiet-ui/` and enable the plugin.

## Compatibility

Built and tested with Obsidian 1.15.1 and Self-hosted LiveSync 1.0.50 and 1.0.51. Every feature reads parts of
its host that are not public API (LiveSync's internal services; Obsidian's Properties editor), and each falls back
to the stock behaviour when those parts are missing: LiveSync's line shows, Properties open the way Obsidian opens
them, Sync Mode is left as LiveSync set it, and no status record is written. The status
record is written only for a CouchDB remote.

## Build

```sh
npm install
npm run build
npm test
```

`npm test` runs the tests against the built `main.js`.

## License

MIT
