"""Helpers d'affichage partagés par les vues."""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd

from models import Exigence

COULEURS_CONFIANCE = {"vert": "🟢", "orange": "🟠", "rouge": "🔴"}


def format_date_fr(value: str | None) -> str:
    """ISO 8601 (jour ou horodatage) → JJ/MM/AAAA[ HH:MM]."""
    if not value:
        return "—"
    try:
        if len(value) == 10:
            return date.fromisoformat(value).strftime("%d/%m/%Y")
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
    except ValueError:
        return value


def badge_confiance(exigence: Exigence) -> str:
    return f"{COULEURS_CONFIANCE[exigence.niveau_confiance]} {exigence.confiance:.2f}"


def exigences_dataframe(exigences: list[Exigence]) -> pd.DataFrame:
    rows = [
        {
            "ID": e.id,
            "Titre": e.titre,
            "Article(s)": " ; ".join(e.articles),
            "Type": e.type_obligation,
            "Échéance": format_date_fr(e.echeance.date if e.echeance else None),
            "Confiance": round(e.confiance, 2),
            "Vérifié": "oui" if e.verifie_dans_source else "non",
            "Statut": e.statut_validation,
        }
        for e in exigences
    ]
    return pd.DataFrame(rows)
