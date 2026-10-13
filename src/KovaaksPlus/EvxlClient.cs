using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace KovaaksPlus;

public class BenchmarkEntry
{
    public int Id { get; set; }
    public string? Name { get; set; }
    public string? Difficulty { get; set; }
    public string? Abbreviation { get; set; }
    public string? Color { get; set; }
    public string? Sharecode { get; set; }
    public Dictionary<string, string> RankColors { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, long> Scenarios { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public class RankColorEntry
{
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#ffffff";
}

/// <summary>One difficulty of a benchmark as evxl.app defines it (layout = categories/subcategories with scenario counts).</summary>
public class BenchDifficulty
{
    public string Name { get; set; } = "";
    public int Id { get; set; }
    public string? Sharecode { get; set; }
    public List<RankColorEntry> RankColors { get; set; } = new();
    public JsonNode? Categories { get; set; }
}

/// <summary>A benchmark with all its difficulties, plus evxl's scoring method ("rankCalculation").</summary>
public class BenchmarkGroup
{
    public string Name { get; set; } = "";
    public string? Abbreviation { get; set; }
    public string? Color { get; set; }
    public string? RankCalculation { get; set; }
    public string? SpreadsheetUrl { get; set; }
    public string? DateAdded { get; set; }
    public List<BenchDifficulty> Difficulties { get; set; } = new();
}

public class BenchmarkCatalog
{
    public const int CurrentVersion = 3;
    public int Version { get; set; }
    public DateTime Fetched { get; set; }
    public Dictionary<int, BenchmarkEntry> Entries { get; set; } = new();
    public List<BenchmarkGroup> Groups { get; set; } = new();
}

public class ScenarioClass
{
    public string Name { get; set; } = "";
    public long LeaderboardId { get; set; }
    public int Players { get; set; }
    public List<string> Skills { get; set; } = new();
    public List<string> Actions { get; set; } = new();
}

public class PlayerResult
{
    public long LeaderboardId { get; set; }
    public int Position { get; set; }
    public int Players { get; set; }
}

public class Friend
{
    public string SteamId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Country { get; set; }
}

/// <summary>
/// Benchmark + leaderboard data. evxl.app (https://api.evxl.app/documentation) supplies the benchmark catalog, player
/// ranks, friends, ratings/positions and scenario classification; KovaaK's public webapp backend supplies rank
/// thresholds and scenario leaderboards. Everything is cached on disk so the app keeps working offline.
/// </summary>
public class EvxlClient
{
    const string Api = "https://api.evxl.app";
    const string Kovaaks = "https://kovaaks.com/webapp-backend";
    // Any valid SteamID returns the thresholds; used only when the user has none configured.
    const string ThresholdProbeId = "76561197960287930";

    static readonly HttpClient Http = CreateHttp();
    static string CatalogPath => Path.Combine(AppPaths.Cache, "benchmarks.json");
    static string DetailPath(int id) => Path.Combine(AppPaths.Cache, "bench", $"{id}.json");
    static string ClassPath => Path.Combine(AppPaths.Cache, "scenario-classes.json");
    static string LbIdPath => Path.Combine(AppPaths.Cache, "leaderboard-ids.json");

    readonly SemaphoreSlim _catalogLock = new(1, 1);
    BenchmarkCatalog _catalog = Json.Read<BenchmarkCatalog>(CatalogPath) ?? new();
    readonly ConcurrentDictionary<string, (DateTime at, JsonNode? node)> _memo = new();
    readonly ConcurrentDictionary<string, long> _lbIds =
        new(Json.Read<Dictionary<string, long>>(LbIdPath) ?? new(), StringComparer.OrdinalIgnoreCase);
    Dictionary<string, ScenarioClass>? _classes;

    public bool Resolving { get; private set; }
    public event Action<int, int>? CatalogProgress;

    static HttpClient CreateHttp()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
        h.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("KovaaksPlus", "1.1"));
        h.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return h;
    }

    static async Task<JsonNode?> GetJson(string url)
    {
        using var res = await Http.GetAsync(url);
        res.EnsureSuccessStatusCode();
        return JsonNode.Parse(await res.Content.ReadAsStringAsync());
    }

    /// <summary>GET with an in-memory TTL cache (and optional disk fallback when offline).</summary>
    async Task<JsonNode?> Cached(string url, TimeSpan ttl, bool refresh = false, string? diskFile = null)
    {
        if (!refresh && _memo.TryGetValue(url, out var m) && DateTime.Now - m.at < ttl) return m.node?.DeepClone();
        try
        {
            var node = await GetJson(url);
            _memo[url] = (DateTime.Now, node?.DeepClone());
            if (diskFile != null && node != null) Json.Write(diskFile, node, compact: true);
            return node;
        }
        catch when (diskFile != null && File.Exists(diskFile))
        {
            return JsonNode.Parse(File.ReadAllText(diskFile));
        }
    }

    public BenchmarkCatalog Catalog => _catalog;

    // =====================================================================================
    // Catalog

    /// <summary>Returns the cached catalog immediately and refreshes it in the background when stale.</summary>
    public BenchmarkCatalog GetCatalog(bool refresh)
    {
        bool stale = refresh || _catalog.Entries.Count == 0 || DateTime.Now - _catalog.Fetched > TimeSpan.FromDays(3)
                     || _catalog.Version < BenchmarkCatalog.CurrentVersion;
        if (stale && !Resolving) _ = Task.Run(() => RefreshCatalog(refresh));
        return _catalog;
    }

    async Task RefreshCatalog(bool force)
    {
        if (!await _catalogLock.WaitAsync(0)) return;
        Resolving = true;
        try
        {
            var root = await GetJson($"{Api}/benchmark-scenarios");
            var next = new BenchmarkCatalog { Fetched = DateTime.Now, Version = BenchmarkCatalog.CurrentVersion };
            if (root?["benchmarks"] is JsonObject benches)
            {
                foreach (var (idStr, val) in benches)
                {
                    if (!int.TryParse(idStr, out var id)) continue;
                    var e = new BenchmarkEntry { Id = id };
                    if (_catalog.Entries.TryGetValue(id, out var old) && !force)
                    {
                        e.Name = old.Name; e.Difficulty = old.Difficulty; e.Abbreviation = old.Abbreviation;
                        e.Color = old.Color; e.Sharecode = old.Sharecode; e.RankColors = old.RankColors;
                    }
                    if (val?["scenarios"] is JsonObject sc)
                        foreach (var (sn, lb) in sc) e.Scenarios[sn] = lb?.GetValue<long>() ?? 0;
                    next.Entries[id] = e;
                }
            }
            next.Groups = _catalog.Groups;
            _catalog = next;

            // Preferred: evxl.app's own benchmark config (grouping, layout, scoring method, rank colours, playlist codes).
            await EnrichFromSite(next);

            // Fallback for anything still unnamed: rank-counts is keyed by "Benchmark name" → "Difficulty".
            var missing = next.Entries.Values.Where(e => e.Name == null).ToList();
            int done = 0;
            CatalogProgress?.Invoke(0, missing.Count);
            await Parallel.ForEachAsync(missing, new ParallelOptions { MaxDegreeOfParallelism = 4 }, async (e, _) =>
            {
                try
                {
                    if (await GetJson($"{Api}/rank-counts?benchmarkId={e.Id}") is JsonObject o && o.Count > 0)
                    {
                        var first = o.First();
                        e.Name = first.Key;
                        if (first.Value is JsonObject diffs && diffs.Count > 0) e.Difficulty = diffs.First().Key;
                    }
                }
                catch { }
                Interlocked.Increment(ref done);
            });
            Json.Write(CatalogPath, _catalog, compact: true);
        }
        catch { /* offline: keep cached */ }
        finally
        {
            Resolving = false;
            _catalogLock.Release();
            CatalogProgress?.Invoke(-1, -1);
        }
    }

    /// <summary>
    /// evxl.app ships its benchmark definitions inside front-end chunks (JSON.parse(`[...]`)). The documented API has no
    /// names/layout endpoint, so we find those chunks by following the page's script imports. Best-effort only.
    /// </summary>
    async Task EnrichFromSite(BenchmarkCatalog catalog)
    {
        try
        {
            const string site = "https://evxl.app";
            var html = await Http.GetStringAsync(site + "/groups/kovaaks");
            var queue = new Queue<string>();
            var seen = new HashSet<string>();
            foreach (Match m in Regex.Matches(html, @"/_app/immutable/[\w\-/.]+\.js"))
                if (seen.Add(m.Value)) queue.Enqueue(m.Value);

            var configs = new List<JsonArray>();
            while (queue.Count > 0 && seen.Count < 450)
            {
                var path = queue.Dequeue();
                string js;
                try { js = await Http.GetStringAsync(site + path); } catch { continue; }
                int at = js.IndexOf("kovaaksBenchmarkId", StringComparison.Ordinal);
                if (at >= 0)
                {
                    int start = js.LastIndexOf("JSON.parse(`", at, StringComparison.Ordinal);
                    int end = start < 0 ? -1 : js.IndexOf("`)", at, StringComparison.Ordinal);
                    if (start >= 0 && end > start)
                    {
                        var text = js[(start + 12)..end].Replace("\\`", "`").Replace("\\${", "${").Replace("\\\\", "\\");
                        try { if (JsonNode.Parse(text) is JsonArray arr) configs.Add(arr); } catch { }
                    }
                }
                var dir = path[..(path.LastIndexOf('/') + 1)];
                foreach (Match m in Regex.Matches(js, @"[""'`](\.{1,2}/[\w\-/.]+\.js)[""'`]"))
                {
                    var resolved = new Uri(new Uri(site + dir), m.Groups[1].Value).AbsolutePath;
                    if (seen.Add(resolved)) queue.Enqueue(resolved);
                }
            }
            if (configs.Count == 0) return;

            var groups = new Dictionary<string, BenchmarkGroup>(StringComparer.OrdinalIgnoreCase);
            foreach (var b in configs.SelectMany(c => c))
            {
                var name = b?["benchmarkName"]?.GetValue<string>();
                if (name == null || b?["difficulties"] is not JsonArray diffs) continue;
                if (b["hidden"]?.GetValue<bool>() == true) continue;
                var g = new BenchmarkGroup
                {
                    Name = name,
                    Abbreviation = b["abbreviation"]?.GetValue<string>(),
                    Color = b["color"]?.GetValue<string>(),
                    RankCalculation = b["rankCalculation"]?.GetValue<string>(),
                    SpreadsheetUrl = b["spreadsheetURL"]?.GetValue<string>(),
                    DateAdded = b["dateAdded"]?.GetValue<string>(),
                };
                foreach (var d in diffs)
                {
                    int id = d?["kovaaksBenchmarkId"] is JsonValue idv && idv.TryGetValue<int>(out var x) ? x : -1;
                    var diff = new BenchDifficulty
                    {
                        Name = d?["difficultyName"]?.GetValue<string>() ?? "",
                        Id = id,
                        Sharecode = d?["sharecode"]?.GetValue<string>() is { Length: > 0 } sc ? sc : null,
                        Categories = d?["categories"]?.DeepClone(),
                    };
                    if (d?["rankColors"] is JsonObject rc)
                        foreach (var (rn, rv) in rc) diff.RankColors.Add(new RankColorEntry { Name = rn, Color = rv?.GetValue<string>() ?? "#ffffff" });
                    g.Difficulties.Add(diff);

                    if (id > 0 && catalog.Entries.TryGetValue(id, out var e))
                    {
                        e.Name = name;
                        e.Difficulty = string.IsNullOrWhiteSpace(diff.Name) || diff.Name == "All" ? e.Difficulty : diff.Name;
                        e.Abbreviation = g.Abbreviation;
                        e.Color = g.Color;
                        e.Sharecode = diff.Sharecode;
                        e.RankColors = diff.RankColors.GroupBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
                            .ToDictionary(r => r.Key, r => r.First().Color, StringComparer.OrdinalIgnoreCase);
                    }
                }
                // Only KovaaK's benchmarks we can actually load (at least one difficulty with a KovaaK's id).
                if (g.Difficulties.Any(d => d.Id > 0 && catalog.Entries.ContainsKey(d.Id)) && !groups.ContainsKey(name))
                    groups[name] = g;
            }
            if (groups.Count > 0) catalog.Groups = groups.Values.OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }
        catch { /* enrichment is optional */ }
    }

    public BenchmarkGroup? GroupFor(int id) => _catalog.Groups.FirstOrDefault(g => g.Difficulties.Any(d => d.Id == id));

    // =====================================================================================
    // Benchmark detail

    /// <summary>Benchmark thresholds + the player's server-side scores, normalised into a UI-friendly shape.</summary>
    /// <param name="saveOffline">Only your own data is written to the offline cache, so a viewed player's scores never show up as yours.</param>
    public async Task<JsonObject> GetBenchmark(int id, string? steamId, bool refresh, bool saveOffline = true)
    {
        var sid = string.IsNullOrWhiteSpace(steamId) ? ThresholdProbeId : steamId;
        var key = $"bench:{id}:{sid}";
        if (!refresh && _memo.TryGetValue(key, out var m) && DateTime.Now - m.at < TimeSpan.FromMinutes(20) && m.node != null)
            return (JsonObject)m.node.DeepClone();

        JsonNode? raw;
        bool offline = false;
        try
        {
            raw = await GetJson($"{Kovaaks}/benchmarks/player-progress-rank-benchmark?benchmarkId={id}&steamId={sid}&page=0&max=100");
            if (saveOffline) Json.Write(DetailPath(id), raw!, compact: true);
        }
        catch
        {
            raw = saveOffline && File.Exists(DetailPath(id)) ? JsonNode.Parse(File.ReadAllText(DetailPath(id))) : null;
            offline = true;
            if (raw == null) throw new InvalidOperationException("Couldn't reach KovaaK's benchmark service and nothing is cached yet.");
        }

        var entry = _catalog.Entries.GetValueOrDefault(id);
        var group = GroupFor(id);
        var diff = group?.Difficulties.FirstOrDefault(d => d.Id == id);
        var result = new JsonObject
        {
            ["id"] = id,
            ["name"] = group?.Name ?? entry?.Name ?? $"Benchmark {id}",
            ["difficulty"] = diff?.Name ?? entry?.Difficulty,
            ["offline"] = offline,
            ["hasPlayer"] = !string.IsNullOrWhiteSpace(steamId),
            ["overallRank"] = raw?["overall_rank"]?.DeepClone(),
            ["progress"] = raw?["benchmark_progress"]?.DeepClone(),
            ["sharecode"] = entry?.Sharecode,
            ["color"] = group?.Color ?? entry?.Color,
            ["abbreviation"] = group?.Abbreviation,
            ["rankCalculation"] = group?.RankCalculation,
            ["spreadsheetUrl"] = group?.SpreadsheetUrl,
            ["layout"] = diff?.Categories?.DeepClone(),
            ["rankNames"] = diff == null ? null : new JsonArray(diff.RankColors.Select(r => (JsonNode)new JsonObject { ["name"] = r.Name, ["color"] = r.Color }).ToArray()),
            ["difficulties"] = group == null ? null : new JsonArray(group.Difficulties.Select(d => (JsonNode)new JsonObject
            {
                ["id"] = d.Id, ["name"] = d.Name, ["rankCount"] = d.RankColors.Count,
            }).ToArray()),
        };
        var ranks = new JsonArray();
        if (raw?["ranks"] is JsonArray rr)
            foreach (var r in rr)
            {
                var rname = r?["name"]?.GetValue<string>();
                var color = r?["color"]?.GetValue<string>();
                // KovaaK's often returns #ffffff for every rank; evxl's config has the real colours.
                if ((color == null || color.Equals("#ffffff", StringComparison.OrdinalIgnoreCase)) && rname != null
                    && entry?.RankColors.TryGetValue(rname, out var better) == true) color = better;
                ranks.Add(new JsonObject { ["name"] = rname, ["color"] = color, ["icon"] = r?["icon"]?.DeepClone() });
            }
        result["ranks"] = ranks;

        var cats = new JsonArray();
        if (raw?["categories"] is JsonObject co)
        {
            foreach (var (cname, c) in co)
            {
                var scen = new JsonArray();
                if (c?["scenarios"] is JsonObject so)
                    foreach (var (sname, s) in so)
                        scen.Add(new JsonObject
                        {
                            ["name"] = sname,
                            ["leaderboardId"] = s?["leaderboard_id"]?.DeepClone(),
                            // The webapp reports scores in hundredths (115067 = 1150.67); thresholds are unscaled.
                            ["remoteScore"] = s?["score"] is JsonValue sv && sv.TryGetValue<double>(out var raw100) ? Math.Round(raw100 / 100.0, 2) : null,
                            ["leaderboardRank"] = s?["leaderboard_rank"]?.DeepClone(),
                            ["remoteRank"] = s?["scenario_rank"]?.DeepClone(),
                            ["rankMaxes"] = s?["rank_maxes"]?.DeepClone(),
                        });
                cats.Add(new JsonObject
                {
                    ["name"] = cname,
                    ["rank"] = c?["category_rank"]?.DeepClone(),
                    ["progress"] = c?["benchmark_progress"]?.DeepClone(),
                    ["scenarios"] = scen,
                });
            }
        }
        result["categories"] = cats;
        _memo[key] = (DateTime.Now, result.DeepClone());
        return result;
    }

    public async Task<JsonNode?> GetProfileRanks(string steamId, bool refresh, bool saveOffline = true) =>
        await Cached($"{Api}/profile-ranks?steamId={Uri.EscapeDataString(steamId)}&mode=kovaaks", TimeSpan.FromMinutes(20), refresh,
            saveOffline ? Path.Combine(AppPaths.Cache, "profile-ranks.json") : null);

    public record PlayerHit(string SteamId, string Name, string? SteamAccountName, string? Country);

    /// <summary>
    /// Finds players from a SteamID64, a steamcommunity.com /profiles/ or /id/ link, an evxl.app/u/ link, or a name
    /// (evxl's player search covers Steam account names and KovaaK's usernames).
    /// </summary>
    public async Task<List<PlayerHit>> SearchPlayers(string query)
    {
        var q = query.Trim().TrimEnd('/');
        if (q.Length == 0) return new();
        string? id = null;
        var m = Regex.Match(q, @"(?:^|/profiles/|/u/)(7656\d{13})(?:$|[/?#])");
        if (m.Success) id = m.Groups[1].Value;
        else if (Regex.Match(q, @"steamcommunity\.com/id/([^/?#]+)", RegexOptions.IgnoreCase) is { Success: true } vm)
        {
            // Vanity URL → SteamID64 via the public profile XML (no API key needed).
            using var res = await Http.GetAsync($"https://steamcommunity.com/id/{Uri.EscapeDataString(vm.Groups[1].Value)}?xml=1");
            var xml = await res.Content.ReadAsStringAsync();
            var sm = Regex.Match(xml, @"<steamID64>(\d{17})</steamID64>");
            if (!sm.Success) throw new InvalidOperationException("That Steam profile link couldn't be found.");
            id = sm.Groups[1].Value;
        }
        else if (Regex.Match(q, @"evxl\.app/u/([^/?#]+)", RegexOptions.IgnoreCase) is { Success: true } em)
            q = Uri.UnescapeDataString(em.Groups[1].Value);

        if (id != null)
        {
            string name = id; string? country = null;
            try
            {
                var p = await Cached($"{Api}/ratings/kovaaks/player?playerId={id}", TimeSpan.FromHours(1));
                name = p?["name"]?.GetValue<string>() ?? id;
                country = p?["country"]?.GetValue<string>();
            }
            catch { /* not rated on evxl: the ID alone still works for benchmarks */ }
            if (name == id)
                try
                {
                    // Fall back to the Steam profile name (public XML, no API key).
                    var xml = await Http.GetStringAsync($"https://steamcommunity.com/profiles/{id}?xml=1");
                    var nm = Regex.Match(xml, @"<steamID><!\[CDATA\[(.*?)\]\]></steamID>");
                    if (nm.Success && nm.Groups[1].Value.Length > 0) name = nm.Groups[1].Value;
                }
                catch { }
            return new() { new PlayerHit(id, name, null, country) };
        }

        var root = await Cached($"{Api}/player-search?q={Uri.EscapeDataString(q)}&limit=12", TimeSpan.FromMinutes(5));
        var list = new List<PlayerHit>();
        foreach (var r in root?["data"]?.AsArray() ?? new JsonArray())
        {
            var sid = r?["steamId"]?.GetValue<string>();
            if (sid == null) continue;
            list.Add(new PlayerHit(sid, r?["displayName"]?.GetValue<string>() ?? r?["webappUsername"]?.GetValue<string>() ?? sid,
                r?["steamAccountName"]?.GetValue<string>(), null));
        }
        return list;
    }

    /// <summary>Read-only passthrough for any documented evxl GET endpoint (keeps the UI flexible).</summary>
    public async Task<JsonNode?> Get(string path)
    {
        if (!path.StartsWith('/') || path.Contains("..") || path.Contains("://")) throw new ArgumentException("Invalid path");
        return await Cached(Api + path, TimeSpan.FromMinutes(5));
    }

    // =====================================================================================
    // Scenario classification, positions, friends

    /// <summary>evxl's classification of ~2000 popular scenarios (skills like "reactive_tracking", leaderboard ids).</summary>
    public async Task<Dictionary<string, ScenarioClass>> GetScenarioClasses(bool refresh = false)
    {
        if (_classes != null && !refresh) return _classes;
        var cached = Json.Read<Dictionary<string, ScenarioClass>>(ClassPath);
        bool fresh = File.Exists(ClassPath) && DateTime.Now - File.GetLastWriteTime(ClassPath) < TimeSpan.FromDays(3);
        if (cached != null && fresh && !refresh) return _classes = new(cached, StringComparer.OrdinalIgnoreCase);
        try
        {
            var root = await GetJson($"{Api}/ratings/kovaaks/scenarios");
            var cols = root?["columns"]?.AsArray().Select(c => c?.GetValue<string>()).ToList() ?? new();
            int iName = cols.IndexOf("name"), iLb = cols.IndexOf("leaderboardId"), iPlayers = cols.IndexOf("players"),
                iSkills = cols.IndexOf("skills"), iActions = cols.IndexOf("actions");
            var map = new Dictionary<string, ScenarioClass>(StringComparer.OrdinalIgnoreCase);
            foreach (var row in root?["rows"]?.AsArray() ?? new JsonArray())
            {
                if (row is not JsonArray r || iName < 0) continue;
                var name = r[iName]?.GetValue<string>();
                if (name == null) continue;
                var sc = new ScenarioClass { Name = name };
                if (iLb >= 0 && long.TryParse(r[iLb]?.ToString(), out var lb)) sc.LeaderboardId = lb;
                if (iPlayers >= 0 && r[iPlayers] is JsonValue pv && pv.TryGetValue<int>(out var pl)) sc.Players = pl;
                if (iSkills >= 0 && r[iSkills] is JsonArray sk) sc.Skills = sk.Select(x => x?.GetValue<string>() ?? "").Where(x => x != "").ToList();
                if (iActions >= 0 && r[iActions] is JsonArray ac) sc.Actions = ac.Select(x => x?.GetValue<string>() ?? "").Where(x => x != "").ToList();
                map[name] = sc;
                if (sc.LeaderboardId > 0) _lbIds.TryAdd(name, sc.LeaderboardId);
            }
            Json.Write(ClassPath, map, compact: true);
            return _classes = map;
        }
        catch
        {
            return _classes = cached != null ? new(cached, StringComparer.OrdinalIgnoreCase) : new(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>The player's global position on every scenario evxl has rated (refreshed daily by evxl).</summary>
    public async Task<Dictionary<string, PlayerResult>> GetPlayerResults(string steamId, bool refresh = false)
    {
        var map = new Dictionary<string, PlayerResult>(StringComparer.OrdinalIgnoreCase);
        var root = await Cached($"{Api}/ratings/kovaaks/player/results?playerId={Uri.EscapeDataString(steamId)}", TimeSpan.FromHours(3), refresh,
            Path.Combine(AppPaths.Cache, "player-results.json"));
        var cols = root?["columns"]?.AsArray().Select(c => c?.GetValue<string>()).ToList() ?? new();
        int iName = cols.IndexOf("name"), iLb = cols.IndexOf("leaderboardId"), iPos = cols.IndexOf("position"), iPlayers = cols.IndexOf("players");
        foreach (var row in root?["rows"]?.AsArray() ?? new JsonArray())
        {
            if (row is not JsonArray r || iName < 0) continue;
            var name = r[iName]?.GetValue<string>();
            if (name == null) continue;
            var pr = new PlayerResult();
            if (iLb >= 0 && long.TryParse(r[iLb]?.ToString(), out var lb)) { pr.LeaderboardId = lb; _lbIds.TryAdd(name, lb); }
            if (iPos >= 0 && r[iPos] is JsonValue p && p.TryGetValue<int>(out var pos)) pr.Position = pos;
            if (iPlayers >= 0 && r[iPlayers] is JsonValue q && q.TryGetValue<int>(out var players)) pr.Players = players;
            map[name] = pr;
        }
        return map;
    }

    /// <summary>Steam friends who play KovaaK's (evxl resolves the friend list from Steam).</summary>
    public async Task<List<Friend>> GetFriends(string steamId, bool refresh = false)
    {
        var list = new List<Friend>();
        // evxl caps pages at 100 rows.
        for (int page = 0; page < 10; page++)
        {
            var root = await Cached($"{Api}/ratings/kovaaks/leaderboard?steamIdFriendSearch={Uri.EscapeDataString(steamId)}&max=100&page={page}",
                TimeSpan.FromHours(6), refresh, page == 0 ? Path.Combine(AppPaths.Cache, "friends.json") : null);
            var rows = root?["rows"]?.AsArray() ?? new JsonArray();
            foreach (var r in rows)
            {
                var id = r?["steamId"]?.GetValue<string>();
                if (id == null || id == steamId || list.Any(f => f.SteamId == id)) continue;
                list.Add(new Friend { SteamId = id, Name = r?["name"]?.GetValue<string>() ?? id, Country = r?["country"]?.GetValue<string>() });
            }
            int total = root?["total"]?.GetValue<int>() ?? 0;
            if (rows.Count < 100 || list.Count >= total) break;
        }
        return list;
    }

    /// <summary>One player's current scores on a set of KovaaK's leaderboards.</summary>
    public async Task<Dictionary<long, double>> GetPlayerScores(string playerId, IEnumerable<long> leaderboardIds)
    {
        var ids = string.Join(",", leaderboardIds.Distinct());
        var map = new Dictionary<long, double>();
        if (ids.Length == 0) return map;
        try
        {
            var root = await Cached($"{Api}/ratings/kovaaks/player/scores?playerId={playerId}&leaderboardIds={ids}", TimeSpan.FromMinutes(15));
            if (root?["scores"] is JsonObject s)
                foreach (var (k, v) in s)
                    if (long.TryParse(k, out var lb) && v is JsonValue jv && jv.TryGetValue<double>(out var score)) map[lb] = score;
        }
        catch { }
        return map;
    }

    // =====================================================================================
    // Scenario leaderboards (KovaaK's)

    /// <summary>Finds a scenario's KovaaK's leaderboard id (benchmarks, evxl classification, then KovaaK's search).</summary>
    public async Task<long> ResolveLeaderboardId(string scenario)
    {
        if (_lbIds.TryGetValue(scenario, out var known) && known > 0) return known;
        foreach (var e in _catalog.Entries.Values)
            if (e.Scenarios.TryGetValue(scenario, out var lb) && lb > 0) return Remember(scenario, lb);
        var classes = await GetScenarioClasses();
        if (classes.TryGetValue(scenario, out var c) && c.LeaderboardId > 0) return Remember(scenario, c.LeaderboardId);
        try
        {
            var res = await GetJson($"{Kovaaks}/scenario/popular?page=0&max=20&scenarioNameSearch={Uri.EscapeDataString(scenario)}");
            foreach (var row in res?["data"]?.AsArray() ?? new JsonArray())
                if (string.Equals(row?["scenarioName"]?.GetValue<string>(), scenario, StringComparison.OrdinalIgnoreCase)
                    && row?["leaderboardId"] is JsonValue v && v.TryGetValue<long>(out var id))
                    return Remember(scenario, id);
        }
        catch { }
        return 0;
    }

    long Remember(string scenario, long id)
    {
        _lbIds[scenario] = id;
        try { Json.Write(LbIdPath, new Dictionary<string, long>(_lbIds), compact: true); } catch { }
        return id;
    }

    public async Task<JsonObject> GetScenarioLeaderboard(long leaderboardId, int page, int max)
    {
        var root = await Cached($"{Kovaaks}/leaderboard/scores/global?leaderboardId={leaderboardId}&page={page}&max={max}", TimeSpan.FromMinutes(3));
        var rows = new JsonArray();
        foreach (var r in root?["data"]?.AsArray() ?? new JsonArray())
            rows.Add(MapScoreRow(r));
        return new JsonObject { ["total"] = root?["total"]?.DeepClone(), ["page"] = page, ["max"] = max, ["rows"] = rows };
    }

    static JsonObject MapScoreRow(JsonNode? r)
    {
        var a = r?["attributes"];
        double? acc = a?["accuracyDamage"] is JsonValue av && av.TryGetValue<double>(out var ad) && ad > 0 && ad <= 100000 ? Math.Round(ad / 100000.0, 4) : null;
        return new JsonObject
        {
            ["rank"] = r?["rank"]?.DeepClone(),
            ["steamId"] = r?["steamId"]?.DeepClone(),
            ["name"] = (r?["webappUsername"]?.GetValue<string>() is { Length: > 0 } wu ? wu : r?["steamAccountName"]?.GetValue<string>()) ?? "?",
            ["country"] = r?["country"]?.DeepClone(),
            ["score"] = r?["score"]?.DeepClone(),
            ["accuracy"] = acc,
            ["cm360"] = a?["cm360"]?.DeepClone(),
            ["sens"] = a?["horizSens"]?.DeepClone(),
            ["sensScale"] = a?["sensScale"]?.DeepClone(),
            ["fov"] = a?["fov"]?.DeepClone(),
            ["epoch"] = a?["epoch"]?.DeepClone(),
        };
    }

    /// <summary>Where a score would place on a KovaaK's leaderboard (binary search over pages; ~10 requests).</summary>
    public async Task<(int position, int total)> EstimatePosition(long leaderboardId, double score)
    {
        const int max = 100;
        var first = await GetScenarioLeaderboard(leaderboardId, 0, max);
        int total = first["total"]?.GetValue<int>() ?? 0;
        double ScoreAt(JsonObject page, int i) => page["rows"]![i]!["score"]?.GetValue<double>() ?? 0;
        var rows0 = first["rows"]!.AsArray();
        if (rows0.Count == 0 || score >= ScoreAt(first, 0)) return (1, Math.Max(total, 1));

        int lo = 0, hi = Math.Max(0, (total - 1) / max);
        JsonObject? found = null; int foundPage = 0;
        while (lo <= hi)
        {
            int mid = (lo + hi) / 2;
            var page = mid == 0 ? first : await GetScenarioLeaderboard(leaderboardId, mid, max);
            var rows = page["rows"]!.AsArray();
            if (rows.Count == 0) { hi = mid - 1; continue; }
            if (score > ScoreAt(page, 0)) hi = mid - 1;
            else if (score <= ScoreAt(page, rows.Count - 1)) lo = mid + 1;
            else { found = page; foundPage = mid; break; }
        }
        if (found == null) return (Math.Min(total + 1, lo * max + 1), total + 1);
        var list = found["rows"]!.AsArray();
        for (int i = 0; i < list.Count; i++)
            if (score > ScoreAt(found, i)) return (foundPage * max + i + 1, total);
        return (foundPage * max + list.Count + 1, total);
    }
}
