"""Vue 2 : textes et matrices (sélection d'un texte, applicabilité, exigences, M1 à M5 depuis les données, graphiques)."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from services import data
from services.matrices import TITRES, classeur_xlsx, toutes
from views.common import exigences_dataframe


def _graphiques(exigences, risques) -> None:
    c1, c2, c3 = st.columns(3)
    if exigences:
        par_type = pd.DataFrame({"Type": [e.type_obligation for e in exigences]}).value_counts().reset_index(name="Exigences")
        c1.plotly_chart(px.bar(par_type, x="Type", y="Exigences", title="Exigences par type d'obligation"), width="stretch")
        couverture = pd.DataFrame({"Couverture": [e.couverture for e in exigences]}).value_counts().reset_index(name="Exigences")
        c2.plotly_chart(
            px.pie(couverture, names="Couverture", values="Exigences", title="Couverture par les contrôles",
                   color="Couverture", color_discrete_map={"Couverte": "#2e7d32", "Partielle": "#f9a825", "Non couverte": "#c62828", "À évaluer": "#9e9e9e"}),
            width="stretch",
        )
    if risques:
        grille = [[0] * 4 for _ in range(4)]
        for r in risques:
            grille[r.impact - 1][r.probabilite - 1] += 1
        fig = go.Figure(
            data=go.Heatmap(z=grille, x=["P1", "P2", "P3", "P4"], y=["I1", "I2", "I3", "I4"], colorscale="YlOrRd", text=grille, texttemplate="%{text}", showscale=False)
        )
        fig.update_layout(title="Heatmap probabilité × impact (risques bruts)", xaxis_title="Probabilité", yaxis_title="Impact")
        c3.plotly_chart(fig, width="stretch")
    else:
        c3.caption("Heatmap probabilité × impact : disponible après l'étape risques.")


def render() -> None:
    st.title("Textes et matrices")
    textes = data.textes()
    if not textes:
        st.warning("Aucun texte dans le store.")
        return
    textes_par_id = {t.id: t for t in textes}
    choix = st.selectbox("Texte", options=[t.id for t in textes], format_func=lambda i: f"{i} · {textes_par_id[i].titre}")
    texte = textes_par_id[choix]
    exigences = [e for e in data.exigences() if e.texte_id == texte.id]
    scope = {e.id for e in exigences}
    risques = [r for r in data.risques() if r.exigence_id in scope]
    controles = {c.id: c for c in data.controles()}
    jurisprudence = [j for j in data.jurisprudence() if any(i in scope for i in j.exigences_ids)]

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Applicabilité", texte.applicable)
    c2.metric("Articles", texte.nombre_articles)
    c3.metric("Exigences", len(exigences))
    c4.metric("Risques", len(risques))
    if texte.justification_applicabilite:
        st.info(texte.justification_applicabilite)

    st.subheader("Exigences")
    tri = st.radio("Trier par", ["confiance", "échéance", "statut"], horizontal=True)
    if tri == "confiance":
        exigences.sort(key=lambda e: e.confiance)
    elif tri == "échéance":
        exigences.sort(key=lambda e: (e.echeance.date if e.echeance and e.echeance.date else "9999"))
    else:
        exigences.sort(key=lambda e: e.statut_validation)
    st.dataframe(exigences_dataframe(exigences), hide_index=True, width="stretch")

    _graphiques(exigences, risques)

    st.subheader("Matrices (rendues depuis les données)")
    tables = toutes(exigences, textes_par_id, controles, risques, jurisprudence)
    st.download_button(
        "Télécharger les cinq matrices (XLSX)",
        classeur_xlsx(tables),
        file_name=f"matrices-grc-{texte.id}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    onglets = st.tabs([TITRES[k] for k in tables])
    for onglet, (key, df) in zip(onglets, tables.items(), strict=True):
        with onglet:
            if df.empty:
                st.caption("Aucune ligne : étape d'analyse non exécutée ou aucune donnée pour ce texte.")
            st.dataframe(df, hide_index=True, width="stretch")
            st.download_button(
                f"Télécharger {key} (CSV)",
                df.to_csv(index=False).encode("utf-8-sig"),
                file_name=f"{key}-{texte.id}.csv",
                mime="text/csv",
                key=f"dl-{key}",
            )
