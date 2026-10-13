using System.IO.Compression;
using System.Text.Json;

namespace KovaaksPlus;

public class PackManifest
{
    public string Format { get; set; } = "kovaaks-plus-pack";
    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Pack";
    public string? Author { get; set; }
    public string? Description { get; set; }
    public DateTime Created { get; set; } = DateTime.Now;
    public string? Cover { get; set; }
    public List<PackScenario> Scenarios { get; set; } = new();
    public List<PackPreset> Presets { get; set; } = new();
    public List<TagDef> Tags { get; set; } = new();
}

public class PackScenario
{
    public string Name { get; set; } = "";
    public string? File { get; set; }
    public string? CustomName { get; set; }
    public List<string> Tags { get; set; } = new();   // tag names (ids are local to each install)
    public string? Notes { get; set; }
    public string? Thumbnail { get; set; }
    public string? Preview { get; set; }
    public string? Preset { get; set; }   // preset id inside this pack
}

public class PackPreset
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string File { get; set; } = "";
}

/// <summary>Exports/imports .kpack files (zip + manifest) containing scenarios, their overlay metadata, presets and media.</summary>
public class PackManager
{
    const long MaxEntry = 64L * 1024 * 1024;
    readonly GamePaths _paths;
    readonly ScenarioLibrary _scenarios;
    readonly LibraryStore _library;
    readonly PresetStore _presets;

    public PackManager(GamePaths paths, ScenarioLibrary scenarios, LibraryStore library, PresetStore presets)
    {
        _paths = paths; _scenarios = scenarios; _library = library; _presets = presets;
    }

    public object Export(string target, string name, string? author, string? description, List<string> scenarioNames, List<string> presetIds)
    {
        var manifest = new PackManifest { Name = name, Author = author, Description = description };
        var usedTags = new HashSet<string>();
        var tmp = target + ".tmp";
        using (var fs = new FileStream(tmp, FileMode.Create))
        using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
        {
            var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string? AddMedia(string? media)
            {
                if (media == null || media.StartsWith("ic:")) return null;
                string src;
                try { src = Api.MediaFull(media); } catch { return null; }
                if (!File.Exists(src)) return null;
                var entry = "media/" + media.Replace('\\', '/');
                if (usedNames.Add(entry)) zip.CreateEntryFromFile(src, entry, CompressionLevel.Optimal);
                return entry;
            }

            foreach (var sn in scenarioNames.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var file = _scenarios.Find(sn);
                var meta = _library.Meta(sn);
                var ps = new PackScenario { Name = sn, CustomName = meta.CustomName, Notes = meta.Notes,
                    Preset = meta.Preset != null && presetIds.Contains(meta.Preset) ? meta.Preset : null };
                if (file != null && File.Exists(file.Path))
                {
                    var entry = "scenarios/" + Path.GetFileName(file.Path);
                    for (int i = 2; !usedNames.Add(entry); i++) entry = $"scenarios/{Path.GetFileNameWithoutExtension(file.Path)} ({i}).sce";
                    zip.CreateEntryFromFile(file.Path, entry, CompressionLevel.Optimal);
                    ps.File = entry;
                }
                foreach (var tagId in meta.Tags)
                {
                    var t = _library.Data.Tags.FirstOrDefault(x => x.Id == tagId);
                    if (t == null) continue;
                    ps.Tags.Add(t.Name);
                    usedTags.Add(t.Id);
                }
                ps.Thumbnail = AddMedia(meta.Thumbnail);
                ps.Preview = AddMedia(meta.Preview);
                manifest.Scenarios.Add(ps);
            }

            foreach (var id in presetIds.Distinct())
            {
                var p = _presets.Get(id);
                if (p == null) continue;
                var copy = JsonSerializer.Deserialize<Preset>(JsonSerializer.Serialize(p, Json.Options), Json.Options)!;
                copy.Thumbnail = AddMedia(p.Thumbnail);
                copy.Preview = AddMedia(p.Preview);
                var entry = $"presets/{p.Id}.json";
                using (var w = new StreamWriter(zip.CreateEntry(entry).Open()))
                    w.Write(JsonSerializer.Serialize(copy, Json.Options));
                manifest.Presets.Add(new PackPreset { Id = p.Id, Name = p.Name, File = entry });
            }

            manifest.Tags = _library.Data.Tags.Where(t => usedTags.Contains(t.Id))
                .Select(t => new TagDef { Id = t.Id, Name = t.Name, Color = t.Color, Group = t.Group, Thumbnail = AddMedia(t.Thumbnail),
                    Icon = t.Icon != null && t.Icon.StartsWith("ic:") ? t.Icon : AddMedia(t.Icon),
                    Preset = t.Preset != null && presetIds.Contains(t.Preset) ? t.Preset : null })
                .ToList();
            manifest.Cover = manifest.Scenarios.Select(s => s.Thumbnail).FirstOrDefault(t => t != null);
            using (var w = new StreamWriter(zip.CreateEntry("manifest.json").Open()))
                w.Write(JsonSerializer.Serialize(manifest, Json.Options));
        }
        File.Move(tmp, target, true);
        return new { path = target, scenarios = manifest.Scenarios.Count, presets = manifest.Presets.Count };
    }

