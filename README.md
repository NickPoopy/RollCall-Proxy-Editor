# RollCall Proxy Editor

Edit RollCall proxy configuration files without fighting the text format.

**[Open the app →](https://nickpoopy.github.io/RollCall-Proxy-Editor/)** · or download the single-file offline version from [Releases](https://github.com/NickPoopy/RollCall-Proxy-Editor/releases) (works with no internet, just open the `.html` in Chrome or Edge).

![Screenshot](docs/screenshot.png)

The window has three panes, all kept in sync:

| Raw text | Editor | RollCall preview |
|---|---|---|
| The actual file. Paste, type, or open one. Errors and warnings are marked in the gutter. | A friendly tree with forms for names, addresses and devices, plus tables for all devices and settings. | A mock-up of the tree RollCall will show, using the same `Name NNNN:DD:00 (version)` labels. |

Click a net in any pane and it's highlighted in the other two.

## Features

- **Open / Save** proxy files. In Chrome and Edge, Save writes back to the same file. Line endings (CRLF) and encoding are preserved, and untouched lines come out byte-for-byte identical.
- **Drag and drop** in the Tree tab. Drop on a net to move inside it, or on the top/bottom edge of a row to place before/after it. Children and devices come along. Because a net's position *is* its address, siblings shift one slot to make room. The toast tells you what moved, and Ctrl+Z undoes it.
- **Add, rename, move, reorder and delete** nets. Addresses are picked automatically (next free slot), and moving a net moves everything under it.
- **Bulk add**: create e.g. 10 children named `Video {n:2}` with device IPs counting up from `10.0.0.10`.
- **Duplicate…**: stamp out copies of a whole branch (e.g. MV1 → MV2–MV7) with every child and device. Names are renamed with find → replace rules (`MV1` → `MV{n}`), and every IP shifts by a step per copy (e.g. +10 on the last octet).
- **Toolbox…**: ready-made prefabs with a few simple settings (count, first number, base IPs, IP step):
  - **IQ frames + cards**: frames with cards in the slots that match their card numbers, plus paired addresses
  - **Multiviewers**: MV Control plus IP Control Port 1–n
  - **MV media ports**: Port 1–n, each with two addresses

  Changing a setting regenerates the outline, which you can still hand-edit before adding.
- **Save as prefab…**: turn any branch into your own prefab. A number in the branch name becomes "how many / first number", each IP network becomes a setting, and IPs step per copy. My prefabs are saved in the browser and can be **exported/imported as a .json file** to share with the team.
- **Outlines**: the Toolbox also takes an indented outline or a paste from Excel (see below). **Copy branch as outline** exports a branch the same way, so you can edit it in Excel and paste it back.
- **Devices table**: edit every `IpShare` line in one grid, with filtering.
- **Settings**: edit the other sections (`[Combiner Services]`, `[MonitoringToLogServer]`, …) as key/value pairs.
- **IpShare numbering**: RollCall needs `IpShare0, 1, 2…` in order with no gaps or repeats. Every edit made through the editor rewrites them in sequence automatically. Gaps from hand-editing the raw text are flagged with a **Renumber** button, and Save always renumbers first.
- **Validation**: duplicate addresses, unnamed parents, bad IPs/ports, more than 15 children, duplicate IP:port.
- **Undo / redo**, plus a draft autosave in the browser so a closed tab doesn't lose work.
- Everything runs locally in your browser. Files are never uploaded anywhere.

## How the proxy file maps to the tree

```
[NetNames]
1000=IQ Frames        ->  IQ Frames      0000:01:00
1200=Video Frames     ->    Video Frames 1000:02:00
1210=Video            ->      Video      1200:01:00
1211=Video 01         ->        Video 01 1210:01:00
```

- Net addresses are **4 hex digits**, one digit per tree level. `0` means "level not used", so a net can have up to 15 children (1–F), and the tree is at most 4 levels deep. `0000` is the root/system name.
- RollCall shows each net as `parent:DD:00`, where `DD` is the net's own digit.
- `IpShareN=ip1,port1,NET,ip2,port2,ip3,port3,` in `[Combiner Services]` attaches the device at those IP addresses to net `NET`. `-` means an address slot is unused. RollCall then shows the device (with its own name, address and version) under that net. The preview shows a placeholder row for it, because the real details come from the device.

## Outline format (Paste outline…)

One net per line. Indentation sets the level: Tab, spaces, or Excel columns A, B, C… (empty leading cells paste as tabs). Addresses go after the name, either in the next cells/tabs or after `@` separated by commas. Each is `ip` or `ip:port`, and `-` marks an unused slot.

```
Replay
	EVS
		EVS 1	10.30.1.11	10.31.1.11
		EVS 2 @ 10.30.1.12:2051, 10.31.1.12
Routers
	Spare Router	10.30.2.1
```

`[3] Name` puts a net in slot 3 instead of the next free slot. For example, `[A] F1 IQUCP25_10` lands at `…A`, matching the card number.

### Prefab templates

A prefab is an outline with settings. `{{expr}}` inserts a value. `@repeat i FROM..TO` … `@end` repeats lines, and `@if expr` … `@end` keeps lines only when the condition is true. Functions: `pad(n, 2)` → `03`, `hex(n)` → slot digit, `ip(base, offset)` → base IP plus offset on the last octet (`-` stays `-`).

```
@repeat m 0..count-1
{{prefix}}{{first+m}}
	MV Control	{{ip(ip, m*step)}}
@repeat p 1..ports
	IP Control Port {{p}}	{{ip(ip, m*step + p)}}
@end
@end
```

With "Reuse existing nets with the same name" on, `Routers` above goes into the existing Routers net instead of creating a second one. The preview shows which rows are new and which already exist before anything is changed.

## Development

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # parser / model tests
npm run build          # web build -> dist/
npm run build:offline  # single self-contained HTML -> dist-offline/index.html
```

Stack: React + TypeScript + Vite, Zustand, CodeMirror 6, Vitest.

```
src/model/    file format: parse, serialize, address math, tree, validation, edit operations (pure, unit-tested)
src/state/    app store (undo, selection, autosave), file open/save, templates
src/panes/    RawTextPane, EditorPane (+ editor/*), PreviewPane
```

`samples/example-proxy.txt` is an anonymized real proxy file, used by the tests and the **Example** button. Put real files in `samples/private/` (git-ignored). The tests also check that they round-trip.

## Releasing

Bump `version` in `package.json`, update `RELEASE_NOTES.md`, then push a tag:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

GitHub Actions runs the tests and publishes a release with the offline HTML attached. Every push to `main` redeploys the web app to GitHub Pages.
