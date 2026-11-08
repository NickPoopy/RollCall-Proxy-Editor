First usable alpha of RollCall Proxy Editor.

**Use it:** https://nickpoopy.github.io/RollCall-Proxy-Editor/, or download the attached `.html` and open it in Chrome or Edge (works offline).

### What's in it
- Three synced panes: raw text, friendly editor, RollCall tree preview
- Open / save proxy files with line endings and encoding preserved (untouched lines are byte-identical)
- Add, rename, move, reorder and delete nets, with automatic addressing
- Bulk add children with name patterns and auto-incrementing device IPs
- Duplicate a whole branch N times, with rename rules and IP shifting (e.g. MV1 → MV2–MV7)
- Paste outline: build trees from an indented outline or straight from Excel, and copy any branch back out as an outline
- Devices (IpShare) table and settings editor for the other sections
- Validation of addresses, IPs, ports and tree shape
- Undo / redo and browser draft autosave

### Known limitations
- The preview can't show real device names or versions (those come from the device), so it shows `Device @ <ip>` placeholders.
- The three IpShare address slots are labelled Address 1/2/3 until their exact meaning is confirmed.
