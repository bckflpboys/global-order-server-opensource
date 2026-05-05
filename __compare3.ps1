$src = 'E:\web\chrome extentions\global order\global order server\routes'
$dst = 'E:\web\chrome extentions\global order\global order server opensource\routes'
foreach ($f in Get-ChildItem $src -Filter *.js) {
  $b = Join-Path $dst $f.Name
  if (Test-Path $b) {
    $d = Compare-Object (Get-Content $f.FullName) (Get-Content $b)
    if ($d) { Write-Host "DIFF: $($f.Name)" } else { Write-Host "SAME: $($f.Name)" }
  } else { Write-Host "MISSING in opensource: $($f.Name)" }
}
Write-Host ""
Write-Host "--- Files in opensource not in main ---"
foreach ($f in Get-ChildItem $dst -Filter *.js) {
  $a = Join-Path $src $f.Name
  if (-not (Test-Path $a)) { Write-Host "EXTRA in opensource: $($f.Name)" }
}
