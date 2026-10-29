"""Accès Notion : lecture des bases Textes et Exigences (API data sources 2025-09-03) et écriture
des décisions humaines (page + commentaire d'audit). Les noms de propriétés viennent de
`notion/ids.json`, écrit par `pnpm notion init` (source de vérité partagée avec l'agent)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from config import NOTION_API_VERSION, NOTION_IDS_FILE, NOTION_PARENT_PAGE_ID, NOTION_TOKEN
from models import Controle, Decision, Exigence, Jurisprudence, Lot, Recommandation, Risque, RunMetrics, Texte, Validation

RICH_TEXT_LIMIT = 2000

SOURCE_FROM_LABEL = {
    "EUR-Lex": "eurlex",
    "Légifrance": "legifrance",
    "Judilibre": "judilibre",
    "Assemblée nationale": "assemblee-nationale",
    "Sénat": "senat",
    "CNIL": "cnil",
    "ANSSI": "anssi",
    "Fichier local": "local-file",
}


def _plain(prop: dict | None) -> str:
    if not prop:
        return ""
    items = prop.get("rich_text") or prop.get("title") or []
    return "".join(item.get("plain_text") or item.get("text", {}).get("content", "") for item in items)


def _select(prop: dict | None) -> str | None:
    if not prop or not prop.get("select"):
        return None
    return prop["select"].get("name")


def _multi(prop: dict | None) -> list[str]:
    if not prop:
        return []
    return [o.get("name", "") for o in prop.get("multi_select") or [] if o.get("name")]


def _date(prop: dict | None) -> str | None:
    if not prop or not prop.get("date"):
        return None
    return prop["date"].get("start")


def _number(prop: dict | None) -> float | None:
    if not prop:
        return None
    return prop.get("number")


def _checkbox(prop: dict | None) -> bool:
    return bool(prop and prop.get("checkbox"))


def _url(prop: dict | None) -> str | None:
    return prop.get("url") if prop else None


def _relation_ids(prop: dict | None) -> list[str]:
    if not prop:
        return []
    return [r.get("id", "") for r in prop.get("relation") or [] if r.get("id")]


def rich(text: str | None) -> list[dict[str, Any]]:
    """Découpe en objets rich_text de 2 000 caractères (contrainte Notion)."""
    if not text:
        return []
    return [{"type": "text", "text": {"content": text[i : i + RICH_TEXT_LIMIT]}} for i in range(0, len(text), RICH_TEXT_LIMIT)][:25]


def _split_list(text: str) -> list[str]:
    return [part.strip() for part in text.split(";") if part.strip()]


class NotionRepo:
    label = "Notion"
    writable = True

    def __init__(self, token: str, ids: dict, client: Any | None = None) -> None:
        if client is None:
            from notion_client import Client

            client = Client(auth=token, notion_version=NOTION_API_VERSION)
        self.client = client
        self.ids = ids
        self.props_t: dict[str, str] = ids["bases"]["textes"]["proprietes"]
        self.props_e: dict[str, str] = ids["bases"]["exigences"]["proprietes"]
        self._texte_pages: dict[str, str] = {}
        self._page_ids: dict[str, str] = {}

    @classmethod
    def from_env(cls) -> "NotionRepo | None":
        """Instance si le token et `notion/ids.json` existent, sinon `None` (repli local)."""
        if not NOTION_TOKEN or not NOTION_IDS_FILE.exists():
            return None
        ids = json.loads(NOTION_IDS_FILE.read_text(encoding="utf-8"))
        return cls(NOTION_TOKEN, ids)

    # --- lecture ---

    def ping(self) -> None:
        self.client.users.me()

    def _query_all(self, data_source_id: str) -> list[dict]:
        from notion_client.helpers import collect_paginated_api

        return collect_paginated_api(self.client.data_sources.query, data_source_id=data_source_id, page_size=100)

    def _texte_from_page(self, page: dict) -> Texte:
        p = page["properties"]
        P = self.props_t
        label = _select(p.get(P["source"])) or "Fichier local"
        return Texte(
            id=_plain(p.get(P["id"])),
            source=SOURCE_FROM_LABEL.get(label, "local-file"),
            reference=_plain(p.get(P["reference"])),
            titre=_plain(p.get(P["titre"])) or _plain(p.get(P["id"])),
            type=_select(p.get(P["type"])) or "Référentiel",
            url_officielle=_url(p.get(P["url"])) or "",
            date_publication=_date(p.get(P["date_publication"])),
            date_entree_en_vigueur=_date(p.get(P["date_vigueur"])),
            date_entree_en_application=_date(p.get(P["date_application"])),
            statut_texte=_select(p.get(P["statut"])) or "En vigueur",
            hash_sha256=_plain(p.get(P["hash"])),
            collecte_le=_date(p.get(P["date_collecte"])) or "",
            derniere_modification_detectee=_date(p.get(P["derniere_modification"])),
            applicable=_select(p.get(P["applicable"])) or "À déterminer",
            justification_applicabilite=_plain(p.get(P["justification_applicabilite"])) or None,
            confiance_applicabilite=_number(p.get(P["confiance_applicabilite"])),
            resume=_plain(p.get(P["resume"])) or None,
            nombre_articles=int(_number(p.get(P["nombre_articles"])) or 0),
            run_id=_plain(p.get(P["run_id"])),
        )

    def _exigence_from_page(self, page: dict) -> Exigence:
        p = page["properties"]
        P = self.props_e
        echeance_date = _date(p.get(P["echeance"]))
        type_echeance = _select(p.get(P["type_echeance"])) or "Non précisée"
        echeance = {"date": echeance_date, "type": type_echeance, "texte_source": None} if (echeance_date or type_echeance != "Non précisée") else None
        sanction_desc = _plain(p.get(P["sanction"]))
        sanction = {"description": sanction_desc, "niveau": _select(p.get(P["niveau_sanction"])) or "Non précisé", "article": None} if sanction_desc else None
        version_corrigee: dict | None = None
        raw_version = _plain(p.get(P["version_corrigee"]))
        if raw_version:
            try:
                version_corrigee = json.loads(raw_version)
            except ValueError:
                version_corrigee = {"brut": raw_version}
        relations = _relation_ids(p.get(P["texte"]))
        texte_id = self._texte_pages.get(relations[0], "") if relations else ""
        return Exigence(
            id=_plain(p.get(P["id"])),
            texte_id=texte_id or "TX-?",
            titre=_plain(p.get(P["titre"])) or _plain(p.get(P["id"])),
            description=_plain(p.get(P["description"])) or "—",
            articles=_split_list(_plain(p.get(P["articles"]))),
            extrait_verbatim=_plain(p.get(P["extrait"])),
            url_article=_url(p.get(P["url_article"])),
            verifie_dans_source=_checkbox(p.get(P["verifie"])),
            type_obligation=_select(p.get(P["type_obligation"])) or "Obligation de faire",
            destinataires=_multi(p.get(P["destinataires"])),
            echeance=echeance,
            sanction=sanction,
            confiance=_number(p.get(P["confiance"])) or 0.0,
            statut_validation=_select(p.get(P["statut_validation"])) or "À valider",
            validateur=_plain(p.get(P["validateur"])) or None,
            date_validation=_date(p.get(P["date_validation"])),
            commentaire_validation=_plain(p.get(P["commentaire_validation"])) or None,
            version_corrigee=version_corrigee,
            processus_impactes=_multi(p.get(P["processus"])),
            systemes_impactes=_multi(p.get(P["systemes"])),
            donnees_concernees=_multi(p.get(P["donnees"])),
            contrats_concernes=_split_list(_plain(p.get(P["contrats"]))),
            effort_estime=_select(p.get(P["effort"])),
            couverture=_select(p.get(P["couverture"])) or "À évaluer",
            run_id=_plain(p.get(P["run_id"])),
            notion_page_id=page["id"],
            relations_notion={
                "controles": _relation_ids(p.get(P["controles"])),
                "risques": _relation_ids(p.get(P["risques"])),
                "jurisprudence": _relation_ids(p.get(P["jurisprudence"])),
                "lots": _relation_ids(p.get(P["lots"])),
            },
        )

    def textes(self) -> list[Texte]:
        pages = self._query_all(self.ids["bases"]["textes"]["data_source_id"])
        textes = []
        for page in pages:
            texte = self._texte_from_page(page)
            self._texte_pages[page["id"]] = texte.id
            textes.append(texte)
        return textes

    def exigences(self) -> list[Exigence]:
        if not self._texte_pages:
            self.textes()
        pages = self._query_all(self.ids["bases"]["exigences"]["data_source_id"])
        exigences = [self._exigence_from_page(page) for page in pages]
        self._page_ids = {e.id: e.notion_page_id for e in exigences if e.notion_page_id}
        return exigences

    def _props(self, base: str) -> dict[str, str]:
        return self.ids["bases"][base]["proprietes"]

    def _title(self, page: dict, prop: str) -> str:
        return _plain(page["properties"].get(prop))

    def controles(self) -> list[Controle]:
        P = self._props("controles")
        out = []
        for page in self._query_all(self.ids["bases"]["controles"]["data_source_id"]):
            p = page["properties"]
            out.append(Controle(
                id=_plain(p.get(P["id"])), nom=_plain(p.get(P["nom"])), description=_plain(p.get(P["description"])),
                referentiel=_select(p.get(P["referentiel"])) or "", reference=_plain(p.get(P["reference"])),
                proprietaire=_plain(p.get(P["proprietaire"])), statut=_select(p.get(P["statut"])) or "Absent",
                efficacite=_select(p.get(P["efficacite"])) or "Non évaluée", preuves=_plain(p.get(P["preuves"])) or None,
                ecart_constate=_plain(p.get(P["ecart"])) or None,
                exigences_ids=_relation_ids(p.get(P.get("exigences", ""))),
                risques_ids=_relation_ids(p.get(P.get("risques", ""))),
                notion_page_id=page["id"],
            ))
        return out

    def risques(self) -> list[Risque]:
        P = self._props("risques")
        exigence_pages = {page_id: eid for eid, page_id in self._page_ids.items()}
        out = []
        for page in self._query_all(self.ids["bases"]["risques"]["data_source_id"]):
            p = page["properties"]
            rel = _relation_ids(p.get(P["exigences"]))
            out.append(Risque(
                id=_plain(p.get(P["id"])), exigence_id=exigence_pages.get(rel[0], "EX-?") if rel else "EX-?",
                intitule=_plain(p.get(P["intitule"])), scenario=_plain(p.get(P["scenario"])),
                categorie=_select(p.get(P["categorie"])) or "Opérationnel",
                probabilite=int(_number(p.get(P["probabilite"])) or 1), impact=int(_number(p.get(P["impact"])) or 1),
                criticite_brute=int((p.get(P["criticite"]) or {}).get("formula", {}).get("number") or (int(_number(p.get(P["probabilite"])) or 1) * int(_number(p.get(P["impact"])) or 1))),
                risque_residuel=int(_number(p.get(P["residuel"])) or 1), niveau_residuel=_select(p.get(P["niveau_residuel"])) or "Faible",
                traitement=_select(p.get(P["traitement"])) or "Réduire", proprietaire=_plain(p.get(P["proprietaire"])),
                statut=_select(p.get(P["statut"])) or "Identifié",
                controles_attenuants=_relation_ids(p.get(P.get("controles", ""))),
                lots_ids=_relation_ids(p.get(P.get("lots", ""))),
                notion_page_id=page["id"],
            ))
        return out

    def jurisprudence(self) -> list[Jurisprudence]:
        P = self._props("jurisprudence")
        exigence_pages = {page_id: eid for eid, page_id in self._page_ids.items()}
        out = []
        for page in self._query_all(self.ids["bases"]["jurisprudence"]["data_source_id"]):
            p = page["properties"]
            out.append(Jurisprudence(
                id=_plain(p.get(P["id"])), juridiction=_select(p.get(P["juridiction"])) or "Autre", numero=_plain(p.get(P["numero"])),
                date_decision=_date(p.get(P["date"])), url_officielle=_url(p.get(P["url"])) or "", resume=_plain(p.get(P["resume"])),
                solution_retenue=_plain(p.get(P["solution"])) or None, portee=_plain(p.get(P["portee"])) or None,
                pertinence=_number(p.get(P["pertinence"])) or 0.0,
                exigences_ids=[exigence_pages.get(r, r) for r in _relation_ids(p.get(P["exigences"]))],
                mots_cles=_multi(p.get(P["mots_cles"])),
            ))
            out[-1].__dict__["notion_page_id"] = page["id"]
        return out

    def lots(self) -> list[Lot]:
        P = self._props("lots")
        exigence_pages = {page_id: eid for eid, page_id in self._page_ids.items()}
        out = []
        for page in self._query_all(self.ids["bases"]["lots"]["data_source_id"]):
            p = page["properties"]
            out.append(Lot(
                id=_plain(p.get(P["id"])), titre=_plain(p.get(P["titre"])), description=_plain(p.get(P["description"])),
                exigences_ids=[exigence_pages.get(r, r) for r in _relation_ids(p.get(P["exigences"]))],
                risques_ids=_relation_ids(p.get(P.get("risques", ""))),
                priorite=_select(p.get(P["priorite"])) or "P3", responsable=_plain(p.get(P["responsable"])),
                echeance_cible=_date(p.get(P["echeance"])), statut=_select(p.get(P["statut"])) or "À planifier",
                cadre_gouvernance=_select(p.get(P["cadre"])) or "Hybride", phase_ou_pratique=_plain(p.get(P["phase"])),
                livrable_attendu=_plain(p.get(P["livrable"])), effort=_select(p.get(P["effort"])) or "Moyen",
                notion_page_id=page["id"],
            ))
        return out

    @staticmethod
    def lier(exigences: list[Exigence], controles: list[Controle], risques: list[Risque], lots: list[Lot], jurisprudence: list[Jurisprudence]) -> None:
        """Résout les relations Notion (identifiants de pages) en identifiants métier, sur toutes les bases."""
        pages: dict[str, str] = {}
        for items in (exigences, controles, risques, lots, jurisprudence):
            for item in items:
                page_id = getattr(item, "notion_page_id", None)
                if page_id:
                    pages[page_id] = item.id

        def resoudre(valeurs: list[str]) -> list[str]:
            return [pages.get(v, v) for v in valeurs]

        for e in exigences:
            rel = e.relations_notion or {}
            for cle, champ in (("risques", "risques_ids"), ("lots", "lots_ids"), ("jurisprudence", "jurisprudence_ids"), ("controles", "controles_ids")):
                if rel.get(cle):
                    setattr(e, champ, resoudre(rel[cle]))
        for c in controles:
            c.exigences_ids = resoudre(c.exigences_ids)
            c.risques_ids = resoudre(c.risques_ids)
        for r in risques:
            r.controles_attenuants = resoudre(r.controles_attenuants)
            r.lots_ids = resoudre(r.lots_ids)
        for lot in lots:
            lot.exigences_ids = resoudre(lot.exigences_ids)
            lot.risques_ids = resoudre(lot.risques_ids)
        for j in jurisprudence:
            j.exigences_ids = resoudre(j.exigences_ids)

    def recommandation(self) -> Recommandation | None:
        from services.local_repo import LocalRepo

        return LocalRepo().recommandation()

    def decision(self) -> Decision | None:
        from services.local_repo import LocalRepo

        return LocalRepo().decision()

    def plan_markdown(self) -> str | None:
        from services.local_repo import LocalRepo

        return LocalRepo().plan_markdown()

    def ecrire_decision_gouvernance(self, cadre: str, auteur: str, date_iso: str, commentaire: str | None, lots: list[Lot]) -> int:
        """Écrit le cadre sur chaque lot d'action et consigne la décision dans la page « Décision de gouvernance »."""
        P = self._props("lots")
        updated = 0
        for lot in lots:
            if not lot.notion_page_id:
                continue
            self.client.pages.update(page_id=lot.notion_page_id, properties={P["cadre"]: {"select": {"name": cadre}}})
            updated += 1
        horodatage = datetime.fromisoformat(date_iso.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")
        texte = f"{horodatage} · Cadre retenu : {cadre} · décidé par {auteur}" + (f" · {commentaire}" if commentaire else "")
        paragraphe = {"object": "block", "type": "paragraph", "paragraph": {"rich_text": rich(texte)}}
        parent = NOTION_PARENT_PAGE_ID
        if parent:
            page_id = self._trouver_page_enfant(parent, "Décision de gouvernance")
            if page_id:
                self.client.blocks.children.append(block_id=page_id, children=[paragraphe])
            else:
                self.client.pages.create(
                    parent={"page_id": parent},
                    properties={"title": [{"type": "text", "text": {"content": "Décision de gouvernance"}}]},
                    children=[paragraphe],
                )
        return updated

    def _trouver_page_enfant(self, parent_id: str, titre: str) -> str | None:
        res = self.client.blocks.children.list(block_id=parent_id, page_size=100)
        for block in res.get("results", []):
            if block.get("type") == "child_page" and block.get("child_page", {}).get("title") == titre:
                return block["id"]
        return None

    def validations(self) -> list[Validation]:
        """Le journal local est alimenté par `pnpm notion pull` (phase 3)."""
        from services.local_repo import LocalRepo

        return LocalRepo().validations()

    def dernier_run(self) -> RunMetrics | None:
        from services.local_repo import LocalRepo

        return LocalRepo().dernier_run()

    # --- écriture ---

    def _find_page_id(self, business_id: str) -> str:
        res = self.client.data_sources.query(
            data_source_id=self.ids["bases"]["exigences"]["data_source_id"],
            filter={"property": self.props_e["id"], "title": {"equals": business_id}},
            page_size=1,
        )
        results = res.get("results") or []
        if not results:
            raise LookupError(f"Exigence {business_id} introuvable dans Notion")
        return results[0]["id"]

    def _properties_for_champs(self, champs: dict[str, Any]) -> dict[str, Any]:
        P = self.props_e
        props: dict[str, Any] = {}
        if "titre" in champs:
            props[P["titre"]] = {"rich_text": rich(str(champs["titre"]))}
        if "description" in champs:
            props[P["description"]] = {"rich_text": rich(str(champs["description"]))}
        if "articles" in champs:
            props[P["articles"]] = {"rich_text": rich(" ; ".join(champs["articles"]))}
        if "type_obligation" in champs:
            props[P["type_obligation"]] = {"select": {"name": str(champs["type_obligation"])}}
        if "destinataires" in champs:
            props[P["destinataires"]] = {"multi_select": [{"name": d.replace(",", " ")} for d in champs["destinataires"]]}
        if "echeance" in champs:
            props[P["echeance"]] = {"date": {"start": champs["echeance"]} if champs["echeance"] else None}
        if "sanction" in champs:
            sanction = champs["sanction"] or {}
            props[P["sanction"]] = {"rich_text": rich(sanction.get("description") or "")}
            props[P["niveau_sanction"]] = {"select": {"name": sanction.get("niveau") or "Non précisé"}}
        return props

    def ecrire_decision(
        self,
        exigence: Exigence,
        statut: str,
        validateur: str,
        date_iso: str,
        commentaire: str | None,
        champs: dict[str, Any] | None,
    ) -> None:
        """Met à jour la page (statut, validateur, date, commentaire, champs corrigés) et ajoute un commentaire d'audit."""
        P = self.props_e
        page_id = exigence.notion_page_id or self._find_page_id(exigence.id)
        props: dict[str, Any] = {
            P["statut_validation"]: {"select": {"name": statut}},
            P["validateur"]: {"rich_text": rich(validateur)},
            P["date_validation"]: {"date": {"start": date_iso}},
            P["commentaire_validation"]: {"rich_text": rich(commentaire or "")},
        }
        if champs:
            props[P["version_corrigee"]] = {"rich_text": rich(json.dumps(champs, ensure_ascii=False))}
            props.update(self._properties_for_champs(champs))
        self.client.pages.update(page_id=page_id, properties=props)
        horodatage = datetime.fromisoformat(date_iso.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")
        audit = f"{horodatage} · {statut} par {validateur} · {commentaire or 'sans commentaire'}"
        self.client.comments.create(parent={"page_id": page_id}, rich_text=rich(audit))