    static PackManifest ReadManifest(ZipArchive zip)
    {
        var e = zip.GetEntry("manifest.json") ?? throw new InvalidDataException("Not a Kovaak's Plus pack (manifest.json missing).");
        using var r = new StreamReader(e.Open());
        var m = JsonSerializer.Deserialize<PackManifest>(r.ReadToEnd(), Json.Options) ?? throw new InvalidDataException("Invalid manifest.");
        if (m.Format != "kovaaks-plus-pack") throw new InvalidDataException("Unknown pack format.");
        return m;
    }

    public object Preview(string path)
    {
        using var zip = ZipFile.OpenRead(path);
        var m = ReadManifest(zip);
        return new
        {
            path,
            m.Name, m.Author, m.Description, m.Created,
            scenarios = m.Scenarios.Select(s =>
            {
                var existing = _scenarios.Find(s.Name);
                bool identical = false;
                if (existing != null && s.File != null && zip.GetEntry(s.File) is { } entry)
                    identical = SameContent(entry, existing.Path);
                return new
                {
                    s.Name, s.CustomName, s.Tags, hasFile = s.File != null,
                    exists = existing != null, identical,
                    hasThumbnail = s.Thumbnail != null,
                };
            }).ToList(),
            presets = m.Presets.Select(p => new { p.Id, p.Name, exists = _presets.Get(p.Id) != null }).ToList(),
        };
    }

    static bool SameContent(ZipArchiveEntry entry, string file)
    {
        try
        {
            var fi = new FileInfo(file);
            if (fi.Length != entry.Length) return false;
            using var a = entry.Open();
            using var b = fi.OpenRead();
            int x, y;
            do { x = a.ReadByte(); y = b.ReadByte(); if (x != y) return false; } while (x != -1);
            return true;
        }
        catch { return false; }
    }

    public object Import(string path, List<string> scenarioNames, List<string> presetIds, bool overwrite)
    {
        using var zip = ZipFile.OpenRead(path);
        var m = ReadManifest(zip);
        int installed = 0, skipped = 0, metaUpdated = 0, presetsAdded = 0;
        var wanted = new HashSet<string>(scenarioNames, StringComparer.OrdinalIgnoreCase);

        // Files land in the same per-owner folders the app uses for its own thumbnails.
        string? ExtractMedia(string? entryName, string? owner = null, string target = "imported")
        {
            if (entryName == null) return null;
            var entry = zip.GetEntry(entryName);
            if (entry == null || entry.Length > MaxEntry) return null;
            var ext = Path.GetExtension(entry.Name).ToLowerInvariant();
            if (!Api.MediaExtensions.Contains(ext)) return null;
            var name = Api.MediaTarget(owner, target, ext);
            entry.ExtractToFile(Api.MediaFull(name));
            return name;
        }

