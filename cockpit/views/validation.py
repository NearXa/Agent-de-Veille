"""Vue 3 : validation humaine (file « À valider » / « À revalider », Valider, Corriger, Rejeter)."""

from __future__ import annotations

from typing import Any

import streamlit as st

from models import STATUTS_A_TRAITER, Exigence, cle_file_validation
from services import data
from services.notion_repo import NotionRepo
from services.validation_service import ValidationRefusee, ValidationService
from views.common import badge_confiance, format_date_fr

TYPES_OBLIGATION = [
    "Obligation de faire",
    "Interdiction",
    "Notification",
    "Documentaire",
    "Gouvernance",
    "Contractuelle",
    "Technique",
]
NIVEAUX_SANCTION = ["Faible", "Moyen", "Élevé", "Critique", "Non précisé"]


def _service() -> ValidationService:
    notion = NotionRepo.from_env() if data.is_writable() else None
    return ValidationService(notion, st.session_state.get("validateur", ""))


def _apres_action(message: str) -> None:
    st.toast(message, icon="✅")
    data.clear_cache()
    st.session_state["file_index"] = st.session_state.get("file_index", 0) + 1
    st.rerun()


def _panneau_detail(e: Exigence, texte_url: str | None) -> None:
    st.subheader(f"{e.id} · {e.titre}")
    st.write(e.description)
    c1, c2, c3 = st.columns(3)
    c1.metric("Confiance", badge_confiance(e))
    c2.metric("Statut", e.statut_validation)
    c3.metric("Type", e.type_obligation)
    st.markdown(f"**Article(s)** : {' ; '.join(e.articles)}")
    st.markdown("**Extrait verbatim (copié depuis la source)**")
    st.markdown(f"> {e.extrait_verbatim}")
    lien = e.url_article or texte_url
    if lien:
        st.markdown(f"[Vérifier dans la source officielle]({lien})")
    d = e.confiance_detail
    if d.llm or d.verbatim_retrouve or d.article_existe:
        st.caption(
            f"Détail de la confiance : 0,5 × LLM {d.llm:.2f} + 0,3 × verbatim {d.verbatim_retrouve} + 0,2 × article {d.article_existe} "
            f"= {e.confiance:.2f} · vérifié dans la source : {'oui' if e.verifie_dans_source else 'non'}"
        )
    else:
        st.caption(
            f"Confiance {e.confiance:.2f} · vérifié dans la source : {'oui' if e.verifie_dans_source else 'non'} "
            "(détail des trois composantes disponible dans data/store/exigences.json)"
        )
    if e.a_relire_en_priorite:
        st.warning("À relire en priorité : confiance faible ou extrait non retrouvé dans la source.")
    if e.echeance:
        st.markdown(f"**Échéance** : {format_date_fr(e.echeance.date)} ({e.echeance.type}, source : {e.echeance.texte_source or '—'})")
    if e.sanction:
        st.markdown(f"**Sanction** : {e.sanction.description} (niveau {e.sanction.niveau}, {e.sanction.article or 'article non précisé'})")
    if e.destinataires:
        st.markdown(f"**Destinataires** : {', '.join(e.destinataires)}")
    if e.processus_impactes or e.systemes_impactes or e.donnees_concernees:
        st.markdown(
            f"**Impact** : processus {', '.join(e.processus_impactes) or '—'} · systèmes {', '.join(e.systemes_impactes) or '—'} · données {', '.join(e.donnees_concernees) or '—'}"
        )
    if e.controles_ids:
        st.markdown(f"**Contrôles** : {', '.join(e.controles_ids)} (couverture : {e.couverture})")
    if e.risques_ids:
        st.markdown(f"**Risques** : {', '.join(e.risques_ids)}")
    if e.avertissements:
        st.caption("Avertissements du pipeline : " + " · ".join(e.avertissements))


