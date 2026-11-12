$mysqlBase = Join-Path $env:LOCALAPPDATA 'mini-store-mysql\mysql-8.4.13-winx64'
$mysqldPath = (Join-Path $mysqlBase 'bin\mysqld.exe').ToLowerInvariant()

$processes = Get-CimInstance Win32_Process -Filter "Name = 'mysqld.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant() -eq $mysqldPath }

if (-not $processes) {
  Write-Host 'Mini-store MySQL is not running.'
  exit 0
}

$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host 'Mini-store MySQL stopped.'
