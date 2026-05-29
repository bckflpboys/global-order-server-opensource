$src = 'E:\web\chrome extentions\global order\global order server\models'
$dst = 'E:\web\chrome extentions\global order\global order server opensource\models'
foreach ($f in Get-ChildItem $src -Filter *.js) {
  $b = Join-Path $dst $f.Name
  if (Test-Path $b) {
    $d = Compare-Object (Get-Content $f.FullName) (Get-Content $b)
    if ($d) { Write-Host "DIFF: $($f.Name)" } else { Write-Host "SAME: $($f.Name)" }
  } else { Write-Host "MISSING in opensource: $($f.Name)" }
}
Write-Host ""
Write-Host "--- Middleware ---"
$src2 = 'E:\web\chrome extentions\global order\global order server\middleware'
$dst2 = 'E:\web\chrome extentions\global order\global order server opensource\middleware'
foreach ($f in Get-ChildItem $src2 -Filter *.js) {
  $b = Join-Path $dst2 $f.Name
  if (Test-Path $b) {
    $d = Compare-Object (Get-Content $f.FullName) (Get-Content $b)
    if ($d) { Write-Host "DIFF: $($f.Name)" } else { Write-Host "SAME: $($f.Name)" }
  } else { Write-Host "MISSING in opensource: $($f.Name)" }
}
