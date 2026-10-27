import json

from models import Exigence
from services.notion_repo import NotionRepo, rich

PROPS_T = {
    "id": "ID", "titre": "Titre", "source": "Source", "type": "Type", "reference": "Référence officielle",
    "url": "URL officielle", "date_publication": "Date de publication", "date_vigueur": "Date d'entrée en vigueur",
    "date_application": "Date d'entrée en application", "statut": "Statut du texte", "hash": "Hash contenu",
    "date_collecte": "Date de collecte", "derniere_modification": "Dernière modification détectée",
    "applicable": "Applicable à l'organisation", "justification_applicabilite": "Justification applicabilité",
    "confiance_applicabilite": "Confiance applicabilité", "resume": "Résumé", "nombre_articles": "Nombre d'articles",
    "exigences": "Exigences", "run_id": "Run ID",
}
PROPS_E = {
    "id": "ID", "titre": "Titre", "description": "Description", "texte": "Texte", "articles": "Article(s) de référence",
    "extrait": "Extrait verbatim", "url_article": "URL de l'article", "verifie": "Vérifié dans la source",
    "type_obligation": "Type d'obligation", "destinataires": "Destinataires", "echeance": "Échéance",
    "type_echeance": "Type d'échéance", "sanction": "Sanction", "niveau_sanction": "Niveau de sanction",
    "confiance": "Niveau de confiance", "statut_validation": "Statut de validation", "validateur": "Validateur",
    "date_validation": "Date de validation", "commentaire_validation": "Commentaire de validation",
    "version_corrigee": "Version corrigée", "processus": "Processus impactés", "systemes": "Systèmes impactés",
    "donnees": "Données concernées", "contrats": "Contrats concernés", "effort": "Effort estimé", "couverture": "Couverture",
    "controles": "Contrôles", "risques": "Risques", "jurisprudence": "Jurisprudence", "lots": "Lots d'action", "run_id": "Run ID",
}
IDS = {
    "bases": {
        "textes": {"data_source_id": "ds-textes", "proprietes": PROPS_T},
        "exigences": {"data_source_id": "ds-exigences", "proprietes": PROPS_E},
    }
}


def t(text):
    return {"rich_text": [{"plain_text": text}]}


TEXTE_PAGE = {
    "id": "page-tx1",
    "properties": {
        "ID": {"title": [{"plain_text": "TX-0001"}]},
        "Titre": t("Règlement DORA"),
        "Source": {"select": {"name": "EUR-Lex"}},
        "Type": {"select": {"name": "Règlement UE"}},
        "Référence officielle": t("CELEX:32022R2554"),
        "URL officielle": {"url": "https://eur-lex.europa.eu/x"},
        "Date de collecte": {"date": {"start": "2026-10-27T16:01:00.000+00:00"}},
        "Nombre d'articles": {"number": 64},
        "Run ID": t("RUN-20261027-1601"),
    },
}
EXIGENCE_PAGE = {
    "id": "page-ex1",
    "properties": {
        "ID": {"title": [{"plain_text": "EX-0001"}]},
        "Titre": t("Mettre en place un cadre"),
        "Description": t("Description"),
        "Texte": {"relation": [{"id": "page-tx1"}]},
        "Article(s) de référence": t("Art. 6 §1 ; Art. 6 §2"),
        "Extrait verbatim": t("Les entités financières disposent"),
        "URL de l'article": {"url": "https://eur-lex.europa.eu/x#art_6"},
        "Vérifié dans la source": {"checkbox": True},
        "Type d'obligation": {"select": {"name": "Gouvernance"}},
        "Destinataires": {"multi_select": [{"name": "Entités financières"}]},
        "Échéance": {"date": {"start": "2025-01-17"}},
        "Type d'échéance": {"select": {"name": "Entrée en application"}},
        "Niveau de confiance": {"number": 0.91},
        "Statut de validation": {"select": {"name": "À valider"}},
        "Run ID": t("RUN-20261027-1601"),
    },
}


class _Comments:
    def __init__(self, log):
        self.log = log

    def create(self, parent, rich_text):
        self.log.append((parent["page_id"], "".join(r["text"]["content"] for r in rich_text)))
        return {"id": "comment-1"}


class FakeClient:
    def __init__(self):
        self.updates = []
        self.comments_log = []
        self.data_sources = self
        self.pages = self
        self.users = self
        self.comments = _Comments(self.comments_log)

    def me(self):
        return {"object": "user"}

    def query(self, data_source_id, **kwargs):
        pages = {"ds-textes": [TEXTE_PAGE], "ds-exigences": [EXIGENCE_PAGE]}[data_source_id]
        return {"results": pages, "has_more": False, "next_cursor": None}

    def update(self, page_id, properties):
        self.updates.append((page_id, properties))
        return {"id": page_id}


def make_repo():
    client = FakeClient()
    return NotionRepo("token", IDS, client=client), client


def test_lecture_des_textes_et_exigences():
    repo, _ = make_repo()
    textes = repo.textes()
    assert textes[0].id == "TX-0001" and textes[0].source == "eurlex" and textes[0].nombre_articles == 64
    exigences = repo.exigences()
    e = exigences[0]
    assert e.id == "EX-0001" and e.texte_id == "TX-0001" and e.notion_page_id == "page-ex1"
    assert e.articles == ["Art. 6 §1", "Art. 6 §2"]
    assert e.echeance is not None and e.echeance.date == "2025-01-17"
    assert e.sanction is None and e.confiance == 0.91 and e.statut_validation == "À valider"


def test_ecriture_d_une_validation_et_du_commentaire_d_audit():
    repo, client = make_repo()
    exigence = repo.exigences()[0]
    repo.ecrire_decision(exigence, "Validée", "N. Kaci", "2026-10-27T16:01:00+00:00", "ok", None)
    page_id, props = client.updates[0]
    assert page_id == "page-ex1"
    assert props["Statut de validation"] == {"select": {"name": "Validée"}}
    assert props["Validateur"]["rich_text"][0]["text"]["content"] == "N. Kaci"
    assert props["Date de validation"] == {"date": {"start": "2026-10-27T16:01:00+00:00"}}
    assert "Version corrigée" not in props
    assert client.comments_log == [("page-ex1", "2026-10-27 16:01 · Validée par N. Kaci · ok")]


def test_ecriture_d_une_correction():
    repo, client = make_repo()
    exigence = repo.exigences()[0]
    champs = {"titre": "Titre corrigé", "articles": ["Art. 6 §1"], "echeance": None, "sanction": {"description": "Amende", "niveau": "Élevé"}}
    repo.ecrire_decision(exigence, "Corrigée", "N. Kaci", "2026-10-27T16:05:00+00:00", "reformulé", champs)
    _, props = client.updates[0]
    assert props["Statut de validation"] == {"select": {"name": "Corrigée"}}
    assert json.loads(props["Version corrigée"]["rich_text"][0]["text"]["content"]) == champs
    assert props["Titre"]["rich_text"][0]["text"]["content"] == "Titre corrigé"
    assert props["Échéance"] == {"date": None}
    assert props["Niveau de sanction"] == {"select": {"name": "Élevé"}}


def test_rich_text_decoupe_a_2000():
    chunks = rich("a" * 4100)
    assert [len(c["text"]["content"]) for c in chunks] == [2000, 2000, 100]
    assert rich(None) == []


def test_exigence_modele_depuis_notion_sans_detail_de_confiance():
    repo, _ = make_repo()
    e = repo.exigences()[0]
    assert isinstance(e, Exigence)
    assert e.confiance_detail.llm == 0 and e.niveau_confiance == "vert"
