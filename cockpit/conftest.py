"""Rend les modules du cockpit importables depuis pytest lancé à la racine du dépôt."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
