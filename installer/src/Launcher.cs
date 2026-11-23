using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("知意输入法")]
[assembly: System.Reflection.AssemblyDescription("知意中文输入法启动器")]
[assembly: System.Reflection.AssemblyCompany("Zhiyi")]
[assembly: System.Reflection.AssemblyProduct("知意输入法")]
[assembly: System.Reflection.AssemblyCopyright("Copyright © 2026 Zhiyi")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

namespace Zhiyi
{
    internal static class Launcher
    {
        [STAThread]
        private static void Main(string[] args)
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            if (HasArg(args, "--stop"))
            {
                StopServer(dir, true);
                return;
            }

            string script = Path.Combine(dir, "server.ps1");
            if (!File.Exists(script))
            {
                MessageBox.Show("没有找到 server.ps1，请重新安装知意输入法。", "知意输入法",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(
                    "powershell.exe",
                    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"");
                psi.WorkingDirectory = dir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("知意启动失败：" + ex.Message, "知意输入法",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool HasArg(string[] args, string flag)
        {
            foreach (string a in args)
            {
                if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private static void StopServer(string dir, bool notify)
        {
            string pidFile = Path.Combine(dir, ".zhiyi.pid");
            if (!File.Exists(pidFile))
            {
                if (notify) MessageBox.Show("知意当前没有在运行。", "知意输入法",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            bool killed = false;
            try
            {
                string text = File.ReadAllText(pidFile).Trim();
                int pid;
                if (int.TryParse(text, out pid))
                {
                    Process p = Process.GetProcessById(pid);
                    string name = p.ProcessName.ToLowerInvariant();
                    if (name.Contains("powershell") || name.Contains("pwsh"))
                    {
                        p.Kill();
                        p.WaitForExit(2500);
                        killed = true;
                    }
                }
            }
            catch
            {
                // 进程已经退出
            }

            try { File.Delete(pidFile); } catch { }
            if (notify)
            {
                MessageBox.Show(killed ? "知意已停止。" : "知意服务器已经结束。", "知意输入法",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
    }
}
