using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace KovaaksPlus;

/// <summary>JSON-RPC surface used by the web UI. Every UI action lands here.</summary>
public sealed class Api
{
    public static readonly HashSet<string> MediaExtensions = new(StringComparer.OrdinalIgnoreCase)
        { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".mp4", ".webm" };

    readonly MainForm _form;
    public AppConfig Config { get; private set; }
    public GamePaths? Paths { get; private set; }
    public readonly StatsIndex Stats = new();
    public readonly ScenarioLibrary Scenarios = new();
    public readonly LibraryStore Library = new();
    public readonly PresetStore Presets = new();
    public readonly EvxlClient Evxl = new();
    public readonly GameWatcher Watcher;
    SettingsManager? _settings;
    PackManager? _packs;
    Task? _loading;

    public Api(MainForm form)
    {
        _form = form;
        Config = Json.Read<AppConfig>(AppPaths.Config) ?? new AppConfig();
        Watcher = new GameWatcher(form, () => Config);
        Watcher.StatusChanged += running => _form.Emit("game.status", new { running, currentScenario = Watcher.CurrentScenario });
        Watcher.ScenarioStarted += name => _form.Emit("game.scenario", new { name });
        Watcher.PauseDetected += OnPause;
        Watcher.StatsFileCreated += path => _ = OnStatsFile(path);
        Evxl.CatalogProgress += (done, total) => _form.Emit("evxl.catalogProgress", new { done, total });
    }

    public void Start()
    {
        if (!Config.SetupComplete)
        {
            // First launch: auto-detect everything so the UI can just ask for confirmation.
            var d = GamePaths.Detect();
            Config.GamePath ??= d.GamePath;
            if (Config.WorkshopPaths.Count == 0) Config.WorkshopPaths = d.WorkshopPaths;
            Config.SteamId ??= d.SteamId;
            Config.SteamName ??= d.SteamName;
        }
        InitPaths();
    }

    void InitPaths()
    {
        if (string.IsNullOrEmpty(Config.GamePath)) return;
        var p = new GamePaths(Config.GamePath, Config.WorkshopPaths);
        if (!p.IsValid) return;
        Paths = p;
        _settings = new SettingsManager(p);
        _packs = new PackManager(p, Scenarios, Library, Presets);
        _form.OnGamePathsReady(p);
        Watcher.Start(p);
        _loading = Task.Run(() =>
        {
            Scenarios.Scan(p);
            Stats.Load(p.Stats, (done, total) => _form.Emit("stats.progress", new { done, total }));
            _form.Emit("stats.ready", new { runs = Stats.All().Count });
        });
        Evxl.GetCatalog(false);
    }

    void SaveConfig() => Json.Write(AppPaths.Config, Config);

    GamePaths RequirePaths() => Paths ?? throw new InvalidOperationException("KovaaK's folder isn't set. Open Settings → Setup.");

    // =====================================================================================

