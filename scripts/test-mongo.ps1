# Windows twin of scripts/test-mongo.sh: runs the real-Mongo Jest suites against the disposable NATIVE Mongo
# started by scripts/local-mongo.ps1 (127.0.0.1:27117, replica set rs0). Never Atlas. The Docker path (test-mongo.sh) is unchanged.
# Skipped here: backend/attachments/fileLedger.mongo.test.ts, which restarts a Docker container by name.
#   powershell -File scripts/test-mongo.ps1 [-Stop]
param([switch]$Stop, [int]$Port = 27117)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
powershell -NoProfile -File (Join-Path $PSScriptRoot 'local-mongo.ps1') start -Port $Port
if ($LASTEXITCODE -ne 0) { exit 1 }
$uri = "mongodb://127.0.0.1:$Port/?replicaSet=rs0"
$secret = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
$status = 0
function Run([string]$label, [string]$db, [string[]]$tests) {
  Write-Host "== $label"
  $env:NODE_ENV = 'test'; $env:K3NCRYPT_DEVICE_TRUST_PROOF_SECRET = $secret; $env:MONGO_URI = $uri; $env:MONGO_DB_NAME = $db
  $env:K3NCRYPT_ROUTING_MONGO_URI = $uri; $env:K3NCRYPT_ATTACHMENT_TRUST_MONGO_URI = $uri; $env:K3NCRYPT_FILE_READ_MONGO_URI = $uri; $env:K3NCRYPT_RETENTION_MONGO_URI = $uri
  $env:K3NCRYPT_TEST_MONGO_URI = $uri   # opt-in gate for the push (Firebase wake) integration suites
  $out = npx jest @tests --runInBand --forceExit --coverage=false --silent 2>&1 | Select-String -Pattern '^(Tests:|FAIL )'
  $out | ForEach-Object { Write-Host $_.Line }
  if ($LASTEXITCODE -ne 0) { $script:status = 1 }
}
Run 'database, device trust, private network' 'k3ncrypt_playwright_mongo' @('backend/db/mongo.integration', 'backend/security/durableDeviceTrust.mongo', 'backend/privateNetwork/membershipSecurity.mongo')
Run 'web lifecycle TTL' 'k3ncrypt_playwright_lifecycle_mongo' @('backend/db/webLifecycle.mongo')
Run 'routing ownership and clock skew' 'k3ncrypt_playwright_routing' @('backend/security/routingOwnership.mongo', 'backend/security/contactRemoval.mongo', 'backend/security/lifecycleClockSkew.mongo')
Run 'attachments (without the Docker-restart suite)' 'k3ncrypt_playwright_attachments' @('backend/attachments/attachmentRevocation.mongo', 'backend/attachments/fileRead.mongo')
Run 'retention TTL' 'k3ncrypt_playwright_retention' @('backend/db/retention.mongo')
Run 'storage caps' 'k3ncrypt_playwright_caps' @('backend/db/storageCaps.mongo')
Run 'push wake (Mongo integration)' 'k3ncrypt_playwright_push' @('backend/push/privateWake.mongo.integration', 'backend/push/durableWake.mongo.integration', 'backend/push/callWake.mongo.integration')
if ($Stop) { powershell -NoProfile -File (Join-Path $PSScriptRoot 'local-mongo.ps1') stop -Port $Port }
exit $status
