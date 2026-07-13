<#
.SYNOPSIS
  Builds the self-contained F5-TTS runtime archive (Windows x64 / CUDA).

.DESCRIPTION
  Produces the download-on-demand runtime that src-tauri/src/tts.rs's F5 backend
  spawns (see the plan sec. C + resolve_f5_runtime's layout doc). This is a dev/CI
  build step - the archive is NOT bundled in the installer (it's ~3 GB); it's
  uploaded to a GitHub release and fetched on first F5 enable by the install
  manager (task #86), mirroring how Kokoro lazily downloads its ~200 MB model.

  The archive is a fully self-contained embeddable CPython - no Python install,
  no pip, no network needed on the user's machine at runtime. Layout produced:

    f5-runtime/
      python.exe                embeddable CPython (+ python3xx.zip stdlib, DLLs)
      Lib/site-packages/...      torch (cu124), torchaudio, f5-tts, soundfile, ...
      f5_cli.py                  the persistent worker (scripts/f5_cli.py)
      refs/<voice_id>.wav|.txt    Kokoro-bootstrapped clips (gen_f5_refs.py) plus, if
                                   -ArchetypeRefsDir is given, curated archetype clips
      model/model.safetensors     the F5 checkpoint      (tts.rs sets F5_CKPT)
      model/vocab.txt             its vocab              (tts.rs sets F5_VOCAB)

  Two ways to populate site-packages:
    * default (CI-reproducible): pip-install pinned versions into the embeddable
      interpreter - a clean-room build from PyPI + the PyTorch cu124 index.
    * -FromVenv <path> (fast local): copy an already-built venv's site-packages
      (skips pip resolution/download). Use the same venv the Rust integration
      test validated so the shipped package set is byte-identical to what was
      tested.

  Both yield the same self-contained result; -FromVenv just trades
  reproducibility for speed when iterating on this box.

.NOTES
  Windows PowerShell 5.1 compatible. Requires a network for the embeddable
  Python download (always) and the pip install (default path only).
#>
[CmdletBinding()]
param(
    # Where the staging dir + final zip are written.
    [string]$OutDir = (Join-Path $PSScriptRoot "..\build\f5-runtime"),

    # Embeddable CPython version. MUST match the minor version of the interpreter
    # whose wheels end up in site-packages (compiled extensions are cp3xx-ABI
    # specific), i.e. the -FromVenv venv's Python, or the pip default path's.
    [string]$PythonVersion = "3.12.10",

    # Fast path: copy this venv's Lib/site-packages instead of pip-installing.
    [string]$FromVenv = "",

    # Pinned package set (default pip path). Kept identical to the versions the
    # Rust f5_end_to_end integration test ran against.
    [string]$TorchSpec = "torch==2.6.0+cu124 torchaudio==2.6.0+cu124",
    [string]$TorchIndexUrl = "https://download.pytorch.org/whl/cu124",
    [string]$F5Spec = "f5-tts==1.1.21 soundfile==0.14.0",

    # Kokoro inputs for the reference-clip pack (gen_f5_refs.py drives this exe).
    [Parameter(Mandatory = $true)][string]$KokoroExe,
    [Parameter(Mandatory = $true)][string]$KokoroOnnx,
    [Parameter(Mandatory = $true)][string]$KokoroVoices,

    # Optional: a directory of curated <id>.wav/<id>.txt pairs (task #91's D&D
    # archetype voices - see ARCHETYPE_VOICES in tts.rs) merged into refs/
    # alongside the 28 Kokoro-bootstrapped ones. Omit to build the base-only
    # runtime.
    [string]$ArchetypeRefsDir = "",

    # F5 checkpoint (.safetensors). Defaults to the HuggingFace cache copy.
    [string]$F5Checkpoint = "",

    # Vocos vocoder dir (config.yaml + pytorch_model.bin). Defaults to the
    # HuggingFace cache copy. Bundled into the runtime so f5_cli.py never
    # needs to reach huggingface.co on a user's first synthesis - if this
    # isn't cached yet, run any F5 synthesis once locally first (it downloads
    # and caches "charactr/vocos-mel-24khz" automatically).
    [string]$VocoderDir = "",

    # Skip the (multi-GB, slow) final zip - leaves the staging dir for inspection
    # or a direct tts.rs F5_RUNTIME_DIR point-at during dev.
    [switch]$SkipZip
)

$ErrorActionPreference = "Stop"
function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$Runtime = Join-Path $OutDir "f5-runtime"
$Py = Join-Path $Runtime "python.exe"

# -- 0. Clean staging ------------------------------------------------------
Step "Staging in $Runtime"
if (Test-Path $Runtime) { Remove-Item $Runtime -Recurse -Force }
New-Item -ItemType Directory -Path $Runtime -Force | Out-Null

# -- 1. Embeddable CPython --------------------------------------------------
Step "Downloading embeddable Python $PythonVersion"
$embedUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$embedZip = Join-Path $OutDir "python-embed.zip"
Invoke-WebRequest -Uri $embedUrl -OutFile $embedZip
Expand-Archive -Path $embedZip -DestinationPath $Runtime -Force
Remove-Item $embedZip -Force
if (-not (Test-Path $Py)) { throw "embeddable python.exe not found after extract" }

# Enable site-packages: the embeddable dist ships with `import site` commented
# out and no site-packages on the path. Rewrite the ._pth so pip-installed (or
# copied) packages are importable.
Step "Enabling site-packages in ._pth"
$pth = Get-ChildItem -Path $Runtime -Filter "python*._pth" | Select-Object -First 1
$verNoDot = ($PythonVersion.Split('.')[0..1]) -join ''   # e.g. 312
@(
    "python$verNoDot.zip"
    "."
    "Lib\site-packages"
    ""
    "import site"
) | Set-Content -Path $pth.FullName -Encoding ASCII

$sitePackages = Join-Path $Runtime "Lib\site-packages"
New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null

# -- 2. Packages ------------------------------------------------------------
if ($FromVenv) {
    $venvSP = Join-Path $FromVenv "Lib\site-packages"
    if (-not (Test-Path $venvSP)) { throw "venv site-packages not found: $venvSP" }
    Step "Copying site-packages from venv ($venvSP)"
    # robocopy: fast multithreaded copy. Exit codes 0-7 are success; 8+ real
    # failure. Skip the venv-only bits (pip/setuptools scripts are fine to keep;
    # __pycache__ is regenerated as needed but copies fine too).
    robocopy $venvSP $sitePackages /E /MT:16 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
    $global:LASTEXITCODE = 0
} else {
    Step "Bootstrapping pip"
    $getpip = Join-Path $OutDir "get-pip.py"
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getpip
    & $Py $getpip --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw "get-pip failed" }
    Remove-Item $getpip -Force

    Step "pip install torch (cu124) - large, uses pip cache if warm"
    & $Py -m pip install --no-warn-script-location $TorchSpec.Split(' ') --index-url $TorchIndexUrl
    if ($LASTEXITCODE -ne 0) { throw "torch install failed" }

    Step "pip install f5-tts + soundfile"
    & $Py -m pip install --no-warn-script-location $F5Spec.Split(' ')
    if ($LASTEXITCODE -ne 0) { throw "f5-tts install failed" }
}

# -- 3. Worker script -------------------------------------------------------
Step "Copying f5_cli.py"
Copy-Item (Join-Path $PSScriptRoot "f5_cli.py") (Join-Path $Runtime "f5_cli.py") -Force

# -- 4. Model checkpoint + vocab --------------------------------------------
$modelDir = Join-Path $Runtime "model"
New-Item -ItemType Directory -Path $modelDir -Force | Out-Null

if (-not $F5Checkpoint) {
    $F5Checkpoint = Get-ChildItem "$env:USERPROFILE\.cache\huggingface\hub\models--SWivid--F5-TTS\snapshots\*\F5TTS_v1_Base\model_1250000.safetensors" -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $F5Checkpoint -or -not (Test-Path $F5Checkpoint)) {
    throw "F5 checkpoint not found - pass -F5Checkpoint <path to model_1250000.safetensors>"
}
Step "Copying F5 checkpoint ($([math]::Round((Get-Item $F5Checkpoint).Length/1GB,2)) GB)"
Copy-Item $F5Checkpoint (Join-Path $modelDir "model.safetensors") -Force

# vocab.txt ships inside the f5_tts package (infer/examples/vocab.txt) - grab it
# from the site-packages we just populated so it always matches the installed
# f5-tts version.
$vocab = Get-ChildItem (Join-Path $sitePackages "f5_tts") -Recurse -Filter "vocab.txt" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $vocab) { throw "vocab.txt not found under f5_tts in site-packages" }
Copy-Item $vocab.FullName (Join-Path $modelDir "vocab.txt") -Force

# -- 4b. Vocos vocoder --------------------------------------------------------
# Bundled (not left to f5_tts's live HF Hub download) so a user's FIRST
# synthesis after installing this archive needs no network beyond the initial
# download - matching the "no network needed at runtime" promise above.
if (-not $VocoderDir) {
    $VocoderDir = Get-ChildItem "$env:USERPROFILE\.cache\huggingface\hub\models--charactr--vocos-mel-24khz\snapshots\*" -Directory -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $VocoderDir -or -not (Test-Path (Join-Path $VocoderDir "config.yaml"))) {
    throw "Vocos vocoder files not found - pass -VocoderDir <dir with config.yaml + pytorch_model.bin>, or run any F5 synthesis once locally first so f5-tts downloads and caches it"
}
Step "Bundling Vocos vocoder from $VocoderDir"
$vocoderOutDir = Join-Path $Runtime "vocoder"
New-Item -ItemType Directory -Path $vocoderOutDir -Force | Out-Null
Copy-Item (Join-Path $VocoderDir "config.yaml") (Join-Path $vocoderOutDir "config.yaml") -Force
Copy-Item (Join-Path $VocoderDir "pytorch_model.bin") (Join-Path $vocoderOutDir "pytorch_model.bin") -Force

# -- 5. Reference-clip pack -------------------------------------------------
Step "Generating Kokoro-bootstrapped reference clips"
& $Py (Join-Path $PSScriptRoot "gen_f5_refs.py") $KokoroExe $KokoroOnnx $KokoroVoices (Join-Path $Runtime "refs")
if ($LASTEXITCODE -ne 0) { throw "reference-clip generation failed" }

# -- 5b. Curated archetype reference clips (task #91, optional) -------------
# 80 hand-picked D&D archetype voices (5 male + 5 female x 8 buckets), cloned
# from real VCTK Corpus recordings rather than Kokoro-bootstrapped - see
# ARCHETYPE_VOICES in tts.rs. Collides-with-base-catalog is treated as a hard
# error (an id must own exactly one clip), not a silent overwrite.
if ($ArchetypeRefsDir) {
    Step "Merging curated archetype reference clips from $ArchetypeRefsDir"
    if (-not (Test-Path $ArchetypeRefsDir)) { throw "ArchetypeRefsDir not found: $ArchetypeRefsDir" }
    $refsDir = Join-Path $Runtime "refs"
    $archetypeWavs = Get-ChildItem -Path $ArchetypeRefsDir -Filter "*.wav"
    if ($archetypeWavs.Count -eq 0) { throw "no .wav files found in $ArchetypeRefsDir" }
    foreach ($wav in $archetypeWavs) {
        $destWav = Join-Path $refsDir $wav.Name
        if (Test-Path $destWav) { throw "archetype id collides with base catalog: $($wav.Name)" }
        $txtName = [System.IO.Path]::ChangeExtension($wav.Name, ".txt")
        $srcTxt = Join-Path $ArchetypeRefsDir $txtName
        if (-not (Test-Path $srcTxt)) { throw "missing transcript for $($wav.Name): $srcTxt" }
        Copy-Item $wav.FullName $destWav -Force
        Copy-Item $srcTxt (Join-Path $refsDir $txtName) -Force
    }
    $totalRefs = (Get-ChildItem -Path $refsDir -Filter "*.wav").Count
    Step "Refs pack now has $totalRefs voices ($($archetypeWavs.Count) archetype + $($totalRefs - $archetypeWavs.Count) base)"
}

# -- 6. Smoke-test the assembled runtime ------------------------------------
Step "Smoke test: import torch + CUDA visibility from the embeddable interpreter"
$env:F5_CKPT = Join-Path $modelDir "model.safetensors"
$env:F5_VOCAB = Join-Path $modelDir "vocab.txt"
& $Py -c "import torch, f5_tts, soundfile; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) { throw "runtime smoke test failed - the archive python cannot import the stack" }

# -- 7. Zip -----------------------------------------------------------------
if ($SkipZip) {
    Step "Done (staging only, -SkipZip). Runtime at: $Runtime"
    return
}
$zip = Join-Path $OutDir "f5-runtime-win-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Step "Zipping to $zip (this is the slow part - multi-GB)"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Entries are added by hand with FORWARD-SLASH names. .NET Framework's
# ZipFile.CreateFromDirectory writes backslash separators (non-conformant with
# the ZIP spec), which the Rust `zip` crate the install manager uses (task #86)
# then treats as literal filename characters rather than path separators --
# extracting a flat pile of "f5-runtime\python.exe"-named files instead of a
# tree. Forward slashes keep the archive portable across every extractor. Names
# are rooted at "f5-runtime/" (relative to $Runtime's parent) so the archive
# extracts into app-data/f5-runtime/, exactly where resolve_f5_runtime looks.
# Fastest, not Optimal: the bulk (torch's CUDA DLLs + the safetensors
# checkpoint) is already-incompressible, so Optimal buys little for much more time.
$parent = Split-Path $Runtime -Parent
$zipStream = [System.IO.File]::Open($zip, [System.IO.FileMode]::CreateNew)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -Path $Runtime -Recurse -File | ForEach-Object {
            $entryName = $_.FullName.Substring($parent.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $_.FullName, $entryName,
                [System.IO.Compression.CompressionLevel]::Fastest) | Out-Null
        }
    } finally { $archive.Dispose() }
} finally { $zipStream.Dispose() }

