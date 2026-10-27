#!/usr/bin/env bash
# Installation du projet (Linux / WSL2) : pnpm via corepack, dépendances Node, venv Python, .env.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Veille GRC : installation =="
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 ou plus est requis (AI SDK 7)." >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 ou plus est requis (AI SDK 7), version détectée : $(node --version)" >&2
  exit 1
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm absent : activation via corepack dans ~/.local/bin"
  mkdir -p "$HOME/.local/bin"
  corepack enable --install-directory "$HOME/.local/bin" pnpm
  export PATH="$HOME/.local/bin:$PATH"
  echo 'Pensez à ajouter ~/.local/bin à votre PATH : export PATH="$HOME/.local/bin:$PATH"'
fi
pnpm install

PYTHON_BIN="${PYTHON:-python3}"
if [ ! -d .venv ]; then
  "$PYTHON_BIN" -m venv .venv
fi
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install -r cockpit/requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env créé à partir de .env.example : renseignez ANTHROPIC_API_KEY, NOTION_TOKEN et NOTION_PARENT_PAGE_ID."
fi

echo
echo "Installation terminée. Vérification : pnpm agent config"