    public async Task<object?> Handle(string method, JsonElement p)
    {
        switch (method)
        {
            // ---------- app ----------
            case "app.init":
                return new
                {
                    version = Application.ProductVersion.Split('+')[0],
                    config = Config,
                    firstRun = !Config.SetupComplete,
                    valid = Paths != null,
                    running = Watcher.IsRunning,
                    currentScenario = Watcher.CurrentScenario,
                    statsReady = Stats.Ready,
                    dataFolder = AppPaths.Root,
                };
            case "app.detect":
                return GamePaths.Detect();
            case "app.saveConfig":
            {
                var oldGame = Config.GamePath;
                var oldWs = string.Join("|", Config.WorkshopPaths);
                var merged = JsonSerializer.SerializeToNode(Config, Json.Options)!.AsObject();
                foreach (var prop in p.EnumerateObject()) merged[prop.Name] = JsonNode.Parse(prop.Value.GetRawText());
                Config = merged.Deserialize<AppConfig>(Json.Options)!;
                SaveConfig();
                Watcher.UpdateHook();
                if (oldGame != Config.GamePath || oldWs != string.Join("|", Config.WorkshopPaths)) InitPaths();
                return new { config = Config, valid = Paths != null };
            }
            case "app.validateGamePath":
            {
                var path = Json.Get(p, "path", "");
                return new { valid = new GamePaths(path, Array.Empty<string>()).IsValid };
            }
            case "app.pickFolder":
            {
                using var dlg = new FolderBrowserDialog { Description = Json.Get(p, "title", "Select folder"), UseDescriptionForTitle = true };
                return dlg.ShowDialog(_form) == DialogResult.OK ? dlg.SelectedPath : null;
            }
            case "app.openUrl":
            {
                var url = Json.Get(p, "url", "");
                if (url.StartsWith("https://") || url.StartsWith("http://")) Native.OpenUrl(url);
                return null;
            }
            case "game.restartKey":
                return new { detected = GameWatcher.DetectRestartKey()?.ToString(), effective = Watcher.RestartKey().ToString() };
            case "stats.positions":
            {
                // Your global position on every scenario evxl rates (refreshed daily by evxl).
                if (Config.SteamId == null) return new List<object>();
                var results = await Evxl.GetPlayerResults(Config.SteamId, Json.Get(p, "refresh", false));
                return results.Where(kv => kv.Value.Position > 0 && kv.Value.Players > 0).Select(kv => (object)new
                {
                    name = kv.Key, kv.Value.LeaderboardId, kv.Value.Position, kv.Value.Players,
                    percentile = Math.Round(kv.Value.Position * 100.0 / kv.Value.Players, 4),
                }).ToList();
            }
            case "app.setZoom":
                _form.SetZoom(Json.Get(p, "factor", 1.0));
                return null;
            case "app.openDataFolder":
                Native.RevealInExplorer(AppPaths.Root);
                return null;
            case "app.revealFile":
            {
                var path = Json.Get(p, "path", "");
                if (File.Exists(path)) Native.RevealInExplorer(path);
                return null;
            }
            case "app.reveal":
            {
                var what = Json.Get(p, "what", "");
                var path = what switch
                {
                    "stats" => Paths?.Stats, "scenarios" => Paths?.Scenarios, "game" => Paths?.GameRoot,
                    "backups" => AppPaths.Backups, _ => null,
                };
                if (path != null) Native.RevealInExplorer(path);
                return null;
            }

            // ---------- game ----------
            case "game.status":
                return new { running = Watcher.IsRunning, currentScenario = Watcher.CurrentScenario };
            case "game.play":
                return await Play(Json.Get(p, "name", ""), Json.Get(p, "mode", Config.DefaultMode), Json.Get<string?>(p, "preset", null));
            case "game.playPlaylist":
                await Watcher.PlayPlaylist(Json.Get(p, "sharecode", ""));
                return null;
            case "game.focus":
            {
                // action: "restart" presses KovaaK's restart key after switching; "continue"/"focus" just switches.
                var action = Json.Get(p, "action", "focus");
                if (!Watcher.IsRunning) { Watcher.LaunchGame(); return null; }
                if (action == "restart") await Watcher.ReturnToGame(true);
                else Watcher.FocusGame(Json.Get(p, "resuming", true));
                return null;
            }
            case "game.launch":
                Watcher.LaunchGame();
                return null;

            // ---------- library ----------
            case "library.list":
                if (_loading != null) await _loading;
                return BuildLibrary();
            case "library.tags":
                return new { tags = Library.Data.Tags, groups = Library.Data.Groups };
            case "library.saveTags":
                Library.SetTags(Json.Get(p, "tags", new List<TagDef>()), Json.Get(p, "groups", new List<string>()));
                return new { tags = Library.Data.Tags, groups = Library.Data.Groups };
            case "library.detail":
                return ScenarioDetail(Json.Get(p, "name", ""));
            case "library.setMeta":
                SetMeta(p);
                return ScenarioDetail(Json.Get(p, "name", ""));
            case "library.bulk":
                Bulk(p);
                return null;
            case "library.rescan":
                await Task.Run(() => Scenarios.Scan(RequirePaths()));
                return BuildLibrary();
            case "library.revealScenario":
            {
                var f = Scenarios.Find(Json.Get(p, "name", ""));
                if (f != null) Native.RevealInExplorer(f.Path);
                return null;
            }
            case "library.autoTag":
                return await AutoTagFromBenchmarks(Json.Get(p, "ids", new List<int>()));
            case "library.autoTagScan":
            {
                if (_loading != null) await _loading;
                var scope = Json.Get<List<string>?>(p, "names", null) ?? AllScenarioNames();
                var classes = await Evxl.GetScenarioClasses();
                var sources = new HashSet<string>(Json.Get(p, "sources", new List<string> { "skills", "gametag" }));
                return AutoTagger.Scan(scope, Scenarios, classes, Evxl.Catalog, Library.Data.Tags, sources, Json.Get(p, "minCount", 2));
            }
            case "library.autoTagApply":
                return AutoTagApply(p);
            case "library.gameFavorites":
                return SessionSave.Read()?.Favorites ?? new List<string>();
            case "library.importGameFavorites":
            {
                var favs = SessionSave.Read()?.Favorites ?? new List<string>();
                foreach (var f in favs) Library.Update(f, m => m.Favorite = true);
                return new { imported = favs.Count };
            }

            // ---------- stats ----------
            case "stats.overview":
                if (_loading != null) await _loading;
                return await Task.Run(StatsOverview);
            case "stats.scenario":
                return RunsWithPb(Stats.ForScenario(Json.Get(p, "name", "")));
            case "stats.run":
            {
                var file = Path.GetFileName(Json.Get(p, "file", ""));
                var full = Path.Combine(RequirePaths().Stats, file);
                if (!File.Exists(full)) throw new FileNotFoundException("Run file not found");
                var detail = StatsIndex.ParseDetail(full);
                var sf = Scenarios.Find(detail.Summary.Scenario);
                return new
                {
                    summary = detail.Summary, kills = detail.Kills, fields = detail.Fields,
                    scoring = sf == null ? null : new { scorePerKill = sf.ScorePerKill, scorePerDamage = sf.ScorePerDamage, multAccuracy = sf.ScoreMultAccuracy, timeLimit = sf.TimeLimit },
                };
            }

            // ---------- media ----------
            case "media.pick":
            {
                var kind = Json.Get(p, "kind", "image");
                using var dlg = new OpenFileDialog
                {
                    Title = kind == "video" ? "Choose a preview (image, GIF or video)" : "Choose an image",
                    Filter = kind == "video"
                        ? "Images & video|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.mp4;*.webm"
                        : "Images|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp",
                };
                if (dlg.ShowDialog(_form) != DialogResult.OK) return null;
                var ext = Path.GetExtension(dlg.FileName).ToLowerInvariant();
                if (!MediaExtensions.Contains(ext)) throw new InvalidOperationException("Unsupported file type");
                var name = MediaTarget(Json.Get<string?>(p, "owner", null), Json.Get<string?>(p, "target", null), ext);
                File.Copy(dlg.FileName, MediaFull(name));
                return name;
            }
            case "media.openFolder":
                Native.RevealInExplorer(AppPaths.Media);
                return null;
            case "media.saveDataUrl":
            {
                var m = Regex.Match(Json.Get(p, "dataUrl", ""), @"^data:(?<mime>[\w/+.-]+);base64,(?<data>.+)$", RegexOptions.Singleline);
                if (!m.Success) throw new InvalidOperationException("Invalid image data");
                var ext = m.Groups["mime"].Value switch
                {
                    "image/png" => ".png", "image/jpeg" => ".jpg", "image/gif" => ".gif", "image/webp" => ".webp",
                    "video/mp4" => ".mp4", "video/webm" => ".webm", _ => throw new InvalidOperationException("Unsupported media type"),
                };
                var name = MediaTarget(Json.Get<string?>(p, "owner", null), Json.Get<string?>(p, "target", null), ext);
                await File.WriteAllBytesAsync(MediaFull(name), Convert.FromBase64String(m.Groups["data"].Value));
                return name;
            }

            // ---------- settings & presets ----------
            case "settings.get":
                return RequireSettings().Snapshot(Watcher.IsRunning);
            case "settings.apply":
                return await WithGameClosed(Json.Get(p, "restart", false), "edit", s =>
                {
                    var primary = p.TryGetProperty("primary", out var pr) ? JsonNode.Parse(pr.GetRawText()) as JsonObject : null;
                    var weapon = Json.Get<Dictionary<string, string>?>(p, "weapon", null);
                    s.Backup("edit");
                    s.ApplyPatch(primary, weapon);
                });
            case "settings.backups":
                return RequireSettings().ListBackups();
            case "settings.restore":
                return await WithGameClosed(Json.Get(p, "restart", false), "restore", s => s.RestoreBackup(Json.Get(p, "id", "")));
            case "presets.list":
                return Presets.List();
            case "presets.capture":
            {
                var preset = RequireSettings().Capture(Json.Get(p, "name", "New preset"), Json.Get(p, "categories", new List<string>()));
                preset.Description = Json.Get<string?>(p, "description", null);
                Presets.Save(preset);
                return preset;
            }
            case "presets.save":
            {
                var id = Json.Get(p, "id", "");
                var preset = Presets.Get(id) ?? throw new InvalidOperationException("Preset not found");
                if (p.TryGetProperty("name", out _)) preset.Name = Json.Get(p, "name", preset.Name);
                if (p.TryGetProperty("description", out _)) preset.Description = Json.Get<string?>(p, "description", null);
                if (p.TryGetProperty("tags", out _)) preset.Tags = Json.Get(p, "tags", new List<string>());
                if (p.TryGetProperty("thumbnail", out _)) preset.Thumbnail = Json.Get<string?>(p, "thumbnail", null);
                if (p.TryGetProperty("preview", out _)) preset.Preview = Json.Get<string?>(p, "preview", null);
                Presets.Save(preset);
                return preset;
            }
            case "presets.recapture":
            {
                var old = Presets.Get(Json.Get(p, "id", "")) ?? throw new InvalidOperationException("Preset not found");
                var fresh = RequireSettings().Capture(old.Name, old.Categories);
                fresh.Id = old.Id; fresh.Description = old.Description; fresh.Tags = old.Tags;
                fresh.Thumbnail = old.Thumbnail; fresh.Preview = old.Preview; fresh.Created = old.Created;
                Presets.Save(fresh);
                return fresh;
            }
            case "presets.delete":
                Presets.Delete(Json.Get(p, "id", ""));
                return null;
            case "presets.apply":
            {
                var preset = Presets.Get(Json.Get(p, "id", "")) ?? throw new InvalidOperationException("Preset not found");
                return await WithGameClosed(Json.Get(p, "restart", false), "preset", s => s.ApplyPreset(preset));
            }

            // ---------- packs ----------
            case "packs.export":
            {
                var packs = _packs ?? throw new InvalidOperationException("Set up the KovaaK's folder first.");
                var name = Json.Get(p, "name", "My pack");
                var target = Json.Get<string?>(p, "path", null);
                if (target == null)
                {
                    using var dlg = new SaveFileDialog
                    {
                        Title = "Export pack", Filter = "Kovaak's Plus pack|*.kpack",
                        FileName = string.Concat(name.Split(Path.GetInvalidFileNameChars())) + ".kpack",
                    };
                    if (dlg.ShowDialog(_form) != DialogResult.OK) return null;
                    target = dlg.FileName;
                }
                return await Task.Run(() => packs.Export(target, name, Json.Get<string?>(p, "author", null),
                    Json.Get<string?>(p, "description", null), Json.Get(p, "scenarios", new List<string>()), Json.Get(p, "presets", new List<string>())));
            }
            case "packs.pickImport":
            {
                var packs = _packs ?? throw new InvalidOperationException("Set up the KovaaK's folder first.");
                var path = Json.Get<string?>(p, "path", null);
                if (path == null)
                {
                    using var dlg = new OpenFileDialog { Title = "Import pack", Filter = "Kovaak's Plus pack|*.kpack;*.zip" };
                    if (dlg.ShowDialog(_form) != DialogResult.OK) return null;
                    path = dlg.FileName;
                }
                return packs.Preview(path);
            }
            case "packs.previewData":
            {
                // A .kpack dropped onto the window arrives as a data URL (the browser can't see file paths).
                var packs = _packs ?? throw new InvalidOperationException("Set up the KovaaK's folder first.");
                var data = Json.Get(p, "dataUrl", "");
                int comma = data.IndexOf(',');
                if (!data.StartsWith("data:") || comma < 0) throw new InvalidOperationException("Invalid file data");
                var dir = Path.Combine(AppPaths.Cache, "imports");
                Directory.CreateDirectory(dir);
                foreach (var old in new DirectoryInfo(dir).GetFiles().Where(f => f.CreationTime < DateTime.Now.AddDays(-1)))
                    try { old.Delete(); } catch { }
                var path = Path.Combine(dir, Guid.NewGuid().ToString("N") + ".kpack");
                await File.WriteAllBytesAsync(path, Convert.FromBase64String(data[(comma + 1)..]));
                return packs.Preview(path);
            }
            case "packs.import":
            {
                var packs = _packs ?? throw new InvalidOperationException("Set up the KovaaK's folder first.");
                var res = await Task.Run(() => packs.Import(Json.Get(p, "path", ""), Json.Get(p, "scenarios", new List<string>()),
                    Json.Get(p, "presets", new List<string>()), Json.Get(p, "overwrite", false)));
                await Task.Run(() => Scenarios.Scan(RequirePaths()));
                return res;
            }

            // ---------- benchmarks ----------
            case "evxl.catalog":
            {
                var cat = Evxl.GetCatalog(Json.Get(p, "refresh", false));
                return new
                {
                    resolving = Evxl.Resolving,
                    benchmarks = cat.Entries.Values.OrderBy(e => e.Name ?? "~").Select(e => new
                    {
                        e.Id, e.Name, e.Difficulty, scenarioCount = e.Scenarios.Count, scenarios = e.Scenarios.Keys,
                    }),
                    // One entry per benchmark with its difficulties, like evxl.app.
                    groups = BenchmarkGroups(cat),
                };
            }
            case "evxl.benchmark":
                return await BenchmarkWithLocal(Json.Get(p, "id", 0), Json.Get(p, "refresh", false), Json.Get<string?>(p, "steamId", null));

            // ---------- leaderboards ----------
            case "lb.scenario":
                return await ScenarioLeaderboard(p);
            case "lb.position":
            {
                var name = Json.Get(p, "name", "");
                var lb = await Evxl.ResolveLeaderboardId(name);
                if (lb == 0) return null;
                var (pos, total) = await Evxl.EstimatePosition(lb, Json.Get(p, "score", 0.0));
                return new { leaderboardId = lb, position = pos, total };
            }
            case "lb.scoreAt":
            {
                // Score currently held at a leaderboard position (for "what do I need for #N / top X%").
                var lb = await Evxl.ResolveLeaderboardId(Json.Get(p, "name", ""));
                if (lb == 0) return null;
                var first = await Evxl.GetScenarioLeaderboard(lb, 0, 100);
                int total = first["total"]?.GetValue<int>() ?? 0;
                int pos = Json.Get(p, "position", 0);
                var pct = Json.Get<double?>(p, "percent", null);
                if (pct != null) pos = (int)Math.Ceiling(total * pct.Value / 100.0);
                pos = Math.Clamp(pos, 1, Math.Max(1, total));
                var page = (pos - 1) / 100;
                var rows = (page == 0 ? first : await Evxl.GetScenarioLeaderboard(lb, page, 100))["rows"]!.AsArray();
                var row = rows.Count == 0 ? null : rows[Math.Min(rows.Count - 1, (pos - 1) % 100)];
                return new { leaderboardId = lb, position = pos, total, score = row?["score"]?.GetValue<double>(), name = row?["name"]?.GetValue<string>() };
            }
            case "lb.benchmark":
            {
                var id = Json.Get(p, "id", 0);
                var scope = Json.Get(p, "scope", "global");
                var q = $"/leaderboard?benchmarkId={id}&page={Json.Get(p, "page", 0)}&max={Json.Get(p, "max", 50)}";
                var search = Json.Get<string?>(p, "search", null);
                if (!string.IsNullOrWhiteSpace(search)) q += "&usernameSearch=" + Uri.EscapeDataString(search);
                var country = Json.Get<string?>(p, "country", null);
                if (!string.IsNullOrWhiteSpace(country)) q += "&country=" + Uri.EscapeDataString(country.ToLowerInvariant());
                if (scope == "friends" && Config.SteamId != null) q += "&steamIdFriendSearch=" + Config.SteamId;
                if (scope == "me" && Config.SteamId != null) q += "&steamIdSearch=" + Config.SteamId;
                return await Evxl.Get(q);
            }
            case "lb.countries":
                return await Evxl.Get($"/leaderboard-country-averages?benchmarkId={Json.Get(p, "id", 0)}&minPlayers={Json.Get(p, "minPlayers", 5)}");
            case "lb.friends":
                return Config.SteamId == null ? new List<Friend>() : await Evxl.GetFriends(Config.SteamId, Json.Get(p, "refresh", false));
            case "evxl.profile":
            {
                // steamId: someone else's profile (viewed from a leaderboard or player search); default is yours.
                var other = OtherPlayer(Json.Get<string?>(p, "steamId", null));
                var sid = other ?? Config.SteamId;
                if (string.IsNullOrWhiteSpace(sid)) return null;
                return await Evxl.GetProfileRanks(sid, Json.Get(p, "refresh", false), saveOffline: other == null);
            }
            case "player.search":
                return await Evxl.SearchPlayers(Json.Get(p, "query", ""));
            case "evxl.get":
                return await Evxl.Get(Json.Get(p, "path", ""));

            default:
                throw new InvalidOperationException("Unknown method " + method);
        }
    }

