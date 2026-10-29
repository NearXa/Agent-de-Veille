"""Outils de lecture exposés à l'assistant GRC du cockpit.

Chaque outil lit les données affichées par le cockpit (Notion, ou repli sur data/store/) et renvoie un JSON
compact. Aucun outil n'écrit : valider, corriger ou décider reste dans les vues du cockpit.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter
from collections.abc import Callable, Iterable
from datetime import date
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from models import Controle, Decision, Exigence, Jurisprudence, Lot, Recommandation, Risque, Texte

LIMITE_RESULTAT = 12_000  # caractères JSON au plus par résultat d'outil renvoyé au modèle
DATE_ISO = r"^\d{4}-\d{2}-\d{2}$"
T = TypeVar("T")


class Source(Protocol):
    """Ce que l'assistant lit : le module services.data du cockpit ou un LocalRepo conviennent."""

    def textes(self) -> list[Texte]: ...
    def exigences(self) -> list[Exigence]: ...
    def controles(self) -> list[Controle]: ...
    def risques(self) -> list[Risque]: ...
    def lots(self) -> list[Lot]: ...
    def jurisprudence(self) -> list[Jurisprudence]: ...
    def recommandation(self) -> Recommandation | None: ...
    def decision(self) -> Decision | None: ...


def normaliser(texte: str) -> str:
    """Minuscules, sans accents ni ponctuation : « Échéance, DORA » devient « echeance dora »."""
    decompose = unicodedata.normalize("NFD", texte or "")
    sans_accents = "".join(c for c in decompose if unicodedata.category(c) != "Mn")
    return re.sub(r"[^\w]+", " ", sans_accents.lower()).strip()


def filtrer_par_requete(items: Iterable[T], texte_de: Callable[[T], str], requete: str | None) -> list[T]:
    """Garde les éléments qui contiennent au moins la moitié des mots de la requête, les plus pertinents d'abord."""
    liste = list(items)
    termes = {t for t in normaliser(requete or "").split() if len(t) > 2}
    if not termes:
        return liste
    seuil = max(1, math.ceil(len(termes) / 2))
    notes = []
    for item in liste:
        cible = f" {normaliser(texte_de(item))} "
        note = sum(1 for terme in termes if terme in cible)
        if note >= seuil:
            notes.append((note, item))
    notes.sort(key=lambda paire: -paire[0])
    return [item for _, item in notes]


def _cite_article(articles: list[str], numero: str) -> bool:
    motif = re.compile(rf"\bart(?:icle)?s?\.?\s*{re.escape(numero.strip())}\b", re.IGNORECASE)
    return any(motif.search(a) for a in articles)


# --- Entrées des outils (validées avant exécution) ---------------------------------------------------------

StatutValidation = Literal["À valider", "Validée", "Corrigée", "Rejetée", "À revalider"]
Couverture = Literal["Couverte", "Partielle", "Non couverte", "À évaluer"]


