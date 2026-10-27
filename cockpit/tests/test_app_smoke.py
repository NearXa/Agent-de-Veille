"""Démarrage du cockpit sans exception (AppTest exécute app.py en mode headless)."""

from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parents[1] / "app.py"


def test_app_demarre_sans_exception():
    at = AppTest.from_file(str(APP), default_timeout=60)
    at.run()
    assert not at.exception, [e.value for e in at.exception]
    assert any("Veille GRC" in t.value for t in at.sidebar.title)
