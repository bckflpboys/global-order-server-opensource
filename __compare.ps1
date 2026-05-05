$src = 'E:\web\chrome extentions\global order\global order server\models'
$dst = 'E:\web\chrome extentions\global order\global order server opensource\models'
foreach ($f in Get-ChildItem $src -Filter *.js) {
  $b = Join-Path $dst $f.Name
  if (Test-Path $b) {
    $d = Compare-Object (Get-Content $f.FullName) (Get-Content $b)
    if ($d) { Write-Host "DIFF: $($f.Name)" } else { Write-Host "SAME: $($f.Name)" }
  } else { Write-Host "MISSING: $($f.Name)" }
}