    // ---------- media files ----------
    // Thumbnails/previews/icons are stored under %APPDATA%\KovaaksPlus\media\<scenarios|tags|presets>\<name>\,
    // so they're easy to find; values are paths relative to the media folder ("tags/Static Clicking/thumbnail-1a2b3c.png").

    static string SafeName(string s)
    {
        var clean = string.Concat(s.Split(Path.GetInvalidFileNameChars())).Trim().TrimEnd('.');
        return clean.Length == 0 ? "unnamed" : clean.Length > 80 ? clean[..80] : clean;
    }

    public static string MediaTarget(string? owner, string? target, string ext)
    {
        string folder = "other", sub = "";
        if (owner != null && owner.IndexOf(':') is var i and > 0)
        {
            folder = owner[..i] switch { "scenario" => "scenarios", "tag" => "tags", "preset" => "presets", _ => "other" };
            sub = SafeName(owner[(i + 1)..]);
        }
        var file = $"{SafeName(target ?? "image")}-{Guid.NewGuid().ToString("N")[..6]}{ext}";
        var rel = sub.Length > 0 ? $"{folder}/{sub}/{file}" : $"{folder}/{file}";
        Directory.CreateDirectory(Path.GetDirectoryName(MediaFull(rel))!);
        return rel;
    }

