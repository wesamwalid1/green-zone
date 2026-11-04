#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-FreeBytes([string]$path) {
  $root = [System.IO.Path]::GetPathRoot($path)
  if ([string]::IsNullOrWhiteSpace($root)) { return [int64]::MaxValue }
  try {
    $info = New-Object System.IO.DriveInfo($root)
    if (-not $info.IsReady) { return 0 }
    return [int64]$info.AvailableFreeSpace
  } catch {
    return [int64]::MaxValue
  }
}

function Format-Size([int64]$bytes) {
  if ($bytes -ge 1GB) { return '{0:N1} GB' -f ($bytes / 1GB) }
  return '{0:N0} MB' -f ($bytes / 1MB)
}

function Find-AppExe([string]$dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return $null }
  foreach ($name in @('GreenZone.exe', 'Green Zone.exe', 'M5azen.exe')) {
    $direct = Join-Path $dir $name
    if (Test-Path -LiteralPath $direct) { return $direct }
  }
  foreach ($name in @('GreenZone.exe', 'Green Zone.exe', 'M5azen.exe')) {
    $hit = Get-ChildItem -LiteralPath $dir -Filter $name -Recurse -File -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
    if ($hit) { return $hit }
  }
  return $null
}

function Clear-GreenZoneData {
  $roots = @(
    (Join-Path $env:APPDATA 'GreenZone'),
    (Join-Path $env:APPDATA '@m5azen'),
    (Join-Path $env:LOCALAPPDATA 'GreenZone')
  )
  foreach ($root in $roots) {
    if (Test-Path -LiteralPath $root) {
      Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Copy-AppFiles([string]$from, [string]$to) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  $robo = Get-Command robocopy.exe -ErrorAction SilentlyContinue
  if ($robo) {
    $p = Start-Process -FilePath 'robocopy.exe' -ArgumentList @(
      $from, $to, '/E', '/COPY:DAT', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
    ) -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -ge 8) {
      throw "فشل النسخ (robocopy code $($p.ExitCode)). جرّب مسارًا محليًا مثل C:\GreenZone"
    }
    return
  }
  Copy-Item -Path (Join-Path $from '*') -Destination $to -Recurse -Force -ErrorAction Stop
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidates = @(
  (Join-Path $scriptDir 'app'),
  (Join-Path $scriptDir '..\release\win-unpacked'),
  (Join-Path $scriptDir 'win-unpacked')
)
$source = $null
foreach ($c in $candidates) {
  if (Find-AppExe $c) { $source = (Resolve-Path -LiteralPath $c).Path; break }
}
if (-not $source) {
  [void][System.Windows.Forms.MessageBox]::Show(
    "لم يتم العثور على ملفات التطبيق.`nضع المثبّت بجانب مجلد app.",
    'Green Zone',
    'OK',
    'Error'
  )
  exit 1
}

$iconPath = @(
  (Join-Path $source 'resources\icon.ico'),
  (Join-Path $scriptDir 'app\resources\icon.ico'),
  (Join-Path $scriptDir '..\build\icon.ico'),
  (Join-Path $source '..\..\build\icon.ico')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

$required = (Get-ChildItem -LiteralPath $source -Recurse -File -ErrorAction SilentlyContinue |
  Measure-Object -Property Length -Sum).Sum
if (-not $required) { $required = 900MB }

$form = New-Object System.Windows.Forms.Form
$form.Text = 'تثبيت Green Zone'
$form.Width = 560
$form.Height = 320
$form.StartPosition = 'CenterScreen'
$form.RightToLeft = 'Yes'
$form.RightToLeftLayout = $true
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.MaximizeBox = $false
$form.FormBorderStyle = 'FixedDialog'
if ($iconPath) {
  try { $form.Icon = New-Object System.Drawing.Icon($iconPath) } catch { }
}

$lbl = New-Object System.Windows.Forms.Label
$lbl.Text = "اختر مجلدًا محليًا (مثل C:\GreenZone أو D:\GreenZone).`nالمطلوب تقريباً: $(Format-Size $required)`nالتثبيت يفتح نسخة فارغة بدون بيانات قديمة."
$lbl.AutoSize = $false
$lbl.Width = 520
$lbl.Height = 60
$lbl.Left = 16
$lbl.Top = 12
$form.Controls.Add($lbl)

$pathBox = New-Object System.Windows.Forms.TextBox
$pathBox.Width = 400
$pathBox.Left = 16
$pathBox.Top = 85
$pathBox.Text = 'C:\GreenZone'
$form.Controls.Add($pathBox)

$browse = New-Object System.Windows.Forms.Button
$browse.Text = 'استعراض...'
$browse.Width = 100
$browse.Left = 430
$browse.Top = 83
$form.Controls.Add($browse)

$spaceLbl = New-Object System.Windows.Forms.Label
$spaceLbl.Width = 520
$spaceLbl.Height = 28
$spaceLbl.Left = 16
$spaceLbl.Top = 125
$form.Controls.Add($spaceLbl)

$freshBox = New-Object System.Windows.Forms.CheckBox
$freshBox.Text = 'تثبيت بنسخة فارغة (مسح أي بيانات قديمة للتطبيق)'
$freshBox.Checked = $true
$freshBox.AutoSize = $true
$freshBox.Left = 16
$freshBox.Top = 155
$form.Controls.Add($freshBox)

$install = New-Object System.Windows.Forms.Button
$install.Text = 'تثبيت وتشغيل'
$install.Width = 160
$install.Height = 36
$install.Left = 220
$install.Top = 195
$form.Controls.Add($install)

$runOnly = New-Object System.Windows.Forms.Button
$runOnly.Text = 'تشغيل من هنا بدون تثبيت'
$runOnly.Width = 220
$runOnly.Height = 30
$runOnly.Left = 170
$runOnly.Top = 240
$form.Controls.Add($runOnly)

function Refresh-Space {
  try {
    $target = $pathBox.Text.Trim()
    if (-not $target) { $spaceLbl.Text = 'حدد مسار التثبيت'; $install.Enabled = $false; return }
    $parent = if (Test-Path -LiteralPath $target) { $target } else { Split-Path -Parent $target }
    if (-not $parent) { $parent = $target }
    if (-not (Test-Path -LiteralPath $parent)) {
      $root = [System.IO.Path]::GetPathRoot($target)
      $parent = $root
    }
    $free = Get-FreeBytes $parent
    $spaceLbl.Text = "المساحة المتاحة: $(Format-Size $free)"
    $install.Enabled = ($free -gt ($required + 50MB))
  } catch {
    $spaceLbl.Text = 'تعذر قراءة المساحة — تأكد أن المسار على قرص محلي'
    $install.Enabled = $true
  }
}

$browse.Add_Click({
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = 'اختر مجلد التثبيت'
  if ($dlg.ShowDialog() -eq 'OK') {
    $pathBox.Text = Join-Path $dlg.SelectedPath 'GreenZone'
    Refresh-Space
  }
})
$pathBox.Add_TextChanged({ Refresh-Space })
Refresh-Space

$runOnly.Add_Click({
  try {
    if ($freshBox.Checked) { Clear-GreenZoneData }
    $exe = Find-AppExe $source
    if (-not $exe) { throw 'GreenZone.exe غير موجود في مجلد app' }
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
    $form.Close()
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show("تعذر التشغيل:`n$($_.Exception.Message)", 'Green Zone', 'OK', 'Error')
  }
})

$install.Add_Click({
  try {
    $dest = $pathBox.Text.Trim().TrimEnd('\')
    if (-not $dest) { return }
    if ($dest -match '(?i)\\\\|mtp|phone|mobile|OneDrive\\Mobile') {
      throw 'المسار يبدو غير محلي. استخدم مثلاً C:\GreenZone'
    }
    $install.Enabled = $false
    $runOnly.Enabled = $false
    $install.Text = 'جاري النسخ...'
    [System.Windows.Forms.Application]::DoEvents()

    if ($freshBox.Checked) { Clear-GreenZoneData }
    Copy-AppFiles -from $source -to $dest

    $exe = Find-AppExe $dest
    if (-not $exe) {
      $sample = (Get-ChildItem -LiteralPath $dest -ErrorAction SilentlyContinue | Select-Object -First 8 -ExpandProperty Name) -join ', '
      throw "تعذر العثور على GreenZone.exe بعد النسخ.`nالمسار: $dest`nمحتوى المجلد: $sample"
    }

    $wsh = New-Object -ComObject WScript.Shell
    $desk = [Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desk 'Green Zone.lnk'
    $lnk = $wsh.CreateShortcut($lnkPath)
    $lnk.TargetPath = $exe
    $lnk.WorkingDirectory = (Split-Path -Parent $exe)
    $lnk.Description = 'Green Zone'
    if ($iconPath) { $lnk.IconLocation = "$iconPath,0" }
    $lnk.Save()

    Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe)
    $form.Close()
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show("فشل التثبيت:`n$($_.Exception.Message)", 'Green Zone', 'OK', 'Error')
    $install.Text = 'تثبيت وتشغيل'
    $install.Enabled = $true
    $runOnly.Enabled = $true
  }
})

[void]$form.ShowDialog()