$sizeGb = [math]::Round((Get-Item $zip).Length / 1GB, 2)
$sha = (Get-FileHash $zip -Algorithm SHA256).Hash
Step "Built $zip"
Write-Host "  size:   $sizeGb GB"
Write-Host "  sha256: $sha"

# -- 8. Split into <2GB parts (GitHub Releases hard-caps a single asset at 2GB;
#       this archive is several times that) -----------------------------------
#
# Confirmed against GitHub's own docs/community threads: the release-asset
# limit is 2GB per FILE, the same on every plan (free or paid) -- there is no
# tier that unlocks a bigger single asset. So the zip built above can never be
# uploaded as one file; splitting it and reassembling client-side (see
# download_multipart_with_progress in tts.rs) is what keeps this on GitHub
# Releases at all, matching Kokoro's existing "lazy download, cache forever"
# hosting rather than standing up a separate large-file host.
Step "Splitting into sub-2GB parts (GitHub release-asset limit)"
$partSizeBytes = 1800000000  # ~1.8GB decimal -- comfortable margin under the
                              # 2GB cap regardless of GitHub's GB-vs-GiB rounding
$partPaths = New-Object System.Collections.Generic.List[string]
$reader = [System.IO.File]::OpenRead($zip)
try {
    $buf = New-Object byte[] (4 * 1MB)
    $partIndex = 1
    $writer = $null
    $writtenInPart = 0
    while ($true) {
        $n = $reader.Read($buf, 0, $buf.Length)
        if ($n -eq 0) { break }
        if ($null -eq $writer -or $writtenInPart -ge $partSizeBytes) {
            if ($null -ne $writer) { $writer.Dispose() }
            $partName = "f5-runtime-win-x64.zip.{0:D3}" -f $partIndex
            $partPath = Join-Path $OutDir $partName
            if (Test-Path $partPath) { Remove-Item -LiteralPath $partPath -Force }
            $writer = [System.IO.File]::Create($partPath)
            $partPaths.Add($partPath) | Out-Null
            $partIndex++
            $writtenInPart = 0
        }
        $writer.Write($buf, 0, $n)
        $writtenInPart += $n
    }
} finally {
    if ($null -ne $writer) { $writer.Dispose() }
    $reader.Dispose()
}

