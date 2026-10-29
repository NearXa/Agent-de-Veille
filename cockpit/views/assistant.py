"""Bulle de l'assistant GRC : fixée en bas à droite de toutes les pages du cockpit.

Le panneau s'ouvre au clic. Il fonctionne dans un fragment Streamlit : poser une question ne relance pas la
page en cours. L'historique vit dans la session du navigateur ; « Nouvelle conversation » le vide.
"""

from __future__ import annotations

import importlib
import threading
import time
from datetime import date
from typing import Any

import streamlit as st

from config import ANTHROPIC_API_KEY, ASSISTANT_MODELE, ASSISTANT_PLAFOND_USD
from services import assistant as service
from services import data
from services.assistant_outils import LIBELLES

LIBELLE = "Assistant GRC"
CLE_ETAT = "assistant_grc"
SUGGESTIONS = (
    "Quels risques ont un niveau résiduel critique ?",
    "Quelles exigences restent à valider en priorité ?",
    "Qu'impose DORA sur la notification des incidents majeurs ?",
)
STYLE = """<style>
.st-key-assistant_grc_bulle { position: fixed; right: 1.5rem; bottom: 1.5rem; z-index: 999; width: auto !important; }
.st-key-assistant_grc_bulle [data-testid="stPopoverButton"] {
  border-radius: 999px; padding: 0.6rem 1.1rem; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}
div[data-testid="stPopoverBody"][aria-label="Assistant GRC"] {
  width: min(460px, calc(100vw - 2rem)) !important; max-width: calc(100vw - 2rem) !important;
}
div[data-testid="stPopoverBody"][aria-label="Assistant GRC"] table { font-size: 0.85rem; }
/* Le panneau mesure au plus 70 % de la fenêtre : la conversation prend la place restante sous l'en-tête.
   Streamlit fixe la hauteur par la base flex du conteneur parent : c'est elle qui est surchargée.
   Aucun chevron dans ce CSS : st.html supprime une balise style dont le texte en contient. */
div[data-testid="stLayoutWrapper"]:has(> .st-key-assistant_grc_zone) {
  flex: 0 0 max(150px, calc(70vh - 230px)) !important; height: max(150px, calc(70vh - 230px)) !important;
}
</style>"""


def _precharger_sdk() -> None:
    """Importe le SDK Anthropic hors du script : son import est long quand le .venv est sur /mnt/c (WSL)."""
    try:
        importlib.import_module("anthropic")
    except ImportError:
        pass


_PRECHARGEMENT = threading.Thread(target=_precharger_sdk, name="prechargement-anthropic", daemon=True)
if ANTHROPIC_API_KEY:
    _PRECHARGEMENT.start()


def _etat() -> dict[str, Any]:
    if CLE_ETAT not in st.session_state:
        st.session_state[CLE_ETAT] = {"api": [], "affichage": [], "cout": 0.0, "aujourdhui": date.today()}
    return st.session_state[CLE_ETAT]


def _reinitialiser() -> None:
    st.session_state.pop(CLE_ETAT, None)


def _md(texte: str) -> str:
    """Le Markdown de Streamlit lit « $…$ » comme une formule : les montants en dollars restent du texte."""
    return texte.replace("$", "\\$")


def _ligne_outil(nom: str, entree: dict[str, Any]) -> str:
    details = " · ".join(f"{cle} : {valeur}" for cle, valeur in entree.items() if valeur not in (None, "", [], {}))
    details = details.replace("`", "'")
    if len(details) > 90:
        details = details[:89] + "…"
    return f":material/manage_search: {LIBELLES.get(nom, nom)}" + (f" · `{details}`" if details else "")


def _rendu(zone: Any, type_: str, texte: str) -> None:
    if type_ == "hors_perimetre":
        zone.warning(texte, icon=":material/block:")
    elif type_ in ("erreur", "refus"):
        zone.error(texte, icon=":material/error:")
    else:
        zone.markdown(_md(texte) or "_Réponse vide._")


def _afficher(message: dict[str, Any]) -> None:
    with st.chat_message(message["role"]):
        for ligne in message.get("outils", []):
            st.caption(ligne)
        _rendu(st, message.get("type", "reponse"), message["texte"])


