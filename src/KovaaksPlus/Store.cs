using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace KovaaksPlus;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = null,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        NumberHandling = JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.AllowNamedFloatingPointLiterals,
        PropertyNameCaseInsensitive = true,
    };

    public static readonly JsonSerializerOptions Compact = new(Options) { WriteIndented = false };

    public static T? Read<T>(string path) where T : class
    {
        try
        {
            if (!File.Exists(path)) return null;
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options);
        }
        catch { return null; }
    }

    /// <summary>Atomic write: temp file + replace, so a crash never leaves a half-written file.</summary>
    public static void Write(string path, object value, bool compact = false)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, compact ? Compact : Options));
        File.Move(tmp, path, true);
    }

    public static T Get<T>(JsonElement e, string name, T fallback)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var p) || p.ValueKind == JsonValueKind.Null)
            return fallback;
        try { return p.Deserialize<T>(Options) ?? fallback; } catch { return fallback; }
    }
}

public class AppConfig
{
    public bool SetupComplete { get; set; }
    public string? GamePath { get; set; }          // ...\steamapps\common\FPSAimTrainer
    public List<string> WorkshopPaths { get; set; } = new();
    public string? SteamId { get; set; }
    public string? SteamName { get; set; }

    public bool PauseBringsApp { get; set; } = true;
    public string PauseKey { get; set; } = "Escape";
    public bool RunEndBringsApp { get; set; } = true;
    public bool FocusGameOnPlay { get; set; } = true;
    public bool CelebratePB { get; set; } = true;
    public bool Sounds { get; set; } = true;
    public string DefaultMode { get; set; } = "challenge";
    public string Accent { get; set; } = "#8b5cf6";
    public bool ShowUninstalled { get; set; } = true;
    public string LibraryView { get; set; } = "grid";
    public string LibrarySort { get; set; } = "recent";
    public List<int> PinnedBenchmarks { get; set; } = new();
    public int? ActiveBenchmark { get; set; }
    /// <summary>What to do when a scenario's default preset differs from current settings: ask | auto | off.</summary>
    public string PresetMode { get; set; } = "ask";
    public bool TagThumbNames { get; set; } = true;

    /// <summary>Resuming from the pause bar: "restart" (press the restart key for you) or "continue".</summary>
    public string PauseResume { get; set; } = "restart";
    /// <summary>Going back after a run: "restart", "next" (next scenario in the queue) or "focus".</summary>
    public string AfterRun { get; set; } = "restart";
    /// <summary>KovaaK's restart key (Keys enum name), or "auto" to read the ResetSession bind from KovaaK's Input.ini.</summary>
    public string RestartKey { get; set; } = "auto";
    /// <summary>Benchmark difficulty ids shown as filters in the Scenarios sidebar.</summary>
    public List<int> BenchmarkFilters { get; set; } = new();
    /// <summary>Free-form UI preferences (appearance, benchmark table look). Owned by the web UI.</summary>
    public System.Text.Json.Nodes.JsonObject? Ui { get; set; }
}

public class TagDef
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#8b5cf6";
    public string Group { get; set; } = "Custom";
    /// <summary>Optional default thumbnail for scenarios carrying this tag (media file name).</summary>
    public string? Thumbnail { get; set; }
    /// <summary>Optional default settings preset for scenarios carrying this tag.</summary>
    public string? Preset { get; set; }
    /// <summary>Sidebar icon: "ic:&lt;name&gt;" for a built-in icon, a media path for a custom image, or null for the colour dot.</summary>
    public string? Icon { get; set; }
}

public class ScenarioMeta
{
    public string? CustomName { get; set; }
    public List<string> Tags { get; set; } = new();
    public string? Notes { get; set; }
    public string? Thumbnail { get; set; }
    public string? Preview { get; set; }
    public bool Favorite { get; set; }
    public bool Hidden { get; set; }
    /// <summary>Default settings preset applied before playing this scenario.</summary>
    public string? Preset { get; set; }

    [JsonIgnore]
    public bool IsEmpty => CustomName == null && Tags.Count == 0 && Notes == null && Thumbnail == null
                           && Preview == null && !Favorite && !Hidden && Preset == null;
}

public class LibraryData
{
    public List<string> Groups { get; set; } = new();
    public List<TagDef> Tags { get; set; } = new();
    public Dictionary<string, ScenarioMeta> Scenarios { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public static LibraryData CreateDefault()
    {
        var lib = new LibraryData { Groups = new() { "Aim Type", "Difficulty", "Other" } };
        void Add(string group, string color, params string[] names)
        {
            foreach (var n in names) lib.Tags.Add(new TagDef { Name = n, Color = color, Group = group });
        }
        Add("Aim Type", "#f97316", "Static Clicking");
        Add("Aim Type", "#fb923c", "Dynamic Clicking");
        Add("Aim Type", "#22d3ee", "Precise Tracking");
        Add("Aim Type", "#06b6d4", "Reactive Tracking");
        Add("Aim Type", "#0ea5e9", "Control Tracking");
        Add("Aim Type", "#a3e635", "Speed Switching");
        Add("Aim Type", "#84cc16", "Evasive Switching");
        Add("Aim Type", "#e879f9", "Stability");
        Add("Difficulty", "#4ade80", "Easy");
        Add("Difficulty", "#facc15", "Medium");
        Add("Difficulty", "#f87171", "Hard");
        Add("Difficulty", "#dc2626", "Extreme");
        Add("Aim Type", "#2dd4bf", "Smooth Tracking");
        Add("Aim Type", "#65a30d", "Stability Switching");
        Add("Other", "#8b5cf6", "Warmup");
        Add("Other", "#eab308", "Benchmark");
        return lib;
    }
}

/// <summary>All app-owned data lives under %APPDATA%\KovaaksPlus — the game's files are never renamed or re-tagged.</summary>
public static class AppPaths
{
    public static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "KovaaksPlus");
    public static readonly string Config = Path.Combine(Root, "config.json");
    public static readonly string Library = Path.Combine(Root, "library.json");
    public static readonly string Presets = Path.Combine(Root, "presets");
    public static readonly string Media = Path.Combine(Root, "media");
    public static readonly string Cache = Path.Combine(Root, "cache");
    public static readonly string Backups = Path.Combine(Root, "backups");
    public static readonly string StatsIndex = Path.Combine(Cache, "stats-index.json");
    public static readonly string WebViewData = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KovaaksPlus", "WebView2");

    public static void Ensure()
    {
        foreach (var d in new[] { Root, Presets, Media, Cache, Backups }) Directory.CreateDirectory(d);
    }
}

public static class JsonNodeExt
{
    public static JsonObject Obj(this JsonNode? n, string key)
    {
        if (n is not JsonObject o) throw new InvalidOperationException("not an object");
        if (o[key] is JsonObject child) return child;
        var created = new JsonObject();
        o[key] = created;
        return created;
    }
}
