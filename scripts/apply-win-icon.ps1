param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [Parameter(Mandatory = $true)]
  [string]$IconPath
)

$ErrorActionPreference = "Stop"

$definition = @"
using System;
using System.Runtime.InteropServices;

public static class NativeResource
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool UpdateResource(
        IntPtr updateHandle,
        IntPtr resourceType,
        IntPtr resourceName,
        UInt16 language,
        byte[] data,
        UInt32 dataLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool EndUpdateResource(IntPtr updateHandle, bool discard);

    public static IntPtr ResourceId(int id)
    {
        return new IntPtr(id);
    }
}
"@

Add-Type -TypeDefinition $definition

$resolvedExe = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedIcon = (Resolve-Path -LiteralPath $IconPath).Path
$iconBytes = [System.IO.File]::ReadAllBytes($resolvedIcon)

function Read-UInt16($offset) {
  return [System.BitConverter]::ToUInt16($iconBytes, $offset)
}

function Read-UInt32($offset) {
  return [System.BitConverter]::ToUInt32($iconBytes, $offset)
}

function Write-UInt16([byte[]]$target, [int]$offset, [int]$value) {
  [System.BitConverter]::GetBytes([UInt16]$value).CopyTo($target, $offset)
}

function Write-UInt32([byte[]]$target, [int]$offset, [int]$value) {
  [System.BitConverter]::GetBytes([UInt32]$value).CopyTo($target, $offset)
}

function Throw-LastError($message) {
  $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "$message (Win32 error $code)"
}

if ((Read-UInt16 0) -ne 0 -or (Read-UInt16 2) -ne 1) {
  throw "Icon file is not a valid ICO resource: $resolvedIcon"
}

$iconCount = Read-UInt16 4
if ($iconCount -lt 1) {
  throw "Icon file has no image entries: $resolvedIcon"
}

$groupBytes = New-Object byte[] (6 + ($iconCount * 14))
Write-UInt16 $groupBytes 0 0
Write-UInt16 $groupBytes 2 1
Write-UInt16 $groupBytes 4 $iconCount

$iconEntries = @()
for ($index = 0; $index -lt $iconCount; $index += 1) {
  $entryOffset = 6 + ($index * 16)
  $resourceId = $index + 1
  $bytesInResource = [int](Read-UInt32 ($entryOffset + 8))
  $imageOffset = [int](Read-UInt32 ($entryOffset + 12))
  $imageData = New-Object byte[] $bytesInResource
  [System.Array]::Copy($iconBytes, $imageOffset, $imageData, 0, $bytesInResource)

  $groupOffset = 6 + ($index * 14)
  $groupBytes[$groupOffset] = $iconBytes[$entryOffset]
  $groupBytes[$groupOffset + 1] = $iconBytes[$entryOffset + 1]
  $groupBytes[$groupOffset + 2] = $iconBytes[$entryOffset + 2]
  $groupBytes[$groupOffset + 3] = $iconBytes[$entryOffset + 3]
  Write-UInt16 $groupBytes ($groupOffset + 4) (Read-UInt16 ($entryOffset + 4))
  Write-UInt16 $groupBytes ($groupOffset + 6) (Read-UInt16 ($entryOffset + 6))
  Write-UInt32 $groupBytes ($groupOffset + 8) $bytesInResource
  Write-UInt16 $groupBytes ($groupOffset + 12) $resourceId

  $iconEntries += [PSCustomObject]@{
    Id = $resourceId
    Data = $imageData
  }
}

$rtIcon = [NativeResource]::ResourceId(3)
$rtGroupIcon = [NativeResource]::ResourceId(14)
$groupName = [NativeResource]::ResourceId(1)
$languages = @(0, 1033)

$handle = [NativeResource]::BeginUpdateResource($resolvedExe, $false)
if ($handle -eq [IntPtr]::Zero) {
  Throw-LastError "Unable to open executable resources for update"
}

$discard = $true
try {
  foreach ($language in $languages) {
    foreach ($entry in $iconEntries) {
      $ok = [NativeResource]::UpdateResource(
        $handle,
        $rtIcon,
        [NativeResource]::ResourceId($entry.Id),
        [UInt16]$language,
        $entry.Data,
        [UInt32]$entry.Data.Length
      )
      if (-not $ok) {
        Throw-LastError "Unable to update icon resource $($entry.Id)"
      }
    }

    $ok = [NativeResource]::UpdateResource(
      $handle,
      $rtGroupIcon,
      $groupName,
      [UInt16]$language,
      $groupBytes,
      [UInt32]$groupBytes.Length
    )
    if (-not $ok) {
      Throw-LastError "Unable to update icon group resource"
    }
  }

  $discard = $false
}
finally {
  $ok = [NativeResource]::EndUpdateResource($handle, $discard)
  if (-not $ok) {
    Throw-LastError "Unable to finalize executable resource update"
  }
}

Write-Host "Applied Windows icon to $resolvedExe"
