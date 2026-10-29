"""Modèles pydantic, miroirs des schémas Zod de `agent/src/store/types.ts`."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

StatutValidation = Literal["À valider", "Validée", "Corrigée", "Rejetée", "À revalider"]
TypeObligation = Literal[
    "Obligation de faire",
    "Interdiction",
    "Notification",
    "Documentaire",
    "Gouvernance",
    "Contractuelle",
    "Technique",
]
NiveauSanction = Literal["Faible", "Moyen", "Élevé", "Critique", "Non précisé"]
TypeEcheance = Literal[
    "Entrée en application",
    "Transposition",
    "Délai de notification",
    "Périodique",
    "Non précisée",
]

STATUTS_A_TRAITER: tuple[str, ...] = ("À valider", "À revalider")
ORDRE_SANCTION: dict[str, int] = {
    "Critique": 4,
    "Élevé": 3,
    "Moyen": 2,
    "Faible": 1,
    "Non précisé": 0,
}


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Article(_Base):
    numero: str
    titre: str | None = None
    contenu: str = ""
    ancre: str | None = None
    type: str = "article"
    position: int = 0


class Texte(_Base):
    id: str
    source: str
    reference: str
    titre: str
    type: str
    url_officielle: str
    urls_connues: list[str] = Field(default_factory=list)
    date_publication: str | None = None
    date_entree_en_vigueur: str | None = None
    date_entree_en_application: str | None = None
    statut_texte: str = "En vigueur"
    hash_sha256: str = ""
    collecte_le: str = ""
    derniere_modification_detectee: str | None = None
    fichier_source: str | None = None
    applicable: str = "À déterminer"
    justification_applicabilite: str | None = None
    confiance_applicabilite: float | None = None
    resume: str | None = None
    nombre_articles: int = 0
    articles: list[Article] = Field(default_factory=list)
    run_id: str = ""
    version: int = 1
    historique: list[dict[str, Any]] = Field(default_factory=list)


class Echeance(_Base):
    date: str | None = None
    type: TypeEcheance = "Non précisée"
    texte_source: str | None = None


class Sanction(_Base):
    description: str = ""
    niveau: NiveauSanction = "Non précisé"
    article: str | None = None


class ConfianceDetail(_Base):
    llm: float = 0.0
    verbatim_retrouve: int = 0
    article_existe: int = 0


class Exigence(_Base):
    id: str
    texte_id: str
    titre: str
    description: str
    articles: list[str] = Field(default_factory=list)
    extrait_verbatim: str = ""
    url_article: str | None = None
    verifie_dans_source: bool = False
    type_obligation: TypeObligation = "Obligation de faire"
    destinataires: list[str] = Field(default_factory=list)
    echeance: Echeance | None = None
    sanction: Sanction | None = None
    confiance: float = 0.0
    confiance_detail: ConfianceDetail = Field(default_factory=ConfianceDetail)
    justification_confiance: str | None = None
    statut_validation: StatutValidation = "À valider"
    validateur: str | None = None
    date_validation: str | None = None
    commentaire_validation: str | None = None
    version_corrigee: dict[str, Any] | None = None
    processus_impactes: list[str] = Field(default_factory=list)
    systemes_impactes: list[str] = Field(default_factory=list)
    donnees_concernees: list[str] = Field(default_factory=list)
    contrats_concernes: list[str] = Field(default_factory=list)
    departements_impactes: list[str] = Field(default_factory=list)
    effort_estime: str | None = None
    impact_justification: str | None = None
    couverture: str = "À évaluer"
    couverture_detail: list[dict[str, Any]] = Field(default_factory=list)
    couverture_justification: str | None = None
    lot_propose: str | None = None
    revalidation_motif: str | None = None
    controles_ids: list[str] = Field(default_factory=list)
    risques_ids: list[str] = Field(default_factory=list)
    jurisprudence_ids: list[str] = Field(default_factory=list)
    lots_ids: list[str] = Field(default_factory=list)
    run_id: str = ""
    chunk_id: str | None = None
    avertissements: list[str] = Field(default_factory=list)
    notion_page_id: str | None = None
    relations_notion: dict[str, list[str]] = Field(default_factory=dict)

    @property
    def niveau_confiance(self) -> str:
        """vert (≥ 0,8), orange (0,6 à 0,8) ou rouge (< 0,6), selon la spec."""
        if self.confiance >= 0.8:
            return "vert"
        if self.confiance >= 0.6:
            return "orange"
        return "rouge"

    @property
    def a_relire_en_priorite(self) -> bool:
        return self.confiance < 0.6 or not self.verifie_dans_source


class Validation(_Base):
    id: str
    exigence_id: str
    action: str
    validateur: str
    date: str
    commentaire: str | None = None
    champs_modifies: dict[str, Any] | None = None
    source: str = "cockpit"


class RunMetrics(_Base):
    run_id: str
    kind: str = ""
    started_at: str = ""
    finished_at: str | None = None
    duration_ms: int | None = None
    status: str = ""
    llm: dict[str, Any] = Field(default_factory=dict)
    counts: dict[str, int] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


def cle_file_validation(exigence: Exigence) -> tuple[float, str, int]:
    """Tri de la file de validation : confiance croissante, échéance proche, sanction élevée."""
    echeance = exigence.echeance.date if exigence.echeance and exigence.echeance.date else "9999-12-31"
    niveau = exigence.sanction.niveau if exigence.sanction else "Non précisé"
    return (exigence.confiance, echeance, -ORDRE_SANCTION.get(niveau, 0))


class Controle(_Base):
    id: str
    nom: str
    description: str = ""
    referentiel: str = ""
    reference: str = ""
    proprietaire: str = ""
    statut: str = "Absent"
    efficacite: str = "Non évaluée"
    preuves: str | None = None
    exigences_ids: list[str] = Field(default_factory=list)
    risques_ids: list[str] = Field(default_factory=list)
    ecart_constate: str | None = None
    run_id: str | None = None
    notion_page_id: str | None = None


class Risque(_Base):
    id: str
    exigence_id: str
    intitule: str
    scenario: str = ""
    categorie: str = "Opérationnel"
    probabilite: int = 1
    impact: int = 1
    criticite_brute: int = 1
    justification_scores: str | None = None
    controles_attenuants: list[str] = Field(default_factory=list)
    risque_residuel: int = 1
    niveau_residuel: str = "Faible"
    traitement: str = "Réduire"
    proprietaire: str = ""
    statut: str = "Identifié"
    lots_ids: list[str] = Field(default_factory=list)
    run_id: str = ""
    notion_page_id: str | None = None


class Jurisprudence(_Base):
    id: str
    juridiction: str = "Autre"
    numero: str = ""
    date_decision: str | None = None
    url_officielle: str = ""
    resume: str = ""
    solution_retenue: str | None = None
    portee: str | None = None
    pertinence: float = 0.0
    exigences_ids: list[str] = Field(default_factory=list)
    mots_cles: list[str] = Field(default_factory=list)
    source: str = "judilibre"
    source_id: str | None = None
    run_id: str = ""
    notion_page_id: str | None = None


class Lot(_Base):
    id: str
    titre: str
    description: str = ""
    exigences_ids: list[str] = Field(default_factory=list)
    risques_ids: list[str] = Field(default_factory=list)
    priorite: str = "P3"
    responsable: str = ""
    echeance_cible: str | None = None
    statut: str = "À planifier"
    cadre_gouvernance: str = "Hybride"
    phase_ou_pratique: str = ""
    livrable_attendu: str = ""
    effort: str = "Moyen"
    run_id: str = ""
    notion_page_id: str | None = None


class Recommandation(_Base):
    texte_id: str | None = None
    run_id: str | None = None
    genere_le: str | None = None
    repartition: dict[str, int] = Field(default_factory=dict)
    cadre_recommande: str
    score_togaf: float = 0
    score_itil: float = 0
    criteres: list[dict[str, Any]] = Field(default_factory=list)
    justification: str = ""
    mapping: list[dict[str, Any]] = Field(default_factory=list)
    alternatives: str = ""
    points_de_decision_humaine: list[str] = Field(default_factory=list)
    lots: list[str] = Field(default_factory=list)


class Decision(_Base):
    cadre: str
    auteur: str
    date: str
    commentaire: str | None = None
    texte_id: str | None = None
    recommandation_run_id: str | None = None
