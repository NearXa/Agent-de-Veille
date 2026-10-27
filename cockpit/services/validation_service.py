"""Actions de validation humaine : Valider, Corriger, Rejeter.

Chaque action écrit immédiatement dans Notion (page + commentaire d'audit). En mode local, l'action
est refusée avec un message clair : aucune écriture silencieuse hors Notion.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from models import Exigence
from services.notion_repo import NotionRepo


class ValidationRefusee(Exception):
    """Action impossible dans l'état courant (mode local, validateur manquant, champ obligatoire)."""


class ValidationService:
    def __init__(self, notion: NotionRepo | None, validateur: str) -> None:
        self.notion = notion
        self.validateur = (validateur or "").strip()

    def _check(self) -> NotionRepo:
        if self.notion is None:
            raise ValidationRefusee(
                "Écriture refusée : Notion est injoignable ou non configuré. "
                "Le cockpit est en lecture seule sur data/store/ et n'écrit jamais ailleurs que dans Notion."
            )
        if not self.validateur:
            raise ValidationRefusee("Indiquez votre nom dans le champ « Validateur » de la barre latérale.")
        return self.notion

    @staticmethod
    def horodatage() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def valider(self, exigence: Exigence, commentaire: str | None = None) -> None:
        notion = self._check()
        notion.ecrire_decision(exigence, "Validée", self.validateur, self.horodatage(), commentaire, None)

    def corriger(self, exigence: Exigence, champs: dict[str, Any], commentaire: str) -> None:
        notion = self._check()
        if not (commentaire or "").strip():
            raise ValidationRefusee("Un commentaire est obligatoire pour une correction.")
        if not champs:
            raise ValidationRefusee("Aucun champ modifié : rien à corriger.")
        notion.ecrire_decision(exigence, "Corrigée", self.validateur, self.horodatage(), commentaire, champs)

    def rejeter(self, exigence: Exigence, motif: str) -> None:
        notion = self._check()
        if not (motif or "").strip():
            raise ValidationRefusee("Un motif est obligatoire pour un rejet.")
        notion.ecrire_decision(exigence, "Rejetée", self.validateur, self.horodatage(), motif, None)
