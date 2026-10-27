import json

from services.local_repo import LocalRepo
from tests.test_models import EXEMPLE_SPEC

TEXTE = {
    "id": "TX-0001",
    "source": "eurlex",
    "reference": "CELEX:32022R2554",
    "titre": "Règlement DORA",
    "type": "Règlement UE",
    "url_officielle": "https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554",
    "hash_sha256": "0" * 64,
    "collecte_le": "2026-10-27T16:01:00Z",
    "nombre_articles": 64,
    "articles": [],
    "run_id": "RUN-20261027-1601",
}


def test_lecture_du_store_local(tmp_path):
    store = tmp_path / "store"
    store.mkdir()
    (store / "textes.json").write_text(json.dumps([TEXTE]), encoding="utf-8")
    (store / "exigences.json").write_text(json.dumps([EXEMPLE_SPEC]), encoding="utf-8")
    runs = tmp_path / "runs"
    (runs / "RUN-20261027-1601").mkdir(parents=True)
    (runs / "RUN-20261027-1601" / "metrics.json").write_text(
        json.dumps({"run_id": "RUN-20261027-1601", "kind": "extract", "status": "ok", "counts": {"exigences": 1}}),
        encoding="utf-8",
    )
    repo = LocalRepo(store, runs)
    assert repo.ping() is None
    assert [t.id for t in repo.textes()] == ["TX-0001"]
    assert [e.id for e in repo.exigences()] == ["EX-0007"]
    assert repo.validations() == []
    assert repo.dernier_run().counts == {"exigences": 1}


def test_store_absent_ou_vide(tmp_path):
    repo = LocalRepo(tmp_path / "absent", tmp_path / "runs-absents")
    assert repo.textes() == [] and repo.exigences() == [] and repo.dernier_run() is None
    (tmp_path / "absent").mkdir()
    (tmp_path / "absent" / "exigences.json").write_text("", encoding="utf-8")
    assert repo.exigences() == []
