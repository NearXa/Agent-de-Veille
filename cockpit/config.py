"""Configuration du cockpit : racine du dépôt, variables d'environnement, chemins."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

COCKPIT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(os.environ.get("VEILLE_ROOT") or COCKPIT_DIR.parent).resolve()
load_dotenv(REPO_ROOT / ".env", override=False)

STORE_DIR = REPO_ROOT / "data" / "store"
RUNS_DIR = REPO_ROOT / "data" / "runs"
OUTPUT_DIR = REPO_ROOT / "output"
NOTION_IDS_FILE = REPO_ROOT / "notion" / "ids.json"

NOTION_TOKEN = os.environ.get("NOTION_TOKEN") or None
NOTION_PARENT_PAGE_ID = (os.environ.get("NOTION_PARENT_PAGE_ID") or "").replace("-", "").strip() or None
NOTION_API_VERSION = os.environ.get("NOTION_API_VERSION", "2025-09-03")
CACHE_TTL_SECONDS = 60

APP_TITLE = "Veille GRC"


def notion_configured() -> bool:
    """Vrai si le token et le fichier d'IDs des bases (écrit par `pnpm notion init`) existent."""
    return bool(NOTION_TOKEN) and NOTION_IDS_FILE.exists()
