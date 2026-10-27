"""Décision humaine du cadre de gouvernance : écrite dans Notion (lots + page « Décision de gouvernance »)
et dans output/gouvernance/decision.json. Refusée en mode local, comme les validations."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from config import OUTPUT_DIR
from models import Decision, Lot, Recommandation
from services.notion_repo import NotionRepo

CADRES = ("TOGAF", "ITIL", "Hybride")


class DecisionRefusee(Exception):
    """Décision impossible dans l'état courant."""


class GouvernanceService:
    def __init__(self, notion: NotionRepo | None, auteur: str, output_dir: Path = OUTPUT_DIR) -> None:
        self.notion = notion
        self.auteur = (auteur or "").strip()
        self.output_dir = Path(output_dir)

    def enregistrer(self, cadre: str, commentaire: str | None, lots: list[Lot], recommandation: Recommandation | None) -> Decision:
        if self.notion is None:
            raise DecisionRefusee("Écriture refusée : Notion est injoignable ou non configuré (aucune écriture silencieuse hors Notion).")
        if not self.auteur:
            raise DecisionRefusee("Indiquez votre nom dans le champ « Validateur » de la barre latérale.")
        if cadre not in CADRES:
            raise DecisionRefusee(f"Cadre inconnu : {cadre}")
        date = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.notion.ecrire_decision_gouvernance(cadre, self.auteur, date, commentaire, lots)
        decision = Decision(
            cadre=cadre,
            auteur=self.auteur,
            date=date,
            commentaire=(commentaire or "").strip() or None,
            texte_id=recommandation.texte_id if recommandation else None,
            recommandation_run_id=recommandation.run_id if recommandation else None,
        )
        path = self.output_dir / "gouvernance" / "decision.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(decision.model_dump(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return decision
