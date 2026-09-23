param(
 [Parameter(Mandatory)][ValidateSet('install','start','stop','status','backup','restore','update','enable-tunnel')][string]$Action,
 [string]$AppRoot='C:\Services\HermesVolunteerBoard\app',
 [string]$DataRoot='C:\ProgramData\HermesVolunteerBoard',
 [string]$NodeExe='C:\Program Files\nodejs\node.exe',
 [string]$BackupFile, [string]$Revision)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $AppRoot
$env:CONFIG_FILE=Join-Path $DataRoot 'config\board.env'
$taskPrefix='HermesVolunteerBoard-'
function Native-Check { if($LASTEXITCODE -ne 0){throw 'Command failed; operation stopped'} }
function Stop-App {
 Disable-ScheduledTask -TaskName ($taskPrefix+'App') | Out-Null
 & $NodeExe 'scripts/host.mjs' stop; Native-Check
 $pidPath=Join-Path $DataRoot 'data\app.pid'
 for($i=0;$i -lt 20;$i++) {
  if(-not(Test-Path -LiteralPath $pidPath)){break}
  $appPid=[int](Get-Content -LiteralPath $pidPath)
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$appPid"
  if(-not $p){Remove-Item -LiteralPath $pidPath;break}
  if($p.Name -ne 'node.exe' -or $p.CommandLine -notmatch 'dist[/\\]src[/\\]server.js'){throw 'PID identity mismatch; refuse to stop unrelated process'}
  Start-Sleep -Seconds 1
 }
 if(Test-Path -LiteralPath $pidPath){throw 'App did not stop; database unchanged'}
 Stop-ScheduledTask -TaskName ($taskPrefix+'App')
 $stopPath=Join-Path $DataRoot 'data\app.stop'
 if(Test-Path -LiteralPath $stopPath){Remove-Item -LiteralPath $stopPath}
}
function Start-App {
 Enable-ScheduledTask -TaskName ($taskPrefix+'App') | Out-Null
 Start-ScheduledTask -TaskName ($taskPrefix+'App')
}
switch($Action) {
 'install' {
  $principal=New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  foreach($kind in @('App','Tunnel','Backup','Health')) {
   $taskName=$taskPrefix+$kind
   # Reinstallation preserves operational enabled/disabled state.
   $previous=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
   $disabled=if($previous){$previous.State -eq 'Disabled'}else{$kind -eq 'Tunnel'}
   $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $AppRoot 'scripts\windows\run.ps1')+'" -Kind '+$kind.ToLower()+' -AppRoot "'+$AppRoot+'" -DataRoot "'+$DataRoot+'" -NodeExe "'+$NodeExe+'"'
   $actionDef=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $args -WorkingDirectory $AppRoot
   if($kind -in @('App','Tunnel')){
    # Periodic activation recovers even manually launched tasks; IgnoreNew prevents duplicates.
    $triggers=@((New-ScheduledTaskTrigger -AtStartup),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
   }
   else {
    $interval=if($kind -eq 'Backup'){New-TimeSpan -Hours 6}else{New-TimeSpan -Minutes 5}
    $triggers=@((New-ScheduledTaskTrigger -AtStartup),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval $interval))
   }
   Register-ScheduledTask -TaskName $taskName -Action $actionDef -Trigger $triggers -Settings $settings -Principal $principal -Description 'Hermes Volunteer Board managed home deployment' -Force | Out-Null
   if($disabled){Disable-ScheduledTask -TaskName $taskName | Out-Null}
  }
 }
 'start' {Start-App}
 'stop' {Stop-App}
 'status' {Get-ScheduledTask -TaskName ($taskPrefix+'*') | Select-Object TaskName,State; & $NodeExe 'scripts/host.mjs' health; Native-Check}
 'backup' {& $NodeExe 'scripts/host.mjs' backup; Native-Check}
 'restore' {
  if(-not $BackupFile -or -not(Test-Path -LiteralPath $BackupFile)){throw 'Supply existing -BackupFile'}
  Stop-App
  & $NodeExe 'scripts/host.mjs' backup; Native-Check
  & $NodeExe 'scripts/host.mjs' restore $BackupFile; Native-Check
  Start-App
 }
 'update' {
  if($Revision -notmatch '^[0-9a-f]{40}$'){throw 'Supply full tested commit SHA already available locally'}
  if(git -c safe.directory=$AppRoot status --porcelain --untracked-files=no){throw 'Tracked checkout dirty'}
  git -c safe.directory=$AppRoot cat-file -e "$Revision`^{commit}"; Native-Check
  & $NodeExe 'scripts/host.mjs' backup; Native-Check
  Stop-App
  git -c safe.directory=$AppRoot checkout --detach $Revision; Native-Check
  & (Join-Path (Split-Path $NodeExe) 'npm.cmd') ci; Native-Check
  & (Join-Path (Split-Path $NodeExe) 'npm.cmd') run build; Native-Check
  & (Join-Path (Split-Path $NodeExe) 'npm.cmd') audit --omit=dev; Native-Check
  Start-App
 }
 'enable-tunnel' {
  $config=Get-Content -LiteralPath (Join-Path $DataRoot 'config\tunnel.json') -Raw | ConvertFrom-Json
  if(-not $config.enabled -or -not(Test-Path -LiteralPath $config.tokenFile)){throw 'Provision named tunnel config and protected token first'}
  Enable-ScheduledTask -TaskName ($taskPrefix+'Tunnel') | Out-Null
  Start-ScheduledTask -TaskName ($taskPrefix+'Tunnel')
 }
}
