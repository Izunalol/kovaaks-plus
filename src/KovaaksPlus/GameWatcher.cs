using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace KovaaksPlus;

/// <summary>
/// Observes KovaaK's from the outside (process list, keyboard, stats folder, log file) and switches window focus.
/// Nothing is injected into the game process.
/// </summary>
public sealed class GameWatcher : IDisposable
{
    readonly Func<AppConfig> _config;
    readonly Control _ui;
    GamePaths? _paths;

    Process? _game;
    int _gamePid;
    System.Windows.Forms.Timer? _poll;
    FileSystemWatcher? _statsWatcher;
    readonly HashSet<string> _seenStats = new(StringComparer.OrdinalIgnoreCase);

    // The keyboard hook lives on its own thread so a busy UI can never add input lag in game
    // (Windows also silently drops low-level hooks that respond slowly).
    Thread? _hookThread;
    uint _hookThreadId;
    IntPtr _hook = IntPtr.Zero;
    Native.LowLevelKeyboardProc? _hookProc;   // keep delegate alive for the hook's lifetime
    volatile int _hookPid;                    // game pid as seen by the hook thread
    volatile uint _pauseVk = (uint)Keys.Escape;
    long _lastPauseTicks;
    long _expectResumeUntilTicks;

    long _logPos = -1;
    static readonly Regex StartRx = new(@"Scenario start broadcast: '(.+?)'", RegexOptions.Compiled);

    // Which scenario is loaded comes from several signals; the newest one wins:
    // our own Play button, session.sav (rewritten by the game), finished runs, and the log if it is live.
    FileSystemWatcher? _sessionWatcher;
    DateTime _currentAtUtc = DateTime.MinValue;

    public event Action<bool>? StatusChanged;
    public event Action? PauseDetected;
    public event Action<string>? StatsFileCreated;
    public event Action<string>? ScenarioStarted;

    public bool IsRunning => _gamePid != 0;
    public string? CurrentScenario { get; private set; }

    public void SetCurrentScenario(string? name, DateTime? atUtc = null)
    {
        var at = atUtc ?? DateTime.UtcNow;
        if (string.IsNullOrWhiteSpace(name) || at < _currentAtUtc) return;
        _currentAtUtc = at;
        if (name == CurrentScenario) return;
        CurrentScenario = name;
        ScenarioStarted?.Invoke(name);
    }

    /// <summary>Re-reads session.sav and adopts its scenario if it was written after our last signal.</summary>
    public void RefreshFromSession()
    {
        var s = SessionSave.Read();
        if (s?.ScenarioName is { Length: > 0 } n && (_game == null || s.WrittenUtc >= SafeStartUtc()))
            SetCurrentScenario(n, s.WrittenUtc);
    }

    DateTime SafeStartUtc()
    {
        try { return _game?.StartTime.ToUniversalTime() ?? DateTime.MinValue; } catch { return DateTime.MinValue; }
    }

    void WatchSession()
    {
        _sessionWatcher?.Dispose();
        var file = SessionSave.PathFor();
        var dir = Path.GetDirectoryName(file)!;
        if (!Directory.Exists(dir)) return;
        _sessionWatcher = new FileSystemWatcher(dir, "session.sav") { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size };
        FileSystemEventHandler h = (_, _) => _ui.BeginInvoke(async () => { await Task.Delay(250); RefreshFromSession(); });
        _sessionWatcher.Changed += h;
        _sessionWatcher.Created += h;
        _sessionWatcher.Renamed += (_, _) => _ui.BeginInvoke(async () => { await Task.Delay(250); RefreshFromSession(); });
        _sessionWatcher.EnableRaisingEvents = true;
    }

    public GameWatcher(Control ui, Func<AppConfig> config)
    {
        _ui = ui;
        _config = config;
    }

