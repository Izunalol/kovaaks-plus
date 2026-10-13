using System.Collections.Concurrent;
using System.Text;

namespace KovaaksPlus;

public class ScenarioFile
{
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public string Source { get; set; } = "local";   // local | workshop
    public string? WorkshopId { get; set; }
    public string? Author { get; set; }
    public string? GameTag { get; set; }
    public string? Difficulty { get; set; }
    public string? Description { get; set; }
    public double TimeLimit { get; set; }
    public string? Weapon { get; set; }
    public long Mtime { get; set; }
    // Scoring rules (used to rebuild a run's score over time for the results graphs).
    public double ScorePerKill { get; set; }
    public double ScorePerDamage { get; set; }
    public bool ScoreMultAccuracy { get; set; }
    public int V { get; set; }
}

/// <summary>Scans the game's local scenario folder and Steam Workshop downloads. Read-only: files are never modified.</summary>
public class ScenarioLibrary
{
    readonly object _lock = new();
    Dictionary<string, ScenarioFile> _byName = new(StringComparer.OrdinalIgnoreCase);
    static string CachePath => System.IO.Path.Combine(AppPaths.Cache, "scenarios.json");

    public IReadOnlyCollection<ScenarioFile> All() { lock (_lock) return _byName.Values.ToList(); }

    public ScenarioFile? Find(string name) { lock (_lock) return _byName.GetValueOrDefault(name); }

    public void Scan(GamePaths paths)
    {
        var cache = (Json.Read<List<ScenarioFile>>(CachePath) ?? new())
            .GroupBy(s => s.Path, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var files = new List<(FileInfo fi, string source, string? wsId)>();
        if (Directory.Exists(paths.Scenarios))
            foreach (var f in new DirectoryInfo(paths.Scenarios).EnumerateFiles("*.sce"))
                files.Add((f, "local", null));
        foreach (var ws in paths.Workshop)
            foreach (var dir in new DirectoryInfo(ws).EnumerateDirectories())
                foreach (var f in dir.EnumerateFiles("*.sce", SearchOption.AllDirectories))
                    files.Add((f, "workshop", dir.Name));

        var parsed = new ConcurrentBag<ScenarioFile>();
        Parallel.ForEach(files, item =>
        {
            var (fi, source, wsId) = item;
            if (cache.TryGetValue(fi.FullName, out var c) && c.Mtime == fi.LastWriteTimeUtc.Ticks && c.V >= ParserVersion) { parsed.Add(c); return; }
            try { parsed.Add(ParseHeader(fi, source, wsId)); } catch { /* unreadable file */ }
        });

        // Local copies win over workshop duplicates (that's what the game itself plays).
        var map = new Dictionary<string, ScenarioFile>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in parsed.OrderBy(s => s.Source == "local" ? 0 : 1))
            map.TryAdd(s.Name, s);

        lock (_lock) _byName = map;
        try { Json.Write(CachePath, parsed.ToList(), compact: true); } catch { }
    }

    const int ParserVersion = 2;

    public static ScenarioFile ParseHeader(FileInfo fi, string source, string? wsId)
    {
        var s = new ScenarioFile
        {
            Path = fi.FullName, Source = source, WorkshopId = wsId, Mtime = fi.LastWriteTimeUtc.Ticks, V = ParserVersion,
            Name = System.IO.Path.GetFileNameWithoutExtension(fi.Name),
        };
        using var fs = new FileStream(fi.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var buf = new byte[Math.Min(fs.Length, 24 * 1024)];
        int read = fs.Read(buf, 0, buf.Length);
        var text = Encoding.UTF8.GetString(buf, 0, read);
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith('[')) break;
            int eq = line.IndexOf('=');
            if (eq <= 0) continue;
            var key = line[..eq];
            var val = line[(eq + 1)..].Trim();
            switch (key)
            {
                case "Name": if (val.Length > 0) s.Name = val; break;
                case "AuthorsTag": s.Author = Blank(val); break;
                case "GameTag": s.GameTag = Blank(val); break;
                case "DifficultyTag": s.Difficulty = Blank(val); break;
                case "Description": s.Description = Blank(val); break;
                case "Timelimit": double.TryParse(val, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var t); s.TimeLimit = t; break;
                case "WeaponProfile": s.Weapon ??= Blank(val); break;
                case "ScorePerKill": s.ScorePerKill = Num(val); break;
                case "ScorePerDamage": s.ScorePerDamage = Num(val); break;
                case "ScoreMultAccuracy": s.ScoreMultAccuracy = val.Equals("true", StringComparison.OrdinalIgnoreCase); break;
            }
        }
        return s;
    }

    static string? Blank(string v) => string.IsNullOrWhiteSpace(v) ? null : v;
    static double Num(string v) => double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;
}

/// <summary>User overlay (custom names, tags, thumbnails...) stored separately from the game's files.</summary>
public class LibraryStore
{
    readonly object _lock = new();
    public LibraryData Data { get; private set; }

    public LibraryStore()
    {
        Data = Json.Read<LibraryData>(AppPaths.Library) ?? LibraryData.CreateDefault();
        // Re-key case-insensitively after deserialization.
        Data.Scenarios = new Dictionary<string, ScenarioMeta>(Data.Scenarios, StringComparer.OrdinalIgnoreCase);
        if (Data.Groups.Count == 0) Data.Groups = new() { "Aim Type", "Difficulty", "Other" };
    }

    public void Save() { lock (_lock) Json.Write(AppPaths.Library, Data); }

    public ScenarioMeta Meta(string name)
    {
        lock (_lock) return Data.Scenarios.TryGetValue(name, out var m) ? m : new ScenarioMeta();
    }

    public void Update(string name, Action<ScenarioMeta> change)
    {
        lock (_lock)
        {
            if (!Data.Scenarios.TryGetValue(name, out var m)) m = new ScenarioMeta();
            change(m);
            if (m.IsEmpty) Data.Scenarios.Remove(name); else Data.Scenarios[name] = m;
        }
        Save();
    }

    public TagDef EnsureTag(string name, string group, string color)
    {
        lock (_lock)
        {
            var t = Data.Tags.FirstOrDefault(x => x.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
            if (t != null) return t;
            t = new TagDef { Name = name, Group = group, Color = color };
            Data.Tags.Add(t);
            if (!Data.Groups.Contains(group)) Data.Groups.Add(group);
            return t;
        }
    }

    public void SetTags(List<TagDef> tags, List<string> groups)
    {
        lock (_lock)
        {
            Data.Tags = tags;
            Data.Groups = groups;
            var valid = tags.Select(t => t.Id).ToHashSet();
            foreach (var m in Data.Scenarios.Values) m.Tags.RemoveAll(id => !valid.Contains(id));
        }
        Save();
    }
}
