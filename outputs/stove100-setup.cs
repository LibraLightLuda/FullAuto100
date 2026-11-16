using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("FullAuto100 설치")]
[assembly: AssemblyFileVersion("5.7.0.0")]

internal static class Setup
{
    private const string ChromeExtensions = "chrome://extensions/";
    private const string ReleaseApi = "https://api.github.com/repos/LibraLightLuda/FullAuto100/releases/latest";
    private static readonly string[] Files = {
        "manifest.json", "background.js", "bridge.js", "update.js", "engine.js", "popup.html", "popup.js", "사용방법.md"
    };

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var defaultFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FullAuto100", "extension");
        var savedPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FullAuto100", "install-path.txt");
        if (File.Exists(savedPath)) {
            try { defaultFolder = NormalizeDestination(File.ReadAllText(savedPath)); } catch { }
        }
        if (args.Length == 1) {
            try { defaultFolder = NormalizeDestination(args[0]); } catch { }
        }
        var version = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(ReadBundledManifest())["version"].ToString();
        using (var form = new Form {
            Text = "FullAuto100 설치", StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new Size(640, 535), MinimumSize = new Size(605, 500),
            Font = new Font("Malgun Gothic", 10), AutoScaleMode = AutoScaleMode.Font
        })
        {
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, AutoScroll = true, Padding = new Padding(18) };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            var heading = new Label { Text = "FullAuto100", AutoSize = true, Font = new Font(form.Font, FontStyle.Bold) };
            var note = new Label {
                AutoSize = true, MaximumSize = new Size(540, 0),
                Text = "1단계 · 설치 폴더 선택\n경로를 직접 입력하거나 ‘폴더 찾기’를 누르세요. 빈 폴더나 기존 FullAuto100 폴더를 선택할 수 있습니다."
            };
            var path = new TextBox { Text = defaultFolder, Dock = DockStyle.Top, AccessibleName = "설치 폴더 경로" };
            var guide = new Label {
                AutoSize = true, MaximumSize = new Size(540, 0),
                Text = "2단계 · 크롬에 처음 등록\n" +
                       "① ‘관리 주소 복사’를 누르고 크롬 주소창에 붙여 넣은 뒤 Enter를 누릅니다.\n" +
                       "② 개발자 모드를 켜고 ‘압축해제된 확장 프로그램을 로드합니다’를 누릅니다.\n" +
                       "③ 이 창에서 ‘설치 경로 복사’를 누릅니다. 크롬의 폴더 선택창에서 Alt+D → Ctrl+V → Enter로 이동한 뒤 ‘폴더 선택’을 누릅니다.\n" +
                       "④ 목록에서 FullAuto100 " + version + "을 확인합니다. 퍼즐 아이콘에서 고정할 수 있습니다.\n\n" +
                       "같은 폴더를 이미 등록했다면 자동 처리를 중지한 뒤 파일을 설치하고, 크롬 목록에서 기존 항목을 새로고침하세요."
            };
            var setupActions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top };
            var registerActions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top };
            var browse = new Button { Text = "폴더 찾기", AutoSize = true };
            var reset = new Button { Text = "기본 경로", AutoSize = true };
            var install = new Button { Text = "선택한 폴더에 설치", AutoSize = true };
            var copyAddress = new Button { Text = "관리 주소 복사", AutoSize = true };
            var copyFolder = new Button { Text = "설치 경로 복사", AutoSize = true, Enabled = false };
            var open = new Button { Text = "설치 폴더 열기", AutoSize = true, Enabled = false };
            var status = new Label { Text = "설치 경로를 확인하고 파일을 준비하세요.", AutoSize = true, MaximumSize = new Size(540, 0) };
            var updateLabel = new Label { Text = "v" + version + " · 최신 버전 확인 중…", AutoSize = true, MaximumSize = new Size(540, 0) };
            var update = new Button { Text = "최신 버전 확인", AutoSize = true };
            LatestRelease latest = null;
            setupActions.Controls.AddRange(new Control[] { browse, reset, install });
            registerActions.Controls.AddRange(new Control[] { copyAddress, copyFolder, open });
            foreach (Control control in new Control[] { heading, note, path, setupActions, status, guide, registerActions, updateLabel, update }) layout.Controls.Add(control);
            form.Controls.Add(layout);
            form.AcceptButton = install;
            reset.Click += delegate { path.Text = defaultFolder; };
            browse.Click += delegate {
                using (var dialog = new FolderBrowserDialog {
                    Description = "manifest.json을 저장할 설치 폴더를 선택하세요.",
                    SelectedPath = Directory.Exists(path.Text) ? path.Text : defaultFolder,
                    ShowNewFolderButton = true
                })
                    if (dialog.ShowDialog(form) == DialogResult.OK) path.Text = dialog.SelectedPath;
            };
            install.Click += delegate {
                try {
                    var folder = NormalizeDestination(path.Text);
                    Install(folder);
                    path.Text = folder;
                    try {
                        Directory.CreateDirectory(Path.GetDirectoryName(savedPath));
                        File.WriteAllText(savedPath, folder);
                    } catch { }
                }
                catch (Exception error) {
                    MessageBox.Show(form, "파일 설치에 실패했습니다.\n" + error.Message, form.Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
                status.Text = "파일 준비 완료 · 아래 크롬 등록 단계를 진행하세요.";
                copyFolder.Enabled = open.Enabled = true;
                path.ReadOnly = true;
                browse.Enabled = reset.Enabled = install.Enabled = false;
                form.AcceptButton = null;
            };
            copyAddress.Click += delegate {
                if (CopyText(form, ChromeExtensions)) status.Text = "관리 주소를 복사했습니다. 크롬 주소창에 붙여 넣으세요.";
            };
            copyFolder.Click += delegate {
                if (CopyText(form, path.Text)) status.Text = "설치 경로를 복사했습니다. 크롬의 폴더 선택창 주소줄에 붙여 넣으세요.";
            };
            open.Click += delegate {
                try { Process.Start(new ProcessStartInfo(path.Text) { UseShellExecute = true }); }
                catch (System.ComponentModel.Win32Exception error) { MessageBox.Show(form, error.Message, form.Text); }
            };
            Func<Task> check = async () => {
                update.Enabled = false;
                try {
                    latest = await Task.Run(() => GetLatest());
                    bool available = new Version(latest.Version) > new Version(version);
                    updateLabel.Text = available ? "새 버전 " + latest.Version + " 사용 가능" : "v" + version + " · 최신 버전입니다.";
                    update.Text = available ? "최신 설치 파일 받고 열기" : "최신 버전 확인";
                    if (!available) latest = null;
                } catch (Exception error) {
                    latest = null;
                    updateLabel.Text = "최신 버전 확인 실패 · " + error.Message;
                    update.Text = "다시 확인";
                } finally { update.Enabled = true; }
            };
            form.Shown += async delegate { await check(); };
            update.Click += async delegate {
                if (latest == null) { await check(); return; }
                update.Enabled = false;
                try {
                    var folder = NormalizeDestination(path.Text);
                    var release = latest;
                    var file = await Task.Run(() => DownloadLatest(release));
                    Process.Start(new ProcessStartInfo(file, "\"" + folder + "\"") { UseShellExecute = true });
                    form.Close();
                } catch (Exception error) {
                    updateLabel.Text = "업데이트 파일을 열지 못했습니다. " + error.Message;
                    update.Enabled = true;
                }
            };
            Application.Run(form);
        }
    }

    private sealed class TimedClient : WebClient
    {
        protected override WebRequest GetWebRequest(Uri address) {
            var request = base.GetWebRequest(address);
            request.Timeout = 15000;
            return request;
        }
    }
    private static WebClient Client() {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        var client = new TimedClient();
        client.Headers[HttpRequestHeader.UserAgent] = "FullAuto100-Setup";
        client.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
        return client;
    }
    internal sealed class LatestRelease {
        internal string Version, Url, Digest;
    }
    internal static LatestRelease ParseLatest(string json) {
        var release = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
        var version = Convert.ToString(release["tag_name"]).TrimStart('v');
        if (!System.Text.RegularExpressions.Regex.IsMatch(version, @"^\d+\.\d+\.\d+$") ||
            Convert.ToBoolean(release["draft"]) || Convert.ToBoolean(release["prerelease"]))
            throw new InvalidDataException("정식 릴리즈를 확인하지 못했습니다.");
        var name = "FullAuto100-Setup-v" + version + ".exe";
        var expected = "https://github.com/LibraLightLuda/FullAuto100/releases/download/v" + version + "/" + name;
        foreach (Dictionary<string, object> asset in (System.Collections.IEnumerable)release["assets"]) {
            if (Convert.ToString(asset["name"]) != name) continue;
            var url = Convert.ToString(asset["browser_download_url"]);
            var digest = asset.ContainsKey("digest") ? Convert.ToString(asset["digest"]) : "";
            if (url != expected || Convert.ToString(asset["state"]) != "uploaded" ||
                !System.Text.RegularExpressions.Regex.IsMatch(digest, @"^sha256:[0-9a-fA-F]{64}$"))
                throw new InvalidDataException("설치 파일 주소와 SHA-256을 확인하지 못했습니다.");
            return new LatestRelease { Version = version, Url = url, Digest = digest.Substring(7) };
        }
        throw new InvalidDataException("설치 파일이 등록되지 않은 릴리즈입니다.");
    }
    internal static LatestRelease GetLatest() {
        using (var client = Client()) return ParseLatest(client.DownloadString(ReleaseApi));
    }
    internal static void VerifyDownload(string file, string digest) {
        using (var hash = SHA256.Create())
        using (var stream = File.OpenRead(file)) {
            var actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "");
            if (!actual.Equals(digest, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("설치 파일 검증에 실패했습니다.");
        }
    }
    private static string DownloadLatest(LatestRelease release) {
        var folder = Path.Combine(Path.GetTempPath(), "FullAuto100-update-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, "FullAuto100-Setup-v" + release.Version + ".exe");
        using (var client = Client()) client.DownloadFile(release.Url, file);
        VerifyDownload(file, release.Digest);
        return file;
    }

    private static string ReadBundledManifest()
    {
        using (var source = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.manifest.json")))
            return source.ReadToEnd();
    }

    internal static string NormalizeDestination(string input)
    {
        var entered = Environment.ExpandEnvironmentVariables(input.Trim().Trim('"'));
        if (!System.Text.RegularExpressions.Regex.IsMatch(entered, @"^[a-zA-Z]:[\\/]"))
            throw new IOException("C:\\FullAuto100 같은 로컬 드라이브의 전체 폴더 경로를 입력하세요.");
        var path = Path.GetFullPath(entered).TrimEnd('\\', '/');
        if (path.Length <= 2) throw new IOException("드라이브 바로 아래의 별도 폴더를 선택하세요.");
        return path;
    }

    internal static void Install(string destination)
    {
        destination = NormalizeDestination(destination);
        var previous = destination + ".previous";
        var stage = destination + ".staging-" + Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(Path.GetDirectoryName(destination));
        using (new FileStream(destination + ".setup.lock", FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.DeleteOnClose))
        {
            CheckPayloadFolder(destination);
            CheckPayloadFolder(previous);
            if (!Directory.Exists(destination) && Directory.Exists(previous)) Directory.Move(previous, destination);
            RemovePayloadFolder(previous);
            Directory.CreateDirectory(stage);
            try
            {
                foreach (var name in Files)
                {
                    using (var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload." + name))
                    {
                        if (source == null) throw new InvalidDataException("설치 파일 누락 " + name);
                        using (var target = File.Create(Path.Combine(stage, name))) source.CopyTo(target);
                    }
                }
                if (Directory.Exists(destination)) Directory.Move(destination, previous);
                try { Directory.Move(stage, destination); }
                catch
                {
                    if (Directory.Exists(previous) && !Directory.Exists(destination)) Directory.Move(previous, destination);
                    throw;
                }
            }
            finally { RemovePayloadFolder(stage); }
            // Chrome may still hold an old file open until the extension reloads.
            try { RemovePayloadFolder(previous); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static void CheckPayloadFolder(string folder)
    {
        if (File.Exists(folder)) throw new IOException("파일 대신 설치 폴더 경로를 선택하세요.\n" + folder);
        if (!Directory.Exists(folder)) return;
        if ((File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0 ||
            Directory.EnumerateFileSystemEntries(folder).Any(entry =>
                Directory.Exists(entry) || !Files.Contains(Path.GetFileName(entry), StringComparer.OrdinalIgnoreCase)))
            throw new IOException("설치 폴더에 다른 파일이 있어 변경할 수 없습니다.\n" + folder);
        if (!Directory.EnumerateFileSystemEntries(folder).Any()) return;
        var manifest = Path.Combine(folder, "manifest.json");
        if (!File.Exists(manifest) || new FileInfo(manifest).Length > 65536)
            throw new IOException("빈 폴더 또는 기존 FullAuto100 폴더를 선택하세요.\n" + folder);
        var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(manifest));
        object name;
        if (data == null || !data.TryGetValue("name", out name) || !Equals(name, "FullAuto100 백그라운드 실행"))
            throw new IOException("빈 폴더 또는 기존 FullAuto100 폴더를 선택하세요.\n" + folder);
    }

    private static void RemovePayloadFolder(string folder)
    {
        if (!Directory.Exists(folder)) return;
        // Keep the ownership marker until the other files are removed.
        foreach (var name in Files.Where(name => name != "manifest.json")) File.Delete(Path.Combine(folder, name));
        File.Delete(Path.Combine(folder, "manifest.json"));
        Directory.Delete(folder);
    }

    private static bool CopyText(Form form, string value)
    {
        try { Clipboard.SetText(value); return true; }
        catch (System.Runtime.InteropServices.ExternalException) {
            MessageBox.Show(form, "클립보드를 사용할 수 없습니다. 아래 값을 직접 복사해 주세요.\n" + value, form.Text);
            return false;
        }
    }
}
