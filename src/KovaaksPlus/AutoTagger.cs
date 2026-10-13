using System.Globalization;
using System.Text.RegularExpressions;

namespace KovaaksPlus;

/// <summary>
/// Proposes tags for scenarios from several sources (evxl skill classification, the scenario's in-game GameTag and
/// difficulty, benchmark membership) and matches each proposal against the user's existing tags so the UI can ask
/// "use existing tag X or create a new one?" instead of creating near-duplicates.
/// </summary>
public static class AutoTagger
{
    public class Candidate
    {
        public string Key { get; set; } = "";
        public string Name { get; set; } = "";
        public string Source { get; set; } = "";
        public string Group { get; set; } = "Custom";
        public List<string> Variants { get; set; } = new();
        [System.Text.Json.Serialization.JsonIgnore]
        public Dictionary<string, int> VariantCounts { get; } = new(StringComparer.OrdinalIgnoreCase);
        public List<string> Names { get; set; } = new();
        public int Count => Names.Count;
        public string? MatchTagId { get; set; }
        public string? MatchKind { get; set; }        // exact | similar | suggested
        public List<string> Similar { get; set; } = new();
    }

    static readonly Dictionary<string, string> SkillLabels = new()
    {
        ["dynamic_clicking"] = "Dynamic Clicking", ["static_clicking"] = "Static Clicking",
        ["reactive_tracking"] = "Reactive Tracking", ["precise_tracking"] = "Precise Tracking",
        ["smooth_tracking"] = "Smooth Tracking", ["control_tracking"] = "Control Tracking",
        ["speed_switching"] = "Speed Switching", ["evasive_switching"] = "Evasive Switching",
        ["stability_switching"] = "Stability Switching", ["movement"] = "Movement",
    };

