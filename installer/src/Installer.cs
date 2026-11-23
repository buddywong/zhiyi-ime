using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("知意输入法 安装程序")]
[assembly: AssemblyDescription("知意中文输入法安装程序")]
[assembly: AssemblyCompany("Zhiyi")]
[assembly: AssemblyProduct("知意输入法")]
[assembly: AssemblyCopyright("Copyright © 2026 Zhiyi")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace ZhiyiSetup
{
    internal static class Program
    {
        internal const string VersionText = "1.0.0";
        internal const string AppName = "知意输入法";

        [STAThread]
        private static int Main(string[] args)
        {
            Log("Main args=" + string.Join("|", args));
            if (Has(args, "/ping"))
            {
                Log("ping ok");
                return 0;
            }
            if (Has(args, "/cleanup"))
            {
                Cleanup(args);
                return 0;
            }

            if (Has(args, "/uninstall"))
            {
                return Uninstall(Has(args, "/silent"));
            }

            if (Has(args, "/silent"))
            {
                return SilentInstall(args);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
            return 0;
        }

        internal static string DefaultInstallDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", "ZhiyiIME");
            }
        }

        internal static bool Has(string[] args, string flag)
        {
            foreach (string a in args)
            {
                if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        internal static string ArgValue(string[] args, string prefix)
        {
            foreach (string a in args)
            {
                if (a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return a.Substring(prefix.Length).Trim('"');
                }
            }
            return null;
        }

        private static int SilentInstall(string[] args)
        {
            string dir = ArgValue(args, "/dir=");
            if (string.IsNullOrEmpty(dir)) dir = DefaultInstallDir;
            dir = Path.GetFullPath(dir);
            bool shortcuts = !Has(args, "/no-shortcuts");
            bool registry = !Has(args, "/no-registry");
            bool launch = !Has(args, "/no-launch");
            Log("silent dir=" + dir + " shortcuts=" + shortcuts + " registry=" + registry + " launch=" + launch);
            try
            {
                InstallCore(dir, shortcuts, registry, null);
                if (launch) LaunchApp(dir);
                Log("静默安装完成：" + dir);
                return 0;
            }
            catch (Exception ex)
            {
                Log("静默安装失败：" + ex);
                return 1;
            }
        }

        internal static void InstallCore(string dir, bool shortcuts, bool registry, Action<string> progress)
        {
            if (string.IsNullOrEmpty(dir)) throw new ArgumentException("安装目录不能为空。");
            dir = Path.GetFullPath(dir);
            ValidateInstallDir(dir);
            Report(progress, "正在停止旧版本…");
            StopServer(dir);
            PrepareDirectory(dir);
            Directory.CreateDirectory(dir);

            Report(progress, "正在释放程序文件…");
            ExtractPayload(dir);

            string self = Application.ExecutablePath;
            string uninstall = Path.Combine(dir, "Uninstall.exe");
            if (!string.Equals(self, uninstall, StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(self, uninstall, true);
            }

            if (shortcuts)
            {
                Report(progress, "正在创建快捷方式…");
                CreateShortcuts(dir);
            }

            if (registry)
            {
                Report(progress, "正在写入卸载信息…");
                WriteUninstallRegistry(dir);
            }

            File.WriteAllText(Path.Combine(dir, "version.txt"),
                VersionText + Environment.NewLine + "zh-CN" + Environment.NewLine,
                Encoding.UTF8);
            Report(progress, "安装完成");
        }

        internal static void LaunchApp(string dir)
        {
            string exe = Path.Combine(dir, "Zhiyi.exe");
            if (!File.Exists(exe)) throw new FileNotFoundException("没有找到 Zhiyi.exe", exe);
            ProcessStartInfo psi = new ProcessStartInfo(exe);
            psi.WorkingDirectory = dir;
            psi.UseShellExecute = true;
            Process.Start(psi);
        }

        internal static void StopServer(string dir)
        {
            string pidFile = Path.Combine(dir, ".zhiyi.pid");
            if (!File.Exists(pidFile)) return;
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
                    }
                }
            }
            catch { }
            try { File.Delete(pidFile); } catch { }
        }

        private static void ValidateInstallDir(string dir)
        {
            string root = Path.GetPathRoot(dir);
            if (string.Equals(dir.TrimEnd(Path.DirectorySeparatorChar), root.TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("不能直接安装到磁盘根目录。");
            }
            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            if (dir.StartsWith(windows + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("不能安装到 Windows 系统目录。");
            }
        }

        private static void PrepareDirectory(string dir)
        {
            if (!Directory.Exists(dir)) return;
            string[] entries = Directory.GetFileSystemEntries(dir);
            bool ours =
                File.Exists(Path.Combine(dir, "index.html")) ||
                File.Exists(Path.Combine(dir, "Zhiyi.exe")) ||
                File.Exists(Path.Combine(dir, "Uninstall.exe"));
            if (entries.Length > 0 && !ours)
            {
                throw new InvalidOperationException("安装目录不是空的，也不是知意目录。请换一个空文件夹。");
            }
            Directory.Delete(dir, true);
        }

        private static void ExtractPayload(string dir)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            string root = dir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            using (Stream stream = asm.GetManifestResourceStream("ZhiyiPayload.zip"))
            {
                if (stream == null) throw new InvalidOperationException("安装包内部数据缺失。");
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string name = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                        string target = Path.GetFullPath(Path.Combine(dir, name));
                        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("安装包路径无效。");
                        }
                        if (entry.FullName.EndsWith("/") || string.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(target);
                            continue;
                        }
                        string parent = Path.GetDirectoryName(target);
                        if (!Directory.Exists(parent)) Directory.CreateDirectory(parent);
                        using (Stream input = entry.Open())
                        using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write))
                        {
                            input.CopyTo(output);
                        }
                    }
                }
            }
            if (!File.Exists(Path.Combine(dir, "index.html")))
            {
                throw new InvalidOperationException("程序文件释放失败。");
            }
        }

        internal static void CreateShortcuts(string dir)
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                if (string.IsNullOrEmpty(desktop))
                {
                    desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Desktop");
                }
                string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                if (string.IsNullOrEmpty(programs))
                {
                    programs = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                        "Microsoft", "Windows", "Start Menu", "Programs");
                }
                string startMenu = Path.Combine(programs, AppName);
                string exe = Path.Combine(dir, "Zhiyi.exe");
                string uninstall = Path.Combine(dir, "Uninstall.exe");
                string icon = Path.Combine(dir, "zhiyi.ico");

                Directory.CreateDirectory(startMenu);
                CreateShortcut(Path.Combine(desktop, AppName + ".lnk"), exe, "", dir, icon, "知意输入法");
                CreateShortcut(Path.Combine(startMenu, AppName + ".lnk"), exe, "", dir, icon, "打开知意输入法");
                CreateShortcut(Path.Combine(startMenu, "停止知意输入法.lnk"), exe, "--stop", dir, icon, "停止知意输入法");
                CreateShortcut(Path.Combine(startMenu, "卸载知意输入法.lnk"), uninstall, "/uninstall", dir, icon, "卸载知意输入法");
            }
            catch (Exception ex)
            {
                Log("快捷方式创建失败（不影响程序安装）：" + ex.Message);
            }
        }

        private static void CreateShortcut(string path, string target, string arguments, string workDir, string icon, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shell = Activator.CreateInstance(shellType);
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell,
                    new object[] { path });
                Type shortcutType = shortcut.GetType();
                shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
                shortcutType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
                shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
                shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { icon + ",0" });
                shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                shortcutType.InvokeMember("WindowStyle", BindingFlags.SetProperty, null, shortcut, new object[] { 1 });
                shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                Marshal.ReleaseComObject(shortcut);
                Marshal.ReleaseComObject(shell);
            }
            catch
            {
                // 快捷方式失败不阻断安装
            }
        }

        internal static void WriteUninstallRegistry(string dir)
        {
            try
            {
                string key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhiyiIME";
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(key))
                {
                    k.SetValue("DisplayName", AppName);
                    k.SetValue("DisplayVersion", VersionText);
                    k.SetValue("Publisher", "Zhiyi");
                    k.SetValue("InstallLocation", dir);
                    k.SetValue("DisplayIcon", Path.Combine(dir, "zhiyi.ico"));
                    k.SetValue("UninstallString", "\"" + Path.Combine(dir, "Uninstall.exe") + "\" /uninstall");
                    k.SetValue("QuietUninstallString", "\"" + Path.Combine(dir, "Uninstall.exe") + "\" /silent /uninstall");
                    k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    k.SetValue("EstimatedSize", EstimateSizeKb(dir), RegistryValueKind.DWord);
                }
            }
            catch (Exception ex)
            {
                Log("卸载注册表写入失败（不影响程序安装）：" + ex.Message);
            }
        }

        private static int EstimateSizeKb(string dir)
        {
            try
            {
                long total = 0;
                foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                {
                    total += new FileInfo(f).Length;
                }
                return (int)Math.Max(1, total / 1024);
            }
            catch { return 1; }
        }

        private static string FindInstalledDir()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhiyiIME"))
                {
                    if (k != null)
                    {
                        string location = k.GetValue("InstallLocation") as string;
                        if (!string.IsNullOrEmpty(location))
                        {
                            return Path.GetFullPath(location).TrimEnd(Path.DirectorySeparatorChar);
                        }
                    }
                }
            }
            catch { }
            return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        }

        private static int Uninstall(bool silent)
        {
            string dir = FindInstalledDir();
            if (string.IsNullOrEmpty(dir) ||
                !File.Exists(Path.Combine(dir, "Zhiyi.exe")) ||
                !File.Exists(Path.Combine(dir, "index.html")))
            {
                if (!silent)
                {
                    MessageBox.Show("没有找到知意的安装目录，可能已经卸载。", "知意输入法",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                return 1;
            }

            if (!silent)
            {
                DialogResult r = MessageBox.Show(
                    "确定要卸载知意输入法吗？\n\n浏览器中的词库、习惯与草稿不会被删除。",
                    "卸载知意输入法", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (r != DialogResult.Yes) return 0;
            }

            try
            {
                StopServer(dir);
                RemoveShortcuts();
                RemoveRegistry();
                Log("卸载完成：" + dir);
                if (!silent)
                {
                    MessageBox.Show("知意已卸载。浏览器里的个人数据仍然保留。", "知意输入法",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                ScheduleCleanup(dir);
                return 0;
            }
            catch (Exception ex)
            {
                Log("卸载失败：" + ex);
                if (!silent)
                {
                    MessageBox.Show("卸载时遇到问题：" + ex.Message, "知意输入法",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return 1;
            }
        }

        private static void RemoveShortcuts()
        {
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            TryDelete(Path.Combine(desktop, AppName + ".lnk"));
            string startMenu = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Microsoft", "Windows", "Start Menu", "Programs", AppName);
            try
            {
                if (Directory.Exists(startMenu)) Directory.Delete(startMenu, true);
            }
            catch { }
        }

        private static void RemoveRegistry()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(
                    @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ZhiyiIME", false);
            }
            catch { }
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }

        private static void ScheduleCleanup(string dir)
        {
            string cmd = "/c ping 127.0.0.1 -n 4 >nul & rmdir /s /q \"" + dir + "\"";
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmd);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch { }
        }

        private static void Cleanup(string[] args)
        {
            string dir = args.Length > 1 ? args[1].Trim('"') : "";
            if (string.IsNullOrEmpty(dir)) return;
            if (!File.Exists(Path.Combine(dir, "Zhiyi.exe")) || !File.Exists(Path.Combine(dir, "index.html"))) return;
            System.Threading.Thread.Sleep(900);
            try
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
            }
            catch { }

            string self = Application.ExecutablePath;
            string cmd = "/c ping 127.0.0.1 -n 4 >nul & rmdir /s /q \"" + dir + "\" & del /f /q \"" + self + "\"";
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmd);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch { }
        }

        private static void Report(Action<string> progress, string message)
        {
            Log(message);
            if (progress != null) progress(message);
        }

        internal static void Log(string message)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine;
            try
            {
                string path = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "ZhiyiSetup.log");
                File.AppendAllText(path, line, Encoding.UTF8);
                return;
            }
            catch { }
            try
            {
                File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ZhiyiSetup.log"),
                    line, Encoding.UTF8);
            }
            catch { }
        }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly TextBox pathBox;
        private readonly Button installButton;
        private readonly Button cancelButton;
        private readonly CheckBox desktopCheck;
        private readonly CheckBox launchCheck;
        private readonly Label statusLabel;
        private readonly ProgressBar progressBar;
        private readonly Panel bodyPanel;
        private readonly Panel successPanel;
        private bool installing;

        public InstallerForm()
        {
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "知意输入法 安装程序";
            ClientSize = new Size(620, 478);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(244, 240, 231);
            Font = new Font("Microsoft YaHei UI", 9F);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Program.Log("Form size=" + Size.Width + "x" + Size.Height + " client=" + ClientSize.Width + "x" + ClientSize.Height);
            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (installing) e.Cancel = true;
            };

            SealControl seal = new SealControl();
            seal.Location = new Point(28, 24);
            seal.Size = new Size(58, 58);
            Controls.Add(seal);

            Label title = new Label();
            title.Text = "知意输入法";
            title.Font = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(32, 37, 31);
            title.AutoSize = true;
            title.Location = new Point(102, 27);
            Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "越用越懂你的中文输入法";
            subtitle.Font = new Font("Microsoft YaHei UI", 9F);
            subtitle.ForeColor = Color.FromArgb(120, 126, 116);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(104, 70);
            Controls.Add(subtitle);

            Label version = new Label();
            version.Text = "v" + Program.VersionText + " · 本地优先";
            version.Font = new Font("Microsoft YaHei UI", 8F);
            version.ForeColor = Color.FromArgb(160, 148, 132);
            version.AutoSize = true;
            version.Location = new Point(468, 72);
            Controls.Add(version);

            Panel line = new Panel();
            line.BackColor = Color.FromArgb(228, 221, 208);
            line.Location = new Point(28, 104);
            line.Size = new Size(564, 1);
            Controls.Add(line);

            bodyPanel = new Panel();
            bodyPanel.Location = new Point(28, 116);
            bodyPanel.Size = new Size(564, 292);
            bodyPanel.BackColor = Color.Transparent;
            Controls.Add(bodyPanel);

            Label intro = new Label();
            intro.Text = "把知意安装到这台电脑。它会记住你的用词、联想和常用段落。";
            intro.Font = new Font("Microsoft YaHei UI", 9F);
            intro.ForeColor = Color.FromArgb(80, 88, 78);
            intro.AutoSize = true;
            intro.Location = new Point(2, 0);
            bodyPanel.Controls.Add(intro);

            Label pathLabel = new Label();
            pathLabel.Text = "安装位置";
            pathLabel.Font = new Font("Microsoft YaHei UI", 8.5F, FontStyle.Bold);
            pathLabel.ForeColor = Color.FromArgb(92, 100, 91);
            pathLabel.AutoSize = true;
            pathLabel.Location = new Point(2, 38);
            bodyPanel.Controls.Add(pathLabel);

            pathBox = new TextBox();
            pathBox.Text = Program.DefaultInstallDir;
            pathBox.Font = new Font("Microsoft YaHei UI", 9F);
            pathBox.Location = new Point(2, 60);
            pathBox.Size = new Size(448, 28);
            pathBox.BorderStyle = BorderStyle.FixedSingle;
            bodyPanel.Controls.Add(pathBox);

            Button browse = new Button();
            browse.Text = "浏览…";
            browse.Font = new Font("Microsoft YaHei UI", 8.5F);
            browse.FlatStyle = FlatStyle.Flat;
            browse.FlatAppearance.BorderColor = Color.FromArgb(196, 188, 174);
            browse.BackColor = Color.FromArgb(250, 247, 240);
            browse.ForeColor = Color.FromArgb(70, 75, 68);
            browse.Location = new Point(460, 59);
            browse.Size = new Size(100, 29);
            browse.Click += delegate
            {
                using (FolderBrowserDialog dialog = new FolderBrowserDialog())
                {
                    dialog.Description = "选择知意的安装位置";
                    dialog.SelectedPath = pathBox.Text;
                    if (dialog.ShowDialog(this) == DialogResult.OK)
                    {
                        pathBox.Text = Path.Combine(dialog.SelectedPath, "ZhiyiIME");
                    }
                }
            };
            bodyPanel.Controls.Add(browse);

            desktopCheck = new CheckBox();
            desktopCheck.Text = "创建桌面快捷方式";
            desktopCheck.Checked = true;
            desktopCheck.AutoSize = true;
            desktopCheck.ForeColor = Color.FromArgb(64, 70, 62);
            desktopCheck.Location = new Point(2, 110);
            bodyPanel.Controls.Add(desktopCheck);

            launchCheck = new CheckBox();
            launchCheck.Text = "安装完成后启动知意";
            launchCheck.Checked = true;
            launchCheck.AutoSize = true;
            launchCheck.ForeColor = Color.FromArgb(64, 70, 62);
            launchCheck.Location = new Point(2, 138);
            bodyPanel.Controls.Add(launchCheck);

            Label note = new Label();
            note.Text = "这是浏览器内的输入法工作台，不会接管其他软件的输入框。\n卸载时只移除程序文件，浏览器里的词库、习惯和草稿会保留。";
            note.Font = new Font("Microsoft YaHei UI", 8F);
            note.ForeColor = Color.FromArgb(145, 150, 140);
            note.AutoSize = true;
            note.Location = new Point(2, 174);
            bodyPanel.Controls.Add(note);

            statusLabel = new Label();
            statusLabel.Text = "准备就绪";
            statusLabel.Font = new Font("Microsoft YaHei UI", 8.5F);
            statusLabel.ForeColor = Color.FromArgb(120, 126, 116);
            statusLabel.AutoSize = true;
            statusLabel.Location = new Point(2, 226);
            bodyPanel.Controls.Add(statusLabel);

            progressBar = new ProgressBar();
            progressBar.Location = new Point(2, 250);
            progressBar.Size = new Size(558, 8);
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Value = 0;
            bodyPanel.Controls.Add(progressBar);

            successPanel = new Panel();
            successPanel.Location = new Point(28, 116);
            successPanel.Size = new Size(564, 292);
            successPanel.BackColor = Color.Transparent;
            successPanel.Visible = false;
            Controls.Add(successPanel);

            CheckControl check = new CheckControl();
            check.Location = new Point(220, 8);
            check.Size = new Size(76, 76);
            successPanel.Controls.Add(check);

            Label doneTitle = new Label();
            doneTitle.Text = "知意已安好";
            doneTitle.Font = new Font("Microsoft YaHei UI", 17F, FontStyle.Bold);
            doneTitle.ForeColor = Color.FromArgb(32, 37, 31);
            doneTitle.AutoSize = true;
            doneTitle.Location = new Point(200, 96);
            successPanel.Controls.Add(doneTitle);

            Label doneText = new Label();
            doneText.Text = "桌面和开始菜单里都能找到「知意输入法」。\n浏览器里的数据会沿用，不需要重新设置。";
            doneText.Font = new Font("Microsoft YaHei UI", 8.5F);
            doneText.ForeColor = Color.FromArgb(100, 108, 98);
            doneText.AutoSize = true;
            doneText.TextAlign = ContentAlignment.MiddleCenter;
            doneText.Location = new Point(126, 138);
            successPanel.Controls.Add(doneText);

            Button openButton = new Button();
            openButton.Text = "打开知意";
            openButton.Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold);
            openButton.FlatStyle = FlatStyle.Flat;
            openButton.FlatAppearance.BorderSize = 0;
            openButton.BackColor = Color.FromArgb(182, 78, 53);
            openButton.ForeColor = Color.FromArgb(255, 248, 238);
            openButton.Location = new Point(168, 208);
            openButton.Size = new Size(110, 38);
            openButton.Click += delegate { TryLaunch(); };
            successPanel.Controls.Add(openButton);

            Button finishButton = new Button();
            finishButton.Text = "完成";
            finishButton.Font = new Font("Microsoft YaHei UI", 9F);
            finishButton.FlatStyle = FlatStyle.Flat;
            finishButton.FlatAppearance.BorderColor = Color.FromArgb(196, 188, 174);
            finishButton.BackColor = Color.FromArgb(250, 247, 240);
            finishButton.ForeColor = Color.FromArgb(70, 75, 68);
            finishButton.Location = new Point(290, 208);
            finishButton.Size = new Size(100, 38);
            finishButton.Click += delegate { Close(); };
            successPanel.Controls.Add(finishButton);

            installButton = new Button();
            installButton.Text = "安装";
            installButton.Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold);
            installButton.FlatStyle = FlatStyle.Flat;
            installButton.FlatAppearance.BorderSize = 0;
            installButton.BackColor = Color.FromArgb(182, 78, 53);
            installButton.ForeColor = Color.FromArgb(255, 248, 238);
            installButton.Location = new Point(462, 424);
            installButton.Size = new Size(130, 38);
            installButton.Click += delegate { BeginInstall(); };
            Controls.Add(installButton);

            cancelButton = new Button();
            cancelButton.Text = "取消";
            cancelButton.Font = new Font("Microsoft YaHei UI", 9F);
            cancelButton.FlatStyle = FlatStyle.Flat;
            cancelButton.FlatAppearance.BorderColor = Color.FromArgb(196, 188, 174);
            cancelButton.BackColor = Color.FromArgb(250, 247, 240);
            cancelButton.ForeColor = Color.FromArgb(70, 75, 68);
            cancelButton.Location = new Point(352, 424);
            cancelButton.Size = new Size(100, 38);
            cancelButton.Click += delegate { if (!installing) Close(); };
            Controls.Add(cancelButton);

            Label footer = new Label();
            footer.Text = "Zhiyi · 数据留在本地";
            footer.Font = new Font("Microsoft YaHei UI", 7.5F);
            footer.ForeColor = Color.FromArgb(160, 148, 132);
            footer.AutoSize = true;
            footer.Location = new Point(28, 438);
            Controls.Add(footer);
        }

        private void BeginInstall()
        {
            string dir;
            try { dir = Path.GetFullPath(pathBox.Text.Trim()); }
            catch { MessageBox.Show("安装路径无效。", "知意输入法", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            if (string.IsNullOrEmpty(dir)) return;

            installing = true;
            installButton.Enabled = false;
            cancelButton.Enabled = false;
            pathBox.Enabled = false;
            desktopCheck.Enabled = false;
            launchCheck.Enabled = false;
            progressBar.Style = ProgressBarStyle.Marquee;
            bodyPanel.Refresh();

            try
            {
                Program.InstallCore(dir, desktopCheck.Checked, true, delegate(string message)
                {
                    statusLabel.Text = message;
                    statusLabel.Refresh();
                    Application.DoEvents();
                });

                progressBar.Style = ProgressBarStyle.Continuous;
                progressBar.Value = 100;
                bodyPanel.Visible = false;
                successPanel.Visible = true;
                if (launchCheck.Checked)
                {
                    try { Program.LaunchApp(dir); } catch { }
                }
            }
            catch (Exception ex)
            {
                progressBar.Style = ProgressBarStyle.Continuous;
                progressBar.Value = 0;
                installing = false;
                installButton.Enabled = true;
                cancelButton.Enabled = true;
                pathBox.Enabled = true;
                desktopCheck.Enabled = true;
                launchCheck.Enabled = true;
                MessageBox.Show("安装没有完成：\n\n" + ex.Message, "知意输入法",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                statusLabel.Text = "安装未完成";
            }
        }

        private void TryLaunch()
        {
            try { Program.LaunchApp(Path.GetFullPath(pathBox.Text.Trim())); }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：" + ex.Message, "知意输入法",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    internal sealed class SealControl : Control
    {
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle r = new Rectangle(1, 1, Width - 3, Height - 3);
            using (GraphicsPath path = RoundedRect(r, 13))
            using (LinearGradientBrush brush = new LinearGradientBrush(r,
                Color.FromArgb(199, 97, 69), Color.FromArgb(168, 64, 43), 135F))
            {
                e.Graphics.FillPath(brush, path);
            }
            using (Pen pen = new Pen(Color.FromArgb(70, 255, 248, 238)))
            {
                using (GraphicsPath path = RoundedRect(new Rectangle(4, 4, Width - 9, Height - 9), 10))
                {
                    e.Graphics.DrawPath(pen, path);
                }
            }
            using (Font f = new Font("SimSun", 28F, FontStyle.Regular, GraphicsUnit.Pixel))
            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment = StringAlignment.Center;
                sf.LineAlignment = StringAlignment.Center;
                e.Graphics.DrawString("知", f, Brushes.WhiteSmoke,
                    new RectangleF(0, -1, Width, Height), sf);
            }
        }

        internal static GraphicsPath RoundedRect(Rectangle bounds, int radius)
        {
            int d = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    internal sealed class CheckControl : Control
    {
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (SolidBrush b = new SolidBrush(Color.FromArgb(226, 239, 228)))
            {
                e.Graphics.FillEllipse(b, 2, 2, Width - 5, Height - 5);
            }
            using (Pen p = new Pen(Color.FromArgb(92, 122, 104), 2.4F))
            {
                e.Graphics.DrawEllipse(p, 3, 3, Width - 7, Height - 7);
                e.Graphics.DrawLines(p, new PointF[] {
                    new PointF(Width * 0.27F, Height * 0.52F),
                    new PointF(Width * 0.44F, Height * 0.68F),
                    new PointF(Width * 0.74F, Height * 0.35F)
                });
            }
        }
    }
}
