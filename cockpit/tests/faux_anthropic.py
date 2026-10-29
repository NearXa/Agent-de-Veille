"""Faux client Anthropic pour les tests de l'assistant : aucun appel réseau, réponses scriptées."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from services.assistant import Classement


def usage(entree: int = 1000, sortie: int = 200) -> SimpleNamespace:
    return SimpleNamespace(input_tokens=entree, output_tokens=sortie, cache_read_input_tokens=0, cache_creation_input_tokens=0)


def texte(contenu: str) -> SimpleNamespace:
    return SimpleNamespace(type="text", text=contenu)


def appel_outil(identifiant: str, nom: str, entree: Any) -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", id=identifiant, name=nom, input=entree)


def tour(contenu: list[Any], stop_reason: str, evenements: list[Any] | None = None) -> "FauxFlux":
    """Un tour de modèle : événements de streaming (texte par défaut) puis message final."""
    if evenements is None:
        evenements = [SimpleNamespace(type="text", text=b.text) for b in contenu if b.type == "text"]
    return FauxFlux(evenements, SimpleNamespace(content=contenu, stop_reason=stop_reason, usage=usage()))


class FauxFlux:
    def __init__(self, evenements: list[Any], final: Any, erreur: Exception | None = None) -> None:
        self.evenements = evenements
        self.final = final
        self.erreur = erreur

    def __enter__(self) -> "FauxFlux":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def __iter__(self):
        if self.erreur is not None:
            raise self.erreur
        yield from self.evenements

    def get_final_message(self) -> Any:
        return self.final


class FauxMessages:
    def __init__(self, categorie: str | None, tours: list[Any], erreur_classement: Exception | None = None) -> None:
        self.categorie = categorie
        self.tours = list(tours)
        self.erreur_classement = erreur_classement
        self.appels_parse: list[dict[str, Any]] = []
        self.appels_stream: list[dict[str, Any]] = []

    def parse(self, **parametres: Any) -> SimpleNamespace:
        self.appels_parse.append(parametres)
        if self.erreur_classement is not None:
            raise self.erreur_classement
        resultat = Classement(categorie=self.categorie, raison="test") if self.categorie else None
        return SimpleNamespace(parsed_output=resultat, stop_reason="end_turn", usage=usage(300, 40))

    def stream(self, **parametres: Any) -> FauxFlux:
        # Copie de la liste envoyée : la boucle l'allonge ensuite, l'API a reçu l'état de cet instant.
        self.appels_stream.append({**parametres, "messages": list(parametres["messages"])})
        return self.tours.pop(0)


class FauxClient:
    def __init__(self, categorie: str | None = "grc", tours: list[Any] | None = None, erreur_classement: Exception | None = None) -> None:
        self.messages = FauxMessages(categorie, tours or [], erreur_classement)
        self.beta = SimpleNamespace(messages=self.messages)
