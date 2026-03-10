param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$releaseDir = Join-Path $ProjectRoot 'android\app\build\outputs\apk\release'
$unsignedApk = Join-Path $releaseDir 'app-release-unsigned.apk'
$alignedApk = Join-Path $releaseDir 'app-release-aligned.apk'
$signedApk = Join-Path $releaseDir 'app-release-signed.apk'

if (-not (Test-Path $unsignedApk)) {
  throw "Unsigned APK not found: $unsignedApk"
}

function Get-RequiredEnvValue {
  param(
    [string]$Name
  )

  $value = [string][Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }

  return $value.Trim()
}

function Get-SigningConfigFromExternalFile {
  param(
    [string]$ConfigPath
  )

  if (-not (Test-Path $ConfigPath)) {
    throw "Keystore info file not found: $ConfigPath"
  }

  $keystoreLines = Get-Content $ConfigPath
  $keystorePath = (($keystoreLines | Where-Object { $_ -like 'Keystore:*' }) -split ':', 2)[1].Trim()
  $alias = (($keystoreLines | Where-Object { $_ -like 'Alias:*' }) -split ':', 2)[1].Trim()
  $password = (($keystoreLines | Where-Object { $_ -like 'Password:*' }) -split ':', 2)[1].Trim()

  if ([string]::IsNullOrWhiteSpace($keystorePath) -or [string]::IsNullOrWhiteSpace($alias) -or [string]::IsNullOrWhiteSpace($password)) {
    throw "Invalid keystore info file: $ConfigPath"
  }

  return @{
    KeystorePath = $keystorePath
    Alias = $alias
    KeystorePassword = $password
    KeyPassword = $password
  }
}

$signingConfig = if (-not [string]::IsNullOrWhiteSpace($env:ANDROID_RELEASE_KEYSTORE_INFO_FILE)) {
  Get-SigningConfigFromExternalFile -ConfigPath $env:ANDROID_RELEASE_KEYSTORE_INFO_FILE.Trim()
} else {
  @{
    KeystorePath = Get-RequiredEnvValue -Name 'ANDROID_RELEASE_KEYSTORE_PATH'
    Alias = Get-RequiredEnvValue -Name 'ANDROID_RELEASE_KEY_ALIAS'
    KeystorePassword = Get-RequiredEnvValue -Name 'ANDROID_RELEASE_KEYSTORE_PASSWORD'
    KeyPassword = [string]$env:ANDROID_RELEASE_KEY_PASSWORD
  }
}

if ([string]::IsNullOrWhiteSpace($signingConfig.KeyPassword)) {
  $signingConfig.KeyPassword = $signingConfig.KeystorePassword
}

$keystorePath = $signingConfig.KeystorePath
$alias = $signingConfig.Alias
$password = $signingConfig.KeystorePassword
$keyPassword = $signingConfig.KeyPassword

if (-not (Test-Path $keystorePath)) {
  throw "Keystore not found: $keystorePath"
}

$sdkRoots = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME, (Join-Path $env:LOCALAPPDATA 'Android\Sdk')) |
  Where-Object { $_ -and (Test-Path $_) } |
  Select-Object -Unique

if (-not $sdkRoots -or $sdkRoots.Count -eq 0) {
  throw 'Android SDK not found. Set ANDROID_SDK_ROOT or install Android SDK.'
}

$buildTools = foreach ($sdkRoot in $sdkRoots) {
  Get-ChildItem -Path (Join-Path $sdkRoot 'build-tools') -Directory -ErrorAction SilentlyContinue
}

$selectedBuildTools = $buildTools |
  Sort-Object { [version]$_.Name } -Descending |
  Select-Object -First 1

if (-not $selectedBuildTools) {
  throw 'Android build-tools not found.'
}

$zipalign = Join-Path $selectedBuildTools.FullName 'zipalign.exe'
$apksigner = Join-Path $selectedBuildTools.FullName 'apksigner.bat'

if (-not (Test-Path $zipalign)) {
  throw "zipalign not found: $zipalign"
}

if (-not (Test-Path $apksigner)) {
  throw "apksigner not found: $apksigner"
}

$ksPassFile = Join-Path $releaseDir '.ks-pass.txt'
$keyPassFile = Join-Path $releaseDir '.key-pass.txt'

try {
  Set-Content -Path $ksPassFile -Value $password -NoNewline
  Set-Content -Path $keyPassFile -Value $keyPassword -NoNewline

  if (Test-Path $alignedApk) {
    Remove-Item $alignedApk -Force
  }
  if (Test-Path $signedApk) {
    Remove-Item $signedApk -Force
  }

  & $zipalign -f -p 4 $unsignedApk $alignedApk
  if ($LASTEXITCODE -ne 0) {
    throw "zipalign failed with exit code $LASTEXITCODE"
  }

  & $apksigner sign `
    --ks $keystorePath `
    --ks-key-alias $alias `
    --ks-pass "file:$ksPassFile" `
    --key-pass "file:$keyPassFile" `
    --out $signedApk `
    $alignedApk
  if ($LASTEXITCODE -ne 0) {
    throw "apksigner sign failed with exit code $LASTEXITCODE"
  }

  & $apksigner verify --verbose --print-certs $signedApk
  if ($LASTEXITCODE -ne 0) {
    throw "apksigner verify failed with exit code $LASTEXITCODE"
  }

  Write-Output "SIGNED_APK=$signedApk"
} finally {
  Remove-Item $ksPassFile, $keyPassFile -Force -ErrorAction SilentlyContinue
}
