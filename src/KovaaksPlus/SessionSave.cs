using System.Text;

namespace KovaaksPlus;

/// <summary>
/// Reads the few fields we need from KovaaK's session.sav (an Unreal GVAS save): the loaded scenario
/// and the in-game favorite lists. Tolerant by design: unknown layouts just return nothing.
/// </summary>
public static class SessionSave
{
    public static string PathFor() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FPSAimTrainer", "Saved", "SaveGames", "session.sav");

    public record Data(string? ScenarioName, List<string> Favorites, DateTime WrittenUtc);

    public static Data? Read(string? path = null)
    {
        path ??= PathFor();
        for (int attempt = 0; attempt < 4; attempt++)
        {
            try
            {
                if (!File.Exists(path)) return null;
                byte[] bytes;
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    bytes = new byte[fs.Length];
                    fs.ReadExactly(bytes);
                }
                var favorites = new List<string>();
                favorites.AddRange(ReadStringSet(bytes, "FavoriteHDScenarios"));
                favorites.AddRange(ReadStringSet(bytes, "FavoriteWorkshopScenarios"));
                return new Data(ReadStrProperty(bytes, "ScenarioName"), favorites.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
                    File.GetLastWriteTimeUtc(path));
            }
            catch (IOException) { Thread.Sleep(60); }
            catch { return null; }
        }
        return null;
    }

    static int Find(byte[] data, byte[] pattern, int start)
    {
        for (int i = Math.Max(0, start); i <= data.Length - pattern.Length; i++)
        {
            int j = 0;
            while (j < pattern.Length && data[i + j] == pattern[j]) j++;
            if (j == pattern.Length) return i;
        }
        return -1;
    }

    static byte[] FStringBytes(string s) => Encoding.ASCII.GetBytes(s + "\0");

    /// <summary>Reads an FString (int32 length, then ASCII or UTF-16 when negative).</summary>
    static string? ReadFString(byte[] d, ref int pos)
    {
        if (pos + 4 > d.Length) return null;
        int len = BitConverter.ToInt32(d, pos);
        pos += 4;
        if (len == 0) return "";
        if (len > 0)
        {
            if (len > 4096 || pos + len > d.Length) return null;
            var s = Encoding.UTF8.GetString(d, pos, len - 1);
            pos += len;
            return s;
        }
        int chars = -len;
        if (chars > 4096 || pos + chars * 2 > d.Length) return null;
        var u = Encoding.Unicode.GetString(d, pos, (chars - 1) * 2);
        pos += chars * 2;
        return u;
    }

    // Layout: FString name | FString "StrProperty" | int64 size | byte hasGuid | FString value
    static string? ReadStrProperty(byte[] d, string name)
    {
        int at = Find(d, FStringBytes(name), 0);
        if (at < 0) return null;
        int type = Find(d, FStringBytes("StrProperty"), at);
        if (type < 0 || type - at > 64) return null;
        int pos = type + "StrProperty".Length + 1 + 8 + 1;
        return ReadFString(d, ref pos);
    }

    // Layout: name | "SetProperty" | int64 size | FString inner type | byte hasGuid | int32 removed | int32 count | entries
    static List<string> ReadStringSet(byte[] d, string name)
    {
        var list = new List<string>();
        int at = Find(d, FStringBytes(name), 0);
        if (at < 0) return list;
        int inner = Find(d, FStringBytes("StrProperty"), at);
        if (inner < 0 || inner - at > 96) return list;
        int pos = inner + "StrProperty".Length + 1 + 1;
        if (pos + 8 > d.Length) return list;
        int removed = BitConverter.ToInt32(d, pos); pos += 4;
        if (removed != 0) return list;
        int count = BitConverter.ToInt32(d, pos); pos += 4;
        if (count < 0 || count > 5000) return list;
        for (int i = 0; i < count; i++)
        {
            var s = ReadFString(d, ref pos);
            if (s == null) break;
            if (s.Length > 0) list.Add(s);
        }
        return list;
    }
}
