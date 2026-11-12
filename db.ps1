$mysqlBase = Join-Path $env:LOCALAPPDATA 'mini-store-mysql\mysql-8.4.13-winx64'
$mysqlData = Join-Path $env:LOCALAPPDATA 'mini-store-mysql\data'

if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -InformationLevel Quiet) {
  Write-Host 'MySQL is already running.'
  exit 0
}

$mysqlArgs = @(
  "--basedir=`"$mysqlBase`"",
  "--datadir=`"$mysqlData`"",
  '--port=3306',
  '--bind-address=127.0.0.1',
  '--mysqlx=OFF',
  "--log-error=`"$env:LOCALAPPDATA\mini-store-mysql\mysql-error.log`""
)

Start-Process `
  -FilePath (Join-Path $mysqlBase 'bin\mysqld.exe') `
  -ArgumentList $mysqlArgs `
  -WindowStyle Hidden

Write-Host 'MySQL is starting.'
