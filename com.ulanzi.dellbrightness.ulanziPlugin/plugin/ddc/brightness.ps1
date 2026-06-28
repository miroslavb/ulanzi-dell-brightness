<#
.SYNOPSIS
  DDC/CI monitor brightness engine for the Ulanzi "Dell Monitor Brightness" plugin.

.DESCRIPTION
  Reads / writes the brightness of external monitors over DDC/CI using the same
  Win32 monitor-configuration API (dxva2.dll) that Dell Display Manager uses
  under the hood (VCP feature 0x10). No third-party binaries required.

  Two ways to call it:

    One-shot (handy for manual testing):
      powershell -ExecutionPolicy Bypass -File brightness.ps1 -Op list
      powershell -ExecutionPolicy Bypass -File brightness.ps1 -Op get    -Index 0
      powershell -ExecutionPolicy Bypass -File brightness.ps1 -Op set    -Index 0 -Value 50
      powershell -ExecutionPolicy Bypass -File brightness.ps1 -Op adjust  -Index 0 -Delta 5

    Serve mode (used by the plugin — one process, P/Invoke compiled once):
      powershell -ExecutionPolicy Bypass -File brightness.ps1 -Serve
      stdin  : one JSON request per line, e.g. {"id":1,"op":"adjust","index":-1,"delta":5}
      stdout : one JSON response per line, e.g. {"id":1,"ok":true,"current":55,"min":0,"max":100,...}

  Index semantics: 0-based position in the enumerated physical-monitor list.
  Index -1 means "the first DDC/CI-capable monitor" (used for the Auto target).
#>
[CmdletBinding()]
param(
  [string]$Op = 'list',
  [int]$Index = -1,
  [int]$Value = 0,
  [int]$Delta = 0,
  [switch]$Serve
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# --- Native DDC/CI bindings + engine (compiled once per process) -------------
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace DellDdc {

  public class MonitorInfo {
    public int Index { get; set; }
    public string Name { get; set; }
    public bool Capable { get; set; }
    public int Current { get; set; }
    public int Min { get; set; }
    public int Max { get; set; }
  }

  public class OpResult {
    public bool Ok { get; set; }
    public string Error { get; set; }
    public int Index { get; set; }
    public string Name { get; set; }
    public int Current { get; set; }
    public int Min { get; set; }
    public int Max { get; set; }
  }

  public static class Engine {

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int left, top, right, bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PHYSICAL_MONITOR {
      public IntPtr hPhysicalMonitor;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
      public string szPhysicalMonitorDescription;
    }

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint count);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint arraySize, [Out] PHYSICAL_MONITOR[] arr);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetMonitorBrightness(IntPtr h, out uint min, out uint cur, out uint max);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool SetMonitorBrightness(IntPtr h, uint value);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool DestroyPhysicalMonitors(uint arraySize, [In] PHYSICAL_MONITOR[] arr);

    // Enumerate every physical monitor behind every HMONITOR into one flat list.
    private static List<PHYSICAL_MONITOR> EnumAll() {
      var hmons = new List<IntPtr>();
      MonitorEnumProc cb = (IntPtr h, IntPtr hdc, ref RECT r, IntPtr d) => { hmons.Add(h); return true; };
      EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cb, IntPtr.Zero);
      GC.KeepAlive(cb);

      var all = new List<PHYSICAL_MONITOR>();
      foreach (var h in hmons) {
        uint n;
        if (!GetNumberOfPhysicalMonitorsFromHMONITOR(h, out n) || n == 0) continue;
        var arr = new PHYSICAL_MONITOR[n];
        if (GetPhysicalMonitorsFromHMONITOR(h, n, arr)) all.AddRange(arr);
      }
      return all;
    }

    private static void DestroyAll(List<PHYSICAL_MONITOR> all) {
      if (all != null && all.Count > 0) {
        try { DestroyPhysicalMonitors((uint)all.Count, all.ToArray()); } catch { }
      }
    }

    // Resolve a requested index. -1 => first DDC/CI-capable monitor.
    private static int Resolve(List<PHYSICAL_MONITOR> all, int index) {
      if (index >= 0) return index < all.Count ? index : -1;
      for (int i = 0; i < all.Count; i++) {
        uint mn, cur, mx;
        if (GetMonitorBrightness(all[i].hPhysicalMonitor, out mn, out cur, out mx)) return i;
      }
      return -1;
    }

    public static MonitorInfo[] List() {
      var all = EnumAll();
      try {
        var res = new List<MonitorInfo>();
        for (int i = 0; i < all.Count; i++) {
          uint mn = 0, cur = 0, mx = 0;
          bool ok = GetMonitorBrightness(all[i].hPhysicalMonitor, out mn, out cur, out mx);
          res.Add(new MonitorInfo {
            Index = i,
            Name = (all[i].szPhysicalMonitorDescription ?? "").Trim(),
            Capable = ok,
            Current = ok ? (int)cur : -1,
            Min = ok ? (int)mn : -1,
            Max = ok ? (int)mx : -1
          });
        }
        return res.ToArray();
      } finally { DestroyAll(all); }
    }

    public static OpResult Get(int index) {
      var all = EnumAll();
      try {
        int idx = Resolve(all, index);
        if (idx < 0) return Fail(index, "No matching DDC/CI-capable monitor");
        uint mn, cur, mx;
        if (!GetMonitorBrightness(all[idx].hPhysicalMonitor, out mn, out cur, out mx))
          return Fail(idx, "GetMonitorBrightness failed (monitor may not support DDC/CI)");
        return Ok(idx, all[idx], (int)cur, (int)mn, (int)mx);
      } finally { DestroyAll(all); }
    }

    public static OpResult Set(int index, int value) {
      var all = EnumAll();
      try {
        int idx = Resolve(all, index);
        if (idx < 0) return Fail(index, "No matching DDC/CI-capable monitor");
        uint mn, cur, mx;
        if (!GetMonitorBrightness(all[idx].hPhysicalMonitor, out mn, out cur, out mx))
          return Fail(idx, "GetMonitorBrightness failed (monitor may not support DDC/CI)");
        long v = value; if (v < mn) v = mn; if (v > mx) v = mx;
        if (!SetMonitorBrightness(all[idx].hPhysicalMonitor, (uint)v))
          return Fail(idx, "SetMonitorBrightness failed");
        return Ok(idx, all[idx], (int)v, (int)mn, (int)mx);
      } finally { DestroyAll(all); }
    }

    public static OpResult Adjust(int index, int delta) {
      var all = EnumAll();
      try {
        int idx = Resolve(all, index);
        if (idx < 0) return Fail(index, "No matching DDC/CI-capable monitor");
        uint mn, cur, mx;
        if (!GetMonitorBrightness(all[idx].hPhysicalMonitor, out mn, out cur, out mx))
          return Fail(idx, "GetMonitorBrightness failed (monitor may not support DDC/CI)");
        long v = (long)cur + delta; if (v < mn) v = mn; if (v > mx) v = mx;
        if (!SetMonitorBrightness(all[idx].hPhysicalMonitor, (uint)v))
          return Fail(idx, "SetMonitorBrightness failed");
        return Ok(idx, all[idx], (int)v, (int)mn, (int)mx);
      } finally { DestroyAll(all); }
    }

    private static OpResult Ok(int idx, PHYSICAL_MONITOR m, int cur, int mn, int mx) {
      return new OpResult { Ok = true, Index = idx, Name = (m.szPhysicalMonitorDescription ?? "").Trim(),
                            Current = cur, Min = mn, Max = mx };
    }
    private static OpResult Fail(int idx, string err) {
      return new OpResult { Ok = false, Error = err, Index = idx, Current = -1, Min = -1, Max = -1 };
    }
  }
}
'@