        // Presets first, so scenarios/tags that reference them can be pointed at the (possibly re-numbered) copies.
        var presetMap = new Dictionary<string, string>();
        foreach (var pp in m.Presets.Where(p => presetIds.Contains(p.Id)))
        {
            var pentry = zip.GetEntry(pp.File);
            if (pentry == null || pentry.Length > MaxEntry) continue;
            using var r = new StreamReader(pentry.Open());
            var preset = JsonSerializer.Deserialize<Preset>(r.ReadToEnd(), Json.Options);
            if (preset == null) continue;
            var original = preset.Id;
            if (_presets.Get(preset.Id) != null && !overwrite) preset.Id = Guid.NewGuid().ToString("N")[..12];
            preset.Thumbnail = ExtractMedia(preset.Thumbnail, "preset:" + preset.Name, "thumbnail");
            preset.Preview = ExtractMedia(preset.Preview, "preset:" + preset.Name, "preview");
            _presets.Save(preset);
            presetMap[original] = preset.Id;
            presetsAdded++;
        }

        // Map pack tags (by name) onto this install's tags, creating any that are missing.
        var tagMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in m.Tags)
        {
            var local = _library.EnsureTag(t.Name, string.IsNullOrWhiteSpace(t.Group) ? "Custom" : t.Group, t.Color);
            if (local.Thumbnail == null || overwrite) local.Thumbnail = ExtractMedia(t.Thumbnail, "tag:" + t.Name, "thumbnail") ?? local.Thumbnail;
            if (local.Icon == null || overwrite)
                local.Icon = t.Icon != null && t.Icon.StartsWith("ic:") ? t.Icon : ExtractMedia(t.Icon, "tag:" + t.Name, "icon") ?? local.Icon;
            if (t.Preset != null && presetMap.TryGetValue(t.Preset, out var tp) && (local.Preset == null || overwrite)) local.Preset = tp;
            tagMap[t.Name] = local.Id;
        }

        foreach (var s in m.Scenarios.Where(s => wanted.Contains(s.Name)))
        {
            if (s.File != null && zip.GetEntry(s.File) is { } entry && entry.Length < MaxEntry)
            {
                Directory.CreateDirectory(_paths.Scenarios);
                var target = Path.Combine(_paths.Scenarios, Path.GetFileName(entry.Name));
                var existing = _scenarios.Find(s.Name);
                bool identical = existing != null && SameContent(entry, existing.Path);
                if (identical || (File.Exists(target) && !overwrite)) skipped++;
                else
                {
                    if (File.Exists(target))
                    {
                        var bdir = Path.Combine(AppPaths.Backups, "scenarios", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                        Directory.CreateDirectory(bdir);
                        File.Copy(target, Path.Combine(bdir, Path.GetFileName(target)), true);
                    }
                    entry.ExtractToFile(target, true);
                    installed++;
                }
            }

            var thumb = ExtractMedia(s.Thumbnail, "scenario:" + s.Name, "thumbnail");
            var preview = ExtractMedia(s.Preview, "scenario:" + s.Name, "preview");
            _library.Update(s.Name, meta =>
            {
                if (s.CustomName != null && (overwrite || meta.CustomName == null)) meta.CustomName = s.CustomName;
                if (s.Notes != null && (overwrite || meta.Notes == null)) meta.Notes = s.Notes;
                if (thumb != null && (overwrite || meta.Thumbnail == null)) meta.Thumbnail = thumb;
                if (preview != null && (overwrite || meta.Preview == null)) meta.Preview = preview;
                if (s.Preset != null && presetMap.TryGetValue(s.Preset, out var sp) && (overwrite || meta.Preset == null)) meta.Preset = sp;
                foreach (var tn in s.Tags)
                {
                    if (!tagMap.TryGetValue(tn, out var id)) id = tagMap[tn] = _library.EnsureTag(tn, "Custom", "#8b5cf6").Id;
                    if (!meta.Tags.Contains(id)) meta.Tags.Add(id);
                }
            });
            metaUpdated++;
        }
        _library.Save();
        return new { installed, skipped, metaUpdated, presetsAdded };
    }
}