class _Entree(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EntreeRechercherExigences(_Entree):
    requete: str | None = Field(None, description="Mots-clés en français, ex. « notification incident majeur »")
    statut_validation: StatutValidation | None = Field(None, description="Filtre sur le statut de validation humaine")
    couverture: Couverture | None = Field(None, description="Filtre sur la couverture par les contrôles existants")
    article: str | None = Field(None, description="Numéro d'article cité, ex. « 11 »")
    texte_id: str | None = Field(None, description="Identifiant du texte, ex. TX-0001")
    limite: int = Field(15, ge=1, le=50, description="Nombre maximal de résultats")


class EntreeDetailExigence(_Entree):
    id: str = Field(description="Identifiant de l'exigence, ex. EX-0004")


class EntreeEcheances(_Entree):
    avant: str | None = Field(None, pattern=DATE_ISO, description="Date limite incluse, format AAAA-MM-JJ")
    apres: str | None = Field(None, pattern=DATE_ISO, description="Date de début incluse, format AAAA-MM-JJ")
    limite: int = Field(20, ge=1, le=100, description="Nombre maximal de résultats")


class EntreeListerRisques(_Entree):
    niveau_residuel: Literal["Faible", "Modéré", "Élevé", "Critique"] | None = Field(None, description="Filtre sur le niveau résiduel")
    categorie: Literal["Juridique", "Financier", "Opérationnel", "Réputationnel", "Cyber"] | None = Field(None, description="Filtre sur la catégorie")
    exigence_id: str | None = Field(None, description="Risques d'une exigence donnée, ex. EX-0004")
    limite: int = Field(20, ge=1, le=100, description="Nombre maximal de résultats")


class EntreeListerLots(_Entree):
    priorite: Literal["P1", "P2", "P3", "P4"] | None = Field(None, description="Filtre sur la priorité")
    statut: Literal["À planifier", "En cours", "Terminé", "Bloqué"] | None = Field(None, description="Filtre sur le statut")
    cadre: Literal["TOGAF", "ITIL", "Hybride"] | None = Field(None, description="Filtre sur le cadre de gouvernance")


class EntreeListerControles(_Entree):
    statut: Literal["En place", "Partiel", "Planifié", "Absent"] | None = Field(None, description="Filtre sur le statut de mise en œuvre")
    requete: str | None = Field(None, description="Mots-clés, ex. « sauvegarde » ou « prestataires »")
    limite: int = Field(20, ge=1, le=60, description="Nombre maximal de résultats")


class EntreeFilDeVeille(_Entree):
    source: Literal["eurlex", "legifrance", "judilibre", "assemblee-nationale", "senat", "cnil", "anssi", "local-file"] | None = Field(None, description="Filtre sur la source")
    requete: str | None = Field(None, description="Mots-clés sur le titre ou le résumé")
    limite: int = Field(10, ge=1, le=40, description="Nombre maximal de résultats")


class EntreeJurisprudence(_Entree):
    exigence_id: str | None = Field(None, description="Décisions liées à une exigence, ex. EX-0004")


class EntreeIndicateurs(_Entree):
    pass


# --- Exécution ---------------------------------------------------------------------------------------------

def _resume(e: Exigence) -> dict[str, Any]:
    return {
        "id": e.id,
        "titre": e.titre,
        "articles": e.articles,
        "type_obligation": e.type_obligation,
        "echeance": e.echeance.date if e.echeance else None,
        "type_echeance": e.echeance.type if e.echeance else None,
        "sanction": f"{e.sanction.niveau}{f' ({e.sanction.article})' if e.sanction.article else ''}" if e.sanction else None,
        "couverture": e.couverture,
        "confiance": round(e.confiance, 2),
        "verifie_dans_source": e.verifie_dans_source,
        "statut_validation": e.statut_validation,
        "effort_estime": e.effort_estime,
        "risques_ids": e.risques_ids,
        "lots_ids": e.lots_ids,
    }


def _rechercher_exigences(a: EntreeRechercherExigences, s: Source) -> dict[str, Any]:
    items = s.exigences()
    if a.texte_id:
        items = [e for e in items if e.texte_id.upper() == a.texte_id.strip().upper()]
    if a.statut_validation:
        items = [e for e in items if e.statut_validation == a.statut_validation]
    if a.couverture:
        items = [e for e in items if e.couverture == a.couverture]
    if a.article:
        items = [e for e in items if _cite_article(e.articles, a.article)]
    items = filtrer_par_requete(items, lambda e: f"{e.titre} {e.description} {' '.join(e.articles)} {' '.join(e.destinataires)}", a.requete)
    return {"total": len(items), "exigences": [_resume(e) for e in items[: a.limite]]}


def _detail_exigence(a: EntreeDetailExigence, s: Source) -> dict[str, Any]:
    cible = a.id.strip().upper()
    e = next((x for x in s.exigences() if x.id.upper() == cible), None)
    if e is None:
        return {"erreur": f"Exigence {a.id} introuvable"}
    texte = next((t for t in s.textes() if t.id == e.texte_id), None)
    controles = [c for c in s.controles() if c.id in e.controles_ids or e.id in c.exigences_ids]
    risques = [r for r in s.risques() if r.exigence_id == e.id or r.id in e.risques_ids]
    lots = [l for l in s.lots() if e.id in l.exigences_ids or l.id in e.lots_ids]
    return {
        **_resume(e),
        "description": e.description,
        "extrait_verbatim": e.extrait_verbatim,
        "url_article": e.url_article,
        "destinataires": e.destinataires,
        "processus_impactes": e.processus_impactes,
        "systemes_impactes": e.systemes_impactes,
        "donnees_concernees": e.donnees_concernees,
        "contrats_concernes": e.contrats_concernes,
        "couverture_detail": e.couverture_detail,
        "validateur": e.validateur,
        "date_validation": e.date_validation,
        "commentaire_validation": e.commentaire_validation,
        "avertissements": e.avertissements,
        "texte": {"id": texte.id, "titre": texte.titre, "url_officielle": texte.url_officielle} if texte else None,
        "controles": [{"id": c.id, "nom": c.nom, "reference": c.reference, "statut": c.statut, "efficacite": c.efficacite} for c in controles],
        "risques": [{"id": r.id, "intitule": r.intitule, "niveau_residuel": r.niveau_residuel, "risque_residuel": r.risque_residuel, "traitement": r.traitement, "proprietaire": r.proprietaire} for r in risques],
        "lots": [{"id": l.id, "titre": l.titre, "priorite": l.priorite, "statut": l.statut, "responsable": l.responsable, "cadre": l.cadre_gouvernance} for l in lots],
    }


def _echeances(a: EntreeEcheances, s: Source) -> dict[str, Any]:
    aujourdhui = date.today()
    items = []
    for e in s.exigences():
        if not e.echeance or not e.echeance.date:
            continue
        if (a.avant and e.echeance.date > a.avant) or (a.apres and e.echeance.date < a.apres):
            continue
        try:
            jours = (date.fromisoformat(e.echeance.date) - aujourdhui).days
        except ValueError:
            jours = None
        items.append({**_resume(e), "jours_restants": jours})
    items.sort(key=lambda x: x["echeance"])
    return {"aujourdhui": aujourdhui.isoformat(), "total": len(items), "exigences": items[: a.limite]}


def _lister_risques(a: EntreeListerRisques, s: Source) -> dict[str, Any]:
    tous = s.risques()
    items = tous
    if a.niveau_residuel:
        items = [r for r in items if r.niveau_residuel == a.niveau_residuel]
    if a.categorie:
        items = [r for r in items if r.categorie == a.categorie]
    if a.exigence_id:
        items = [r for r in items if r.exigence_id.upper() == a.exigence_id.strip().upper()]
    items = sorted(items, key=lambda r: (-r.risque_residuel, r.id))
    lots = s.lots()

    def lots_du_risque(r: Risque) -> list[str]:
        return sorted(set(r.lots_ids) | {lot.id for lot in lots if r.id in lot.risques_ids})

    return {
        "total": len(items),
        "repartition_globale": dict(Counter(r.niveau_residuel for r in tous)),
        "risques": [{**r.model_dump(exclude={"notion_page_id"}), "lots_ids": lots_du_risque(r)} for r in items[: a.limite]],
    }


def _lister_lots(a: EntreeListerLots, s: Source) -> dict[str, Any]:
    items = s.lots()
    if a.priorite:
        items = [l for l in items if l.priorite == a.priorite]
    if a.statut:
        items = [l for l in items if l.statut == a.statut]
    if a.cadre:
        items = [l for l in items if l.cadre_gouvernance == a.cadre]
    items = sorted(items, key=lambda l: (l.priorite, l.id))
    return {"total": len(items), "lots": [l.model_dump(exclude={"notion_page_id", "description"}) for l in items]}


def _lister_controles(a: EntreeListerControles, s: Source) -> dict[str, Any]:
    items = s.controles()
    if a.statut:
        items = [c for c in items if c.statut == a.statut]
    items = filtrer_par_requete(items, lambda c: f"{c.nom} {c.reference} {c.description} {c.ecart_constate or ''}", a.requete)
    exigences = s.exigences()

    def exigences_couvertes(c: Controle) -> list[str]:
        return sorted(set(c.exigences_ids) | {e.id for e in exigences if c.id in e.controles_ids})

    return {
        "total": len(items),
        "controles": [
            {"id": c.id, "nom": c.nom, "referentiel": c.referentiel, "reference": c.reference, "statut": c.statut, "efficacite": c.efficacite, "exigences_couvertes": exigences_couvertes(c), "ecart_constate": c.ecart_constate}
            for c in items[: a.limite]
        ],
    }


def _fil_de_veille(a: EntreeFilDeVeille, s: Source) -> dict[str, Any]:
    items = s.textes()
    if a.source:
        items = [t for t in items if t.source == a.source]
    items = filtrer_par_requete(sorted(items, key=lambda t: t.collecte_le, reverse=True), lambda t: f"{t.titre} {t.resume or ''} {t.reference}", a.requete)
    return {
        "total": len(items),
        "textes": [
            {"id": t.id, "titre": t.titre, "source": t.source, "reference": t.reference, "type": t.type, "collecte_le": t.collecte_le, "applicable": t.applicable, "nombre_articles": t.nombre_articles, "modifie_le": t.derniere_modification_detectee, "url_officielle": t.url_officielle, "resume": t.resume}
            for t in items[: a.limite]
        ],
    }


def _jurisprudence(a: EntreeJurisprudence, s: Source) -> dict[str, Any]:
    items = s.jurisprudence()
    if a.exigence_id:
        cible = a.exigence_id.strip().upper()
        items = [j for j in items if cible in (i.upper() for i in j.exigences_ids)]
    return {"total": len(items), "decisions": [j.model_dump(exclude={"notion_page_id"}) for j in items], "note": None if items else "Aucune décision de jurisprudence dans la base (étape jurisprudence non exercée)."}


def _indicateurs(a: EntreeIndicateurs, s: Source) -> dict[str, Any]:
    exigences = s.exigences()
    recommandation = s.recommandation()
    decision = s.decision()
    score = sum(1 if e.couverture == "Couverte" else 0.5 if e.couverture == "Partielle" else 0 for e in exigences)
    return {
        "textes_suivis": len(s.textes()),
        "exigences": len(exigences),
        "par_statut_validation": dict(Counter(e.statut_validation for e in exigences)),
        "par_couverture": dict(Counter(e.couverture for e in exigences)),
        "pct_verifiees_dans_la_source": round(100 * sum(e.verifie_dans_source for e in exigences) / len(exigences)) if exigences else 0,
        "pct_couverture": round(100 * score / len(exigences)) if exigences else 0,
        "risques_par_niveau_residuel": dict(Counter(r.niveau_residuel for r in s.risques())),
        "lots_par_statut": dict(Counter(l.statut for l in s.lots())),
        "recommandation_gouvernance": {"cadre": recommandation.cadre_recommande, "score_togaf": recommandation.score_togaf, "score_itil": recommandation.score_itil, "points_de_decision_humaine": recommandation.points_de_decision_humaine} if recommandation else None,
        "decision_gouvernance": decision.model_dump() if decision else None,
    }


OUTILS: dict[str, tuple[type[_Entree], str, Callable[[Any, Source], dict[str, Any]]]] = {
    "rechercher_exigences": (EntreeRechercherExigences, "Recherche des exigences réglementaires du projet par mots-clés, article, texte, statut de validation ou couverture.", _rechercher_exigences),
    "detail_exigence": (EntreeDetailExigence, "Détail d'une exigence : description, extrait verbatim, URL de l'article officiel, échéance, sanction, impact, contrôles, risques, lots d'action, validation.", _detail_exigence),
    "echeances": (EntreeEcheances, "Exigences dont l'échéance tombe dans une période (dates AAAA-MM-JJ), triées par date, avec le nombre de jours restants.", _echeances),
    "lister_risques": (EntreeListerRisques, "Risques identifiés avec scénario, probabilité, impact, niveau résiduel, traitement et propriétaire.", _lister_risques),
    "lister_lots": (EntreeListerLots, "Lots d'action de la feuille de route : priorité, cadre de gouvernance, responsable, échéance cible, statut, livrable.", _lister_lots),
    "lister_controles": (EntreeListerControles, "Contrôles existants (ISO 27001:2022 et internes) avec statut, efficacité, exigences couvertes et écarts.", _lister_controles),
    "fil_de_veille": (EntreeFilDeVeille, "Textes collectés par la veille (règlements, dossiers législatifs, actualités CNIL, bulletins CERT-FR), du plus récent au plus ancien.", _fil_de_veille),
    "jurisprudence": (EntreeJurisprudence, "Décisions de jurisprudence rattachées aux exigences.", _jurisprudence),
    "indicateurs": (EntreeIndicateurs, "Indicateurs de pilotage : exigences par statut et couverture, % vérifiées, risques par niveau, lots par statut, recommandation et décision de gouvernance.", _indicateurs),
}

LIBELLES: dict[str, str] = {
    "rechercher_exigences": "Recherche dans les exigences",
    "detail_exigence": "Lecture d'une exigence",
    "echeances": "Lecture des échéances",
    "lister_risques": "Lecture des risques",
    "lister_lots": "Lecture des lots d'action",
    "lister_controles": "Lecture des contrôles",
    "fil_de_veille": "Lecture du fil de veille",
    "jurisprudence": "Lecture de la jurisprudence",
    "indicateurs": "Calcul des indicateurs",
}


def _schema(modele: type[BaseModel]) -> dict[str, Any]:
    schema = modele.model_json_schema()

    def nettoyer(noeud: Any) -> None:
        if isinstance(noeud, dict):
            noeud.pop("title", None)
            for valeur in noeud.values():
                nettoyer(valeur)
        elif isinstance(noeud, list):
            for valeur in noeud:
                nettoyer(valeur)

    nettoyer(schema)
    return schema


DEFINITIONS: list[dict[str, Any]] = [
    {"name": nom, "description": description, "input_schema": _schema(modele), "eager_input_streaming": True}
    for nom, (modele, description, _) in OUTILS.items()
]


def executer(nom: str, entree: Any, source: Source) -> tuple[str, bool]:
    """Exécute un outil ; renvoie (contenu JSON, en_erreur). Une entrée invalide n'est jamais exécutée."""
    outil = OUTILS.get(nom)
    if outil is None:
        return json.dumps({"erreur": f"Outil inconnu : {nom}"}, ensure_ascii=False), True
    if not isinstance(entree, dict):
        return json.dumps({"erreur": "INVALID_JSON : l'entrée de l'outil doit être un objet JSON"}, ensure_ascii=False), True
    modele, _, fonction = outil
    try:
        arguments = modele.model_validate(entree)
    except ValidationError as exc:
        details = [{"champ": ".".join(str(p) for p in err["loc"]), "message": err["msg"]} for err in exc.errors()]
        return json.dumps({"erreur": "Entrée invalide", "details": details}, ensure_ascii=False), True
    try:
        resultat = fonction(arguments, source)
    except Exception as exc:  # noqa: BLE001 - lecture Notion ou store impossible : le modèle reçoit l'erreur
        return json.dumps({"erreur": f"Lecture des données impossible ({exc.__class__.__name__})"}, ensure_ascii=False), True
    texte = json.dumps(resultat, ensure_ascii=False, default=str)
    if len(texte) > LIMITE_RESULTAT:
        texte = texte[:LIMITE_RESULTAT] + " … [résultat tronqué : affiner la recherche ou réduire « limite »]"
    return texte, False
