# Kovaak's Plus

A companion app for KovaaK's FPS Aim Trainer. You browse, launch, tag and review everything here, and the game only comes forward while you're aiming.

## Sharing it with friends

Send them **`dist\KovaaksPlus.exe`** (one file, ~63 MB, nothing to install). On first launch it finds KovaaK's, their Workshop scenarios and their Steam account on its own. They just click **Let's go**. Their tags, names and presets are their own; you share yours as `.kpack` files (Import / Export page, or drag a `.kpack` onto the window).

Requirements: Windows 10/11 with the Edge WebView2 runtime. It ships with Windows 11; the app links to the installer if it's missing.

## How the window switching works

| You do | What happens |
|---|---|
| Click **Play** on any scenario | Launches it with KovaaK's own deep link (`steam://run/824270//?action=jump-to-scenario&name=…&mode=challenge`) and brings the game forward |
| Press **Esc** in game (configurable) | Kovaak's Plus comes forward with a "Paused" bar. Click **Resume** or press **Space** to go back |
| A run ends | KovaaK's writes a stats CSV, the app picks it up and comes forward with your results, PB comparison and benchmark rank. A new PB gets the gold screen and confetti |

Tips:
- Use **Windowed Fullscreen** in KovaaK's so switching is instant.
- Keep KovaaK's **Pause on loss of focus** ON (it is by default).

The pause bar shows the scenario that's loaded. It knows this from:
- the scenario you launched from the app
- KovaaK's `session.sav`, which the game rewrites while running
- your last finished run

### Going back to KovaaK's

Under App Settings → Returning to KovaaK's you can choose what Space does:
- **From the pause bar:** restart the run (default), or continue where you paused.
- **On the results screen:** restart the run (default), play the next scenario in the queue, or just switch back.

The app restarts a run by pressing your restart key for you (default **R**; set it to match your in-game bind). It only presses it once KovaaK's is confirmed to be in front.

The queue is the list you launched from: a benchmark difficulty, a calculator plan, or the scenarios currently shown in the library. **N** on the results screen always plays the next scenario in the queue.

## Organising scenarios

- **Hover** a scenario to see its preview without opening the side panel. In grid view it plays over the card; in lists and tables (library list, Home, Statistics, benchmark tables) it pops up beside the cursor. Turn it off under App Settings → Appearance → Preview on hover.
- **Right-click** any scenario, anywhere: play, favorite, hide, edit tags, rename, set a thumbnail, set a default preset, open its leaderboard, export.
- **Tags:** right-click a tag in the sidebar, or hover it and click the pencil. You can rename it, recolour it, change its category, give it a **default thumbnail** and a **default preset**, or delete it. A scenario without its own thumbnail uses its tags' thumbnails, split diagonally when several tags have one.
- **Auto-tag** (Scenarios → Auto-tag) proposes tags from:
  - evxl.app's aim-type classification (~2,000 scenarios)
  - the scenario's in-game tags (synonyms like Track/Tracking and OW/Overwatch are merged)
  - in-game difficulty
  - benchmark membership

  When a proposal looks like a tag you already have, it asks whether to use that tag or create a new one.
- **Default presets** can be set per scenario, or per tag as a fallback. When you press Play and your current settings differ, the app asks (or, if you choose, applies automatically): it closes KovaaK's, applies the preset, and relaunches straight into the scenario. You can change this under App Settings → Default presets.

## Calculators

- **Benchmark (Rank calculator card, collapsed by default; click its header):** pick a target rank, an energy, or a leaderboard position. It lists the cheapest set of improvements to get there, one scenario per weak subcategory, with exact scores and play buttons. Energy benchmarks raise your weakest subcategories first, because energy is a harmonic mean.
- **Rank lines on score charts:** if a scenario belongs to a benchmark, its score history (side panel and results screen) shows that benchmark's rank thresholds as coloured lines and bands: the rank below your worst run, every rank inside your range, and the next one above your best. Use the picker above the chart to switch benchmark or turn the lines off; your choice is remembered.
- **Scenario (details panel or right-click → Calculator):** enter a target score, a rank, or a leaderboard position / top %. It shows the score needed, the gain over your PB, the rank, and an estimated global position.

## Customising

- **App Settings → Appearance:** theme (7 dark themes), accent and secondary colours, font, interface scale, corners, density, scenario card size, glow, animations, PB highlighting and dimming of earlier runs.
- **Benchmark → Table settings (sliders icon):** evxl-style layout options such as density, bar style, skew, radii, category shading, rank-column colours, a per-subcategory gradient behind the scores and energy, font, text size, separate contrast for rank and score text, leaderboard position, progress %, and simplified names.
- **Manage tags:** drag tags by their handle, or use the arrows, to reorder them or move them between groups. Groups can be reordered too. Tag order decides sidebar order, and which tag's thumbnail and preset win.

## Leaderboards