# --- PowerShell glue ---------------------------------------------------------

function ConvertTo-Result($r) {
  # Normalise an OpResult into a lowercase-keyed hashtable for the JSON wire format.
  return [ordered]@{
    ok      = [bool]$r.Ok
    error   = $r.Error
    index   = [int]$r.Index
    name    = $r.Name
    current = [int]$r.Current
    min     = [int]$r.Min
    max     = [int]$r.Max
  }
}

function Invoke-Op([string]$op, [int]$index, [int]$value, [int]$delta) {
  switch ($op.ToLower()) {
    'list'   { return [ordered]@{ ok = $true; monitors = @([DellDdc.Engine]::List()) } }
    'get'    { return (ConvertTo-Result ([DellDdc.Engine]::Get($index))) }
    'set'    { return (ConvertTo-Result ([DellDdc.Engine]::Set($index, $value))) }
    'adjust' { return (ConvertTo-Result ([DellDdc.Engine]::Adjust($index, $delta))) }
    default  { return [ordered]@{ ok = $false; error = "unknown op: $op" } }
  }
}

function Read-IntProp($obj, $name, $def) {
  if ($null -ne $obj -and $null -ne $obj.$name) { return [int]$obj.$name }
  return $def
}

if ($Serve) {
  # Announce readiness so the Node side knows the worker is up.
  [Console]::Out.WriteLine('{"ready":true}')
  [Console]::Out.Flush()

  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }          # stdin closed -> exit
    $line = $line.Trim()
    if ($line -eq '') { continue }

    $id = $null
    try {
      $req = $line | ConvertFrom-Json
      $id  = $req.id
      $res = Invoke-Op ([string]$req.op) (Read-IntProp $req 'index' (-1)) (Read-IntProp $req 'value' (0)) (Read-IntProp $req 'delta' (0))
    } catch {
      $res = [ordered]@{ ok = $false; error = $_.Exception.Message }
    }
    if ($null -ne $id) { $res['id'] = $id }

    [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
  }
  return
}

# One-shot mode
try {
  $res = Invoke-Op $Op $Index $Value $Delta
} catch {
  $res = [ordered]@{ ok = $false; error = $_.Exception.Message }
}
$res | ConvertTo-Json -Compress -Depth 6
