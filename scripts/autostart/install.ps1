# Start the Career Agent apply assistant by itself whenever you sign in (Windows).
# Run once, from the project folder, in PowerShell:   powershell -ExecutionPolicy Bypass -File scripts\autostart\install.ps1
# Remove it:                                          powershell -ExecutionPolicy Bypass -File scripts\autostart\install.ps1 -Remove
param([switch]$Remove)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$name = "CareerAgentAssistant"
if ($Remove) { schtasks /Delete /TN $name /F | Out-Null; Write-Host "Removed."; exit 0 }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm was not found. Install Node 22 first." }
if (-not (Test-Path (Join-Path $repo ".env.local"))) { throw "Create $repo\.env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first." }
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d `"$repo`" && npm run assist:watch" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Installed. The assistant now starts when you sign in. Start it now with: schtasks /Run /TN $name"