    /// <summary>Absolute path for a media value, refusing anything that escapes the media folder.</summary>
    public static string MediaFull(string rel)
    {
        var root = Path.GetFullPath(AppPaths.Media);
        var full = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Invalid media path");
        return full;
    }

    SettingsManager RequireSettings() => _settings ?? throw new InvalidOperationException("Set up the KovaaK's folder first.");

    /// <summary>KovaaK's keeps settings in memory and rewrites them on exit, so edits must happen while it's closed.</summary>
    async Task<object> WithGameClosed(bool restart, string reason, Action<SettingsManager> apply)
    {
        var s = RequireSettings();
        bool wasRunning = Watcher.IsRunning;
        if (wasRunning && !restart) return new { needsRestart = true };
        if (wasRunning)
        {
            _form.Emit("toast", new { text = "Closing KovaaK's to apply settings…" });
            if (!await Watcher.CloseGameAsync()) throw new InvalidOperationException("KovaaK's didn't close in time. Close it manually, then apply again.");
            await Task.Delay(800);
        }
        apply(s);
        if (wasRunning) Watcher.LaunchGame();
        return new { applied = true, relaunched = wasRunning };
    }

    // =====================================================================================
    // Library

    record ScenarioStats(int Plays, double Pb, DateTime? PbDate, DateTime? Last, DateTime? First, double Recent);

