"""Vue 4 : pilotage et échéances (KPI, timeline, lots d'action, recommandation et décision de gouvernance, exports)."""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta

import pandas as pd
import plotly.express as px
import streamlit as st

from services import data
from services.gouvernance_service import CADRES, DecisionRefusee, GouvernanceService
from services.matrices import classeur_xlsx, toutes
from services.notion_repo import NotionRepo
from views.common import format_date_fr


def _kpis(textes, exigences, risques, lots) -> None:
    statuts = Counter(e.statut_validation for e in exigences)
    verifiees = sum(1 for e in exigences if e.verifie_dans_source)
    score = sum(1 if e.couverture == "Couverte" else 0.5 if e.couverture == "Partielle" else 0 for e in exigences)
    c = st.columns(6)
    c[0].metric("Textes suivis", len(textes))
    c[1].metric("Exigences", len(exigences))
    c[2].metric("Validées ou corrigées", statuts.get("Validée", 0) + statuts.get("Corrigée", 0))
    c[3].metric("Vérifiées dans la source", f"{(verifiees / len(exigences) * 100) if exigences else 0:.0f} %")
    c[4].metric("Couverture", f"{(score / len(exigences) * 100) if exigences else 0:.0f} %")
    c[5].metric("Risques", len(risques))
    g1, g2, g3 = st.columns(3)
    if statuts:
        g1.plotly_chart(px.bar(pd.DataFrame({"Statut": list(statuts), "Exigences": list(statuts.values())}), x="Statut", y="Exigences", title="Exigences par statut"), width="stretch")
    niveaux = Counter(r.niveau_residuel for r in risques)
    if niveaux:
        ordre = ["Faible", "Modéré", "Élevé", "Critique"]
        df = pd.DataFrame({"Niveau": [n for n in ordre if n in niveaux], "Risques": [niveaux[n] for n in ordre if n in niveaux]})
        g2.plotly_chart(px.bar(df, x="Niveau", y="Risques", title="Risques par niveau résiduel", color="Niveau",
                               color_discrete_map={"Faible": "#2e7d32", "Modéré": "#f9a825", "Élevé": "#ef6c00", "Critique": "#c62828"}), width="stretch")
    lots_statut = Counter(l.statut for l in lots)
    if lots_statut:
        g3.plotly_chart(px.pie(pd.DataFrame({"Statut": list(lots_statut), "Lots": list(lots_statut.values())}), names="Statut", values="Lots", title="Lots par statut"), width="stretch")


def _timeline(exigences) -> None:
    st.subheader("Échéances")
    today = date.today()
    rows = []
    for e in exigences:
        if not e.echeance or not e.echeance.date:
            continue
        try:
            d = date.fromisoformat(e.echeance.date)
        except ValueError:
            continue
        delta = (d - today).days
        horizon = "Dépassée" if delta < 0 else "≤ 30 jours" if delta <= 30 else "≤ 90 jours" if delta <= 90 else "≤ 365 jours" if delta <= 365 else "> 1 an"
        rows.append({"ID exigence": e.id, "Titre": e.titre, "Échéance": e.echeance.date, "Type": e.echeance.type, "Jours restants": delta, "Horizon": horizon, "Statut": e.statut_validation})
    if not rows:
        st.caption("Aucune échéance datée : lancer l'étape enrich.")
        return
    df = pd.DataFrame(rows).sort_values("Échéance")
    compte = Counter(df["Horizon"])
    c = st.columns(4)
    c[0].metric("Dépassées", compte.get("Dépassée", 0))
    c[1].metric("À 30 jours", compte.get("≤ 30 jours", 0))
    c[2].metric("À 90 jours", compte.get("≤ 30 jours", 0) + compte.get("≤ 90 jours", 0))
    c[3].metric("À 365 jours", compte.get("≤ 30 jours", 0) + compte.get("≤ 90 jours", 0) + compte.get("≤ 365 jours", 0))
    fig = px.scatter(df, x="Échéance", y="ID exigence", color="Horizon", hover_data=["Titre", "Type"], title="Timeline des échéances",
                     color_discrete_map={"Dépassée": "#c62828", "≤ 30 jours": "#ef6c00", "≤ 90 jours": "#f9a825", "≤ 365 jours": "#1565c0", "> 1 an": "#9e9e9e"})
    fig.add_vline(x=today.isoformat(), line_dash="dash")
    for jours, label in ((30, "+30 j"), (90, "+90 j"), (365, "+365 j")):
        fig.add_vline(x=(today + timedelta(days=jours)).isoformat(), line_dash="dot", annotation_text=label)
    st.plotly_chart(fig, width="stretch")

    def _style(row):
        return ["background-color: #ffcdd2" if row["Horizon"] == "Dépassée" else ""] * len(row)

    st.dataframe(df.style.apply(_style, axis=1), hide_index=True, width="stretch")


