"""Cockpit Streamlit : navigation vers les quatre vues, validateur, source de données, rafraîchissement."""

from __future__ import annotations

import streamlit as st

from config import APP_TITLE
from services import data
from views import fil_de_veille, pilotage, textes_matrices, validation

st.set_page_config(page_title=APP_TITLE, page_icon="⚖️", layout="wide")


def barre_laterale() -> None:
    st.sidebar.title(APP_TITLE)
    st.sidebar.text_input("Validateur", key="validateur", placeholder="Prénom Nom")
    bundle = data.load_bundle()
    icone = "🟢" if bundle["writable"] else "🟠"
    st.sidebar.markdown(f"{icone} Source de données : **{bundle['source']}**")
    if bundle["error"]:
        st.sidebar.warning(bundle["error"])
    if st.sidebar.button("Rafraîchir"):
        data.clear_cache()
        st.rerun()


pages = [
    st.Page(fil_de_veille.render, title="Fil de veille", icon="📰", url_path="veille", default=True),
    st.Page(textes_matrices.render, title="Textes et matrices", icon="📚", url_path="textes"),
    st.Page(validation.render, title="Validation humaine", icon="✅", url_path="validation"),
    st.Page(pilotage.render, title="Pilotage et échéances", icon="📊", url_path="pilotage"),
]

barre_laterale()
st.navigation(pages).run()