Step "Writing manifest (totalBytes/sha256/parts -- the install manager fetches this first)"
$partNames = $partPaths | ForEach-Object { Split-Path $_ -Leaf }
$manifest = [ordered]@{
    totalBytes = (Get-Item $zip).Length
    sha256     = $sha.ToLower()
    parts      = $partNames
}
$manifestPath = Join-Path $OutDir "f5-runtime-win-x64.manifest.json"
# NOT Set-Content -Encoding utf8: on Windows PowerShell 5.1 that ALWAYS
# prepends a UTF-8 BOM (unlike PowerShell 7+), and serde_json's into_json()
# does not skip a leading BOM -- it fails immediately with "expected value at
# line 1 column 1", which is exactly what shipped and broke fetch_manifest
# against the real release. WriteAllText with an explicit BOM-less UTF8Encoding
# is the one reliable way to avoid this on 5.1.
$manifestJson = $manifest | ConvertTo-Json
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Upload ALL of these to the GitHub release (NOT the whole f5-runtime-win-x64.zip" -ForegroundColor Cyan
Write-Host "above -- that's kept locally only for convenience, e.g. re-running the ignored" -ForegroundColor Cyan
Write-Host "extract_real_f5_archive Rust test without re-splitting):" -ForegroundColor Cyan
Write-Host "  $manifestPath"
foreach ($p in $partPaths) { Write-Host "  $p" }
Write-Host "-> wire the release tag into F5_RUNTIME_RELEASE_BASE_URL in tts.rs if it differs from f5-runtime-v1."
