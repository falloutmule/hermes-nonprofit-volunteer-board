param([ValidateSet('app','backup','health')][string]$Kind,
 [string]$AppRoot='C:\Services\HermesVolunteerBoard\app',
 [string]$DataRoot='C:\ProgramData\HermesVolunteerBoard',
 [string]$NodeExe='C:\Program Files\nodejs\node.exe')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $AppRoot
$env:CONFIG_FILE=Join-Path $DataRoot 'config\board.env'
if($Kind -eq 'app') { & $NodeExe 'dist/src/server.js' }
else { & $NodeExe 'scripts/host.mjs' $Kind }
exit $LASTEXITCODE
