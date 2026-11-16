param([switch]$LiveRelease)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'outputs/stove100-background/manifest.json') -Raw | ConvertFrom-Json).version
$exe = Join-Path $root "dist/FullAuto100-Setup-v$version.exe"
$probeRoot = Join-Path ([IO.Path]::GetTempPath()) ('FullAuto100-QA-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $probeRoot
$source = Join-Path $probeRoot 'probe.cs'
@'
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;
class Probe {
    static void Require(bool condition, string note) { if(!condition) throw new Exception(note); }
    static void Reject(Action action) {
        try { action(); } catch(TargetInvocationException error) {
            if(error.InnerException is InvalidDataException || error.InnerException is IOException) return;
            throw;
        }
        throw new Exception("Invalid update or installation accepted");
    }
    static int Main(string[] args) {
        try { return Run(args); }
        catch(Exception error) {
            var cause = error is TargetInvocationException ? error.InnerException : error;
            Console.WriteLine(cause.GetType().FullName + ": " + cause.Message);
            return 1;
        }
    }
    static int Run(string[] args) {
        var app = Assembly.LoadFile(args[0]).GetType("Setup");
        var flags = BindingFlags.Static | BindingFlags.NonPublic;
        var install = app.GetMethod("Install",flags);
        var parse = app.GetMethod("ParseLatest",flags);
        var verify = app.GetMethod("VerifyDownload",flags);
        var folder = Path.Combine(args[1], "한글 사용자 경로", "extension");
        install.Invoke(null,new object[]{folder});
        Require(Directory.GetFiles(folder).Length==8,"Wrong payload count");
        foreach(var file in Directory.GetFiles(args[2]))
            Require(File.ReadAllBytes(file).SequenceEqual(File.ReadAllBytes(Path.Combine(folder,Path.GetFileName(file)))),"Payload mismatch");
        install.Invoke(null,new object[]{folder});
        File.WriteAllText(Path.Combine(folder,"keep.txt"),"keep");
        Reject(()=>install.Invoke(null,new object[]{folder}));
        Require(File.ReadAllText(Path.Combine(folder,"keep.txt"))=="keep","Unrelated file changed");
        var json = "{\"tag_name\":\"v5.8.0\",\"draft\":false,\"prerelease\":false,\"assets\":[{\"name\":\"FullAuto100-Setup-v5.8.0.exe\",\"state\":\"uploaded\",\"digest\":\"sha256:" + new string('a',64) + "\",\"browser_download_url\":\"https://github.com/LibraLightLuda/FullAuto100/releases/download/v5.8.0/FullAuto100-Setup-v5.8.0.exe\"}]}";
        Require(parse.Invoke(null,new object[]{json})!=null,"Release rejected");
        Reject(()=>parse.Invoke(null,new object[]{json.Replace("https://github.com/","https://example.com/")}));
        Reject(()=>parse.Invoke(null,new object[]{json.Replace("\"prerelease\":false","\"prerelease\":true")}));
        Reject(()=>parse.Invoke(null,new object[]{json.Replace("sha256:","invalid:")}));
        Reject(()=>verify.Invoke(null,new object[]{args[0], new string('a',64)}));
        if(args.Length>3) {
            var result=app.GetMethod("GetLatest",flags).Invoke(null,null);
            var latestVersion=result.GetType().GetField("Version",flags|BindingFlags.Instance).GetValue(result);
            Require(Convert.ToString(latestVersion)==args[3],"Unexpected live version");
            Console.WriteLine("PASS: installed EXE reads the published latest release");
        }
        Console.WriteLine("PASS: custom path, exact payload, update, unrelated-file protection and update metadata/hash validation");
        return 0;
    }
}
'@ | Set-Content -LiteralPath $source -Encoding utf8
$compiler = Join-Path $env:windir 'Microsoft.NET/Framework/v4.0.30319/csc.exe'
$probe = Join-Path $probeRoot 'probe.exe'
& $compiler /nologo /codepage:65001 /reference:System.Web.Extensions.dll "/out:$probe" $source
if ($LASTEXITCODE) { throw 'Probe build failed' }
$probeArgs = @($exe,$probeRoot,(Join-Path $root 'outputs/stove100-background'))
if ($LiveRelease) { $probeArgs += $version }
& $probe @probeArgs
if ($LASTEXITCODE) { throw 'Installer verification failed' }
