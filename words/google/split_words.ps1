# split_words.ps1
# Reads the first *.txt file in this folder (one word per line)
# Splits into chunks of 100, writes each chunk to <name>_bands/1.txt, 2.txt, ...
# Each output file: 100 words space-separated on a single line.

$ErrorActionPreference = 'Stop'

try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

    # Find first .txt file in script folder (non-recursive, top-level only)
    $inputFile = Get-ChildItem -Path $scriptDir -Filter *.txt -File |
        Sort-Object Name |
        Select-Object -First 1

    if (-not $inputFile) {
        Write-Host "No .txt file found in: $scriptDir" -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }

    Write-Host "Reading: $($inputFile.Name)" -ForegroundColor Cyan

    # Read all words (one per line), trim, drop blanks
    $words = Get-Content -Path $inputFile.FullName -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne '' }

    if ($words.Count -eq 0) {
        Write-Host "Input file is empty." -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($inputFile.Name)
    $outDir   = Join-Path $scriptDir ($baseName + "_bands")
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null

    $chunkSize   = 100
    $totalChunks = [math]::Ceiling($words.Count / $chunkSize)

    for ($i = 0; $i -lt $totalChunks; $i++) {
        $start = $i * $chunkSize
        $end   = [math]::Min($start + $chunkSize, $words.Count) - 1
        $chunk = $words[$start..$end]
        $line  = ($chunk -join ' ')
        $outPath = Join-Path $outDir ("{0}.txt" -f ($i + 1))
        # -NoNewline keeps file as a single line
        Set-Content -Path $outPath -Value $line -Encoding UTF8 -NoNewline
    }

    Write-Host ""
    Write-Host "Done. $($words.Count) words -> $totalChunks file(s)" -ForegroundColor Green
    Write-Host "Output: $outDir" -ForegroundColor Green
}
catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
finally {
    Read-Host "Press Enter to exit"
}
