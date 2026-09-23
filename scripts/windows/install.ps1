param(
 [Parameter(Mandatory)][string]$SourceApp,
 [Parameter(Mandatory)][string]$SourceEnv,
 [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Revision)
$ErrorActionPreference='Stop'
$app='C:\Services\HermesVolunteerBoard\app'
$data='C:\ProgramData\HermesVolunteerBoard'
$node='C:\Program Files\nodejs\node.exe'
$npm='C:\Program Files\nodejs\npm.cmd'
function Check {if($LASTEXITCODE -ne 0){throw 'Installation command failed'}}
function Secure-Directory([string]$path,[string]$serviceAccess) {
 New-Item -ItemType Directory -Path $path -Force | Out-Null
 $acl=New-Object System.Security.AccessControl.DirectorySecurity
 $acl.SetAccessRuleProtection($true,$false)
 foreach($sid in @('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
 }
 $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]::new('S-1-5-19'),$serviceAccess,'ContainerInherit,ObjectInherit','None','Allow')))
 Set-Acl -LiteralPath $path -AclObject $acl
}
if(-not(Test-Path -LiteralPath $node)){throw 'Install supported machine-level Node first'}
Secure-Directory 'C:\Services\HermesVolunteerBoard' 'ReadAndExecute'
Secure-Directory $data 'ReadAndExecute'
foreach($folder in @('config','data','backups','logs')) {
 $access=if($folder -eq 'config'){'ReadAndExecute'}else{'Modify'}
 Secure-Directory (Join-Path $data $folder) $access
}
if(-not(Test-Path -LiteralPath $app)) {
 git -c safe.directory=$SourceApp -c safe.directory="$SourceApp/.git" clone --no-hardlinks --no-checkout $SourceApp $app; Check
 git -c safe.directory=$app -C $app checkout --detach $Revision; Check
} else {
 $current=git -c safe.directory=$app -C $app rev-parse HEAD; Check
 if($current -ne $Revision){throw 'Existing checkout differs; use update command'}
 if(git -c safe.directory=$app -C $app status --porcelain --untracked-files=no){throw 'Existing checkout is modified'}
}
Set-Location -LiteralPath $app
& $npm ci; Check
& $npm run build; Check
$destination=Join-Path $data 'config\board.env'
# Never overwrite an existing configuration. Transform path values only on initial creation.
if(-not(Test-Path -LiteralPath $destination)) {
 & $node 'scripts/provision-config.mjs' $SourceEnv $destination $data
 Check
}
& (Join-Path $app 'scripts\windows\manage.ps1') -Action install
Write-Output 'Installed fixed directories, protected configuration, binaries, and startup tasks. Live database cutover/start is a separate verified step.'
