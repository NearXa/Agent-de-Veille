from models import Exigence, cle_file_validation

EXEMPLE_SPEC = {
    "id": "EX-0007",
    "texte_id": "TX-0001",
    "titre": "Mettre en place un cadre de gestion du risque lié aux TIC",
    "description": "L'entité financière dispose d'un cadre de gestion du risque lié aux TIC solide, complet et documenté.",
    "articles": ["Art. 6 §1"],
    "extrait_verbatim": "Les entités financières disposent d'un cadre de gestion du risque lié aux TIC solide, complet et bien documenté",
    "url_article": "https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554#art_6",
    "verifie_dans_source": True,
    "type_obligation": "Gouvernance",
    "destinataires": ["Entités financières"],
    "echeance": {"date": "2025-01-17", "type": "Entrée en application", "texte_source": "Art. 64"},
    "sanction": None,
    "confiance": 0.91,
    "statut_validation": "À valider",
    "run_id": "RUN-20261027-1601",
}


def test_exigence_exemple_de_la_spec():
    e = Exigence.model_validate(EXEMPLE_SPEC)
    assert e.id == "EX-0007"
    assert e.niveau_confiance == "vert"
    assert not e.a_relire_en_priorite
    assert e.echeance is not None and e.echeance.type == "Entrée en application"


def test_tri_de_la_file_de_validation():
    faible = Exigence.model_validate({**EXEMPLE_SPEC, "id": "EX-0001", "confiance": 0.4})
    moyenne_proche = Exigence.model_validate(
        {**EXEMPLE_SPEC, "id": "EX-0002", "confiance": 0.7, "echeance": {"date": "2026-01-01", "type": "Périodique", "texte_source": None}}
    )
    moyenne_lointaine = Exigence.model_validate({**EXEMPLE_SPEC, "id": "EX-0003", "confiance": 0.7, "echeance": None})
    ordre = sorted([moyenne_lointaine, moyenne_proche, faible], key=cle_file_validation)
    assert [e.id for e in ordre] == ["EX-0001", "EX-0002", "EX-0003"]
    assert faible.niveau_confiance == "rouge" and moyenne_proche.niveau_confiance == "orange"
