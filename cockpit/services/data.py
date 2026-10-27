"""Couche de données du cockpit : Notion si disponible, sinon repli sur le store local.

Le résultat est mis en cache 60 secondes (`st.cache_data`) ; le bouton « Rafraîchir » vide le cache.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

from config import CACHE_TTL_SECONDS
from models import Controle, Decision, Exigence, Jurisprudence, Lot, Recommandation, Risque, RunMetrics, Texte, Validation
from services.local_repo import LocalRepo
from services.notion_repo import NotionRepo


def backend() -> tuple[LocalRepo | NotionRepo, str | None]:
    """Choisit la source : Notion si configuré et joignable, sinon le store local."""
    notion = NotionRepo.from_env()
    if notion is None:
        return LocalRepo(), None
    try:
        notion.ping()
        return notion, None
    except Exception as error:  # noqa: BLE001 - tout échec réseau déclenche le repli
        return LocalRepo(), f"Notion injoignable ({error.__class__.__name__}), repli sur data/store/"


@st.cache_data(ttl=CACHE_TTL_SECONDS, show_spinner="Chargement des données…")
def load_bundle() -> dict[str, Any]:
    repo, error = backend()
    try:
        collections = _lire(repo)
    except Exception as lecture:  # noqa: BLE001 - toute erreur de lecture Notion déclenche le repli
        repo, error = LocalRepo(), f"lecture Notion impossible ({lecture.__class__.__name__}), repli sur data/store/"
        collections = _lire(repo)
    return {"source": repo.label, "writable": repo.writable, "error": error, **collections}


def _lire(repo: LocalRepo | NotionRepo) -> dict[str, Any]:
    textes = repo.textes()
    exigences = repo.exigences()
    controles = repo.controles()
    risques = repo.risques()
    jurisprudence = repo.jurisprudence()
    lots = repo.lots()
    if isinstance(repo, NotionRepo):
        NotionRepo.lier(exigences, controles, risques, lots, jurisprudence)
    run = repo.dernier_run()
    recommandation = repo.recommandation()
    decision = repo.decision()
    return {
        "textes": [t.model_dump() for t in textes],
        "exigences": [e.model_dump() for e in exigences],
        "validations": [v.model_dump() for v in repo.validations()],
        "controles": [c.model_dump() for c in controles],
        "risques": [r.model_dump() for r in risques],
        "jurisprudence": [j.model_dump() for j in jurisprudence],
        "lots": [l.model_dump() for l in lots],
        "dernier_run": run.model_dump() if run else None,
        "recommandation": recommandation.model_dump() if recommandation else None,
        "decision": decision.model_dump() if decision else None,
        "plan_markdown": repo.plan_markdown(),
    }


def clear_cache() -> None:
    load_bundle.clear()


def textes() -> list[Texte]:
    return [Texte.model_validate(t) for t in load_bundle()["textes"]]


def exigences() -> list[Exigence]:
    return [Exigence.model_validate(e) for e in load_bundle()["exigences"]]


def validations() -> list[Validation]:
    return [Validation.model_validate(v) for v in load_bundle()["validations"]]


def dernier_run() -> RunMetrics | None:
    run = load_bundle()["dernier_run"]
    return RunMetrics.model_validate(run) if run else None


def source_label() -> str:
    return load_bundle()["source"]


def is_writable() -> bool:
    return bool(load_bundle()["writable"])


def controles() -> list[Controle]:
    return [Controle.model_validate(c) for c in load_bundle()["controles"]]


def risques() -> list[Risque]:
    return [Risque.model_validate(r) for r in load_bundle()["risques"]]


def jurisprudence() -> list[Jurisprudence]:
    return [Jurisprudence.model_validate(j) for j in load_bundle()["jurisprudence"]]


def lots() -> list[Lot]:
    return [Lot.model_validate(l) for l in load_bundle()["lots"]]


def recommandation() -> Recommandation | None:
    r = load_bundle()["recommandation"]
    return Recommandation.model_validate(r) if r else None


def decision() -> Decision | None:
    d = load_bundle()["decision"]
    return Decision.model_validate(d) if d else None


def plan_markdown() -> str | None:
    return load_bundle()["plan_markdown"]
