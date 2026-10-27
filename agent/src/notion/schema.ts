/**
 * Définition des six bases Notion (SPEC.md, section 7). Une base = une data source ;
 * la propriété title porte l'ID métier. Les relations bidirectionnelles sont posées après
 * la création de toutes les bases (voir init.ts).
 */
export type BaseKey = 'textes' | 'exigences' | 'controles' | 'risques' | 'jurisprudence' | 'lots';

export type SelectColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

export interface SelectOption {
  name: string;
  color?: SelectColor;
}

/** Schéma de propriété au format de l'API Notion (sous-ensemble utilisé par le projet). */
export type PropertySchema =
  | { title: Record<string, never> }
  | { rich_text: Record<string, never> }
  | { number: { format: 'number' } }
  | { select: { options: SelectOption[] } }
  | { multi_select: { options: SelectOption[] } }
  | { date: Record<string, never> }
  | { url: Record<string, never> }
  | { checkbox: Record<string, never> };

export const title = (): PropertySchema => ({ title: {} });
export const richText = (): PropertySchema => ({ rich_text: {} });
export const number = (): PropertySchema => ({ number: { format: 'number' } });
export const date = (): PropertySchema => ({ date: {} });
export const url = (): PropertySchema => ({ url: {} });
export const checkbox = (): PropertySchema => ({ checkbox: {} });
export const select = (options: (string | SelectOption)[]): PropertySchema => ({
  select: { options: options.map((o) => (typeof o === 'string' ? { name: o } : o)) },
});
export const multiSelect = (options: (string | SelectOption)[] = []): PropertySchema => ({
  multi_select: { options: options.map((o) => (typeof o === 'string' ? { name: o } : o)) },
});

export const STATUT_VALIDATION_OPTIONS: SelectOption[] = [
  { name: 'À valider', color: 'yellow' },
  { name: 'Validée', color: 'green' },
  { name: 'Corrigée', color: 'blue' },
  { name: 'Rejetée', color: 'red' },
  { name: 'À revalider', color: 'orange' },
];

export interface BaseDefinition {
  key: BaseKey;
  titre: string;
  properties: Record<string, PropertySchema>;
}

export interface RelationDefinition {
  from: BaseKey;
  property: string;
  to: BaseKey;
  /** Nom de la propriété miroir créée automatiquement dans la base cible. */
  syncedName: string;
}

export interface FormulaDefinition {
  base: BaseKey;
  property: string;
  expression: string;
}

/** Noms des propriétés, partagés avec le cockpit via notion/ids.json. */
export const P = {
  textes: {
    id: 'ID',
    titre: 'Titre',
    source: 'Source',
    type: 'Type',
    reference: 'Référence officielle',
    url: 'URL officielle',
    date_publication: 'Date de publication',
    date_vigueur: "Date d'entrée en vigueur",
    date_application: "Date d'entrée en application",
    statut: 'Statut du texte',
    hash: 'Hash contenu',
    date_collecte: 'Date de collecte',
    derniere_modification: 'Dernière modification détectée',
    applicable: "Applicable à l'organisation",
    justification_applicabilite: 'Justification applicabilité',
    confiance_applicabilite: 'Confiance applicabilité',
    resume: 'Résumé',
    nombre_articles: "Nombre d'articles",
    exigences: 'Exigences',
    run_id: 'Run ID',
  },
  exigences: {
    id: 'ID',
    titre: 'Titre',
    description: 'Description',
    texte: 'Texte',
    articles: 'Article(s) de référence',
    extrait: 'Extrait verbatim',
    url_article: "URL de l'article",
    verifie: 'Vérifié dans la source',
    type_obligation: "Type d'obligation",
    destinataires: 'Destinataires',
    echeance: 'Échéance',
    type_echeance: "Type d'échéance",
    sanction: 'Sanction',
    niveau_sanction: 'Niveau de sanction',
    confiance: 'Niveau de confiance',
    statut_validation: 'Statut de validation',
    validateur: 'Validateur',
    date_validation: 'Date de validation',
    commentaire_validation: 'Commentaire de validation',
    version_corrigee: 'Version corrigée',
    processus: 'Processus impactés',
    systemes: 'Systèmes impactés',
    donnees: 'Données concernées',
    contrats: 'Contrats concernés',
    effort: 'Effort estimé',
    couverture: 'Couverture',
    controles: 'Contrôles',
    risques: 'Risques',
    jurisprudence: 'Jurisprudence',
    lots: "Lots d'action",
    run_id: 'Run ID',
  },
  controles: {
    id: 'ID',
    nom: 'Nom',
    description: 'Description',
    referentiel: 'Référentiel',
    reference: 'Référence',
    proprietaire: 'Propriétaire',
    statut: 'Statut de mise en œuvre',
    efficacite: 'Efficacité',
    preuves: 'Preuves',
    exigences: 'Exigences couvertes',
    ecart: 'Écart constaté',
    risques: 'Risques atténués',
  },
  risques: {
    id: 'ID',
    intitule: 'Intitulé',
    scenario: 'Scénario',
    categorie: 'Catégorie',
    exigences: 'Exigences liées',
    probabilite: 'Probabilité',
    impact: 'Impact',
    criticite: 'Criticité brute',
    controles: 'Contrôles atténuants',
    residuel: 'Risque résiduel',
    niveau_residuel: 'Niveau résiduel',
    traitement: 'Traitement',
    proprietaire: 'Propriétaire',
    statut: 'Statut',
    lots: "Lots d'action",
  },
  jurisprudence: {
    id: 'ID',
    juridiction: 'Juridiction',
    numero: 'Numéro',
    date: 'Date de décision',
    url: 'URL officielle',
    resume: 'Résumé',
    solution: 'Solution retenue',
    portee: "Portée pour l'organisation",
    pertinence: 'Pertinence',
    exigences: 'Exigences liées',
    mots_cles: 'Mots-clés',
  },
  lots: {
    id: 'ID',
    titre: 'Titre',
    description: 'Description',
    exigences: 'Exigences',
    risques: 'Risques',
    priorite: 'Priorité',
    responsable: 'Responsable',
    echeance: 'Échéance cible',
    statut: 'Statut',
    cadre: 'Cadre de gouvernance',
    phase: 'Phase ou pratique',
    livrable: 'Livrable attendu',
    effort: 'Effort',
  },
} as const;