    // Common abbreviations in KovaaK's GameTags.
    static readonly Dictionary<string, string> Aliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ow"] = "overwatch", ["ow2"] = "overwatch", ["fn"] = "fortnite", ["csgo"] = "cs", ["cs2"] = "cs", ["cs:go"] = "cs",
        ["counter strike"] = "cs", ["r6"] = "rainbow six", ["r6s"] = "rainbow six", ["apex legends"] = "apex",
        ["val"] = "valorant", ["valo"] = "valorant", ["tf2"] = "team fortress 2", ["qc"] = "quake champions",
        ["ts"] = "switching", ["target switching"] = "switching", ["cod"] = "call of duty", ["bf"] = "battlefield",
    };

    static readonly Dictionary<string, string> AliasDisplay = new(StringComparer.OrdinalIgnoreCase)
    {
        ["cs"] = "Counter-Strike", ["rainbow six"] = "Rainbow Six Siege", ["overwatch"] = "Overwatch", ["fortnite"] = "Fortnite",
        ["apex"] = "Apex Legends", ["valorant"] = "Valorant", ["team fortress 2"] = "Team Fortress 2", ["quake champions"] = "Quake Champions",
        ["switching"] = "Switching", ["call of duty"] = "Call of Duty", ["battlefield"] = "Battlefield",
    };

    static readonly HashSet<string> Junk = new(StringComparer.OrdinalIgnoreCase)
        { "every", "all", "none", "other", "misc", "test", "new", "the", "game", "scenario", "scenarios" };

    /// <summary>Normalised word stems ("Tracking" → "track", "Clicks" → "click").</summary>
    public static HashSet<string> Stems(string text)
    {
        var t = text.ToLowerInvariant().Trim();
        if (Aliases.TryGetValue(t, out var alias)) t = alias;
        var set = new HashSet<string>();
        foreach (var raw in Regex.Split(t, @"[^a-z0-9]+").Where(w => w.Length > 0))
        {
            var w = Aliases.TryGetValue(raw, out var a) ? a : raw;
            foreach (var part in w.Split(' '))
            {
                var s = part;
                if (s.Length > 5 && s.EndsWith("ing")) s = s[..^3];
                else if (s.Length > 4 && s.EndsWith("es")) s = s[..^2];
                else if (s.Length > 3 && s.EndsWith('s') && !s.EndsWith("ss")) s = s[..^1];
                if (s.EndsWith("tch") && s.Length > 5) { }  // "switch" stays "switch"
                set.Add(s);
            }
        }
        return set;
    }

    static string KeyOf(HashSet<string> stems) => string.Join(" ", stems.OrderBy(s => s));

    static string Title(string s) =>
        CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.ToLowerInvariant());

    public static List<Candidate> Scan(IEnumerable<string> scope, ScenarioLibrary files, Dictionary<string, ScenarioClass> classes,
        BenchmarkCatalog catalog, List<TagDef> tags, HashSet<string> sources, int minCount)
    {
        var cands = new Dictionary<string, Candidate>();
        void Add(string label, string source, string group, string scenario)
        {
            label = label.Trim();
            if (label.Length < 2 || label.Length > 32 || Junk.Contains(label) || Regex.IsMatch(label, @"^\d+(\.\d+)?$")) return;
            var stems = Stems(label);
            if (stems.Count == 0) return;
            var key = source == "difficulty" ? "difficulty:" + label : KeyOf(stems);
            if (!cands.TryGetValue(key, out var c))
                cands[key] = c = new Candidate { Key = key, Name = label, Source = source, Group = group };
            if (!c.Variants.Contains(label, StringComparer.OrdinalIgnoreCase)) c.Variants.Add(label);
            c.VariantCounts[label] = c.VariantCounts.GetValueOrDefault(label) + 1;
            if (!c.Names.Contains(scenario, StringComparer.OrdinalIgnoreCase)) c.Names.Add(scenario);
            if (source == "skills") { c.Name = label; c.Source = "skills"; c.Group = group; }
        }

        // Display names: skill labels as-is; known aliases get their canonical name; otherwise the most common spelling.
        void PickNames()
        {
            foreach (var c in cands.Values.Where(c => c.Source == "gametag"))
            {
                var alias = c.Variants.Select(v => Aliases.TryGetValue(v.ToLowerInvariant(), out var a) ? a : null).FirstOrDefault(a => a != null);
                if (alias != null && AliasDisplay.TryGetValue(alias, out var nice)) c.Name = nice;
                else c.Name = c.VariantCounts.OrderByDescending(kv => kv.Value).ThenByDescending(kv => kv.Key.Length).First().Key;
            }
        }

        var benchScenarios = new HashSet<string>(catalog.Entries.Values.SelectMany(e => e.Scenarios.Keys), StringComparer.OrdinalIgnoreCase);
        foreach (var name in scope.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (sources.Contains("skills") && classes.TryGetValue(name, out var cls))
                foreach (var sk in cls.Skills)
                    Add(SkillLabels.TryGetValue(sk, out var l) ? l : Title(sk.Replace('_', ' ')), "skills", "Aim Type", name);

            var file = files.Find(name);
            if (sources.Contains("gametag") && file?.GameTag is { } gt)
                foreach (var part in gt.Split(',', ';', '|', '/'))
                {
                    var p = part.Trim();
                    if (p.Length > 0) Add(p.Length <= 4 && p.ToUpperInvariant() == p ? p : Title(p), "gametag", "In-game tags", name);
                }

            if (sources.Contains("difficulty") && file?.Difficulty is { } d
                && double.TryParse(d, NumberStyles.Float, CultureInfo.InvariantCulture, out var dv) && dv >= 1 && dv <= 5)
                Add("Difficulty " + Math.Round(dv), "difficulty", "Difficulty", name);

            if (sources.Contains("benchmark") && benchScenarios.Contains(name))
                Add("Benchmark", "benchmark", "Other", name);
        }

        PickNames();

        // Match against existing tags: identical word stems → reuse silently; overlapping words → ask.
        var tagStems = tags.Select(t => (tag: t, stems: Stems(t.Name))).ToList();
        string[] diffDefaults = { "", "Easy", "Easy", "Medium", "Hard", "Extreme" };
        foreach (var c in cands.Values)
        {
            if (c.Source == "difficulty")
            {
                int level = int.Parse(c.Name[^1..]);
                var def = tags.FirstOrDefault(t => t.Name.Equals(diffDefaults[level], StringComparison.OrdinalIgnoreCase));
                var same = tags.FirstOrDefault(t => t.Name.Equals(c.Name, StringComparison.OrdinalIgnoreCase));
                if (same != null) { c.MatchTagId = same.Id; c.MatchKind = "exact"; }
                else if (def != null) { c.MatchTagId = def.Id; c.MatchKind = "suggested"; c.Similar.Add(def.Id); }
                continue;
            }
            var stems = Stems(c.Name);
            foreach (var v in c.Variants) stems.UnionWith(Stems(v));
            var exact = tagStems.FirstOrDefault(t => t.stems.SetEquals(Stems(c.Name)));
            if (exact.tag != null) { c.MatchTagId = exact.tag.Id; c.MatchKind = "exact"; continue; }
            var similar = tagStems
                .Where(t => t.stems.Count > 0 && (t.stems.IsSubsetOf(stems) || stems.IsSubsetOf(t.stems) || t.stems.Overlaps(stems)))
                .OrderByDescending(t => t.stems.Intersect(stems).Count())
                .ThenBy(t => Math.Abs(t.stems.Count - stems.Count))
                .Select(t => t.tag.Id).Take(4).ToList();
            if (similar.Count > 0) { c.Similar = similar; c.MatchTagId = similar[0]; c.MatchKind = "similar"; }
        }

        return cands.Values.Where(c => c.Count >= minCount || c.MatchKind == "exact" && c.Count > 0)
            .OrderBy(c => c.Source switch { "skills" => 0, "benchmark" => 1, "difficulty" => 2, _ => 3 })
            .ThenByDescending(c => c.Count).ToList();
    }
}
