"""Lecture seule de `data/store/*.json` : mode dégradé quand Notion est injoignable."""

from __future__ import annotations

import json
from pathlib import Path

from config import OUTPUT_DIR, RUNS_DIR, STORE_DIR
from models import Controle, Decision, Exigence, Jurisprudence, Lot, Recommandation, Risque, RunMetrics, Texte, Validation


class LocalRepo:
    label = "Store local (lecture seule)"
    writable = False

    def __init__(self, store_dir: Path = STORE_DIR, runs_dir: Path = RUNS_DIR, output_dir: Path = OUTPUT_DIR) -> None:
        self.store_dir = Path(store_dir)
        self.runs_dir = Path(runs_dir)
        self.output_dir = Path(output_dir)

    def _read(self, name: str) -> list[dict]:
        path = self.store_dir / f"{name}.json"
        if not path.exists():
            return []
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError(f"{path} doit contenir un tableau JSON")
        return data

    def ping(self) -> None:
        """Le store local est toujours disponible (même vide)."""

    def textes(self) -> list[Texte]:
        return [Texte.model_validate(item) for item in self._read("textes")]

    def exigences(self) -> list[Exigence]:
        return [Exigence.model_validate(item) for item in self._read("exigences")]

    def validations(self) -> list[Validation]:
        return [Validation.model_validate(item) for item in self._read("validations")]

    def dernier_run(self) -> RunMetrics | None:
        if not self.runs_dir.exists():
            return None
        for run_dir in sorted(self.runs_dir.iterdir(), reverse=True):
            metrics = run_dir / "metrics.json"
            if run_dir.is_dir() and run_dir.name.startswith("RUN-") and metrics.exists():
                return RunMetrics.model_validate(json.loads(metrics.read_text(encoding="utf-8")))
        return None

    def controles(self) -> list[Controle]:
        return [Controle.model_validate(item) for item in self._read("controles")]

    def risques(self) -> list[Risque]:
        return [Risque.model_validate(item) for item in self._read("risques")]

    def jurisprudence(self) -> list[Jurisprudence]:
        return [Jurisprudence.model_validate(item) for item in self._read("jurisprudence")]

    def lots(self) -> list[Lot]:
        return [Lot.model_validate(item) for item in self._read("lots")]

    def _read_output_json(self, name: str) -> dict | None:
        path = self.output_dir / "gouvernance" / name
        if not path.exists():
            return None
        raw = path.read_text(encoding="utf-8").strip()
        return json.loads(raw) if raw else None

    def recommandation(self) -> Recommandation | None:
        data = self._read_output_json("recommandation.json")
        return Recommandation.model_validate(data) if data else None

    def decision(self) -> Decision | None:
        data = self._read_output_json("decision.json")
        return Decision.model_validate(data) if data else None

    def plan_markdown(self) -> str | None:
        path = self.output_dir / "gouvernance" / "plan-gouvernance.md"
        return path.read_text(encoding="utf-8") if path.exists() else None
