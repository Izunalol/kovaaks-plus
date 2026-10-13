using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace KovaaksPlus;

/// <summary>Locates KovaaK's, its workshop content and the signed-in Steam account — so friends need zero manual setup.</summary>
public class GamePaths
{
    public const string AppId = "824270";
    public const string ProcessName = "FPSAimTrainer-Win64-Shipping";

    public string GameRoot { get; }
    public string Content => Path.Combine(GameRoot, "FPSAimTrainer");
    public string Stats => Path.Combine(Content, "stats");
    public string SaveGames => Path.Combine(Content, "Saved", "SaveGames");
    public string Scenarios => Path.Combine(SaveGames, "Scenarios");
    public string Playlists => Path.Combine(SaveGames, "Playlists");
    public string Themes => Path.Combine(SaveGames, "Themes");
    public string Crosshairs => Path.Combine(Content, "crosshairs");
    public string PrimarySettings => Path.Combine(SaveGames, "PrimaryUserSettings.json");
    public string WeaponSettings => Path.Combine(SaveGames, "weaponsettings.ini");
    public string UiSettings => Path.Combine(SaveGames, "UI.json");
    public string LogFile => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FPSAimTrainer", "Saved", "Logs", "FPSAimTrainer.log");

    public List<string> Workshop { get; }

    public GamePaths(string gameRoot, IEnumerable<string> workshop)
    {
        GameRoot = gameRoot;
        Workshop = workshop.Where(Directory.Exists).ToList();
    }

    public bool IsValid => Directory.Exists(Content);

    public static string? SteamRoot()
    {
        var p = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string
                ?? Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath", null) as string;
        return p == null ? null : Path.GetFullPath(p.Replace('/', '\\'));
    }

    public static List<string> SteamLibraries()
    {
        var libs = new List<string>();
        var root = SteamRoot();
        if (root == null) return libs;
        libs.Add(root);
        var vdf = Path.Combine(root, "steamapps", "libraryfolders.vdf");
        if (File.Exists(vdf))
        {
            foreach (Match m in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s+\"([^\"]+)\""))
            {
                var path = m.Groups[1].Value.Replace(@"\\", @"\");
                if (!libs.Contains(path, StringComparer.OrdinalIgnoreCase)) libs.Add(path);
            }
        }
        return libs;
    }

    public record Detection(string? GamePath, List<string> WorkshopPaths, string? SteamId, string? SteamName);

    public static Detection Detect()
    {
        string? game = null;
        var workshop = new List<string>();
        foreach (var lib in SteamLibraries())
        {
            var g = Path.Combine(lib, "steamapps", "common", "FPSAimTrainer");
            if (game == null && Directory.Exists(Path.Combine(g, "FPSAimTrainer"))) game = g;
            var w = Path.Combine(lib, "steamapps", "workshop", "content", AppId);
            if (Directory.Exists(w)) workshop.Add(w);
        }
        if (game == null)
        {
            // Fallback: Steam's uninstall entry.
            var loc = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App " + AppId,
                "InstallLocation", null) as string;
            if (loc != null && Directory.Exists(loc)) game = loc;
        }
        var (id, name) = DetectSteamUser();
        return new Detection(game, workshop, id, name);
    }

    /// <summary>Reads Steam's loginusers.vdf and returns the most recently signed-in account.</summary>
    public static (string? id, string? name) DetectSteamUser()
    {
        var root = SteamRoot();
        if (root == null) return (null, null);
        var file = Path.Combine(root, "config", "loginusers.vdf");
        if (!File.Exists(file)) return (null, null);
        var text = File.ReadAllText(file);
        string? firstId = null, firstName = null;
        foreach (Match m in Regex.Matches(text, "\"(7656\\d{13})\"\\s*\\{([^}]*)\\}"))
        {
            var id = m.Groups[1].Value;
            var body = m.Groups[2].Value;
            var name = Regex.Match(body, "\"PersonaName\"\\s+\"([^\"]*)\"").Groups[1].Value;
            firstId ??= id; firstName ??= name;
            if (Regex.IsMatch(body, "\"MostRecent\"\\s+\"1\"")) return (id, name);
        }
        return (firstId, firstName);
    }
}