def _lots(lots) -> None:
    st.subheader("Lots d'action")
    if not lots:
        st.caption("Aucun lot : lancer `pnpm agent governance --texte TX-0001`.")
        return
    df = pd.DataFrame(
        [{"Lot": l.id, "Priorité": l.priorite, "Titre": l.titre, "Cadre": l.cadre_gouvernance, "Phase ou pratique": l.phase_ou_pratique,
          "Exigences": len(l.exigences_ids), "Risques": len(l.risques_ids), "Responsable": l.responsable, "Échéance cible": format_date_fr(l.echeance_cible),
          "Effort": l.effort, "Statut": l.statut, "Livrable": l.livrable_attendu} for l in sorted(lots, key=lambda x: (x.priorite, x.id))]
    )
    st.dataframe(df, hide_index=True, width="stretch")


def _gouvernance(lots) -> None:
    st.subheader("Recommandation de cadre de gouvernance")
    reco = data.recommandation()
    decision = data.decision()
    if not reco:
        st.caption("Aucune recommandation : lancer `pnpm agent governance --texte TX-0001`.")
        return
    c1, c2, c3 = st.columns(3)
    c1.metric("Cadre recommandé", reco.cadre_recommande)
    c2.metric("Score TOGAF", f"{reco.score_togaf:.0f} / 100")
    c3.metric("Score ITIL", f"{reco.score_itil:.0f} / 100")
    st.write(reco.justification)
    if reco.criteres:
        st.dataframe(pd.DataFrame(reco.criteres), hide_index=True, width="stretch")
    with st.expander("Alternatives et points de décision humaine"):
        st.write(reco.alternatives)
        for p in reco.points_de_decision_humaine:
            st.markdown(f"- {p}")
    if decision:
        st.success(f"Décision enregistrée : **{decision.cadre}** par {decision.auteur} le {format_date_fr(decision.date)}" + (f" · {decision.commentaire}" if decision.commentaire else ""))
    st.markdown("**Décision humaine** (l'agent recommande, vous tranchez)")
    if not data.is_writable():
        st.warning("Mode lecture seule : Notion injoignable ou non configuré, la décision ne peut pas être enregistrée.")
    cadre = st.radio("Cadre retenu", list(CADRES), index=list(CADRES).index(reco.cadre_recommande) if reco.cadre_recommande in CADRES else 2, horizontal=True)
    commentaire = st.text_area("Commentaire de décision", key="decision-commentaire")
    if st.button("Enregistrer la décision", type="primary", disabled=not data.is_writable()):
        service = GouvernanceService(NotionRepo.from_env() if data.is_writable() else None, st.session_state.get("validateur", ""))
        try:
            d = service.enregistrer(cadre, commentaire, lots, reco)
            st.toast(f"Décision {d.cadre} enregistrée (Notion + decision.json)", icon="✅")
            data.clear_cache()
            st.rerun()
        except DecisionRefusee as erreur:
            st.error(str(erreur))


def render() -> None:
    st.title("Pilotage et échéances")
    textes = data.textes()
    exigences = data.exigences()
    risques = data.risques()
    lots = data.lots()
    _kpis(textes, exigences, risques, lots)
    _timeline(exigences)
    _lots(lots)
    _gouvernance(lots)

    st.subheader("Exports")
    textes_par_id = {t.id: t for t in textes}
    controles = {c.id: c for c in data.controles()}
    c1, c2 = st.columns(2)
    c1.download_button(
        "Matrices M1 à M5 (XLSX)",
        classeur_xlsx(toutes(exigences, textes_par_id, controles, risques, data.jurisprudence())),
        file_name="matrices-grc.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    plan = data.plan_markdown()
    c2.download_button("Plan de gouvernance (Markdown)", (plan or "").encode("utf-8"), file_name="plan-gouvernance.md", mime="text/markdown", disabled=not plan)
