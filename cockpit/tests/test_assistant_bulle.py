"""Bulle de l'assistant GRC dans le cockpit (AppTest headless, faux client, store local)."""

from datetime import date
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

from services import assistant as service
from services import data
from services.assistant import MESSAGE_HORS_PERIMETRE, AssistantGRC
from services.local_repo import LocalRepo
from tests.faux_anthropic import FauxClient, appel_outil, texte, tour

APP = Path(__file__).resolve().parents[1] / "app.py"


@pytest.fixture
def cockpit_local(monkeypatch):
    """Données lues dans data/store/ sans passer par Notion, et faux client Anthropic."""
    bundle = {"source": "Store local (lecture seule)", "writable": False, "error": None, **data._lire(LocalRepo())}
    monkeypatch.setattr(data, "load_bundle", lambda: bundle)

    def brancher(client):
        monkeypatch.setattr(
            service,
            "creer_assistant",
            lambda source, aujourdhui=None: AssistantGRC(client, source, organisation="Aurelia Gestion d'Actifs", aujourdhui=date(2026, 10, 29)),
        )
        at = AppTest.from_file(str(APP), default_timeout=60)
        at.run()
        assert not at.exception, [e.value for e in at.exception]
        return at

    return brancher


def test_bulle_presente_avec_suggestions(cockpit_local):
    at = cockpit_local(FauxClient())
    assert len(at.chat_input) == 1 and at.chat_input[0].placeholder == "Votre question GRC…"
    libelles = [b.label for b in at.button]
    assert "Quels risques ont un niveau résiduel critique ?" in libelles and "Nouvelle conversation" in libelles


def test_bulle_refuse_une_question_hors_grc(cockpit_local):
    client = FauxClient(categorie="hors_perimetre")
    at = cockpit_local(client)
    at.chat_input[0].set_value("Comment reverse une string ?").run()
    assert not at.exception, [e.value for e in at.exception]
    assert [w.value for w in at.warning] == [MESSAGE_HORS_PERIMETRE]
    assert client.messages.appels_stream == []
    assert at.session_state["assistant_grc"]["api"] == []  # rien n'est envoyé au modèle de réponse


def test_bulle_repond_a_une_question_grc(cockpit_local):
    tours = [
        tour([appel_outil("toolu_1", "lister_risques", {"niveau_residuel": "Critique"})], "tool_use"),
        tour([texte("Trois risques critiques : **RK-0004**, **RK-0007** et **RK-0034**.")], "end_turn"),
    ]
    client = FauxClient(categorie="grc", tours=tours)
    at = cockpit_local(client)
    at.chat_input[0].set_value("Quels risques ont un niveau résiduel critique ?").run()
    assert not at.exception, [e.value for e in at.exception]
    assert any("RK-0004" in m.value for m in at.markdown)
    assert any("Lecture des risques" in c.value for c in at.caption)
    etat = at.session_state["assistant_grc"]
    assert [m["role"] for m in etat["api"]] == ["user", "assistant", "user", "assistant"]
    assert etat["cout"] > 0
    # Le résultat de l'outil vient du store réel : les trois risques critiques du projet.
    resultat = client.messages.appels_stream[1]["messages"][-1]["content"][0]["content"]
    assert all(rk in resultat for rk in ("RK-0004", "RK-0007", "RK-0034"))


def test_style_de_la_bulle_accepte_par_st_html():
    """st.html (DOMPurify) supprime une balise style dont le texte contient « < » suivi d'une lettre."""
    from views.assistant import STYLE

    contenu = STYLE.removeprefix("<style>").removesuffix("</style>")
    assert STYLE.startswith("<style>") and STYLE.endswith("</style>")
    assert "<" not in contenu and ">" not in contenu.replace("> .st-key", "")
