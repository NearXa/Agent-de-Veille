#!/usr/bin/env bash
# Parcours de démonstration (étapes 1 à 5) avec cache LLM activé. Étape 6 : pnpm cockpit.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
export LLM_CACHE=1
pnpm agent demo "$@"
