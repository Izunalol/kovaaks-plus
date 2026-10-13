using System.Diagnostics;
using System.Runtime.InteropServices;

namespace KovaaksPlus;

/// <summary>Win32 interop: low-level keyboard hook and reliable foreground switching.</summary>
internal static class Native
{
    public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    public const int WH_KEYBOARD_LL = 13;
    public const int WM_KEYDOWN = 0x0100;
    public const int WM_SYSKEYDOWN = 0x0104;
    public const int WM_CLOSE = 0x0010;
    const int SW_RESTORE = 9;
    const int SW_SHOW = 5;
    const byte VK_MENU = 0x12;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1;
    const uint KEYEVENTF_KEYUP = 0x2;

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr GetModuleHandle(string? lpModuleName);

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int ptX; public int ptY; }
    [DllImport("user32.dll")] public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")] public static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);
    public const uint WM_QUIT = 0x0012;
    public static uint CurrentThreadId() => GetCurrentThreadId();

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    public static uint ForegroundProcessId()
    {
        GetWindowThreadProcessId(GetForegroundWindow(), out var pid);
        return pid;
    }

    /// <summary>Finds the main visible top-level window of a process (prefers Unreal's game window).</summary>
    public static IntPtr FindMainWindow(int pid)
    {
        IntPtr best = IntPtr.Zero;
        EnumWindows((h, _) =>
        {
            GetWindowThreadProcessId(h, out var wpid);
            if (wpid != pid || !IsWindowVisible(h) || GetWindow(h, 4 /*GW_OWNER*/) != IntPtr.Zero) return true;
            var sb = new System.Text.StringBuilder(64);
            GetClassName(h, sb, sb.Capacity);
            if (sb.ToString() == "UnrealWindow") { best = h; return false; }
            if (best == IntPtr.Zero) best = h;
            return true;
        }, IntPtr.Zero);
        return best;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion u; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint uCode, uint uMapType);

    /// <summary>Taps a key by scan code (games read scan codes / WM_KEYDOWN, both of which this produces).</summary>
    public static void TapKey(Keys key)
    {
        ushort scan = (ushort)MapVirtualKey((uint)key, 0 /*MAPVK_VK_TO_VSC*/);
        const uint SCANCODE = 0x0008;
        INPUT Make(uint flags) => new() { type = 1 /*INPUT_KEYBOARD*/, u = new InputUnion { ki = new KEYBDINPUT { wScan = scan, dwFlags = SCANCODE | flags } } };
        SendInput(1, new[] { Make(0) }, Marshal.SizeOf<INPUT>());
        Thread.Sleep(35);
        SendInput(1, new[] { Make(KEYEVENTF_KEYUP) }, Marshal.SizeOf<INPUT>());
    }

    [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr hWnd);
    public static bool IsHung(IntPtr hwnd) => hwnd != IntPtr.Zero && IsHungAppWindow(hwnd);

    /// <summary>
    /// Brings a window to the foreground. Plain SetForegroundWindow first; only when Windows' foreground lock refuses
    /// (we're reacting from the background) do we attach to the current foreground thread, and only if that window
    /// is responsive. The synthetic ALT fallback is reserved for bringing our own window forward.
    /// </summary>
    public static bool ForceForeground(IntPtr hwnd, bool aggressive = true)
    {
        if (hwnd == IntPtr.Zero || IsHung(hwnd)) return false;
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        else ShowWindow(hwnd, SW_SHOW);

        var fg = GetForegroundWindow();
        if (fg == hwnd) return true;
        if (SetForegroundWindow(hwnd) && GetForegroundWindow() == hwnd) return true;

        if (fg != IntPtr.Zero && !IsHung(fg))
        {
            uint fgThread = GetWindowThreadProcessId(fg, out _);
            uint me = GetCurrentThreadId();
            bool attached = fgThread != me && AttachThreadInput(me, fgThread, true);
            try
            {
                BringWindowToTop(hwnd);
                SetForegroundWindow(hwnd);
            }
            finally
            {
                if (attached) AttachThreadInput(me, fgThread, false);
            }
            if (GetForegroundWindow() == hwnd) return true;
        }
        if (!aggressive || (fg != IntPtr.Zero && IsHung(fg))) return false;

        // Last resort for our own window: a synthetic ALT tap satisfies the "last input event" foreground rule.
        keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
        keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
        SetForegroundWindow(hwnd);
        BringWindowToTop(hwnd);
        return GetForegroundWindow() == hwnd;
    }

    public static void UseDarkTitleBar(IntPtr hwnd)
    {
        int on = 1;
        DwmSetWindowAttribute(hwnd, 20 /*DWMWA_USE_IMMERSIVE_DARK_MODE*/, ref on, sizeof(int));
        int caption = 0x00120D0B; // COLORREF (BGR) matching the UI background
        DwmSetWindowAttribute(hwnd, 35 /*DWMWA_CAPTION_COLOR*/, ref caption, sizeof(int));
    }

    public static void OpenUrl(string url) =>
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

    public static void RevealInExplorer(string path)
    {
        if (File.Exists(path)) Process.Start("explorer.exe", $"/select,\"{path}\"");
        else if (Directory.Exists(path)) Process.Start("explorer.exe", $"\"{path}\"");
    }
}