def _formulaire_correction(e: Exigence) -> tuple[dict[str, Any], str, bool]:
    with st.form(f"corriger-{e.id}"):
        titre = st.text_input("Titre", e.titre)
        description = st.text_area("Description", e.description)
        articles = st.text_input("Article(s), séparés par ;", " ; ".join(e.articles))
        type_obligation = st.selectbox("Type d'obligation", TYPES_OBLIGATION, index=TYPES_OBLIGATION.index(e.type_obligation))
        destinataires = st.text_input("Destinataires, séparés par ;", " ; ".join(e.destinataires))
        echeance = st.text_input("Échéance (AAAA-MM-JJ, vide si aucune)", e.echeance.date or "" if e.echeance else "")
        sanction_desc = st.text_input("Sanction", e.sanction.description if e.sanction else "")
        sanction_niveau = st.selectbox(
            "Niveau de sanction", NIVEAUX_SANCTION, index=NIVEAUX_SANCTION.index(e.sanction.niveau if e.sanction else "Non précisé")
        )
        commentaire = st.text_area("Commentaire (obligatoire)")
        envoye = st.form_submit_button("Enregistrer la correction")
    champs: dict[str, Any] = {}
    if titre != e.titre:
        champs["titre"] = titre
    if description != e.description:
        champs["description"] = description
    nouveaux_articles = [a.strip() for a in articles.split(";") if a.strip()]
    if nouveaux_articles != e.articles:
        champs["articles"] = nouveaux_articles
    if type_obligation != e.type_obligation:
        champs["type_obligation"] = type_obligation
    nouveaux_dest = [d.strip() for d in destinataires.split(";") if d.strip()]
    if nouveaux_dest != e.destinataires:
        champs["destinataires"] = nouveaux_dest
    ancienne_echeance = e.echeance.date if e.echeance else None
    if (echeance.strip() or None) != ancienne_echeance:
        champs["echeance"] = echeance.strip() or None
    ancienne_sanction = e.sanction.description if e.sanction else ""
    ancien_niveau = e.sanction.niveau if e.sanction else "Non précisé"
    if sanction_desc != ancienne_sanction or sanction_niveau != ancien_niveau:
        champs["sanction"] = {"description": sanction_desc, "niveau": sanction_niveau}
    return champs, commentaire, envoye


def render() -> None:
    st.title("Validation humaine")
    if not data.is_writable():
        st.warning(
            "Mode lecture seule : Notion est injoignable ou non configuré. Les actions sont désactivées "
            "(aucune écriture hors Notion)."
        )
    exigences = data.exigences()
    textes_url = {t.id: t.url_officielle for t in data.textes()}
    file = sorted((e for e in exigences if e.statut_validation in STATUTS_A_TRAITER), key=cle_file_validation)
    st.caption(f"{len(file)} exigence(s) à traiter sur {len(exigences)}.")
    if not file:
        st.success("Aucune exigence en attente de validation.")
        return

    index = min(st.session_state.get("file_index", 0), len(file) - 1)
    options = list(range(len(file)))
    choix = st.selectbox(
        "Exigence",
        options,
        index=index,
        format_func=lambda i: f"{file[i].id} · {badge_confiance(file[i])} · {file[i].titre}",
    )
    st.session_state["file_index"] = choix
    e = file[choix]
    _panneau_detail(e, textes_url.get(e.texte_id))

    service = _service()
    onglets = st.tabs(["Valider", "Corriger", "Rejeter"])
    with onglets[0]:
        commentaire = st.text_area("Commentaire (facultatif)", key=f"valider-{e.id}")
        if st.button("Valider", type="primary", key=f"btn-valider-{e.id}", disabled=not data.is_writable()):
            try:
                service.valider(e, commentaire or None)
                _apres_action(f"{e.id} validée")
            except ValidationRefusee as erreur:
                st.error(str(erreur))
    with onglets[1]:
        champs, commentaire, envoye = _formulaire_correction(e)
        if envoye:
            try:
                service.corriger(e, champs, commentaire)
                _apres_action(f"{e.id} corrigée")
            except ValidationRefusee as erreur:
                st.error(str(erreur))
    with onglets[2]:
        motif = st.text_area("Motif (obligatoire)", key=f"rejeter-{e.id}")
        if st.button("Rejeter", key=f"btn-rejeter-{e.id}", disabled=not data.is_writable()):
            try:
                service.rejeter(e, motif)
                _apres_action(f"{e.id} rejetée")
            except ValidationRefusee as erreur:
                st.error(str(erreur))
