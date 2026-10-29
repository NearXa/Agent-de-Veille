import { tool } from 'ai';
import { z } from 'zod';
import { loadEnv } from './env';
import { matches, store, type Exigence } from './store';

const limite = z.number().int().min(1).max(50).default(15).describe('Nombre maximal de résultats');

function resumeExigence(e: Exigence) {
  return {
    id: e.id,
    titre: e.titre,
    articles: e.articles,
    type_obligation: e.type_obligation,
    echeance: e.echeance?.date ?? null,
    type_echeance: e.echeance?.type ?? null,
    sanction: e.sanction
      ? `${e.sanction.niveau}${e.sanction.article ? ` (${e.sanction.article})` : ''}`
      : null,
    couverture: e.couverture,
    confiance: e.confiance,
    verifie_dans_source: e.verifie_dans_source,
    statut_validation: e.statut_validation,
    effort_estime: e.effort_estime,
    risques_ids: e.risques_ids,
    lots_ids: e.lots_ids,
  };
}

/** Outils de lecture exposés au modèle : store local (data/store) et recherche Notion. Aucune écriture. */
export const outils = {
  rechercher_exigences: tool({
    description:
      'Recherche des exigences réglementaires dans le store (titre, description, articles). Filtres optionnels par statut de validation, couverture, article ou texte.',
    inputSchema: z.object({
      requete: z
        .string()
        .optional()
        .describe('Mots-clés en français, ex. « incident majeur notification »'),
      statut_validation: z
        .enum(['À valider', 'Validée', 'Corrigée', 'Rejetée', 'À revalider'])
        .optional(),
      couverture: z.enum(['Couverte', 'Partielle', 'Non couverte', 'À évaluer']).optional(),
      article: z.string().optional().describe('Numéro d’article, ex. « 11 »'),
      texte_id: z.string().optional().describe('Identifiant du texte, ex. TX-0001'),
      limite,
    }),
    execute: async ({ requete, statut_validation, couverture, article, texte_id, limite }) => {
      let items = store.exigences();
      if (texte_id) items = items.filter((e) => e.texte_id === texte_id);
      if (statut_validation) items = items.filter((e) => e.statut_validation === statut_validation);
      if (couverture) items = items.filter((e) => e.couverture === couverture);
      if (article)
        items = items.filter((e) => e.articles.some((a) => new RegExp(`\\b${article}\\b`).test(a)));
      if (requete)
        items = items.filter((e) =>
          matches(
            `${e.titre} ${e.description} ${e.articles.join(' ')} ${e.destinataires.join(' ')}`,
            requete,
          ),
        );
      return { total: items.length, exigences: items.slice(0, limite).map(resumeExigence) };
    },
  }),

  detail_exigence: tool({
    description:
      "Détail complet d'une exigence : description, extrait verbatim, URL de l'article officiel, échéance, sanction, impact, contrôles, risques, lots, avertissements.",
    inputSchema: z.object({ id: z.string().describe('Identifiant, ex. EX-0004') }),
    execute: async ({ id }) => {
      const e = store.exigences().find((x) => x.id.toUpperCase() === id.toUpperCase());
      if (!e) return { erreur: `Exigence ${id} introuvable` };
      const controles = store
        .controles()
        .filter((c) => e.controles_ids.includes(c.id))
        .map((c) => ({
          id: c.id,
          nom: c.nom,
          reference: c.reference,
          statut: c.statut,
          efficacite: c.efficacite,
        }));
      const risques = store
        .risques()
        .filter((r) => r.exigence_id === e.id)
        .map((r) => ({
          id: r.id,
          intitule: r.intitule,
          niveau_residuel: r.niveau_residuel,
          risque_residuel: r.risque_residuel,
          traitement: r.traitement,
          proprietaire: r.proprietaire,
        }));
      const lots = store
        .lots()
        .filter((l) => l.exigences_ids.includes(e.id))
        .map((l) => ({
          id: l.id,
          titre: l.titre,
          priorite: l.priorite,
          statut: l.statut,
          responsable: l.responsable,
        }));
      const texte = store.textes().find((t) => t.id === e.texte_id);
      return {
        ...e,
        texte: texte
          ? { id: texte.id, titre: texte.titre, url_officielle: texte.url_officielle }
          : null,
        controles,
        risques,
        lots,
      };
    },
  }),

  echeances: tool({
    description:
      'Exigences dont l’échéance tombe dans une période donnée (dates ISO AAAA-MM-JJ), triées par date. Sans bornes : toutes les échéances connues.',
    inputSchema: z.object({
      avant: z.string().optional().describe('Date limite incluse, ex. 2026-03-31'),
      apres: z.string().optional().describe('Date de début incluse'),
      limite,
    }),
    execute: async ({ avant, apres, limite }) => {
      const items = store
        .exigences()
        .filter((e) => e.echeance?.date)
        .filter(
          (e) => (!avant || e.echeance!.date! <= avant) && (!apres || e.echeance!.date! >= apres),
        )
        .sort((a, b) => a.echeance!.date!.localeCompare(b.echeance!.date!));
      return {
        total: items.length,
        aujourdhui: new Date().toISOString().slice(0, 10),
        exigences: items.slice(0, limite).map(resumeExigence),
      };
    },
  }),

  lister_risques: tool({
    description:
      'Risques identifiés avec leur niveau résiduel, catégorie, traitement et propriétaire. Filtres optionnels.',
    inputSchema: z.object({
      niveau_residuel: z.enum(['Faible', 'Modéré', 'Élevé', 'Critique']).optional(),
      categorie: z
        .enum(['Juridique', 'Financier', 'Opérationnel', 'Réputationnel', 'Cyber'])
        .optional(),
      exigence_id: z.string().optional(),
      limite,
    }),
    execute: async ({ niveau_residuel, categorie, exigence_id, limite }) => {
      let items = store.risques();
      if (niveau_residuel) items = items.filter((r) => r.niveau_residuel === niveau_residuel);
      if (categorie) items = items.filter((r) => r.categorie === categorie);
      if (exigence_id)
        items = items.filter((r) => r.exigence_id.toUpperCase() === exigence_id.toUpperCase());
      items = [...items].sort((a, b) => b.risque_residuel - a.risque_residuel);
      const niveaux: Record<string, number> = {};
      for (const r of store.risques())
        niveaux[r.niveau_residuel] = (niveaux[r.niveau_residuel] ?? 0) + 1;
      return { total: items.length, repartition_globale: niveaux, risques: items.slice(0, limite) };
    },
  }),

  lister_lots: tool({
    description:
      "Lots d'action (feuille de route de mise en conformité) avec priorité, cadre de gouvernance, responsable, échéance cible et statut.",
    inputSchema: z.object({
      priorite: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
      statut: z.enum(['À planifier', 'En cours', 'Terminé', 'Bloqué']).optional(),
      cadre: z.enum(['TOGAF', 'ITIL', 'Hybride']).optional(),
    }),
    execute: async ({ priorite, statut, cadre }) => {
      let items = store.lots();
      if (priorite) items = items.filter((l) => l.priorite === priorite);
      if (statut) items = items.filter((l) => l.statut === statut);
      if (cadre) items = items.filter((l) => l.cadre_gouvernance === cadre);
      return {
        total: items.length,
        lots: [...items].sort(
          (a, b) => a.priorite.localeCompare(b.priorite) || a.id.localeCompare(b.id),
        ),
      };
    },
  }),

  lister_controles: tool({
    description:
      'Catalogue des contrôles existants (ISO 27001:2022 et internes) avec statut, efficacité et exigences couvertes.',
    inputSchema: z.object({
      statut: z.enum(['En place', 'Partiel', 'Planifié', 'Absent']).optional(),
      requete: z.string().optional(),
      limite,
    }),
    execute: async ({ statut, requete, limite }) => {
      let items = store.controles();
      if (statut) items = items.filter((c) => c.statut === statut);
      if (requete)
        items = items.filter((c) =>
          matches(`${c.nom} ${c.reference} ${c.ecart_constate ?? ''}`, requete),
        );
      return { total: items.length, controles: items.slice(0, limite) };
    },
  }),

  fil_de_veille: tool({
    description:
      'Textes collectés par la veille (règlements, lois, actualités CNIL, bulletins CERT-FR...), du plus récent au plus ancien, avec applicabilité et résumé.',
    inputSchema: z.object({
      source: z
        .string()
        .optional()
        .describe('eurlex, legifrance, senat, assemblee-nationale, cnil, anssi'),
      requete: z.string().optional(),
      limite,
    }),
    execute: async ({ source, requete, limite }) => {
      let items = store.textes();
      if (source) items = items.filter((t) => t.source === source);
      if (requete)
        items = items.filter((t) =>
          matches(`${t.titre} ${t.resume ?? ''} ${t.reference}`, requete),
        );
      return {
        total: items.length,
        textes: [...items]
          .sort((a, b) => b.collecte_le.localeCompare(a.collecte_le))
          .slice(0, limite)
          .map((t) => ({
            id: t.id,
            titre: t.titre,
            source: t.source,
            reference: t.reference,
            type: t.type,
            collecte_le: t.collecte_le,
            applicable: t.applicable,
            nombre_articles: t.nombre_articles,
            modifie: t.derniere_modification_detectee,
            url_officielle: t.url_officielle,
            resume: t.resume,
          })),
      };
    },
  }),

  indicateurs: tool({
    description:
      'Indicateurs de pilotage : exigences par statut et par couverture, % vérifiées dans la source, risques par niveau, lots par statut, recommandation et décision de cadre de gouvernance.',
    inputSchema: z.object({}),
    execute: async () => {
      const exigences = store.exigences();
      const count = <T>(items: T[], key: (i: T) => string): Record<string, number> => {
        const out: Record<string, number> = {};
        for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
        return out;
      };
      return {
        textes: store.textes().length,
        exigences: exigences.length,
        par_statut: count(exigences, (e) => e.statut_validation),
        par_couverture: count(exigences, (e) => e.couverture),
        pct_verifiees: exigences.length
          ? Math.round(
              (exigences.filter((e) => e.verifie_dans_source).length / exigences.length) * 100,
            )
          : 0,
        risques_par_niveau: count(store.risques(), (r) => r.niveau_residuel),
        lots_par_statut: count(store.lots(), (l) => l.statut),
        recommandation: store.recommandation(),
        decision: store.decision(),
      };
    },
  }),

  rechercher_notion: tool({
    description:
      'Recherche plein texte dans les pages Notion partagées avec l’intégration (bases Textes, Exigences, Contrôles, Risques, Jurisprudence, Lots). Renvoie titres et liens Notion.',
    inputSchema: z.object({
      requete: z.string().min(2),
      limite: z.number().int().min(1).max(20).default(10),
    }),
    execute: async ({ requete, limite }) => {
      const token = loadEnv().NOTION_TOKEN;
      if (!token)
        return {
          erreur:
            'NOTION_TOKEN absent : recherche Notion indisponible, utiliser les outils du store.',
        };
      const { Client } = await import('@notionhq/client');
      const client = new Client({
        auth: token,
        notionVersion: loadEnv().NOTION_API_VERSION ?? '2025-09-03',
      });
      const res = await client.search({
        query: requete,
        page_size: limite,
        filter: { property: 'object', value: 'page' },
      });
      return {
        total: res.results.length,
        pages: res.results.map((p) => {
          const page = p as {
            id: string;
            url?: string;
            properties?: Record<string, { type: string; title?: { plain_text: string }[] }>;
          };
          const title = Object.values(page.properties ?? {}).find((x) => x.type === 'title');
          return {
            titre: (title?.title ?? []).map((t) => t.plain_text).join('') || '(sans titre)',
            url: page.url ?? null,
            id: page.id,
          };
        }),
      };
    },
  }),
};

export type Outils = typeof outils;
