"""Démarrage du cockpit sans exception (AppTest exécute app.py en mode headless)."""

from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parents[1] / "app.py"


def test_app_demarre_sans_exception():
    at = AppTest.from_file(str(APP), default_timeout=60)
    at.run()
    assert not at.exception, [e.value for e in at.exception]
    assert any("Veille GRC" in t.value for t in at.sidebar.title)


def test_fil_de_veille_masque_les_textes_non_applicables(monkeypatch):
    """Les textes « Non » applicables ne sont pas présélectionnés dans le filtre, et le nombre masqué est indiqué."""
    from services import data
    from services.local_repo import LocalRepo

    bundle = {"source": "Store local (lecture seule)", "writable": False, "error": None, **data._lire(LocalRepo())}
    bundle["textes"] = [dict(t) for t in bundle["textes"]]
    bundle["textes"][-1]["applicable"] = "Non"
    monkeypatch.setattr(data, "load_bundle", lambda: bundle)
    at = AppTest.from_file(str(APP), default_timeout=60)
    at.run()
    assert not at.exception, [e.value for e in at.exception]
    filtre = next(m for m in at.multiselect if m.label == "Applicabilité")
    assert "Non" in filtre.options and "Non" not in filtre.value
    assert any("non applicable(s) masqué(s)" in c.value for c in at.caption)
