using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace KovaaksPlus;

public class RunSummary
{
    public string File { get; set; } = "";
    public string Scenario { get; set; } = "";
    public string Mode { get; set; } = "Challenge";
    public DateTime Date { get; set; }
    public double Score { get; set; }
    public int Kills { get; set; }
    public int Shots { get; set; }
    public int Hits { get; set; }
    public double Accuracy { get; set; }
    public double FightTime { get; set; }
    public double AvgTtk { get; set; }
    public double DamageDone { get; set; }
    public double DamagePossible { get; set; }
    public int PauseCount { get; set; }
    public double Sens { get; set; }
    public string? SensScale { get; set; }
    public double Fov { get; set; }
    public string? FovScale { get; set; }
    public int Dpi { get; set; }
    public double AvgFps { get; set; }
    public string? Weapon { get; set; }
    /// <summary>Seconds from challenge start to the stats file being written (the filename timestamp).</summary>
    public double Duration { get; set; }
    public long Mtime { get; set; }
    /// <summary>Parser version; older cached entries are re-parsed when this increases.</summary>
    public int V { get; set; }
}

public class KillEvent
{
    public double T { get; set; }       // seconds since challenge start
    public double Ttk { get; set; }
    public int Shots { get; set; }
    public int Hits { get; set; }
    public double Damage { get; set; }
    public double DamagePossible { get; set; }
}

public class RunDetail
{
    public RunSummary Summary { get; set; } = new();
    public List<KillEvent> Kills { get; set; } = new();
    public Dictionary<string, string> Fields { get; set; } = new();
}

/// <summary>Parses KovaaK's per-run "... Stats.csv" files and keeps a cached index of every run ever played.</summary>
public class StatsIndex
{
    static readonly Regex NameRx = new(@"^(?<scen>.+) - (?<mode>[^-]+?) - (?<date>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}) Stats\.csv$",
        RegexOptions.Compiled);
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    const int ParserVersion = 2;

    readonly object _lock = new();
    Dictionary<string, RunSummary> _runs = new(StringComparer.OrdinalIgnoreCase);
    public string Folder { get; private set; } = "";
    public bool Ready { get; private set; }

    public IReadOnlyList<RunSummary> All()
    {
        lock (_lock) return _runs.Values.OrderBy(r => r.Date).ToList();
    }

    public List<RunSummary> ForScenario(string scenario)
    {
        lock (_lock)
            return _runs.Values.Where(r => r.Scenario.Equals(scenario, StringComparison.OrdinalIgnoreCase))
                .OrderBy(r => r.Date).ToList();
    }

    /// <summary>Best score on a scenario, ignoring one run (used to decide whether a new run is a PB).</summary>
    public RunSummary? BestExcluding(string scenario, string excludeFile)
    {
        lock (_lock)
            return _runs.Values
                .Where(r => r.Scenario.Equals(scenario, StringComparison.OrdinalIgnoreCase) &&
                            !r.File.Equals(excludeFile, StringComparison.OrdinalIgnoreCase))
                .MaxBy(r => r.Score);
    }

    public void Load(string folder, Action<int, int>? progress = null)
    {
        Folder = folder;
        var cached = Json.Read<List<RunSummary>>(AppPaths.StatsIndex) ?? new();
        var byFile = cached.GroupBy(r => r.File, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var result = new ConcurrentDictionary<string, RunSummary>(StringComparer.OrdinalIgnoreCase);
        if (!Directory.Exists(folder))
        {
            lock (_lock) { _runs = new(result); Ready = true; }
            return;
        }

        var files = new DirectoryInfo(folder).EnumerateFiles("*Stats.csv").ToList();
        var todo = new List<FileInfo>();
        foreach (var f in files)
        {
            if (byFile.TryGetValue(f.Name, out var r) && r.Mtime == f.LastWriteTimeUtc.Ticks && r.V >= ParserVersion) result[f.Name] = r;
            else todo.Add(f);
        }

        int done = 0;
        progress?.Invoke(0, todo.Count);
        Parallel.ForEach(todo, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(2, Environment.ProcessorCount - 1) }, f =>
        {
            var s = TryParseSummary(f.FullName);
            if (s != null) result[f.Name] = s;
            var n = Interlocked.Increment(ref done);
            if (n % 250 == 0) progress?.Invoke(n, todo.Count);
        });
        progress?.Invoke(todo.Count, todo.Count);

        lock (_lock) { _runs = new Dictionary<string, RunSummary>(result, StringComparer.OrdinalIgnoreCase); Ready = true; }
        if (todo.Count > 0 || cached.Count != result.Count) Save();
    }

