using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace KovaaksPlus;

public class Preset
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];
    public string Name { get; set; } = "New preset";
    public string? Description { get; set; }
    public List<string> Tags { get; set; } = new();
    public string? Thumbnail { get; set; }
    public string? Preview { get; set; }
    public DateTime Created { get; set; } = DateTime.Now;
    public DateTime Updated { get; set; } = DateTime.Now;
    public List<string> Categories { get; set; } = new();
    /// <summary>Subset of PrimaryUserSettings.json: section → key → value.</summary>
    public JsonObject Primary { get; set; } = new();
    /// <summary>Subset of weaponsettings.ini.</summary>
    public Dictionary<string, string> Weapon { get; set; } = new();
    public JsonNode? Ui { get; set; }
    public string? ThemeName { get; set; }
    public string? ThemeContent { get; set; }
    public string? CrosshairFile { get; set; }
    public string? CrosshairData { get; set; }   // base64 PNG, so presets carry custom crosshairs to friends
}

/// <summary>Reads/writes KovaaK's settings files. Always backs up before writing.</summary>
public class SettingsManager
{
    public static readonly string[] AllCategories = { "sens", "fov", "crosshair", "visuals", "audio", "graphics", "hud", "theme", "gameplay" };

    static readonly string[] PrimarySections = { "booleanSettings", "integerSettings", "floatSettings", "stringSettings", "vectorSettings", "colorSettings" };

    readonly GamePaths _paths;
    public SettingsManager(GamePaths paths) => _paths = paths;

    public static string ShortKey(string key) { int i = key.IndexOf("::", StringComparison.Ordinal); return i >= 0 ? key[(i + 2)..] : key; }

    public static string Category(string key)
    {
        var k = ShortKey(key);
        if (Regex.IsMatch(k, @"^(XSens|YSens|DPI|SensScaleString|SensitivityScaleTargetEnum|BaseIncrement|YInvert|ToggleADS|ZoomSensMultiplier|AutoScaleZoomSens|SensRandomizer_.*)$")) return "sens";
        if (Regex.IsMatch(k, @"^(FOV|FOVScaleString|FOVScalarTargetEnum|FILMSCustom.*|CustomFOVYawMult|CustomYaw|ADSZoomFOV|ZoomFOVMultiplier|HipfireCustomFOV.*|ADSCustomFOV.*|FOVScale|ADSFOVScale)$")) return "fov";
        if (Regex.IsMatch(k, @"^(Crosshair.*|Hitmarker.*|HeadHitmarker.*|Hitmarkers|HeadHitmarkers|ShowBloom|BloomMultiplier)$")) return "crosshair";
        if (k == "CurrentThemeName") return "theme";
        if (Regex.IsMatch(k, @"(Volume|Pitch|Sound|Sounds)", RegexOptions.IgnoreCase) || k.StartsWith("Miss")) return "audio";
        if (Regex.IsMatch(k, @"^(Anisotropy|AntiAliasing.*|Shadows|PostProcessing|Effects|MaxFPS|MenuMaxFPS|ResolutionScale|Gamma|TextureStreaming|LowLatencyMode|SceneColorFormat|CloudCover|TiledReflections|OneFrameThreadLag|InputLagFrameCount|UseMeshInstancesInKmc|CacheDuration)$")) return "graphics";
        if (Regex.IsMatch(k, @"^(HiddenUiElementsMask|ShowVersionDuringGameplay|ShowInfoBars|ShowSessionBestOnHighScoreBar|HighScoreFadeout|UIAnimationSpeed|ScoreGraphHistoryLength|SessionStatsMode|ChallengeHistogramStats|ChallengeResults.*|LatencyFlashIndicator|FloatingCombatText|ShowBotProfileOnHealthbar)$")) return "hud";
        if (Regex.IsMatch(k, @"^(Enemy|Team|Wall|Floor|Ceiling|Ramp|Sky|Solid|OnHit|OnLookAt|Override|ChangeEnemy|BoundingBox|HideGibs|HideGun|WeaponHidden|ShowHealthBars|AutoHideHealthbar|DecalTime|ProjectileMarkerScale|BarSize|ShowSun|DeathCam|Tracer|WeaponModel|WeaponSkin|OverrideWeapon|ProjectileGraphic)", RegexOptions.IgnoreCase)) return "visuals";
        if (k.EndsWith("Material")) return "visuals";
        return "gameplay";
    }

    // ---------------- reading ----------------

