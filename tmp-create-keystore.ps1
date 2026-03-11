$keytool='C:\Program Files\Java\jdk-17\bin\keytool.exe'
$keystore='C:\Users\PWO\Desktop\vdjv-release.jks'
$alias='vdjv'
$password=-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object {[char]$_})
if(Test-Path $keystore){ Remove-Item $keystore -Force }
& $keytool -genkeypair -v -keystore $keystore -storetype JKS -storepass $password -keypass $password -alias $alias -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=VDJV Sampler Pad, OU=VDJV, O=VDJV, L=Manila, ST=Metro Manila, C=PH'
if($LASTEXITCODE -ne 0){ exit $LASTEXITCODE }
$infoPath='C:\Users\PWO\Desktop\JUNK\secrets\vdjv-keystore-info.txt'
$created=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
@(
  'VDJV Android Release Keystore',
  "Created: $created",
  "Keystore: $keystore",
  "Alias: $alias",
  "Password: $password",
  '',
  'Keep this file private. You need this keystore + password for all future app updates.'
) | Set-Content $infoPath
Write-Output "KEYSTORE=$keystore"
Write-Output "INFO=$infoPath"
