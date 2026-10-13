namespace KovaaksPlus;

static class Program
{
    const string MutexName = "KovaaksPlus.SingleInstance";
    const string ShowEventName = "KovaaksPlus.Show";

    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out bool first);
        if (!first)
        {
            // Already running: ask the existing window to come forward.
            try { using var ev = EventWaitHandle.OpenExisting(ShowEventName); ev.Set(); } catch { }
            return;
        }

        AppPaths.Ensure();
        ApplicationConfiguration.Initialize();
        var form = new MainForm();

        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        var listener = new Thread(() =>
        {
            while (showEvent.WaitOne())
            {
                if (form.IsDisposed) break;
                try { form.BeginInvoke(form.ActivateFromSecondInstance); } catch { break; }
            }
        }) { IsBackground = true };
        listener.Start();

        Application.Run(form);
    }
}
