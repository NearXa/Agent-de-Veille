"""Outils de lecture de l'assistant GRC, sur un jeu de données en mémoire."""

import json
from types import SimpleNamespace

import pytest

from models import Controle, Decision, Exigence, Jurisprudence, Lot, Recommandation, Risque, Texte
from services.assistant_outils import DEFINITIONS, LIBELLES, LIMITE_RESULTAT, OUTILS, executer, filtrer_par_requete, normaliser


def exigence(identifiant: str, **champs) -> Exigence:
    base = {
        "id": identifiant,
        "texte_id": "TX-0001",
        "titre": f"Exigence {identifiant}",
        "description": "Description",
        "articles": ["Art. 6 §1"],
        "extrait_verbatim": "Les entités financières disposent d'un cadre de gestion du risque lié aux TIC",
        "url_article": "https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554#art_6",
        "verifie_dans_source": True,
        "echeance": {"date": "2025-01-17", "type": "Entrée en application"},
        "sanction": {"description": "Sanctions administratives", "niveau": "Élevé", "article": "Art. 50"},
        "confiance": 0.95,
        "couverture": "Partielle",
        "controles_ids": ["CT-0001"],
    }
    return Exigence.model_validate({**base, **champs})


@pytest.fixture
def source():
    exigences = [
        exigence("EX-0001", titre="Disposer d'un cadre de gestion du risque lié aux TIC", risques_ids=["RK-0001"], lots_ids=["LA-0001"]),
        exigence("EX-0002", titre="Notifier les incidents majeurs liés aux TIC", articles=["Art. 19 §1"], echeance={"date": "2027-03-31", "type": "Périodique"}, couverture="Non couverte", statut_validation="Validée"),
        exigence("EX-0003", titre="Tester le plan de continuité", articles=["Art. 110"], echeance=None, sanction=None),
    ]
    textes = [
        Texte(id="TX-0001", source="eurlex", reference="CELEX:32022R2554", titre="Règlement DORA", type="Règlement UE", url_officielle="https://eur-lex.europa.eu/x", collecte_le="2026-10-27T16:01:00Z", resume="Résilience opérationnelle numérique."),
        Texte(id="TX-0002", source="cnil", reference="https://www.cnil.fr/a", titre="Délibération CNIL", type="Délibération", url_officielle="https://www.cnil.fr/a", collecte_le="2026-10-28T09:00:00Z"),
    ]
    controles = [
        Controle(id="CT-0001", nom="Politiques de sécurité de l'information", referentiel="ISO 27001:2022", reference="A.5.1", statut="En place", exigences_ids=["EX-0001"]),
        Controle(id="CT-0035", nom="Registre des prestataires TIC", referentiel="Interne", reference="INT-02", statut="Absent"),
    ]
    risques = [
        Risque(id="RK-0001", exigence_id="EX-0001", intitule="Absence de cadre", categorie="Juridique", risque_residuel=12, niveau_residuel="Critique", lots_ids=["LA-0001"]),
        Risque(id="RK-0002", exigence_id="EX-0002", intitule="Notification tardive", categorie="Cyber", risque_residuel=3, niveau_residuel="Faible"),
    ]
    lots = [
        Lot(id="LA-0002", titre="Incidents", priorite="P3", statut="En cours", cadre_gouvernance="ITIL", exigences_ids=["EX-0002"]),
        Lot(id="LA-0001", titre="Vision", priorite="P1", statut="À planifier", cadre_gouvernance="TOGAF", exigences_ids=["EX-0001"]),
    ]
    jurisprudence = [Jurisprudence(id="JP-0001", juridiction="Cour de cassation", numero="23-10.000", exigences_ids=["EX-0002"])]
    recommandation = Recommandation(cadre_recommande="Hybride", score_togaf=55, score_itil=65, points_de_decision_humaine=["Budget"])
    return SimpleNamespace(
        textes=lambda: textes,
        exigences=lambda: exigences,
        controles=lambda: controles,
        risques=lambda: risques,
        lots=lambda: lots,
        jurisprudence=lambda: jurisprudence,
        recommandation=lambda: recommandation,
        decision=lambda: Decision(cadre="Hybride", auteur="Neyl", date="2026-10-29"),
    )


def appeler(nom, entree, source):
    contenu, en_erreur = executer(nom, entree, source)
    return json.loads(contenu), en_erreur


def test_definitions_conformes_a_l_api():
    assert [d["name"] for d in DEFINITIONS] == list(OUTILS) == list(LIBELLES)
    for definition in DEFINITIONS:
        schema = definition["input_schema"]
        assert definition["eager_input_streaming"] is True and definition["description"]
        assert schema["type"] == "object" and schema["additionalProperties"] is False
        assert "title" not in json.dumps(schema).replace('"titre"', "")


def test_normalisation_et_recherche_tolerante():
    assert normaliser("Échéance, DORA !") == "echeance dora"
    items = ["Notifier les incidents majeurs", "Tester la continuité", "Registre des incidents"]
    assert filtrer_par_requete(items, str, "INCIDENTS majeurs") == ["Notifier les incidents majeurs", "Registre des incidents"]
    assert filtrer_par_requete(items, str, "") == items


