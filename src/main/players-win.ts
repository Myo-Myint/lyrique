/**
 * Spotify and Apple Music on Windows: Windows' own "now playing" service (System Media
 * Transport Controls, the panel behind the volume flyout) knows what every player is playing.
 * A long-lived PowerShell reads it a few times a second and prints the same JSON lines as the
 * Mac loop; playback commands go to it on stdin. Nothing to install, nothing compiled.
 */

/** Which player a "now playing" session belongs to, by the app's id. */
export const WIN_APP_PATTERNS = { spotify: 'spotify', music: 'AppleMusic|AppleInc\\.AppleMusic|iTunes' }

export const WIN_LOOP = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$apps = @($args)
$inv = [Globalization.CultureInfo]::InvariantCulture

# WinRT async calls, awaited from PowerShell.
$asTaskOp = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
} | Select-Object -First 1
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
function Await($op, [Type]$type) {
  $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { return $null }
  return $task.Result
}

function Emit($o) {
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

function KeyOf([string]$aumid) {
  if ($aumid -match '${WIN_APP_PATTERNS.spotify}') { return 'spotify' }
  if ($aumid -match '${WIN_APP_PATTERNS.music}') { return 'music' }
  return $null
}

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if (-not $mgr) { Emit @{ app = 'spotify'; running = $true; error = 'Windows media controls unavailable' }; exit 1 }

function Sessions {
  $found = @{}
  foreach ($s in $mgr.GetSessions()) {
    $k = KeyOf $s.SourceAppUserModelId
    if ($k -and ($apps -contains $k) -and -not $found.ContainsKey($k)) { $found[$k] = $s }
  }
  return $found
}

# Cover art as a data: URL ('' if the player hasn't published it yet).
function Art($props) {
  try {
    if (-not $props.Thumbnail) { return '' }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if (-not $stream) { return '' }
    # The stream arrives as a bare COM object, so PowerShell can't pick the overload itself.
    $net = $asStreamForRead.Invoke($null, @($stream))
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    if ($ms.Length -lt 100) { return '' }
    $bytes = $ms.ToArray()
    $type = if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) { 'image/jpeg' } else { 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return '' }
}

$last = @{}
$artFor = @{}
$known = @{}

function Poll {
  $now = [DateTimeOffset]::Now
  $found = Sessions
  $playing = $false
  foreach ($k in $apps) {
    $s = $found[$k]
    if (-not $s) {
      if ($known[$k] -ne $false) { Emit @{ app = $k; running = $false } }
      $known[$k] = $false
      $last[$k] = $null
      continue
    }
    $known[$k] = $true
    try {
      $status = [string]$s.GetPlaybackInfo().PlaybackStatus
      if ($status -eq 'Stopped' -or $status -eq 'Closed') {
        Emit @{ app = $k; running = $true; state = 'stopped' }
        $last[$k] = $null
        continue
      }
      $state = if ($status -eq 'Playing') { 'playing' } else { 'paused' }
      $tl = $s.GetTimelineProperties()
      # Players update the timeline now and then; move it on by the time since.
      $pos = $tl.Position.TotalSeconds
      if ($state -eq 'playing' -and $tl.LastUpdatedTime.Year -gt 2000) { $pos += ($now - $tl.LastUpdatedTime).TotalSeconds }
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      if (-not $props -or -not $props.Title) { continue }
      $id = "$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      $msg = @{ app = $k; running = $true; state = $state; pos = $pos; at = $now.ToUnixTimeMilliseconds(); id = $id; sec = $true }
      $art = ''
      if ($artFor[$k] -ne $id) {
        $art = Art $props
        if ($art) { $artFor[$k] = $id }
      }
      # Full details when the song changes, and again once its cover arrives.
      if ($id -ne $last[$k] -or $art) {
        $msg.title = $props.Title
        $msg.artist = $props.Artist
        $msg.album = $props.AlbumTitle
        $msg.duration = ($tl.EndTime - $tl.StartTime).TotalSeconds
        if ($art) { $msg.artwork = $art }
        $last[$k] = $id
      }
      Emit $msg
      if ($state -eq 'playing') { $playing = $true }
    } catch {
      Emit @{ app = $k; running = $true; error = [string]$_ }
      $last[$k] = $null
    }
  }
  return $playing
}

# "playPause spotify", "next music", "seek spotify 42.5", "poll"
function Command([string]$line) {
  $parts = $line.Trim() -split ' '
  if ($parts.Count -lt 2) { return }
  $s = (Sessions)[$parts[1]]
  if (-not $s) { return }
  try {
    switch ($parts[0]) {
      'playPause' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
      'next' { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
      'previous' { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
      'seek' {
        $ticks = [long]([double]::Parse($parts[2], $inv) * 10000000)
        $null = Await ($s.TryChangePlaybackPositionAsync($ticks)) ([bool])
      }
    }
  } catch { Emit @{ app = $parts[1]; running = $true; error = [string]$_ } }
}

# Not [Console]::In: its ReadLineAsync blocks until a line arrives, which would stall polling.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$pending = $stdin.ReadLineAsync()
$nextPoll = [DateTime]::MinValue
while ($true) {
  if ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { exit 0 }
    Command $line
    $pending = $stdin.ReadLineAsync()
    $nextPoll = [DateTime]::Now.AddMilliseconds(150)
  }
  if ([DateTime]::Now -ge $nextPoll) {
    $p = Poll
    $nextPoll = [DateTime]::Now.AddMilliseconds($(if ($p) { 400 } else { 1500 }))
  }
  Start-Sleep -Milliseconds 40
}
`
