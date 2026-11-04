#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-FreeBytes([string]$path) {
  $root = [System.IO.Path]::GetPathRoot($path)
  if ([string]::IsNullOrWhiteSpace($root)) { return [int64]::MaxValue }
  $info = New-Object System.IO.DriveInfo($root)
  if (-not $info.IsReady) { return 0 }
  return [int64]$info.AvailableFreeSpace
}

function Format-Size([int64]$bytes) {
  if ($bytes -ge 1GB) { return '{0:N1} GB' -f ($bytes / 1GB) }
  return '{0:N0} MB' -f ($bytes / 1MB)
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidates = @(
  (Join-Path $scriptDir 'app'),
  (Join-Path $scriptDir '..\release\win-unpacked'),
  (Join-Path $scriptDir 'win-unpacked')
)
$source = $candidates | Where-Object { Test-Path (Join-Path $_ 'M5azen.exe') } | Select-Object -First 1
if (-not $source) {
  [System.Windows.Forms.MessageBox]::Show(
    "لم يتم العثور على ملفات التطبيق بجانب المثبّت.`nضع Install-M5azen.ps1 داخل مجلد التوزيع مع مجلد app.",
    'M5azen',
    'OK',
    'Error'
  ) | Out-Null
  exit 1
}

$required = (Get-ChildItem -LiteralPath $source -Recurse -File -ErrorAction SilentlyContinue |
  Measure-Object -Property Length -Sum).Sum
if (-not $required) { $required = 900MB }

$form = New-Object System.Windows.Forms.Form
$form.Text = 'تثبيت M5azen'
$form.Width = 560
$form.Height = 280
$form.StartPosition = 'CenterScreen'
$form.RightToLeft = 'Yes'
$form.RightToLeftLayout = $true
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.MaximizeBox = $false
$form.FormBorderStyle = 'FixedDialog'

$lbl = New-Object System.Windows.Forms.Label
$lbl.Text = "اختر أي مجلد على درايف فيه مساحة كافية.`nالمطلوب تقريباً: $(Format-Size $required)"
$lbl.AutoSize = $false
$lbl.Width = 520
$lbl.Height = 50
$lbl.Left = 16
$lbl.Top = 16
$form.Controls.Add($lbl)

$pathBox = New-Object System.Windows.Forms.TextBox
$pathBox.Width = 400
$pathBox.Left = 16
$pathBox.Top = 80
$pathBox.Text = 'E:\M5azen'
$form.Controls.Add($pathBox)

$browse = New-Object System.Windows.Forms.Button
$browse.Text = 'استعراض...'
$browse.Width = 100
$browse.Left = 430
$browse.Top = 78
$form.Controls.Add($browse)

$spaceLbl = New-Object System.Windows.Forms.Label
$spaceLbl.Width = 520
$spaceLbl.Height = 40
$spaceLbl.Left = 16
$spaceLbl.Top = 120
$form.Controls.Add($spaceLbl)

$install = New-Object System.Windows.Forms.Button
$install.Text = 'تثبيت وتشغيل'
$install.Width = 160
$install.Height = 36
$install.Left = 220
$install.Top = 180
$form.Controls.Add($install)

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
    $ok = $free -ge ($required + 50MB)
    $spaceLbl.Text = "المساحة المتاحة: $(Format-Size $free)   |   المطلوب: $(Format-Size $required)"
    $spaceLbl.ForeColor = if ($ok) { [System.Drawing.Color]::DarkGreen } else { [System.Drawing.Color]::Firebrick }
    $install.Enabled = $ok
  } catch {
    $spaceLbl.Text = $_.Exception.Message
    $install.Enabled = $false
  }
}

$browse.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'اختر مجلد التثبيت'
  if ($dialog.ShowDialog() -eq 'OK') {
    $pathBox.Text = Join-Path $dialog.SelectedPath 'M5azen'
    Refresh-Space
  }
})

$pathBox.Add_TextChanged({ Refresh-Space })

$install.Add_Click({
  $dest = $pathBox.Text.Trim().TrimEnd('\')
  try {
    $install.Enabled = $false
    $spaceLbl.Text = 'جاري النسخ...'
    $form.Refresh()
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    & robocopy $source $dest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if (-not (Test-Path (Join-Path $dest 'M5azen.exe'))) { throw 'فشل نسخ ملفات التطبيق' }

    $wsh = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnk = $wsh.CreateShortcut((Join-Path $desktop 'M5azen.lnk'))
    $lnk.TargetPath = Join-Path $dest 'M5azen.exe'
    $lnk.WorkingDirectory = $dest
    $lnk.Description = 'نظام إدارة المخازن'
    $lnk.Save()

    Start-Process -FilePath (Join-Path $dest 'M5azen.exe')
    [System.Windows.Forms.MessageBox]::Show(
      "تم التثبيت في:`n$dest`n`nوتم إنشاء اختصار على سطح المكتب.`nالدخول: admin / admin123",
      'M5azen',
      'OK',
      'Information'
    ) | Out-Null
    $form.Close()
  } catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'خطأ التثبيت', 'OK', 'Error') | Out-Null
    Refresh-Space
  }
})

Refresh-Space
[void]$form.ShowDialog()
