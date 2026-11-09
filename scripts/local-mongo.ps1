# Disposable native MongoDB for Windows (no Docker, no Windows service). Bound to 127.0.0.1 only.
#   powershell -File scripts/local-mongo.ps1 start   # starts a single-node replica set "rs0" on 127.0.0.1:27017
#   powershell -File scripts/local-mongo.ps1 stop
#   powershell -File scripts/local-mongo.ps1 reset   # stop, delete the data folder, start fresh
#   powershell -File scripts/local-mongo.ps1 status
# Binaries: %LOCALAPPDATA%\k3ncrypt-mongo\bin (MongoDB Community 8.0.x zip from fastdl.mongodb.org, sha256 checked).
# Data:     %LOCALAPPDATA%\k3ncrypt-mongo\data  (throwaway; never point production at this).
# The Mac/Docker path (scripts/test-mongo.sh, scripts/m0-e2e.sh) is unchanged.
# Port 27117 on purpose: another MongoDB (e.g. a Windows service) may already own 27017 and must never be touched.
param([Parameter(Position = 0)][ValidateSet('start', 'stop', 'reset', 'status')][string]$Action = 'status', [int]$Port = 27117)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'k3ncrypt-mongo'
$mongod = Join-Path $root 'bin\mongod.exe'
$data = Join-Path $root 'data'
$log = Join-Path $root 'mongod.log'
$pidFile = Join-Path $root 'mongod.pid'
if (-not (Test-Path $mongod)) { throw "mongod.exe not found at $mongod. See docs/LOCAL_DEVELOPMENT.md (native MongoDB on Windows)." }

function Test-Up { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $Port); $c.Close(); $true } catch { $false } }
function Stop-Mongo {
  if (Test-Path $pidFile) {
    $id = [int](Get-Content $pidFile); $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'mongod') { Stop-Process -Id $id; $p.WaitForExit(15000) | Out-Null }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
  }
}
function Start-Mongo {
  if (Test-Up) {
    if (Test-Path $pidFile) { Write-Host "Already running on 127.0.0.1:$Port"; return }
    throw "Port $Port is in use by something that is not this script's mongod. Pick another with -Port."
  }
  New-Item -ItemType Directory -Force $data | Out-Null
  $p = Start-Process -FilePath $mongod -WindowStyle Hidden -PassThru -ArgumentList @('--dbpath', "`"$data`"", '--bind_ip', '127.0.0.1', '--port', $Port, '--replSet', 'rs0', '--logpath', "`"$log`"", '--noauth', '--setParameter', 'ttlMonitorSleepSecs=1')
  Set-Content $pidFile $p.Id
  for ($i = 0; $i -lt 60 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Up)) { throw "mongod did not start; see $log" }
  # Initiate the replica set once, using the repo's own mongodb driver (no mongosh needed).
  $repo = Split-Path -Parent $PSScriptRoot
  $js = "const {MongoClient}=require('mongodb');(async()=>{const c=new MongoClient('mongodb://127.0.0.1:$Port/?directConnection=true');await c.connect();try{await c.db('admin').command({replSetInitiate:{_id:'rs0',members:[{_id:0,host:'127.0.0.1:$Port'}]}});}catch(e){if(!/already initialized/i.test(String(e.message)))throw e;}for(let i=0;i<40;i++){const s=await c.db('admin').command({hello:1});if(s.isWritablePrimary)break;await new Promise(r=>setTimeout(r,500));}await c.close();})().catch(e=>{console.error(e.message);process.exit(1)})"
  Push-Location $repo; try { node -e $js; if ($LASTEXITCODE -ne 0) { throw 'replica set initiate failed' } } finally { Pop-Location }
  Write-Host "MongoDB ready: mongodb://127.0.0.1:$Port/?replicaSet=rs0&directConnection=true"
}
switch ($Action) {
  'start' { Start-Mongo }
  'stop' { Stop-Mongo; Write-Host 'Stopped.' }
  'reset' { Stop-Mongo; if (Test-Path $data) { Remove-Item $data -Recurse -Force }; Start-Mongo }
  'status' { if (Test-Up) { Write-Host "Up on 127.0.0.1:$Port" } else { Write-Host 'Down' } }
}
