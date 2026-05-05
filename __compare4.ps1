$src = 'E:\web\chrome extentions\global order\global order server\services\agentService.js'
$dst = 'E:\web\chrome extentions\global order\global order server opensource\services\agentService.js'
$d = Compare-Object (Get-Content $src) (Get-Content $dst)
if ($d) { 
  Write-Host "DIFFERENT - showing first 20 diffs:"
  $d | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
} else { Write-Host "IDENTICAL" }
