"""Vue 1 : fil de veille (textes collectés, badges Nouveau / Modifié, filtres, dernier run, diffs par article)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
import streamlit as st

from services import data
from views.common import format_date_fr


def _badges(texte) -> str:
    badges = []
    try:
        collecte = datetime.fromisoformat(texte.collecte_le.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - collecte < timedelta(days=7):
            badges.append("Nouveau")
    except ValueError:
        pass
    if texte.derniere_modification_detectee:
        badges.append("Modifié")
    return " · ".join(badges)


def render() -> None:
    st.title("Fil de veille")
    run = data.dernier_run()
    if run:
        cols = st.columns(5)
        cols[0].metric("Dernier run", run.run_id)
        cols[1].metric("Type", run.kind)
        cols[2].metric("Durée", f"{(run.duration_ms or 0) / 1000:.1f} s")
        cols[3].metric("Textes / exigences", f"{run.counts.get('textes', 0)} / {run.counts.get('exigences', 0)}")
        cout = run.llm.get("cost_usd")
        cols[4].metric("Coût LLM", "n/a" if cout is None else f"{cout:.3f} $")
    else:
        st.info("Aucun run enregistré pour l'instant : lancez `pnpm agent demo`.")

    textes = data.textes()
    if not textes:
        st.warning("Aucun texte dans le store. Étape 1 du parcours : `pnpm agent ingest …`.")
        return

    sources = sorted({t.source for t in textes})
    types = sorted({t.type for t in textes})
    applicabilites = sorted({t.applicable for t in textes})
    c1, c2, c3, c4 = st.columns(4)
    filtre_source = c1.multiselect("Source", sources, default=sources)
    filtre_type = c2.multiselect("Type", types, default=types)
    # Les textes jugés non applicables restent consultables, mais ne sont pas présélectionnés.
    par_defaut = [a for a in applicabilites if a != "Non"] or applicabilites
    filtre_appl = c3.multiselect("Applicabilité", applicabilites, default=par_defaut)
    periode = c4.selectbox("Période", ["Tout", "7 derniers jours", "30 derniers jours", "90 derniers jours"], index=0)
    limite = {"7 derniers jours": 7, "30 derniers jours": 30, "90 derniers jours": 90}.get(periode)
    masques = sum(1 for t in textes if t.applicable == "Non") if "Non" not in filtre_appl else 0
    if masques:
        st.caption(f"{masques} texte(s) non applicable(s) masqué(s) : ajouter « Non » au filtre Applicabilité pour les afficher.")
    visibles = []
    for t in textes:
        if t.source not in filtre_source or t.type not in filtre_type or t.applicable not in filtre_appl:
            continue
        if limite:
            try:
                collecte = datetime.fromisoformat(t.collecte_le.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) - collecte > timedelta(days=limite):
                    continue
            except ValueError:
                pass
        visibles.append(t)
    visibles.sort(key=lambda t: t.collecte_le, reverse=True)

    st.dataframe(
        pd.DataFrame(
            [
                {
                    "ID": t.id, "Titre": t.titre, "Source": t.source, "Référence": t.reference, "Type": t.type,
                    "Collecté le": format_date_fr(t.collecte_le), "Articles": t.nombre_articles, "Applicable": t.applicable,
                    "Version": t.version, "Badges": _badges(t), "URL officielle": t.url_officielle,
                }
                for t in visibles
            ]
        ),
        hide_index=True,
        width="stretch",
        column_config={"URL officielle": st.column_config.LinkColumn("URL officielle")},
    )
    for texte in visibles:
        with st.expander(f"{texte.id} · {texte.titre}"):
            st.write(texte.resume or "Résumé non disponible (étape applicabilité non exécutée).")
            if texte.justification_applicabilite:
                st.caption(f"Applicabilité : {texte.applicable} · {texte.justification_applicabilite}")
            st.markdown(f"[Consulter la source officielle]({texte.url_officielle})")
            st.caption(f"Hash SHA-256 : `{texte.hash_sha256}` · run {texte.run_id} · version {texte.version}")
            if texte.historique:
                st.markdown("**Modifications détectées (diff par article)**")
                st.dataframe(
                    pd.DataFrame(
                        [
                            {
                                "Version": h.get("version"), "Collecté le": format_date_fr(h.get("collecte_le")), "Run": h.get("run_id"),
                                "Articles ajoutés": ", ".join(h.get("articles_ajoutes", [])) or "—",
                                "Articles supprimés": ", ".join(h.get("articles_supprimes", [])) or "—",
                                "Articles modifiés": ", ".join(h.get("articles_modifies", [])) or "—",
                            }
                            for h in texte.historique
                        ]
                    ),
                    hide_index=True,
                    width="stretch",
                )
