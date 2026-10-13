using System.Reflection;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KovaaksPlus;

public sealed class MainForm : Form
{
    const string AppHost = "app.kplus";
    readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(11, 13, 18) };
    readonly Api _api;
    bool _ready;
    readonly Queue<string> _pending = new();
    static string WindowStatePath => Path.Combine(AppPaths.Root, "window.json");

    record WindowPlacement(int X, int Y, int W, int H, bool Max);

    public MainForm()
    {
        Text = "Kovaak's Plus";
        BackColor = Color.FromArgb(11, 13, 18);
        MinimumSize = new Size(1100, 700);
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1440, 900);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        RestorePlacement();
        Controls.Add(_web);
        _api = new Api(this);
        Load += async (_, _) => await InitAsync();
        FormClosing += (_, _) => { SavePlacement(); _api.Watcher.Dispose(); _api.Stats.Save(); };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.UseDarkTitleBar(Handle);
    }

    async Task InitAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, AppPaths.WebViewData);
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show(this, "Kovaak's Plus needs the Microsoft Edge WebView2 Runtime (it ships with Windows 11).\n\nOpen the download page?",
                    "WebView2 required", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                Native.OpenUrl("https://developer.microsoft.com/microsoft-edge/webview2/");
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        var dev = Environment.GetEnvironmentVariable("KPLUS_DEV") == "1";
        core.Settings.AreDevToolsEnabled = dev;
        core.Settings.AreDefaultContextMenusEnabled = dev;
        core.Settings.AreBrowserAcceleratorKeysEnabled = dev;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;

        var uiDir = Environment.GetEnvironmentVariable("KPLUS_UI_DIR");
        if (!string.IsNullOrEmpty(uiDir) && Directory.Exists(uiDir))
            core.SetVirtualHostNameToFolderMapping(AppHost, uiDir, CoreWebView2HostResourceAccessKind.Allow);
        else
        {
            core.AddWebResourceRequestedFilter($"https://{AppHost}/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += ServeEmbedded;
        }
        core.SetVirtualHostNameToFolderMapping("media.kplus", AppPaths.Media, CoreWebView2HostResourceAccessKind.Allow);

        _api.Start();

        core.WebMessageReceived += OnMessage;
        core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.Uri.StartsWith("http")) Native.OpenUrl(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith($"https://{AppHost}/")) { e.Cancel = true; if (e.Uri.StartsWith("http")) Native.OpenUrl(e.Uri); }
        };
        core.NavigationCompleted += (_, _) =>
        {
            _ready = true;
            while (_pending.Count > 0) core.PostWebMessageAsJson(_pending.Dequeue());
        };
        core.Navigate($"https://{AppHost}/index.html");
    }

    static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8",
        [".svg"] = "image/svg+xml", [".png"] = "image/png", [".json"] = "application/json", [".woff2"] = "font/woff2",
        [".ico"] = "image/x-icon", [".mp3"] = "audio/mpeg", [".wav"] = "audio/wav",
    };

    // MSBuild names nested embedded files with backslashes ("wwwroot/js\views\home.js"); index them by URL path.
    static readonly Dictionary<string, string> Embedded = Assembly.GetExecutingAssembly().GetManifestResourceNames()
        .Where(n => n.StartsWith("wwwroot", StringComparison.Ordinal))
        .ToDictionary(n => n.Replace('\\', '/')["wwwroot/".Length..], n => n, StringComparer.OrdinalIgnoreCase);

    void ServeEmbedded(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var path = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
        if (path.Length == 0) path = "index.html";
        var stream = Embedded.TryGetValue(path, out var res) ? Assembly.GetExecutingAssembly().GetManifestResourceStream(res) : null;
        var env = _web.CoreWebView2.Environment;
        if (stream == null) { e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", ""); return; }
        var type = Mime.GetValueOrDefault(Path.GetExtension(path), "application/octet-stream");
        e.Response = env.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {type}\r\nCache-Control: no-cache");
    }

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            id = root.GetProperty("id").GetInt32();
            var method = root.GetProperty("method").GetString()!;
            var p = root.TryGetProperty("params", out var pp) ? pp.Clone() : default;
            var result = await _api.Handle(method, p);
            Post(JsonSerializer.Serialize(new { id, result }, Json.Compact));
        }
        catch (Exception ex)
        {
            var msg = ex is AggregateException ae ? ae.InnerException?.Message ?? ex.Message : ex.Message;
            Post(JsonSerializer.Serialize(new { id, error = msg }, Json.Compact));
        }
    }

    void Post(string json)
    {
        if (InvokeRequired) { BeginInvoke(() => Post(json)); return; }
        if (!_ready || _web.CoreWebView2 == null) { _pending.Enqueue(json); return; }
        _web.CoreWebView2.PostWebMessageAsJson(json);
    }

    /// <summary>Pushes an event to the UI (thread-safe).</summary>
    public void Emit(string evt, object? data)
    {
        try { Post(JsonSerializer.Serialize(new { @event = evt, data }, Json.Compact)); } catch { /* window closing */ }
    }

    public void BringToFrontForced()
    {
        if (InvokeRequired) { BeginInvoke(BringToFrontForced); return; }
        if (WindowState == FormWindowState.Minimized) WindowState = _wasMaximized ? FormWindowState.Maximized : FormWindowState.Normal;
        Native.ForceForeground(Handle);
        _web.Focus();
    }

    bool _wasMaximized;
    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (WindowState != FormWindowState.Minimized) _wasMaximized = WindowState == FormWindowState.Maximized;
    }

    void RestorePlacement()
    {
        var p = Json.Read<WindowPlacement>(WindowStatePath);
        if (p == null) return;
        var rect = new Rectangle(p.X, p.Y, p.W, p.H);
        if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(rect))) return;
        StartPosition = FormStartPosition.Manual;
        Bounds = rect;
        if (p.Max) WindowState = FormWindowState.Maximized;
    }

    void SavePlacement()
    {
        try
        {
            var b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Json.Write(WindowStatePath, new WindowPlacement(b.X, b.Y, b.Width, b.Height, WindowState == FormWindowState.Maximized));
        }
        catch { }
    }

    public void SetZoom(double factor)
    {
        if (InvokeRequired) { BeginInvoke(() => SetZoom(factor)); return; }
        _web.ZoomFactor = Math.Clamp(factor, 0.6, 1.6);
    }

    /// <summary>Exposes the game's crosshair images to the UI (read-only) once the install folder is known.</summary>
    public void OnGamePathsReady(GamePaths paths)
    {
        var core = _web.CoreWebView2;
        if (core == null || !Directory.Exists(paths.Crosshairs)) return;
        try { core.ClearVirtualHostNameToFolderMapping("crosshair.kplus"); } catch { }
        core.SetVirtualHostNameToFolderMapping("crosshair.kplus", paths.Crosshairs, CoreWebView2HostResourceAccessKind.Allow);
    }

    /// <summary>Called when a second copy of the app is started: show this one instead.</summary>
    public void ActivateFromSecondInstance() => BringToFrontForced();
}
