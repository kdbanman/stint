# Issue #37 — user-centric agentic QA evidence

Screen captures and recordings backing the findings filed as standalone
`Agentic QA Discovery` issues discovered from
[#37](https://github.com/kdbanman/stint/issues/37) (#48, #49, #50, #51, #52, #55).
The real renderer
(`packages/gui/renderer`) was driven in the pre-installed Chromium, bridged to a
real `@stint/core` SQLite store through the same `window.stint` IPC handler map
`packages/gui/src/main.ts` registers — so every flow below is the shipped GUI
code over real data (only Electron's OS chrome — tray, native dialogs, global
hotkey — is out of frame). Recordings follow the repo's GIF convention
(`packages/gui/judge/record.mjs`: Playwright `recordVideo` → ffmpeg palette GIF).

| File | Finding |
|------|---------|
| `f1-add-client-dead.gif` | "+ Add client" does nothing (dead button); "+ Add tag" works, for contrast |
| `f2-editor-snap-mutates.gif` | Opening + saving an entry silently snaps/rewrites its times |
| `f2-editor-snapped-times.png` | Editor shows 09:05 / 11:05 for an entry actually spanning 09:07–11:03 |
| `f3-timer-card-frozen.gif` | Timer Start/Stop appears dead after using an Entries filter |
| `f4-two-description-fields.png` | Two Description fields on the Timer view while running |
| `f6-entries-filters-dead.gif` | The Entries toolbar (range/billable/client/tag/search) is inert |
| `f6-entries-calendar.png` | The Entries calendar with ~3 weeks of data |

## Cleanup

This directory is throwaway QA evidence. Each file's owning issue lists it under
*Cleanup on close*; once every `Agentic QA Discovery` issue above is closed, delete
the whole directory.
