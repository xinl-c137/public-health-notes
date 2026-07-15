param(
  [string]$NotesRoot = "",
  [string]$AttachmentsRoot = ".\attachments"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$notesFolderName = -join @([char]0x516C, [char]0x536B, [char]0x8BFE, [char]0x7A0B)
if (-not $NotesRoot) { $NotesRoot = Join-Path "." $notesFolderName }
$notesPath = (Resolve-Path (Join-Path $projectRoot $NotesRoot)).Path
$attachmentsPath = Join-Path $projectRoot $AttachmentsRoot
$contentPath = Join-Path $projectRoot "content"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function To-WebPath([string]$path) {
  return $path.Replace("\", "/")
}

$notes = Get-ChildItem -LiteralPath $notesPath -Recurse -File -Filter "*.md" | ForEach-Object {
  $relative = To-WebPath($_.FullName.Substring($notesPath.Length + 1))
  $parts = $relative.Split("/")
  $raw = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
  $updated = if ($raw -match '(?m)^\s*[^:\r\n]+:\s*(\d{4}-\d{2}-\d{2})') { $Matches[1] } else { $_.LastWriteTime.ToString("yyyy-MM-dd") }
  $body = $raw -replace '(?s)^---\s*.*?\s*---\s*', ''
  $candidate = ($body -split "`r?`n" | Where-Object { $_.Trim() -and $_ -notmatch '^\s*(#|!\[\[|[-*+]\s|>|\||\$\$)' } | Select-Object -First 1)
  $description = if ($candidate) {
    $clean = $candidate -replace '\[\[([^\]|]+)\|?([^\]]*)\]\]', '$1' -replace '[=*`_~#]', ''
    if ($clean.Length -gt 88) { $clean.Substring(0, 88) + "..." } else { $clean }
  } else { "Public health course note." }
  [ordered]@{
    title = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    path = $relative
    file = "$notesFolderName/$relative"
    category = $parts[0]
    description = $description.Trim()
    updated = $updated
  }
} | Sort-Object category, @{ Expression = { if ($_.title -match '^(\d+)') { [int]$Matches[1] } else { 9999 } } }, title

$attachments = @()
if (Test-Path -LiteralPath $attachmentsPath) {
  $resolvedAttachments = (Resolve-Path $attachmentsPath).Path
  $primaryNotePaths = @{}
  foreach ($note in @($notes)) { $primaryNotePaths[$note.path.ToLowerInvariant()] = $true }
  $attachments = Get-ChildItem -LiteralPath $resolvedAttachments -Recurse -File | Where-Object {
    if ($_.Extension -ne ".md") { return $true }
    $candidate = To-WebPath($_.FullName.Substring($resolvedAttachments.Length + 1))
    $prefix = "$notesFolderName/"
    if ($candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { $candidate = $candidate.Substring($prefix.Length) }
    return -not $primaryNotePaths.ContainsKey($candidate.ToLowerInvariant())
  } | ForEach-Object {
    $relative = To-WebPath($_.FullName.Substring($resolvedAttachments.Length + 1))
    [ordered]@{ name = $_.Name; relative = "/$relative"; url = "attachments/$relative" }
  }
}

[System.IO.File]::WriteAllText((Join-Path $contentPath "notes.json"), ($notes | ConvertTo-Json -Depth 5), $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $contentPath "attachments.json"), (@($attachments) | ConvertTo-Json -Depth 5), $utf8NoBom)
Write-Output ("Indexed {0} notes and {1} attachments." -f @($notes).Count, @($attachments).Count)