    public void Save()
    {
        List<RunSummary> list;
        lock (_lock) list = _runs.Values.ToList();
        try { Json.Write(AppPaths.StatsIndex, list, compact: true); } catch { /* cache only */ }
    }

    /// <summary>Adds a freshly written stats file; retries while KovaaK's still holds the file open.</summary>
    public async Task<RunSummary?> AddAsync(string path)
    {
        for (int attempt = 0; attempt < 20; attempt++)
        {
            await Task.Delay(attempt == 0 ? 400 : 250);
            try
            {
                var s = ParseSummary(path);
                if (s == null) continue;
                lock (_lock) _runs[s.File] = s;
                _ = Task.Run(Save);
                return s;
            }
            catch (IOException) { }
        }
        return null;
    }

    public static RunSummary? TryParseSummary(string path)
    {
        try { return ParseSummary(path); } catch { return null; }
    }

    static RunSummary? ParseSummary(string path)
    {
        var fi = new FileInfo(path);
        var m = NameRx.Match(fi.Name);
        if (!m.Success) return null;

        // The summary block lives at the end of the file; read the tail first, fall back to the whole file.
        string text = ReadTail(path, 12 * 1024);
        if (!text.Contains("Scenario:,")) text = ReadShared(path);
        if (!text.Contains("Scenario:,") && !text.Contains("Score:,")) return null;

        var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).ToList();
        var fields = ParseFields(lines);
        var s = new RunSummary
        {
            File = fi.Name,
            Scenario = fields.GetValueOrDefault("Scenario")?.Trim() is { Length: > 0 } sc ? sc : m.Groups["scen"].Value,
            Mode = m.Groups["mode"].Value.Trim(),
            Date = DateTime.ParseExact(m.Groups["date"].Value, "yyyy.MM.dd-HH.mm.ss", Inv),
            Mtime = fi.LastWriteTimeUtc.Ticks,
            V = ParserVersion,
        };
        Fill(s, fields, lines);
        if (fields.TryGetValue("Challenge Start", out var cs) && TryTime(cs, out var start))
        {
            var d = (s.Date.TimeOfDay - start).TotalSeconds;
            if (d < 0) d += 86400; // crossed midnight
            if (d < 6 * 3600) s.Duration = Math.Round(d, 1);
        }
        return s;
    }

    public static RunDetail ParseDetail(string path)
    {
        var text = ReadShared(path);
        var lines = text.Split('\n').Select(l => l.TrimEnd('\r')).ToList();
        var detail = new RunDetail { Summary = ParseSummary(path) ?? new RunSummary { File = Path.GetFileName(path) } };
        detail.Fields = ParseFields(lines);

        TimeSpan? start = null;
        if (detail.Fields.TryGetValue("Challenge Start", out var cs) && TryTime(cs, out var st)) start = st;

        int header = lines.FindIndex(l => l.StartsWith("Kill #,"));
        if (header >= 0)
        {
            var cols = lines[header].Split(',');
            int Col(string name) => Array.FindIndex(cols, c => c.Trim().Equals(name, StringComparison.OrdinalIgnoreCase));
            int cTs = Col("Timestamp"), cTtk = Col("TTK"), cShots = Col("Shots"), cHits = Col("Hits"),
                cDmg = Col("Damage Done"), cPos = Col("Damage Possible");
            for (int i = header + 1; i < lines.Count && lines[i].Length > 0; i++)
            {
                var p = lines[i].Split(',');
                if (p.Length < cols.Length - 1) break;
                var k = new KillEvent
                {
                    Ttk = D(Get(p, cTtk).TrimEnd('s')),
                    Shots = (int)D(Get(p, cShots)),
                    Hits = (int)D(Get(p, cHits)),
                    Damage = D(Get(p, cDmg)),
                    DamagePossible = D(Get(p, cPos)),
                };
                if (TryTime(Get(p, cTs), out var ts) && start != null)
                {
                    var delta = (ts - start.Value).TotalSeconds;
                    if (delta < -43200) delta += 86400; // crossed midnight
                    k.T = Math.Round(delta, 3);
                }
                detail.Kills.Add(k);
            }
        }
        return detail;
    }

    static void Fill(RunSummary s, Dictionary<string, string> f, List<string> lines)
    {
        s.Score = D(f.GetValueOrDefault("Score"));
        s.Kills = (int)D(f.GetValueOrDefault("Kills"));
        s.FightTime = D(f.GetValueOrDefault("Fight Time"));
        s.AvgTtk = D(f.GetValueOrDefault("Avg TTK"));
        s.DamageDone = D(f.GetValueOrDefault("Damage Done"));
        s.PauseCount = (int)D(f.GetValueOrDefault("Pause Count"));
        s.Sens = D(f.GetValueOrDefault("Horiz Sens"));
        s.SensScale = f.GetValueOrDefault("Sens Scale");
        s.Fov = D(f.GetValueOrDefault("FOV"));
        s.FovScale = f.GetValueOrDefault("FOVScale");
        s.Dpi = (int)D(f.GetValueOrDefault("DPI"));
        s.AvgFps = Math.Round(D(f.GetValueOrDefault("Avg FPS")), 1);

        // Weapon summary block: "Weapon,Shots,Hits,Damage Done,Damage Possible,..."
        int wi = lines.FindIndex(l => l.StartsWith("Weapon,Shots,Hits"));
        if (wi >= 0)
        {
            string? main = null; int best = -1;
            for (int i = wi + 1; i < lines.Count && lines[i].Length > 0; i++)
            {
                var p = lines[i].Split(',');
                if (p.Length < 5) break;
                int shots = (int)D(p[1]), hits = (int)D(p[2]);
                s.Shots += shots; s.Hits += hits;
                s.DamagePossible += D(p[4]);
                if (shots > best) { best = shots; main = p[0]; }
            }
            s.Weapon = main;
        }
        if (s.Shots == 0 && f.ContainsKey("Hit Count"))
        {
            s.Hits = (int)D(f["Hit Count"]);
            s.Shots = s.Hits + (int)D(f.GetValueOrDefault("Miss Count"));
        }
        s.Accuracy = s.Shots > 0 ? Math.Round((double)s.Hits / s.Shots, 4)
                   : s.DamagePossible > 0 ? Math.Round(s.DamageDone / s.DamagePossible, 4) : 0;
    }

    static Dictionary<string, string> ParseFields(List<string> lines)
    {
        var f = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in lines)
        {
            int i = l.IndexOf(":,", StringComparison.Ordinal);
            if (i <= 0 || l.StartsWith("Kill #")) continue;
            var key = l[..i].Trim();
            if (key.Contains(',')) continue;
            f[key] = l[(i + 2)..].Trim();
        }
        return f;
    }

    static string Get(string[] p, int i) => i >= 0 && i < p.Length ? p[i] : "";

    static double D(string? s) =>
        double.TryParse(s?.Trim(), NumberStyles.Float, Inv, out var v) && double.IsFinite(v) ? v : 0;

    static bool TryTime(string s, out TimeSpan t) =>
        TimeSpan.TryParseExact(s.Trim(), new[] { @"hh\:mm\:ss\.fff", @"h\:mm\:ss\.fff", @"hh\:mm\:ss" }, Inv, out t);

    static string ReadShared(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var sr = new StreamReader(fs, Encoding.UTF8);
        return sr.ReadToEnd();
    }

    static string ReadTail(string path, int bytes)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        if (fs.Length > bytes) fs.Seek(-bytes, SeekOrigin.End);
        using var sr = new StreamReader(fs, Encoding.UTF8);
        return sr.ReadToEnd();
    }
}