def test_recherche_d_exigences_par_filtres(source):
    def ids(entree):
        resultat, en_erreur = appeler("rechercher_exigences", entree, source)
        assert not en_erreur
        return [e["id"] for e in resultat["exigences"]]

    assert ids({"requete": "incidents majeurs"}) == ["EX-0002"]
    assert ids({"article": "6"}) == ["EX-0001"]
    assert ids({"article": "11"}) == []  # « Art. 110 » ne cite pas l'article 11
    assert ids({"statut_validation": "Validée"}) == ["EX-0002"]
    assert ids({"couverture": "Non couverte"}) == ["EX-0002"]


def test_detail_d_une_exigence(source):
    detail, en_erreur = appeler("detail_exigence", {"id": "ex-0001"}, source)
    assert not en_erreur
    assert detail["id"] == "EX-0001" and detail["texte"]["id"] == "TX-0001"
    assert [c["id"] for c in detail["controles"]] == ["CT-0001"]
    assert [r["id"] for r in detail["risques"]] == ["RK-0001"]
    assert [l["id"] for l in detail["lots"]] == ["LA-0001"]
    introuvable, _ = appeler("detail_exigence", {"id": "EX-9999"}, source)
    assert "introuvable" in introuvable["erreur"]


def test_echeances_risques_lots_controles_veille_jurisprudence_indicateurs(source):
    echeances, _ = appeler("echeances", {"avant": "2026-12-31"}, source)
    assert [e["id"] for e in echeances["exigences"]] == ["EX-0001"]
    assert isinstance(echeances["exigences"][0]["jours_restants"], int)
    risques, _ = appeler("lister_risques", {"niveau_residuel": "Critique"}, source)
    assert [r["id"] for r in risques["risques"]] == ["RK-0001"]
    assert risques["repartition_globale"] == {"Critique": 1, "Faible": 1}
    lots, _ = appeler("lister_lots", {}, source)
    assert [l["id"] for l in lots["lots"]] == ["LA-0001", "LA-0002"]
    controles, _ = appeler("lister_controles", {"statut": "Absent"}, source)
    assert [c["id"] for c in controles["controles"]] == ["CT-0035"]
    veille, _ = appeler("fil_de_veille", {}, source)
    assert [t["id"] for t in veille["textes"]] == ["TX-0002", "TX-0001"]
    decisions, _ = appeler("jurisprudence", {"exigence_id": "EX-0002"}, source)
    assert [j["id"] for j in decisions["decisions"]] == ["JP-0001"]
    indicateurs, _ = appeler("indicateurs", {}, source)
    assert indicateurs["exigences"] == 3 and indicateurs["pct_verifiees_dans_la_source"] == 100
    assert indicateurs["recommandation_gouvernance"]["cadre"] == "Hybride"
    assert indicateurs["decision_gouvernance"]["auteur"] == "Neyl"


def test_entrees_invalides_jamais_executees(source):
    for nom, entree in [
        ("echeances", {"avant": "31/12/2026"}),
        ("lister_risques", {"niveau_residuel": "Inconnu"}),
        ("rechercher_exigences", {"requete": "x", "champ_inconnu": 1}),
        ("rechercher_exigences", {"limite": 500}),
        ("detail_exigence", "EX-0001"),
        ("outil_inexistant", {}),
    ]:
        contenu, en_erreur = executer(nom, entree, source)
        assert en_erreur, nom
        assert "erreur" in json.loads(contenu)


def test_resultat_tronque_au_dela_de_la_limite(source):
    longues = [exigence(f"EX-{i:04d}", titre="x" * 900) for i in range(1, 51)]
    source.exigences = lambda: longues
    contenu, en_erreur = executer("rechercher_exigences", {"limite": 50}, source)
    assert not en_erreur and len(contenu) < LIMITE_RESULTAT + 200 and contenu.endswith("« limite »]")


def test_erreur_de_lecture_remontee_au_modele(source):
    def panne():
        raise ConnectionError("Notion injoignable")

    source.risques = panne
    contenu, en_erreur = executer("lister_risques", {}, source)
    assert en_erreur and "ConnectionError" in json.loads(contenu)["erreur"]


def test_relation_renseignee_d_un_seul_cote(source):
    """Un lot qui liste le risque suffit, même si le risque ne liste pas le lot (et de même pour les contrôles)."""
    risques = [Risque(id="RK-0009", exigence_id="EX-0001", intitule="Sans lien direct", niveau_residuel="Critique", risque_residuel=12)]
    lots = [Lot(id="LA-0009", titre="Lot", risques_ids=["RK-0009"])]
    controles = [Controle(id="CT-0009", nom="Contrôle", exigences_ids=["EX-0003"])]
    source.risques, source.lots, source.controles = (lambda: risques), (lambda: lots), (lambda: controles)
    resultat, _ = appeler("lister_risques", {}, source)
    assert resultat["risques"][0]["lots_ids"] == ["LA-0009"]
    detail, _ = appeler("detail_exigence", {"id": "EX-0003"}, source)
    assert [c["id"] for c in detail["controles"]] == ["CT-0009"]
    couverts, _ = appeler("lister_controles", {}, source)
    assert couverts["controles"][0]["exigences_couvertes"] == ["EX-0003"]
