# Parcours de démonstration (étapes 1 à 5) avec cache LLM activé, équivalent PowerShell de demo.sh.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$env:LLM_CACHE = "1"
pnpm agent demo @args