def _repondre(etat: dict[str, Any], question: str) -> None:
    contexte = [{"role": m["role"], "texte": m["texte"]} for m in etat["affichage"]]
    etat["affichage"].append({"role": "user", "texte": question})
    _afficher(etat["affichage"][-1])
    texte, type_, outils = "", "reponse", []
    with st.chat_message("assistant"):
        zone_outils = st.container()
        zone_texte = st.empty()
        if _PRECHARGEMENT.is_alive():
            zone_texte.markdown(":gray[_Chargement de l'assistant (premier lancement du cockpit)…_]")
        assistant = service.creer_assistant(data, aujourdhui=etat["aujourdhui"])
        if assistant is None:
            texte = "Assistant indisponible : ANTHROPIC_API_KEY absente du fichier .env."
            _rendu(zone_texte, "erreur", texte)
            etat["affichage"].append({"role": "assistant", "texte": texte, "outils": [], "type": "erreur"})
            return
        zone_texte.markdown(":gray[_Vérification du périmètre de la question…_]")
        derniere_maj = 0.0
        for evenement in assistant.repondre(etat["api"], question, contexte):
            if evenement.type == "texte":
                texte += evenement.texte
                if time.monotonic() - derniere_maj > 0.08:
                    zone_texte.markdown(_md(texte) + " ▌")
                    derniere_maj = time.monotonic()
            elif evenement.type == "outil":
                ligne = _ligne_outil(evenement.outil, evenement.entree)
                outils.append(ligne)
                zone_outils.caption(ligne)
                if not texte:
                    zone_texte.markdown(":gray[_Lecture des données du cockpit…_]")
            elif evenement.type != "fin":
                type_, texte = evenement.type, evenement.texte
        _rendu(zone_texte, type_, texte)
    etat["api"].extend(assistant.nouveaux_messages)
    etat["cout"] += assistant.cout_usd
    etat["affichage"].append({"role": "assistant", "texte": texte, "outils": outils, "type": type_})


@st.fragment
def _bulle() -> None:
    etat = _etat()
    with st.container(key="assistant_grc_bulle"):
        with st.popover(LIBELLE, icon=":material/forum:", type="primary"):
            st.caption("**Assistant GRC** · questions de gouvernance, risques et conformité uniquement · lecture seule")
            if not ANTHROPIC_API_KEY:
                st.info("Assistant indisponible : ajoutez ANTHROPIC_API_KEY dans le fichier .env à la racine du dépôt.")
                return
            zone = st.container(height=360, border=False, autoscroll=True, key="assistant_grc_zone")
            choisie = None
            with zone:
                suggestions = st.empty()
                if not etat["affichage"]:
                    with suggestions.container():
                        st.caption("Exemples de questions :")
                        for i, suggestion in enumerate(SUGGESTIONS):
                            if st.button(suggestion, key=f"assistant_grc_suggestion_{i}", type="tertiary"):
                                choisie = suggestion
                for message in etat["affichage"]:
                    _afficher(message)
            plafond = etat["cout"] >= ASSISTANT_PLAFOND_USD
            saisie = st.chat_input("Votre question GRC…", key="assistant_grc_saisie", max_chars=2000, disabled=plafond)
            question = (saisie or choisie or "").strip()
            if question and not plafond:
                suggestions.empty()
                with zone:
                    _repondre(etat, question)
            if etat["cout"] >= ASSISTANT_PLAFOND_USD:
                st.caption(f"Plafond de {ASSISTANT_PLAFOND_USD:.2f} $ atteint pour cette conversation : ouvrez-en une nouvelle.".replace(".", ",", 1))
            colonne_info, colonne_bouton = st.columns([3, 2], vertical_alignment="center")
            colonne_info.caption(f"{ASSISTANT_MODELE} · {etat['cout']:.4f} $".replace(".", ","))
            colonne_bouton.button("Nouvelle conversation", key="assistant_grc_reset", on_click=_reinitialiser, disabled=not etat["affichage"], type="tertiary")


def injecter_style() -> None:
    """À appeler en tête de app.py : pendant un rechargement, la bulle encore affichée reste fixée."""
    st.html(STYLE)


def afficher_assistant() -> None:
    """À appeler depuis app.py, après la page : la bulle est positionnée en CSS, hors du flux de la page."""
    _bulle()