export const BASES: Record<BaseKey, BaseDefinition> = {
  textes: {
    key: 'textes',
    titre: 'Textes',
    properties: {
      [P.textes.id]: title(),
      [P.textes.titre]: richText(),
      [P.textes.source]: select(['EUR-Lex', 'Légifrance', 'Judilibre', 'Assemblée nationale', 'Sénat', 'CNIL', 'ANSSI', 'Fichier local']),
      [P.textes.type]: select([
        'Règlement UE',
        'Directive UE',
        'Loi',
        'Ordonnance',
        'Décret',
        'Arrêté',
        'Projet de loi',
        'Proposition de loi',
        'Décision',
        'Délibération',
        'Recommandation',
        'Référentiel',
      ]),
      [P.textes.reference]: richText(),
      [P.textes.url]: url(),
      [P.textes.date_publication]: date(),
      [P.textes.date_vigueur]: date(),
      [P.textes.date_application]: date(),
      [P.textes.statut]: select(['En vigueur', 'Projet', 'Adopté', 'Abrogé', 'Modifié']),
      [P.textes.hash]: richText(),
      [P.textes.date_collecte]: date(),
      [P.textes.derniere_modification]: date(),
      [P.textes.applicable]: select([
        { name: 'Oui', color: 'green' },
        { name: 'Non', color: 'red' },
        { name: 'À déterminer', color: 'yellow' },
      ]),
      [P.textes.justification_applicabilite]: richText(),
      [P.textes.confiance_applicabilite]: number(),
      [P.textes.resume]: richText(),
      [P.textes.nombre_articles]: number(),
      [P.textes.run_id]: richText(),
    },
  },
  exigences: {
    key: 'exigences',
    titre: 'Exigences',
    properties: {
      [P.exigences.id]: title(),
      [P.exigences.titre]: richText(),
      [P.exigences.description]: richText(),
      [P.exigences.articles]: richText(),
      [P.exigences.extrait]: richText(),
      [P.exigences.url_article]: url(),
      [P.exigences.verifie]: checkbox(),
      [P.exigences.type_obligation]: select([
        'Obligation de faire',
        'Interdiction',
        'Notification',
        'Documentaire',
        'Gouvernance',
        'Contractuelle',
        'Technique',
      ]),
      [P.exigences.destinataires]: multiSelect(),
      [P.exigences.echeance]: date(),
      [P.exigences.type_echeance]: select(['Entrée en application', 'Transposition', 'Délai de notification', 'Périodique', 'Non précisée']),
      [P.exigences.sanction]: richText(),
      [P.exigences.niveau_sanction]: select(['Faible', 'Moyen', 'Élevé', 'Critique', 'Non précisé']),
      [P.exigences.confiance]: number(),
      [P.exigences.statut_validation]: select(STATUT_VALIDATION_OPTIONS),
      [P.exigences.validateur]: richText(),
      [P.exigences.date_validation]: date(),
      [P.exigences.commentaire_validation]: richText(),
      [P.exigences.version_corrigee]: richText(),
      [P.exigences.processus]: multiSelect(),
      [P.exigences.systemes]: multiSelect(),
      [P.exigences.donnees]: multiSelect(),
      [P.exigences.contrats]: richText(),
      [P.exigences.effort]: select(['Faible', 'Moyen', 'Élevé']),
      [P.exigences.couverture]: select([
        { name: 'Couverte', color: 'green' },
        { name: 'Partielle', color: 'yellow' },
        { name: 'Non couverte', color: 'red' },
        { name: 'À évaluer', color: 'gray' },
      ]),
      [P.exigences.run_id]: richText(),
    },
  },
  controles: {
    key: 'controles',
    titre: 'Contrôles',
    properties: {
      [P.controles.id]: title(),
      [P.controles.nom]: richText(),
      [P.controles.description]: richText(),
      [P.controles.referentiel]: select(['ISO 27001:2022', 'NIST CSF 2.0', 'CIS v8', 'Interne', 'Autre']),
      [P.controles.reference]: richText(),
      [P.controles.proprietaire]: richText(),
      [P.controles.statut]: select([
        { name: 'En place', color: 'green' },
        { name: 'Partiel', color: 'yellow' },
        { name: 'Planifié', color: 'blue' },
        { name: 'Absent', color: 'red' },
      ]),
      [P.controles.efficacite]: select(['Non évaluée', 'Faible', 'Satisfaisante', 'Forte']),
      [P.controles.preuves]: richText(),
      [P.controles.ecart]: richText(),
    },
  },
  risques: {
    key: 'risques',
    titre: 'Risques',
    properties: {
      [P.risques.id]: title(),
      [P.risques.intitule]: richText(),
      [P.risques.scenario]: richText(),
      [P.risques.categorie]: select(['Juridique', 'Financier', 'Opérationnel', 'Réputationnel', 'Cyber']),
      [P.risques.probabilite]: number(),
      [P.risques.impact]: number(),
      [P.risques.residuel]: number(),
      [P.risques.niveau_residuel]: select([
        { name: 'Faible', color: 'green' },
        { name: 'Modéré', color: 'yellow' },
        { name: 'Élevé', color: 'orange' },
        { name: 'Critique', color: 'red' },
      ]),
      [P.risques.traitement]: select(['Réduire', 'Accepter', 'Transférer', 'Éviter']),
      [P.risques.proprietaire]: richText(),
      [P.risques.statut]: select(['Identifié', 'En traitement', 'Accepté', 'Clos']),
    },
  },
  jurisprudence: {
    key: 'jurisprudence',
    titre: 'Jurisprudence',
    properties: {
      [P.jurisprudence.id]: title(),
      [P.jurisprudence.juridiction]: select(['Cour de cassation', "Conseil d'État", 'CJUE', "Cour d'appel", 'CNIL', 'Autre']),
      [P.jurisprudence.numero]: richText(),
      [P.jurisprudence.date]: date(),
      [P.jurisprudence.url]: url(),
      [P.jurisprudence.resume]: richText(),
      [P.jurisprudence.solution]: richText(),
      [P.jurisprudence.portee]: richText(),
      [P.jurisprudence.pertinence]: number(),
      [P.jurisprudence.mots_cles]: multiSelect(),
    },
  },
  lots: {
    key: 'lots',
    titre: "Lots d'action",
    properties: {
      [P.lots.id]: title(),
      [P.lots.titre]: richText(),
      [P.lots.description]: richText(),
      [P.lots.priorite]: select([
        { name: 'P1', color: 'red' },
        { name: 'P2', color: 'orange' },
        { name: 'P3', color: 'yellow' },
        { name: 'P4', color: 'gray' },
      ]),
      [P.lots.responsable]: richText(),
      [P.lots.echeance]: date(),
      [P.lots.statut]: select(['À planifier', 'En cours', 'Terminé', 'Bloqué']),
      [P.lots.cadre]: select(['TOGAF', 'ITIL', 'Hybride']),
      [P.lots.phase]: richText(),
      [P.lots.livrable]: richText(),
      [P.lots.effort]: select(['Faible', 'Moyen', 'Élevé']),
    },
  },
};