    public JsonObject ReadPrimary() =>
        File.Exists(_paths.PrimarySettings)
            ? JsonNode.Parse(File.ReadAllText(_paths.PrimarySettings), documentOptions: new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip }) as JsonObject ?? new()
            : new JsonObject();

    public List<KeyValuePair<string, string>> ReadWeapon()
    {
        var list = new List<KeyValuePair<string, string>>();
        if (!File.Exists(_paths.WeaponSettings)) return list;
        foreach (var line in File.ReadAllLines(_paths.WeaponSettings))
        {
            int eq = line.IndexOf('=');
            if (eq > 0) list.Add(new(line[..eq], line[(eq + 1)..]));
        }
        return list;
    }

    public object Snapshot(bool running) => new
    {
        running,
        primary = ReadPrimary(),
        weapon = ReadWeapon().ToDictionary(k => k.Key, k => k.Value),
        themes = ListNames(_paths.Themes, "*.json"),
        crosshairs = ListNames(_paths.Crosshairs, "*.png", keepExt: true),
        sounds = ListNames(Path.Combine(_paths.Content, "sounds"), "*.ogg"),
        scales = ReadScales(),
        categories = AllCategories,
    };

    /// <summary>Sensitivity/FOV scale names exactly as KovaaK's defines them (FovSensConfig.json).</summary>
    List<string> ReadScales()
    {
        try
        {
            var file = Path.Combine(_paths.SaveGames, "FovSensConfig.json");
            if (JsonNode.Parse(File.ReadAllText(file)) is JsonArray arr)
                return arr.Select(n => n?["ScaleName"]?.GetValue<string>()).Where(n => n != null).Select(n => n!).ToList();
        }
        catch { }
        return new() { "cm/360", "in/360", "Quake/Source", "Overwatch" };
    }

    static List<string> ListNames(string dir, string pattern, bool keepExt = false) =>
        Directory.Exists(dir)
            ? Directory.EnumerateFiles(dir, pattern).Select(f => keepExt ? Path.GetFileName(f) : Path.GetFileNameWithoutExtension(f))
                .OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList()
            : new();

    // ---------------- writing ----------------

    public string Backup(string reason)
    {
        var dir = Path.Combine(AppPaths.Backups, DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Regex.Replace(reason, @"[^\w\-]", "_"));
        Directory.CreateDirectory(dir);
        foreach (var f in new[] { _paths.PrimarySettings, _paths.WeaponSettings, _paths.UiSettings })
            if (File.Exists(f)) File.Copy(f, Path.Combine(dir, Path.GetFileName(f)), true);
        foreach (var old in new DirectoryInfo(AppPaths.Backups).GetDirectories().OrderByDescending(d => d.Name).Skip(40))
            try { old.Delete(true); } catch { }
        return dir;
    }

    public List<object> ListBackups() =>
        new DirectoryInfo(AppPaths.Backups).GetDirectories().OrderByDescending(d => d.Name)
            .Select(d => (object)new { id = d.Name, created = d.CreationTime }).ToList();

    public void RestoreBackup(string id)
    {
        var dir = Path.Combine(AppPaths.Backups, Path.GetFileName(id));
        if (!Directory.Exists(dir)) throw new InvalidOperationException("Backup not found");
        Backup("before-restore");
        foreach (var f in Directory.GetFiles(dir))
            File.Copy(f, Path.Combine(_paths.SaveGames, Path.GetFileName(f)), true);
    }

    /// <summary>Merges a section→key→value patch into PrimaryUserSettings.json and key→value into weaponsettings.ini.</summary>
    public void ApplyPatch(JsonObject? primaryPatch, Dictionary<string, string>? weaponPatch, JsonNode? ui = null)
    {
        if (primaryPatch is { Count: > 0 })
        {
            var root = ReadPrimary();
            foreach (var (section, values) in primaryPatch)
            {
                if (values is not JsonObject vals) { root[section] = values?.DeepClone(); continue; }
                var target = root.Obj(section);
                foreach (var (k, v) in vals) target[k] = v?.DeepClone();
            }
            WriteText(_paths.PrimarySettings, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        if (weaponPatch is { Count: > 0 })
        {
            var lines = File.Exists(_paths.WeaponSettings) ? File.ReadAllLines(_paths.WeaponSettings).ToList() : new();
            var remaining = new Dictionary<string, string>(weaponPatch);
            for (int i = 0; i < lines.Count; i++)
            {
                int eq = lines[i].IndexOf('=');
                if (eq <= 0) continue;
                var key = lines[i][..eq];
                if (remaining.Remove(key, out var val)) lines[i] = key + "=" + val;
            }
            lines.AddRange(remaining.Select(kv => kv.Key + "=" + kv.Value));
            WriteText(_paths.WeaponSettings, string.Join("\r\n", lines) + "\r\n");
        }
        if (ui != null) WriteText(_paths.UiSettings, ui.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    static void WriteText(string path, string text)
    {
        var tmp = path + ".kplus.tmp";
        File.WriteAllText(tmp, text);
        File.Move(tmp, path, true);
    }

    // ---------------- presets ----------------

    public Preset Capture(string name, List<string> categories)
    {
        var cats = categories.Count == 0 ? AllCategories.ToList() : categories;
        var p = new Preset { Name = name, Categories = cats };
        var root = ReadPrimary();
        foreach (var section in PrimarySections)
        {
            if (root[section] is not JsonObject sec) continue;
            var picked = new JsonObject();
            foreach (var (k, v) in sec)
                if (cats.Contains(section is "vectorSettings" or "colorSettings" ? "visuals" : Category(k)))
                    picked[k] = v?.DeepClone();
            if (picked.Count > 0) p.Primary[section] = picked;
        }
        if (cats.Contains("visuals"))
        {
            foreach (var extra in new[] { "characterModelOverride", "currentlySelectedBoundingBoxType" })
                if (root[extra] != null) p.Primary[extra] = root[extra]!.DeepClone();
        }
        foreach (var (k, v) in ReadWeapon())
            if (cats.Contains(Category(k))) p.Weapon[k] = v;

        if (cats.Contains("hud") && File.Exists(_paths.UiSettings))
            p.Ui = JsonNode.Parse(File.ReadAllText(_paths.UiSettings));

        if (cats.Contains("theme"))
        {
            p.ThemeName = (root["stringSettings"] as JsonObject)?["EStringSettingId::CurrentThemeName"]?.GetValue<string>();
            var tf = p.ThemeName == null ? null : Path.Combine(_paths.Themes, p.ThemeName + ".json");
            if (tf != null && File.Exists(tf)) p.ThemeContent = File.ReadAllText(tf);
        }
        if (cats.Contains("crosshair") && p.Weapon.TryGetValue("CrosshairFile", out var ch))
        {
            p.CrosshairFile = ch;
            var cf = Path.Combine(_paths.Crosshairs, ch);
            if (File.Exists(cf) && new FileInfo(cf).Length < 2_000_000) p.CrosshairData = Convert.ToBase64String(File.ReadAllBytes(cf));
        }
        return p;
    }

    /// <summary>True when the current settings already contain every value the preset would write.</summary>
    public bool Matches(Preset p)
    {
        var root = ReadPrimary();
        foreach (var (section, values) in p.Primary)
        {
            if (values is not JsonObject vals) continue;
            var current = root[section] as JsonObject;
            foreach (var (k, v) in vals)
                if (!SameValue(v, current?[k])) return false;
        }
        var weapon = ReadWeapon().ToDictionary(kv => kv.Key, kv => kv.Value);
        foreach (var (k, v) in p.Weapon)
            if (!weapon.TryGetValue(k, out var cur) || !SameText(cur, v)) return false;
        return true;
    }

    static bool SameText(string a, string b) =>
        a == b || (double.TryParse(a, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var x)
                   && double.TryParse(b, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var y)
                   && Math.Abs(x - y) < 1e-4);

    static bool SameValue(JsonNode? a, JsonNode? b)
    {
        if (a is JsonValue va && b is JsonValue vb)
        {
            if (va.TryGetValue<double>(out var x) && vb.TryGetValue<double>(out var y)) return Math.Abs(x - y) < 1e-4;
            return va.ToJsonString() == vb.ToJsonString();
        }
        if (a is JsonObject oa && b is JsonObject ob)
            return oa.All(kv => SameValue(kv.Value, ob[kv.Key]));
        return a?.ToJsonString() == b?.ToJsonString();
    }

    public void ApplyPreset(Preset p)
    {
        Backup("preset-" + p.Name);
        if (p.ThemeName != null && p.ThemeContent != null)
        {
            Directory.CreateDirectory(_paths.Themes);
            var tf = Path.Combine(_paths.Themes, SafeFile(p.ThemeName) + ".json");
            if (!File.Exists(tf)) File.WriteAllText(tf, p.ThemeContent);
        }
        if (p.CrosshairFile != null && p.CrosshairData != null)
        {
            var cf = Path.Combine(_paths.Crosshairs, SafeFile(p.CrosshairFile));
            if (!File.Exists(cf)) File.WriteAllBytes(cf, Convert.FromBase64String(p.CrosshairData));
        }
        ApplyPatch(p.Primary, p.Weapon, p.Ui);
    }

    static string SafeFile(string name) => string.Concat(name.Split(Path.GetInvalidFileNameChars()));
}

public class PresetStore
{
    static string FileFor(string id) => Path.Combine(AppPaths.Presets, Path.GetFileName(id) + ".json");

    public List<Preset> List() =>
        Directory.EnumerateFiles(AppPaths.Presets, "*.json").Select(f => Json.Read<Preset>(f)).Where(p => p != null)
            .Select(p => p!).OrderByDescending(p => p.Updated).ToList();

    public Preset? Get(string id) => Json.Read<Preset>(FileFor(id));

    public void Save(Preset p)
    {
        p.Updated = DateTime.Now;
        Json.Write(FileFor(p.Id), p);
    }

    public void Delete(string id)
    {
        var f = FileFor(id);
        if (File.Exists(f)) File.Delete(f);
    }
}