    Dictionary<string, ScenarioStats> AggregateStats()
    {
        return Stats.All().GroupBy(r => r.Scenario, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g =>
        {
            var best = g.MaxBy(r => r.Score)!;
            var recent = g.OrderByDescending(r => r.Date).Take(5).Average(r => r.Score);
            return new ScenarioStats(g.Count(), best.Score, best.Date, g.Max(r => r.Date), g.Min(r => r.Date), recent);
        }, StringComparer.OrdinalIgnoreCase);
    }

    Dictionary<string, List<int>> BenchmarkMembership()
    {
        var map = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in Evxl.Catalog.Entries.Values)
            foreach (var s in e.Scenarios.Keys)
                (map.TryGetValue(s, out var l) ? l : map[s] = new()).Add(e.Id);
        return map;
    }

    object BuildLibrary()
    {
        var agg = AggregateStats();
        var bench = BenchmarkMembership();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in Scenarios.All()) names.Add(s.Name);
        foreach (var n in agg.Keys) names.Add(n);
        foreach (var n in Library.Data.Scenarios.Keys) names.Add(n);

        var list = names.Select(n =>
        {
            var f = Scenarios.Find(n);
            var m = Library.Meta(n);
            agg.TryGetValue(n, out var st);
            return new
            {
                name = n,
                customName = m.CustomName,
                tags = m.Tags,
                favorite = m.Favorite,
                hidden = m.Hidden,
                thumbnail = m.Thumbnail,
                preview = m.Preview,
                preset = m.Preset,
                hasNotes = m.Notes != null,
                installed = f != null,
                source = f?.Source,
                author = f?.Author,
                gameTag = f?.GameTag,
                timeLimit = f?.TimeLimit ?? 0,
                plays = st?.Plays ?? 0,
                pb = st?.Pb,
                pbDate = st?.PbDate,
                lastPlayed = st?.Last,
                firstPlayed = st?.First,
                recentAvg = st?.Recent,
                benchmarks = bench.GetValueOrDefault(n),
            };
        }).ToList();
        return new { scenarios = list, tags = Library.Data.Tags, groups = Library.Data.Groups };
    }

    object ScenarioDetail(string name)
    {
        var f = Scenarios.Find(name);
        var m = Library.Meta(name);
        var runs = RunsWithPb(Stats.ForScenario(name));
        var bench = BenchmarkMembership().GetValueOrDefault(name) ?? new();
        return new
        {
            name,
            meta = m,
            file = f,
            runs,
            benchmarks = bench.Select(id => Evxl.Catalog.Entries.GetValueOrDefault(id))
                .Where(e => e != null).Select(e => new { e!.Id, e.Name, e.Difficulty }),
        };
    }

    void SetMeta(JsonElement p)
    {
        var name = Json.Get(p, "name", "");
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("name required");
        Library.Update(name, m =>
        {
            static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
            if (p.TryGetProperty("customName", out _)) m.CustomName = Clean(Json.Get<string?>(p, "customName", null));
            if (p.TryGetProperty("notes", out _)) m.Notes = Clean(Json.Get<string?>(p, "notes", null));
            if (p.TryGetProperty("tags", out _)) m.Tags = Json.Get(p, "tags", new List<string>());
            if (p.TryGetProperty("thumbnail", out _)) m.Thumbnail = Json.Get<string?>(p, "thumbnail", null);
            if (p.TryGetProperty("preview", out _)) m.Preview = Json.Get<string?>(p, "preview", null);
            if (p.TryGetProperty("favorite", out _)) m.Favorite = Json.Get(p, "favorite", false);
            if (p.TryGetProperty("hidden", out _)) m.Hidden = Json.Get(p, "hidden", false);
            if (p.TryGetProperty("preset", out _)) m.Preset = Json.Get<string?>(p, "preset", null);
        });
    }

    void Bulk(JsonElement p)
    {
        var names = Json.Get(p, "names", new List<string>());
        var add = Json.Get(p, "addTags", new List<string>());
        var remove = Json.Get(p, "removeTags", new List<string>());
        bool? fav = p.TryGetProperty("favorite", out _) ? Json.Get(p, "favorite", false) : null;
        bool? hidden = p.TryGetProperty("hidden", out _) ? Json.Get(p, "hidden", false) : null;
        bool setPreset = p.TryGetProperty("preset", out _);
        var preset = Json.Get<string?>(p, "preset", null);
        foreach (var n in names)
            Library.Update(n, m =>
            {
                foreach (var t in add) if (!m.Tags.Contains(t)) m.Tags.Add(t);
                m.Tags.RemoveAll(remove.Contains);
                if (fav != null) m.Favorite = fav.Value;
                if (hidden != null) m.Hidden = hidden.Value;
                if (setPreset) m.Preset = preset;
            });
    }

    /// <summary>Tags benchmark scenarios with their benchmark category (e.g. "Clicking Static" → existing "Static Clicking") and difficulty.</summary>
    async Task<object> AutoTagFromBenchmarks(List<int> ids)
    {
        int tagged = 0;
        var benchTag = Library.EnsureTag("Benchmark", "Other", "#eab308");
        foreach (var id in ids)
        {
            var b = await Evxl.GetBenchmark(id, Config.SteamId, false);
            var difficulty = b["difficulty"]?.GetValue<string>();
            var diffTag = difficulty == null ? null : Library.EnsureTag(difficulty, "Difficulty", "#facc15");
            foreach (var c in b["categories"]!.AsArray())
            {
                var catTag = MatchCategoryTag(c!["name"]!.GetValue<string>());
                foreach (var s in c["scenarios"]!.AsArray())
                {
                    var sn = s!["name"]!.GetValue<string>();
                    Library.Update(sn, m =>
                    {
                        foreach (var t in new[] { benchTag, catTag, diffTag })
                            if (t != null && !m.Tags.Contains(t.Id)) m.Tags.Add(t.Id);
                    });
                    tagged++;
                }
            }
        }
        Library.Save();
        return new { tagged };
    }

    TagDef MatchCategoryTag(string category)
    {
        // "TrackingReactive" → "Tracking Reactive"; compare as unordered word sets.
        var spaced = Regex.Replace(category, "(?<=[a-z])(?=[A-Z])", " ").Trim();
        var words = WordSet(spaced);
        var existing = Library.Data.Tags.FirstOrDefault(t => WordSet(t.Name).SetEquals(words));
        if (existing != null) return existing;
        var parts = spaced.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var name = parts.Length == 2 ? $"{parts[1]} {parts[0]}" : spaced;   // "Clicking Static" → "Static Clicking"
        return Library.EnsureTag(name, "Aim Type", "#38bdf8");
    }

    static HashSet<string> WordSet(string s) =>
        s.ToLowerInvariant().Split(new[] { ' ', '-', '_' }, StringSplitOptions.RemoveEmptyEntries).ToHashSet();

    // =====================================================================================
    // Stats

    static List<object> RunsWithPb(List<RunSummary> runs)
    {
        double best = double.MinValue;
        var list = new List<object>(runs.Count);
        foreach (var r in runs.OrderBy(r => r.Date))
        {
            bool pb = r.Score > best;
            if (pb) best = r.Score;
            list.Add(new { r.File, r.Date, r.Score, r.Accuracy, r.Kills, r.Shots, r.Hits, r.AvgTtk, r.Sens, r.SensScale, r.Fov, r.PauseCount, r.AvgFps, pb });
        }
        return list;
    }

    object StatsOverview()
    {
        var runs = Stats.All();
        var timeLimits = Scenarios.All().ToDictionary(s => s.Name, s => s.TimeLimit, StringComparer.OrdinalIgnoreCase);
        // Prefer the measured duration (includes pauses, so cap it by the time limit when we know it).
        double RunSeconds(RunSummary r)
        {
            var limit = timeLimits.TryGetValue(r.Scenario, out var t) && t > 0 ? t : 0;
            if (r.Duration > 0) return limit > 0 ? Math.Min(r.Duration, limit) : Math.Min(r.Duration, 900);
            return limit > 0 ? Math.Min(limit, 900) : Math.Max(r.FightTime, 0);
        }

        var daily = new Dictionary<string, (int runs, double secs, int pbs)>();
        var bestSoFar = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        var recent = new List<object>();
        foreach (var r in runs)
        {
            bool pb = !bestSoFar.TryGetValue(r.Scenario, out var b) || r.Score > b;
            bool improved = pb && bestSoFar.ContainsKey(r.Scenario);
            if (pb) bestSoFar[r.Scenario] = r.Score;
            var day = r.Date.ToString("yyyy-MM-dd");
            var d = daily.GetValueOrDefault(day);
            daily[day] = (d.runs + 1, d.secs + RunSeconds(r), d.pbs + (improved ? 1 : 0));
        }
        var tail = runs.Skip(Math.Max(0, runs.Count - 60)).Reverse();
        foreach (var r in tail)
        {
            var prevBest = runs.Where(x => x.Date < r.Date && x.Scenario.Equals(r.Scenario, StringComparison.OrdinalIgnoreCase))
                .Select(x => x.Score).DefaultIfEmpty(double.MinValue).Max();
            recent.Add(new { r.File, r.Scenario, r.Date, r.Score, r.Accuracy, pb = prevBest != double.MinValue && r.Score > prevBest });
        }
        var top = runs.GroupBy(r => r.Scenario, StringComparer.OrdinalIgnoreCase)
            .Select(g => new { scenario = g.Key, plays = g.Count(), pb = g.Max(r => r.Score), last = g.Max(r => r.Date), seconds = g.Sum(RunSeconds) })
            .OrderByDescending(x => x.plays).Take(25).ToList();
        var today = DateTime.Today.ToString("yyyy-MM-dd");
        var td = daily.GetValueOrDefault(today);
        return new
        {
            totalRuns = runs.Count,
            totalScenarios = bestSoFar.Count,
            totalSeconds = runs.Sum(RunSeconds),
            first = runs.FirstOrDefault()?.Date,
            daily = daily.Select(kv => new { day = kv.Key, runs = kv.Value.runs, seconds = Math.Round(kv.Value.secs), pbs = kv.Value.pbs }).OrderBy(x => x.day),
            today = new { runs = td.runs, seconds = Math.Round(td.secs), pbs = td.pbs },
            recent,
            top,
        };
    }

    // =====================================================================================
    // Benchmarks

    /// <summary>A steamId that isn't yours, or null.</summary>
    string? OtherPlayer(string? steamId) => string.IsNullOrWhiteSpace(steamId) || steamId == Config.SteamId ? null : steamId;

    /// <param name="steamId">Another player to view: their KovaaK's scores only, none of your local PBs.</param>
    async Task<JsonObject> BenchmarkWithLocal(int id, bool refresh, string? steamId = null)
    {
        var other = OtherPlayer(steamId);
        var sid = other ?? Config.SteamId;
        var b = await Evxl.GetBenchmark(id, sid, refresh, saveOffline: other == null);
        b["viewing"] = other;
        var agg = other == null ? AggregateStats() : new();
        foreach (var c in b["categories"]!.AsArray())
            foreach (var s in c!["scenarios"]!.AsArray())
            {
                var name = s!["name"]!.GetValue<string>();
                agg.TryGetValue(name, out var st);
                var meta = Library.Meta(name);
                s["localBest"] = st?.Pb;
                s["plays"] = st?.Plays ?? 0;
                s["lastPlayed"] = st?.Last;
                s["installed"] = Scenarios.Find(name) != null;
                s["customName"] = meta.CustomName;
                s["thumbnail"] = meta.Thumbnail;
            }
        // evxl's own server-side rank (exact for every scoring method, but only as fresh as KovaaK's leaderboards).
        if (sid != null)
        {
            try
            {
                var prof = await Evxl.GetProfileRanks(sid, refresh, saveOffline: other == null);
                var bn = b["name"]?.GetValue<string>();
                var dn = b["difficulty"]?.GetValue<string>();
                foreach (var r in prof?["results"]?.AsArray() ?? new JsonArray())
                    if (r?["benchmarkName"]?.GetValue<string>() == bn && (dn == null || r?["difficultyName"]?.GetValue<string>() == dn))
                    { b["evxlRank"] = r!.DeepClone(); break; }
            }
            catch { }
        }
        return b;
    }

    // =====================================================================================
    // Playing (with per-scenario / per-tag default presets)

    /// <summary>The preset a scenario should use: its own, else the first of its tags (in tag-list order) that has one.</summary>
    public Preset? EffectivePreset(string scenario)
    {
        var meta = Library.Meta(scenario);
        if (meta.Preset != null && Presets.Get(meta.Preset) is { } own) return own;
        foreach (var t in Library.Data.Tags)
            if (t.Preset != null && meta.Tags.Contains(t.Id) && Presets.Get(t.Preset) is { } tp) return tp;
        return null;
    }

    /// <summary>
    /// decision: null → follow Config.PresetMode ("ask" returns needsPreset to the UI), "apply" or "skip".
    /// Applying while KovaaK's runs means close → write settings → relaunch straight into the scenario.
    /// </summary>
    async Task<object> Play(string name, string mode, string? decision)
    {
        var preset = Config.PresetMode == "off" && decision == null ? null : EffectivePreset(name);
        if (preset != null && decision != "skip" && _settings != null && !_settings.Matches(preset))
        {
            if (decision != "apply" && Config.PresetMode != "auto")
                return new { needsPreset = true, preset = new { preset.Id, preset.Name }, running = Watcher.IsRunning };
            if (Watcher.IsRunning)
            {
                _form.Emit("toast", new { text = $"Applying \"{preset.Name}\": restarting KovaaK's…" });
                if (!await Watcher.CloseGameAsync()) throw new InvalidOperationException("KovaaK's didn't close in time. Close it manually and try again.");
                await Task.Delay(800);
            }
            _settings.ApplyPreset(preset);
            await Watcher.PlayScenario(name, mode);   // starts the game directly into the scenario
            return new { played = true, presetApplied = preset.Name };
        }
        await Watcher.PlayScenario(name, mode);
        return new { played = true };
    }

    List<string> AllScenarioNames()
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in Scenarios.All()) names.Add(s.Name);
        foreach (var r in Stats.All()) names.Add(r.Scenario);
        return names.ToList();
    }

    object AutoTagApply(JsonElement p)
    {
        int assigned = 0, created = 0;
        if (!p.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array) return new { assigned, created };
        foreach (var item in items.EnumerateArray())
        {
            var names = Json.Get(item, "names", new List<string>());
            string? tagId = Json.Get<string?>(item, "tagId", null);
            if (tagId == null && item.TryGetProperty("create", out var c))
            {
                var name = Json.Get(c, "name", "").Trim();
                if (name.Length == 0) continue;
                bool existed = Library.Data.Tags.Any(t => t.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
                tagId = Library.EnsureTag(name, Json.Get(c, "group", "Custom"), Json.Get(c, "color", "#8b5cf6")).Id;
                if (!existed) created++;
            }
            if (tagId == null || Library.Data.Tags.All(t => t.Id != tagId)) continue;
            foreach (var n in names)
                Library.Update(n, m => { if (!m.Tags.Contains(tagId)) { m.Tags.Add(tagId); assigned++; } });
        }
        Library.Save();
        return new { assigned, created };
    }

    static object BenchmarkGroups(BenchmarkCatalog cat)
    {
        var grouped = new HashSet<int>();
        var list = new List<object>();
        foreach (var g in cat.Groups)
        {
            var diffs = g.Difficulties.Where(d => d.Id > 0 && cat.Entries.ContainsKey(d.Id)).ToList();
            if (diffs.Count == 0) continue;
            diffs.ForEach(d => grouped.Add(d.Id));
            list.Add(new
            {
                g.Name, g.Abbreviation, g.Color, g.RankCalculation, g.DateAdded,
                difficulties = diffs.Select(d => new
                {
                    d.Id, d.Name, scenarioCount = cat.Entries[d.Id].Scenarios.Count, scenarios = cat.Entries[d.Id].Scenarios.Keys,
                    ranks = d.RankColors,
                }),
            });
        }
        // Anything evxl's config didn't cover still appears, grouped by name.
        foreach (var byName in cat.Entries.Values.Where(e => !grouped.Contains(e.Id)).GroupBy(e => e.Name ?? $"Benchmark {e.Id}"))
            list.Add(new
            {
                Name = byName.Key, Abbreviation = (string?)null, Color = (string?)null, RankCalculation = (string?)null, DateAdded = (string?)null,
                difficulties = byName.Select(e => new
                {
                    e.Id, Name = e.Difficulty ?? "Main", scenarioCount = e.Scenarios.Count, scenarios = e.Scenarios.Keys,
                    ranks = e.RankColors.Select(kv => new RankColorEntry { Name = kv.Key, Color = kv.Value }).ToList(),
                }),
            });
        return list;
    }

    /// <summary>scope: global (KovaaK's), friends (evxl friend list + their scores), me (page around your position).</summary>
    async Task<object> ScenarioLeaderboard(JsonElement p)
    {
        var name = Json.Get(p, "name", "");
        var scope = Json.Get(p, "scope", "global");
        int page = Json.Get(p, "page", 0), max = Math.Clamp(Json.Get(p, "max", 50), 5, 100);
        var lb = Json.Get(p, "leaderboardId", 0L);
        if (lb == 0) lb = await Evxl.ResolveLeaderboardId(name);
        if (lb == 0) return new { leaderboardId = 0, rows = Array.Empty<object>(), error = "No online leaderboard found for this scenario." };

        var localBest = Stats.ForScenario(name).Select(r => r.Score).DefaultIfEmpty(0).Max();
        PlayerResult? myResult = null;
        if (Config.SteamId != null)
        {
            try { (await Evxl.GetPlayerResults(Config.SteamId)).TryGetValue(name, out myResult); } catch { }
        }
        object? me = myResult == null ? null : new { position = myResult.Position, players = myResult.Players };

        if (scope == "friends")
        {
            if (Config.SteamId == null) return new { leaderboardId = lb, rows = Array.Empty<object>(), error = "Add your Steam ID in App Settings to see friends." };
            var friends = await Evxl.GetFriends(Config.SteamId);
            var rows = new System.Collections.Concurrent.ConcurrentBag<(string id, string name, string? country, double score, bool self)>();
            await Parallel.ForEachAsync(friends, new ParallelOptions { MaxDegreeOfParallelism = 8 }, async (f, _) =>
            {
                var scores = await Evxl.GetPlayerScores(f.SteamId, new[] { lb });
                if (scores.TryGetValue(lb, out var s) && s > 0) rows.Add((f.SteamId, f.Name, f.Country, s, false));
            });
            var mine = (await Evxl.GetPlayerScores(Config.SteamId, new[] { lb })).GetValueOrDefault(lb);
            var best = Math.Max(mine, localBest);
            if (best > 0) rows.Add((Config.SteamId, Config.SteamName ?? "You", null, best, true));
            var ordered = rows.OrderByDescending(r => r.score).Select((r, i) => (object)new
            {
                rank = i + 1, steamId = r.id, r.name, r.country, r.score, self = r.self,
            }).ToList();
            return new { leaderboardId = lb, total = ordered.Count, rows = ordered, me, friendCount = friends.Count };
        }

        if (scope == "me")
        {
            // evxl's positions are a daily snapshot; locate your best score on the live board instead.
            double best = localBest;
            if (Config.SteamId != null) best = Math.Max(best, (await Evxl.GetPlayerScores(Config.SteamId, new[] { lb })).GetValueOrDefault(lb));
            if (best > 0)
            {
                var (pos, total) = await Evxl.EstimatePosition(lb, best - 0.001);
                page = Math.Max(0, (pos - 1) / max);
                me = new { position = pos, players = total };
            }
            else if (myResult != null) page = Math.Max(0, (myResult.Position - 1) / max);
        }
        var res = await Evxl.GetScenarioLeaderboard(lb, page, max);
        foreach (var r in res["rows"]!.AsArray())
            if (r?["steamId"]?.GetValue<string>() == Config.SteamId) r!["self"] = true;
        res["leaderboardId"] = lb;
        res["me"] = me == null ? null : System.Text.Json.JsonSerializer.SerializeToNode(me);
        res["localBest"] = localBest > 0 ? localBest : null;
        return res;
    }

    // =====================================================================================
    // Game events

    void OnPause()
    {
        _form.Emit("game.pause", new { scenario = Watcher.CurrentScenario });
        _form.BringToFrontForced();
    }

    async Task OnStatsFile(string path)
    {
        var run = await Stats.AddAsync(path);
        if (run == null) return;
        Watcher.SetCurrentScenario(run.Scenario);
        var prev = Stats.BestExcluding(run.Scenario, run.File);
        var history = RunsWithPb(Stats.ForScenario(run.Scenario));
        object? rank = null;
        try { rank = await RankInfo(run.Scenario, run.Score, prev?.Score); } catch { /* offline */ }
        var meta = Library.Meta(run.Scenario);
        _form.Emit("run.completed", new
        {
            run,
            displayName = meta.CustomName ?? run.Scenario,
            thumbnail = meta.Thumbnail,
            previousBest = prev?.Score,
            previousBestDate = prev?.Date,
            isPb = prev != null && run.Score > prev.Score,
            isFirst = prev == null,
            history = history.Skip(Math.Max(0, history.Count - 60)),
            rank,
        });
        if (Config.RunEndBringsApp) _form.BringToFrontForced();
    }

    /// <summary>Finds the scenario in a pinned (or any cached) benchmark and computes rank before/after this run.</summary>
    async Task<object?> RankInfo(string scenario, double score, double? previous)
    {
        var membership = BenchmarkMembership().GetValueOrDefault(scenario);
        if (membership == null) return null;
        var id = membership.OrderBy(i => Config.PinnedBenchmarks.Contains(i) ? 0 : 1).First();
        var b = await Evxl.GetBenchmark(id, Config.SteamId, false);
        foreach (var c in b["categories"]!.AsArray())
            foreach (var s in c!["scenarios"]!.AsArray())
            {
                if (!s!["name"]!.GetValue<string>().Equals(scenario, StringComparison.OrdinalIgnoreCase)) continue;
                var maxes = s["rankMaxes"]?.AsArray().Select(x => x?.GetValue<double>() ?? 0).ToList() ?? new();
                var remote = s["remoteScore"]?.GetValue<double>() ?? 0;
                double before = Math.Max(previous ?? 0, remote);
                double best = Math.Max(before, score);
                int Rank(double v) => maxes.Count(t => v >= t);
                return new
                {
                    benchmarkId = id,
                    benchmark = b["name"]?.GetValue<string>(),
                    difficulty = b["difficulty"]?.GetValue<string>(),
                    category = c["name"]?.GetValue<string>(),
                    ranks = b["ranks"]?.DeepClone(),
                    rankMaxes = maxes,
                    rankBefore = Rank(before),
                    rankAfter = Rank(best),
                    runRank = Rank(score),
                };
            }
        return null;
    }
}