/** Relations bidirectionnelles : propriété côté source → propriété miroir côté cible. */
export const RELATIONS: RelationDefinition[] = [
  { from: 'exigences', property: P.exigences.texte, to: 'textes', syncedName: P.textes.exigences },
  { from: 'exigences', property: P.exigences.controles, to: 'controles', syncedName: P.controles.exigences },
  { from: 'exigences', property: P.exigences.risques, to: 'risques', syncedName: P.risques.exigences },
  { from: 'exigences', property: P.exigences.jurisprudence, to: 'jurisprudence', syncedName: P.jurisprudence.exigences },
  { from: 'exigences', property: P.exigences.lots, to: 'lots', syncedName: P.lots.exigences },
  { from: 'risques', property: P.risques.controles, to: 'controles', syncedName: P.controles.risques },
  { from: 'lots', property: P.lots.risques, to: 'risques', syncedName: P.risques.lots },
];

export const FORMULAS: FormulaDefinition[] = [
  { base: 'risques', property: P.risques.criticite, expression: `prop("${P.risques.probabilite}") * prop("${P.risques.impact}")` },
];

export const BASE_KEYS: BaseKey[] = ['textes', 'exigences', 'controles', 'risques', 'jurisprudence', 'lots'];

/** Libellé Notion de la source (select) à partir de l'identifiant interne. */
export const SOURCE_SELECT: Record<string, string> = {
  eurlex: 'EUR-Lex',
  legifrance: 'Légifrance',
  judilibre: 'Judilibre',
  'assemblee-nationale': 'Assemblée nationale',
  senat: 'Sénat',
  cnil: 'CNIL',
  anssi: 'ANSSI',
  'local-file': 'Fichier local',
};
