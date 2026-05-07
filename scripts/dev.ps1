param(
  [switch]$ResetAgentState
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$agentDir = Join-Path $root "agent"
$backendDir = Join-Path $root "backend"
$logDir = Join-Path $root ".logs"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Stop-Port {
  param([int]$Port)

  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
}

function Read-EnvValue {
  param(
    [string]$Path,
    [string]$Name,
    [string]$Fallback = ""
  )

  if (-not (Test-Path $Path)) {
    return $Fallback
  }

  $line = Get-Content $Path | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if (-not $line) {
    return $Fallback
  }

  return ($line -replace "^$Name=", "").Trim()
}

$rootEnvPath = Join-Path $root ".env.local"
$sharedSecret = Read-EnvValue -Path $rootEnvPath -Name "AGENT_SHARED_SECRET" -Fallback "my-local-dev-secret-2026"

if (-not (Test-Path (Join-Path $agentDir ".venv\Scripts\python.exe"))) {
  Write-Host "Creating agent virtual environment..."
  python -m venv (Join-Path $agentDir ".venv")
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& (Join-Path $agentDir ".venv\Scripts\python.exe") -c "import uvicorn" *> $null
$uvicornCheckExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($uvicornCheckExitCode -ne 0) {
  Write-Host "Installing agent dependencies..."
  & (Join-Path $agentDir ".venv\Scripts\python.exe") -m pip install -r (Join-Path $agentDir "requirements.txt")
}

Stop-Port 8000
Stop-Port 8010
Stop-Port 5173

if ($ResetAgentState) {
  Remove-Item -LiteralPath `
    (Join-Path $agentDir "artifacts\checkpoints\interview.sqlite"), `
    (Join-Path $agentDir "artifacts\checkpoints\interview.sqlite-shm"), `
    (Join-Path $agentDir "artifacts\checkpoints\interview.sqlite-wal") `
    -Force `
    -ErrorAction SilentlyContinue
}

$agentEnv = @{
  AGENT_MODE = "demo"
  AGENT_SHARED_SECRET = $sharedSecret
  AGENT_CHECKPOINT_BACKEND = "sqlite"
  AGENT_CHECKPOINT_SQLITE_PATH = "artifacts/checkpoints/interview.sqlite"
  AGENT_WORKER_COUNT = "1"
}

$agentCommand = @"
`$ErrorActionPreference='Stop'
Set-Location '$agentDir'
New-Item -ItemType Directory -Force -Path 'artifacts/checkpoints' | Out-Null
`$env:AGENT_MODE='$($agentEnv.AGENT_MODE)'
`$env:AGENT_SHARED_SECRET='$($agentEnv.AGENT_SHARED_SECRET)'
`$env:AGENT_CHECKPOINT_BACKEND='$($agentEnv.AGENT_CHECKPOINT_BACKEND)'
`$env:AGENT_CHECKPOINT_SQLITE_PATH='$($agentEnv.AGENT_CHECKPOINT_SQLITE_PATH)'
`$env:AGENT_WORKER_COUNT='$($agentEnv.AGENT_WORKER_COUNT)'
`$env:PYTHONPATH='$(Join-Path $agentDir "src")'
& '.\.venv\Scripts\python.exe' -m uvicorn src.main:app --host 127.0.0.1 --port 8000
"@

Start-Process powershell.exe `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $agentCommand) `
  -RedirectStandardOutput (Join-Path $logDir "agent.out.log") `
  -RedirectStandardError (Join-Path $logDir "agent.err.log") `
  -WindowStyle Hidden

Start-Sleep -Seconds 3

Start-Process -FilePath "D:\Anaconda\python.exe" `
  -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8010") `
  -WorkingDirectory $backendDir `
  -RedirectStandardOutput (Join-Path $logDir "backend.out.log") `
  -RedirectStandardError (Join-Path $logDir "backend.err.log") `
  -WindowStyle Hidden

Start-Sleep -Seconds 3

Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "5173") `
  -WorkingDirectory $root `
  -RedirectStandardOutput (Join-Path $logDir "frontend.out.log") `
  -RedirectStandardError (Join-Path $logDir "frontend.err.log") `
  -WindowStyle Hidden

Write-Host "RecruitPro dev services started:"
Write-Host "  Agent:   http://127.0.0.1:8000/healthz"
Write-Host "  Backend: http://127.0.0.1:8010/api/health"
Write-Host "  Web:     http://127.0.0.1:5173"
Write-Host "Logs: $logDir"