    public void Start(GamePaths paths)
    {
        _paths = paths;
        _poll ??= new System.Windows.Forms.Timer { Interval = 1000 };
        _poll.Tick -= OnPoll;
        _poll.Tick += OnPoll;
        _poll.Start();
        OnPoll(null, EventArgs.Empty);
        WatchStats();
        WatchSession();
        UpdateHook();
    }

    void WatchStats()
    {
        _statsWatcher?.Dispose();
        _statsWatcher = null;
        if (_paths == null || !Directory.Exists(_paths.Stats)) return;
        _statsWatcher = new FileSystemWatcher(_paths.Stats, "*.csv")
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite,
            InternalBufferSize = 64 * 1024,
        };
        _statsWatcher.Created += (_, e) => OnStats(e.FullPath);
        _statsWatcher.Renamed += (_, e) => OnStats(e.FullPath);
        _statsWatcher.EnableRaisingEvents = true;
    }

    void OnStats(string path)
    {
        if (!path.EndsWith("Stats.csv", StringComparison.OrdinalIgnoreCase)) return;
        lock (_seenStats) if (!_seenStats.Add(Path.GetFileName(path))) return;
        _ui.BeginInvoke(() => StatsFileCreated?.Invoke(path));
    }

    void OnPoll(object? sender, EventArgs e)
    {
        bool was = _gamePid != 0;
        if (_game == null || _game.HasExited)
        {
            _game?.Dispose();
            _game = Process.GetProcessesByName(GamePaths.ProcessName).FirstOrDefault();
            _gamePid = _game?.Id ?? 0;
            _hookPid = _gamePid;
            if (_game != null) _logPos = -1;
        }
        bool now = _gamePid != 0;
        if (was != now)
        {
            if (!now) { CurrentScenario = null; _currentAtUtc = DateTime.MinValue; }
            else RefreshFromSession();
            StatusChanged?.Invoke(now);
        }
        if (now) TailLog();
    }

    /// <summary>
    /// Optional: if the game is actively writing its log, use it to learn which scenario is loaded.
    /// Recent KovaaK's builds stopped writing it, so a log older than the running game is ignored entirely.
    /// </summary>
    void TailLog()
    {
        try
        {
            var log = _paths?.LogFile;
            if (log == null || !File.Exists(log)) return;
            var start = SafeStartUtc();
            var written = File.GetLastWriteTimeUtc(log);
            using var fs = new FileStream(log, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (_logPos < 0)
            {
                // Created/rotated by this game session → read it from the top; otherwise only read what gets appended.
                _logPos = File.GetCreationTimeUtc(log) >= start.AddSeconds(-5) && written >= start ? 0 : fs.Length;
            }
            if (fs.Length < _logPos) _logPos = 0;   // rotated while running
            if (fs.Length == _logPos || written < start) return;
            fs.Seek(_logPos, SeekOrigin.Begin);
            var buf = new byte[Math.Min(fs.Length - _logPos, 1024 * 1024)];
            int n = fs.Read(buf, 0, buf.Length);
            _logPos += n;
            var text = Encoding.UTF8.GetString(buf, 0, n);
            string? last = null;
            foreach (Match m in StartRx.Matches(text)) last = m.Groups[1].Value;
            if (last != null) SetCurrentScenario(last);
        }
        catch { /* log is best-effort */ }
    }

    // ---------------- keyboard hook (pause detection) ----------------

    public void UpdateHook()
    {
        var cfg = _config();
        _pauseVk = Enum.TryParse<Keys>(cfg.PauseKey, true, out var key) ? (uint)key : (uint)Keys.Escape;
        if (cfg.PauseBringsApp && _hookThread == null)
        {
            var ready = new ManualResetEventSlim();
            _hookThread = new Thread(() =>
            {
                _hookThreadId = Native.CurrentThreadId();
                _hookProc = HookCallback;
                _hook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, _hookProc, Native.GetModuleHandle(null), 0);
                ready.Set();
                while (Native.GetMessage(out _, IntPtr.Zero, 0, 0) > 0) { }
                if (_hook != IntPtr.Zero) Native.UnhookWindowsHookEx(_hook);
                _hook = IntPtr.Zero;
            }) { IsBackground = true, Name = "KeyboardHook", Priority = ThreadPriority.AboveNormal };
            _hookThread.Start();
            ready.Wait(2000);
        }
        else if (!cfg.PauseBringsApp && _hookThread != null)
        {
            StopHook();
        }
    }

    void StopHook()
    {
        if (_hookThread == null) return;
        Native.PostThreadMessage(_hookThreadId, Native.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        _hookThread.Join(1000);
        _hookThread = null;
    }

    /// <summary>Runs on the hook thread for every key press system-wide: must stay tiny and never block.</summary>
    IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        int pid = _hookPid;
        if (nCode >= 0 && pid != 0 && (wParam == Native.WM_KEYDOWN || wParam == Native.WM_SYSKEYDOWN)
            && (uint)Marshal.ReadInt32(lParam) == _pauseVk && Native.ForegroundProcessId() == pid)
        {
            long now = DateTime.UtcNow.Ticks;
            if (now < Interlocked.Read(ref _expectResumeUntilTicks))
            {
                // The user is un-pausing the game after we handed focus back — not a new pause.
                Interlocked.Exchange(ref _expectResumeUntilTicks, 0);
            }
            else if (now - Interlocked.Read(ref _lastPauseTicks) > TimeSpan.TicksPerMillisecond * 500)
            {
                Interlocked.Exchange(ref _lastPauseTicks, now);
                // Let the game process its own pause first, then come forward (on the UI thread).
                _ui.BeginInvoke(async () => { await Task.Delay(120); RefreshFromSession(); PauseDetected?.Invoke(); });
            }
        }
        return Native.CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    // ---------------- actions ----------------

    public IntPtr GameWindow => _gamePid == 0 ? IntPtr.Zero : Native.FindMainWindow(_gamePid);

    /// <summary>Hands focus back to KovaaK's. If <paramref name="resuming"/>, the next pause key is treated as "unpause".</summary>
    public bool FocusGame(bool resuming)
    {
        var w = GameWindow;
        if (w == IntPtr.Zero) return false;
        Interlocked.Exchange(ref _expectResumeUntilTicks, resuming ? DateTime.UtcNow.AddSeconds(4).Ticks : 0);
        // We are the foreground app when the user clicks a button here, so a plain switch is enough;
        // never force input tricks onto the game window (it may be busy loading).
        return Native.ForceForeground(w, aggressive: false);
    }

    /// <summary>
    /// Switches to KovaaK's and, when asked, presses its restart key so the run starts over instead of sitting in
    /// the pause menu / results screen. The key is only sent once KovaaK's is confirmed to be the foreground window.
    /// </summary>
    public async Task<bool> ReturnToGame(bool restart)
    {
        if (!FocusGame(resuming: !restart)) return false;
        if (!restart) return true;
        for (int i = 0; i < 10 && Native.ForegroundProcessId() != _gamePid; i++) await Task.Delay(50);
        await Task.Delay(220);
        if (Native.ForegroundProcessId() != _gamePid || Native.IsHung(GameWindow)) return false;
        await Task.Run(() => Native.TapKey(RestartKey()));
        return true;
    }

    /// <summary>The configured restart key, or KovaaK's own "ResetSession" bind read from Input.ini when set to auto.</summary>
    public Keys RestartKey()
    {
        var cfg = _config().RestartKey;
        if (!string.Equals(cfg, "auto", StringComparison.OrdinalIgnoreCase) && Enum.TryParse<Keys>(cfg, true, out var k)) return k;
        return DetectRestartKey() ?? Keys.R;
    }

    public static Keys? DetectRestartKey()
    {
        try
        {
            var ini = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FPSAimTrainer", "Saved", "Config", "WindowsNoEditor", "Input.ini");
            if (!File.Exists(ini)) return null;
            var m = Regex.Match(File.ReadAllText(ini), @"ActionName=""ResetSession"",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=(\w+)");
            if (!m.Success) return null;
            // Unreal key names → Windows virtual keys for the common cases.
            var ue = m.Groups[1].Value;
            var map = new Dictionary<string, Keys>(StringComparer.OrdinalIgnoreCase)
            {
                ["SpaceBar"] = Keys.Space, ["Enter"] = Keys.Return, ["BackSpace"] = Keys.Back, ["Tab"] = Keys.Tab,
                ["Zero"] = Keys.D0, ["One"] = Keys.D1, ["Two"] = Keys.D2, ["Three"] = Keys.D3, ["Four"] = Keys.D4,
                ["Five"] = Keys.D5, ["Six"] = Keys.D6, ["Seven"] = Keys.D7, ["Eight"] = Keys.D8, ["Nine"] = Keys.D9,
                ["Add"] = Keys.Add, ["Subtract"] = Keys.Subtract, ["Tilde"] = Keys.Oemtilde, ["LeftShift"] = Keys.LShiftKey,
            };
            if (map.TryGetValue(ue, out var mapped)) return mapped;
            return Enum.TryParse<Keys>(ue, true, out var parsed) ? parsed : null;
        }
        catch { return null; }
    }

    public void LaunchGame() => Native.OpenUrl($"steam://rungameid/{GamePaths.AppId}");

    /// <summary>
    /// Waits until a just-started KovaaK's has a responsive window, so deep links are not fired at a game
    /// that is still booting (and so we never poke a window that is busy).
    /// </summary>
    async Task<bool> WaitUntilResponsive(int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (!IsRunning) return false;
            var w = GameWindow;
            if (w != IntPtr.Zero && !Native.IsHung(w) && (DateTime.UtcNow - SafeStartUtc()).TotalSeconds > 8) return true;
            await Task.Delay(400);
        }
        return false;
    }

    /// <summary>Uses KovaaK's own deep link (the same one behind its Discord "Play this scenario" button).</summary>
    public async Task PlayScenario(string name, string mode)
    {
        mode = mode.Equals("freeplay", StringComparison.OrdinalIgnoreCase) ? "freeplay" : "challenge";
        var url = $"steam://run/{GamePaths.AppId}//?action=jump-to-scenario&name={Uri.EscapeDataString(name)}&mode={mode}";
        bool wasRunning = IsRunning;
        if (wasRunning) await WaitUntilResponsive(45000);
        Native.OpenUrl(url);
        SetCurrentScenario(name);
        if (!wasRunning || !_config().FocusGameOnPlay) return;
        await Task.Delay(350);
        FocusGame(false);
    }

    /// <summary>Opens a playlist by share code (KovaaK's "jump-to-playlist" deep link).</summary>
    public async Task PlayPlaylist(string sharecode)
    {
        bool wasRunning = IsRunning;
        if (wasRunning) await WaitUntilResponsive(45000);
        Native.OpenUrl($"steam://run/{GamePaths.AppId}//?action=jump-to-playlist&sharecode={Uri.EscapeDataString(sharecode)}");
        if (!wasRunning || !_config().FocusGameOnPlay) return;
        await Task.Delay(350);
        FocusGame(false);
    }

    public async Task<bool> CloseGameAsync(int timeoutMs = 20000)
    {
        if (_game == null || _game.HasExited) return true;
        var w = GameWindow;
        if (w != IntPtr.Zero) Native.PostMessage(w, Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (_game.HasExited) { OnPoll(null, EventArgs.Empty); return true; }
            await Task.Delay(250);
        }
        return false;
    }

    public void Dispose()
    {
        StopHook();
        _statsWatcher?.Dispose();
        _sessionWatcher?.Dispose();
        _poll?.Dispose();
        _game?.Dispose();
    }
}