- **Benchmarks:** Global, Friends, Country and country averages (from evxl.app), plus per-scenario boards.
- **Scenarios:** Global (KovaaK's official board), Friends (your Steam friends who play KovaaK's) and My position (located live on the board). Available in the details panel, the right-click menu and every benchmark row.
- **End of run:** where the new score would place globally (estimated live) and how you rank among friends.

**Viewing other players:** click anyone on a leaderboard (benchmark, scenario or end of run) to open their benchmarks in the Benchmarks tab, with their KovaaK's scores, ranks and energy. You can also use **Find player** on the Benchmarks page (or the gear menu on a benchmark) and search by Steam name, KovaaK's username, SteamID64, or a Steam / evxl.app profile link. Right-click a leaderboard row to open their evxl.app or Steam profile instead.

Star a player (in the picker, on the Viewing banner, or by right-clicking a leaderboard row) to add them to **Favorites**. Favorites show as quick chips at the top of the Benchmarks pages. The picker also lists your **Steam friends** who are on evxl.app; type to filter them, or press Enter to search everyone. It's temporary: leaving the Benchmarks tab or relaunching the app switches back to you. Their scores are never written to your offline cache.

The app never injects into or reads the game's memory. It watches the stats folder, the process list and the pause key (a standard low-level keyboard hook on its own thread).

## Why settings changes still restart KovaaK's

The game keeps its settings in memory and rewrites `PrimaryUserSettings.json` constantly (one older game log shows about 1,900 saves). Any edit made from outside is overwritten almost straight away. The game does have an internal `ReloadAndApplyActiveSettings` function, but nothing outside the game can trigger it: there's no key bind, console command or deep link for it. So applying settings or a preset still means closing the game, writing the file and relaunching, straight into the scenario if you launched one.

## What it stores, and where

All app data lives in `%APPDATA%\KovaaksPlus` and never inside the game's folders:
- `library.json`: custom names, tags, notes, favorites, thumbnails
- `presets\`: settings presets
- `media\`: thumbnails, previews and tag icons, one folder per item (`media\scenarios\<scenario>\`, `media\tags\<tag>\`, `media\presets\<preset>\`). App Settings → Data → Thumbnails & icons opens it.
- `backups\`: automatic snapshots of KovaaK's settings, taken before every change
- `cache\`: stats index and benchmark data

**Cleaning up:** replacing or removing a thumbnail leaves the old file in media\. App Settings → Data → **Clean up unused files** scans for files no scenario, tag or preset uses, lets you pick which to remove, and sends them to the Recycle Bin. It also removes empty folders, and can clear links to files that were deleted by hand. Turn on **Clean up automatically on launch** to do this quietly each time the app starts (off by default).

Scenario files are never renamed or edited. The only time the app writes into KovaaK's folders:
- **Applying settings or a preset.** It edits `PrimaryUserSettings.json`, `weaponsettings.ini` and `UI.json` after backing them up. If KovaaK's is running, the app closes it, applies the change and relaunches it, because the game rewrites these files on exit.
- **Importing a pack.** It adds the pack's `.sce` files to the Scenarios folder. Identical files are skipped, and replaced files are backed up first.

## Benchmarks

Benchmarks work like evxl.app: one entry per benchmark, difficulties as tabs, the same category and subcategory layout, threshold cells, and energy.

- **Overall ranks** are calculated locally with evxl's own formulas (basic, vt-energy, generic-energy, generic-energy-uncapped, complete), using your local PBs, so a new PB shows up immediately. For evxl's rarer custom scoring methods, the overall rank comes from evxl's server.
- **Where the data comes from:**
  - Thresholds and server scores: KovaaK's public webapp backend.
  - Catalog, profile ranks, friends and scenario classification: [evxl.app's API](https://api.evxl.app/documentation).
  - Benchmark grouping, layouts and scoring methods: evxl.app's site config, because the documented API has no endpoint for them. If the site changes, names fall back to the `rank-counts` endpoint.

## Building from source

```powershell
winget install Microsoft.DotNet.SDK.8
.\build.ps1          # → dist\KovaaksPlus.exe
```

Project layout (`src\KovaaksPlus`):
- `MainForm.cs`: WebView2 host, JSON-RPC bridge
- `Api.cs`: every UI action
- `GameWatcher.cs`: process, hook, stats watcher and focus switching
- `StatsIndex.cs`: CSV parsing and cache
- `ScenarioLibrary.cs`: `.sce` scanning and the tag/name overlay
- `SettingsManager.cs`: settings, presets and backups
- `PackManager.cs`: `.kpack` import/export
- `EvxlClient.cs`: benchmark data
- `wwwroot\`: the UI (plain HTML/CSS/JS modules, no build step)

For UI development, set `KPLUS_UI_DIR` to the `wwwroot` folder and `KPLUS_DEV=1` (enables DevTools) to edit the UI live without rebuilding.
