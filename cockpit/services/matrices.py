"""Matrices M1 à M5 rendues depuis les données (pandas), export CSV et classeur XLSX (openpyxl)."""

from __future__ import annotations

from io import BytesIO

import pandas as pd

from models import Controle, Exigence, Jurisprudence, Risque, Texte

COLONNES = {
    "M1": ["ID exigence", "Titre", "Texte", "Article(s)", "Extrait verbatim", "URL officielle", "Échéance", "Type d'échéance", "Destinataires", "Confiance", "Vérifié", "Statut de validation"],
    "M2": ["ID exigence", "Titre", "Processus", "Systèmes", "Données", "Contrats et tiers", "Départements", "Effort estimé", "Justification"],
    "M3": ["ID exigence", "Titre", "Contrôles existants", "Couverture", "Écart", "Lot d'action proposé"],
    "M4": ["ID risque", "ID exigence", "Scénario", "Catégorie", "Probabilité", "Impact", "Criticité brute", "Contrôles atténuants", "Risque résiduel", "Niveau résiduel", "Traitement", "Propriétaire"],
    "M5": ["ID exigence", "ID décision", "Juridiction", "Date", "Numéro", "Résumé", "Solution retenue", "Portée", "Pertinence", "URL officielle"],
}
TITRES = {"M1": "M1 Traçabilité", "M2": "M2 Impact", "M3": "M3 Couverture", "M4": "M4 Risque", "M5": "M5 Jurisprudence"}


def _join(values: list[str]) -> str:
    return " ; ".join(values)


def m1(exigences: list[Exigence], textes: dict[str, Texte]) -> pd.DataFrame:
    rows = []
    for e in sorted(exigences, key=lambda x: x.id):
        t = textes.get(e.texte_id)
        rows.append({
            "ID exigence": e.id, "Titre": e.titre, "Texte": f"{e.texte_id} · {t.titre}" if t else e.texte_id,
            "Article(s)": _join(e.articles), "Extrait verbatim": e.extrait_verbatim,
            "URL officielle": e.url_article or (t.url_officielle if t else ""),
            "Échéance": e.echeance.date if e.echeance and e.echeance.date else "", "Type d'échéance": e.echeance.type if e.echeance else "Non précisée",
            "Destinataires": _join(e.destinataires), "Confiance": round(e.confiance, 2), "Vérifié": "oui" if e.verifie_dans_source else "non",
            "Statut de validation": e.statut_validation,
        })
    return pd.DataFrame(rows, columns=COLONNES["M1"])


def m2(exigences: list[Exigence]) -> pd.DataFrame:
    rows = [{
        "ID exigence": e.id, "Titre": e.titre, "Processus": _join(e.processus_impactes), "Systèmes": _join(e.systemes_impactes),
        "Données": _join(e.donnees_concernees), "Contrats et tiers": _join(e.contrats_concernes), "Départements": _join(e.departements_impactes),
        "Effort estimé": e.effort_estime or "", "Justification": e.impact_justification or "",
    } for e in sorted(exigences, key=lambda x: x.id)]
    return pd.DataFrame(rows, columns=COLONNES["M2"])


def m3(exigences: list[Exigence], controles: dict[str, Controle]) -> pd.DataFrame:
    rows = []
    for e in sorted(exigences, key=lambda x: x.id):
        detail = []
        ecarts = []
        for d in e.couverture_detail:
            c = controles.get(d.get("controle_id", ""))
            detail.append(f"{d.get('controle_id')} {c.reference + ' (' + c.statut + ')' if c else ''} : {d.get('couverture')}".replace("  ", " "))
            if d.get("ecart"):
                ecarts.append(f"{d.get('controle_id')} : {d.get('ecart')}")
        rows.append({
            "ID exigence": e.id, "Titre": e.titre, "Contrôles existants": _join(detail), "Couverture": e.couverture,
            "Écart": _join(ecarts) or (e.couverture_justification or "" if e.couverture == "Non couverte" else ""),
            "Lot d'action proposé": e.lot_propose or _join(e.lots_ids),
        })
    return pd.DataFrame(rows, columns=COLONNES["M3"])


def m4(risques: list[Risque], controles: dict[str, Controle]) -> pd.DataFrame:
    rows = [{
        "ID risque": r.id, "ID exigence": r.exigence_id, "Scénario": r.scenario, "Catégorie": r.categorie, "Probabilité": r.probabilite,
        "Impact": r.impact, "Criticité brute": r.criticite_brute,
        "Contrôles atténuants": _join([f"{cid} ({controles[cid].statut})" if cid in controles else cid for cid in r.controles_attenuants]),
        "Risque résiduel": r.risque_residuel, "Niveau résiduel": r.niveau_residuel, "Traitement": r.traitement, "Propriétaire": r.proprietaire,
    } for r in sorted(risques, key=lambda x: x.id)]
    return pd.DataFrame(rows, columns=COLONNES["M4"])


def m5(jurisprudence: list[Jurisprudence], scope: set[str]) -> pd.DataFrame:
    rows = []
    for j in sorted(jurisprudence, key=lambda x: x.id):
        for eid in sorted(i for i in j.exigences_ids if i in scope):
            rows.append({
                "ID exigence": eid, "ID décision": j.id, "Juridiction": j.juridiction, "Date": j.date_decision or "", "Numéro": j.numero,
                "Résumé": j.resume, "Solution retenue": j.solution_retenue or "", "Portée": j.portee or "", "Pertinence": j.pertinence, "URL officielle": j.url_officielle,
            })
    return pd.DataFrame(rows, columns=COLONNES["M5"]).sort_values(["ID exigence", "ID décision"]) if rows else pd.DataFrame(columns=COLONNES["M5"])


def toutes(exigences: list[Exigence], textes: dict[str, Texte], controles: dict[str, Controle], risques: list[Risque], jurisprudence: list[Jurisprudence]) -> dict[str, pd.DataFrame]:
    scope = {e.id for e in exigences}
    return {
        "M1": m1(exigences, textes),
        "M2": m2(exigences),
        "M3": m3(exigences, controles),
        "M4": m4([r for r in risques if r.exigence_id in scope], controles),
        "M5": m5(jurisprudence, scope),
    }


def classeur_xlsx(tables: dict[str, pd.DataFrame]) -> bytes:
    """Classeur XLSX : un onglet par matrice, en-tête figé, filtres, largeurs de colonnes."""
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        for key, df in tables.items():
            df.to_excel(writer, sheet_name=TITRES[key][:31], index=False)
            ws = writer.sheets[TITRES[key][:31]]
            ws.freeze_panes = "A2"
            if len(df.columns) > 0:
                ws.auto_filter.ref = ws.dimensions
            for idx, col in enumerate(df.columns, start=1):
                longest = max([len(str(col))] + [len(str(v)) for v in df[col].head(200)])
                ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = min(60, max(10, int(longest * 0.9)))
    return buffer.getvalue()
