#!/usr/bin/env node
import { Command } from 'commander';
import { readJson } from './utils/fs.js';
import { AppError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { paths } from './utils/paths.js';
import type { IngestCommandOptions } from './commands/ingest.js';
import type { ExtractCommandOptions } from './commands/extract.js';
import type { MatricesCommandOptions } from './commands/matrices.js';
import type { NotionPushCommandOptions } from './commands/notion-push.js';
import type { DemoCommandOptions } from './commands/demo.js';
import type { WatchCommandOptions } from './commands/watch.js';
import type { ApplicabilityCommandOptions } from './commands/applicability.js';
import type { EnrichCommandOptions } from './commands/enrich.js';
import type { JurisprudenceCommandOptions } from './commands/jurisprudence.js';
import type { RunCommandOptions } from './commands/run.js';
import type { NotionWatchCommandOptions } from './commands/notion-watch.js';
import type { GovernanceCommandOptions } from './commands/governance.js';
import type { AskCommandOptions } from './commands/ask.js';

const pkg = readJson<{ version: string }>(paths.resolve('package.json'), { version: '0.0.0' });

/** Exécute une commande en affichant proprement les erreurs attendues. */
async function execute(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) {
      logger.error(error.message);
    } else {
      logger.error({ err: error }, 'Erreur inattendue');
    }
    process.exitCode = 1;
  }
}

const program = new Command();
program
  .name('veille-grc')
  .description('Agent de veille continue GRC et législative (pipeline TypeScript, AI SDK + Zod)')
  .version(pkg.version)
  .showHelpAfterError();

program
  .command('ingest')
  .description('Charge un texte officiel déjà téléchargé et le segmente en articles (TX-xxxx)')
  .requiredOption('--file <chemin>', 'fichier HTML, PDF ou TXT dans data/sources/')
  .option(
    '--source <id>',
    "source d'origine : eurlex, legifrance, judilibre, cnil, anssi...",
    'eurlex',
  )
  .requiredOption('--ref <reference>', 'référence officielle, ex. CELEX:32022R2554')
  .requiredOption('--url <url>', 'URL officielle du texte')
  .option('--title <titre>', 'titre du texte (déduit du document sinon)')
  .option('--type <type>', 'type de texte : Règlement UE, Directive UE, Loi...')
  .action(async (options: IngestCommandOptions) =>
    execute(async () => (await import('./commands/ingest.js')).default(options)),
  );

program
  .command('applicability')
  .description("Évalue l'applicabilité d'un texte à l'organisation (ApplicabiliteSchema)")
  .requiredOption('--texte <id>', 'identifiant du texte, ex. TX-0001')
  .option('--force', "poursuivre même si l'applicabilité est non ou indéterminée")
  .option('--no-cache', 'ignore le cache LLM')
  .action(async (options: ApplicabilityCommandOptions) =>
    execute(async () => (await import('./commands/applicability.js')).default(options)),
  );

program
  .command('extract')
  .description(
    "Extrait les exigences d'un texte (EX-xxxx) avec vérification verbatim et score de confiance",
  )
  .requiredOption('--texte <id>', 'identifiant du texte, ex. TX-0001')
  .option('--articles <plage>', "plage d'articles, ex. 5-16 ou 5,7,9-12 (tout le texte sinon)")
  .option('--dry-run', 'affiche les chunks sans appeler le modèle')
  .option('--no-cache', 'ignore le cache LLM')
  .action(async (options: ExtractCommandOptions) =>
    execute(async () => (await import('./commands/extract.js')).default(options)),
  );

program
  .command('enrich')
  .description('Complète échéances, sanctions et destinataires à partir des articles transversaux')
  .requiredOption('--texte <id>', 'identifiant du texte')
  .option('--no-cache', 'ignore le cache LLM')
  .action(async (options: EnrichCommandOptions) =>
    execute(async () => (await import('./commands/enrich.js')).default(options)),
  );

program
  .command('jurisprudence')
  .description('Recherche et note la jurisprudence pertinente par exigence (Judilibre)')
  .requiredOption('--texte <id>', 'identifiant du texte')
  .option('--no-cache', 'ignore le cache LLM')
  .action(async (options: JurisprudenceCommandOptions) =>
    execute(async () => (await import('./commands/jurisprudence.js')).default(options)),
  );

program
  .command('matrices')
  .description('Génère les matrices GRC M1 à M5 (CSV, XLSX, MD) à partir du store')
  .option('--texte <id>', 'identifiant du texte')
  .option('--all', 'tous les textes du store')
  .option('--only <liste>', 'matrices à produire, ex. M1 ou M1,M3', 'M1,M2,M3,M4,M5')
  .option('--format <liste>', 'formats : csv, xlsx, md', 'csv,xlsx,md')
  .option('--only-validated', 'ne projeter que les exigences Validée et Corrigée')
  .option('--out <dossier>', 'dossier de sortie', 'output/matrices')
  .action(async (options: MatricesCommandOptions) =>
    execute(async () => (await import('./commands/matrices.js')).default(options)),
  );

program
  .command('governance')
  .description('Recommande un cadre de gouvernance (TOGAF, ITIL, Hybride) et génère le plan')
  .requiredOption('--texte <id>', 'identifiant du texte')
  .option('--no-cache', 'ignore le cache LLM')
  .action(async (options: GovernanceCommandOptions) =>
    execute(async () => (await import('./commands/governance.js')).default(options)),
  );

program
  .command('run')
  .description("Enchaîne le pipeline complet d'analyse sur un texte")
  .requiredOption('--texte <id>', 'identifiant du texte')
  .option('--force', "poursuivre même si l'applicabilité est non ou indéterminée")
  .option('--articles <plage>', "plage d'articles pour l'extraction, ex. 5-16")
  .option(
    '--steps <liste>',
    "étapes à exécuter dans l'ordre : applicability,extract,enrich,jurisprudence,impact,coverage,risks,matrices",
  )
  .option('--no-cache', 'ignore le cache LLM')
  .option(
    '--max-cost <usd>',
    'plafond de coût LLM pour ce run, en dollars (remplace LLM_MAX_COST_PER_RUN)',
  )
  .action(async (options: RunCommandOptions) =>
    execute(async () => (await import('./commands/run.js')).default(options)),
  );

program
  .command('watch')
  .description('Exécution planifiée de la veille selon config/sources.yaml')
  .option('--once', 'un seul passage puis sortie')
  .option(
    '--source <liste>',
    'sources à traiter, ex. eurlex,cnil (toutes les sources activées sinon)',
  )
  .action(async (options: WatchCommandOptions) =>
    execute(async () => (await import('./commands/watch.js')).default(options)),
  );

program
  .command('demo')
  .description('Enchaîne les étapes 1 à 5 du parcours de démonstration avec le cache LLM activé')
  .option('--articles <plage>', "plage d'articles à extraire", '5-16')
  .option('--skip-notion', 'ne pas pousser vers Notion')
  .action(async (options: DemoCommandOptions) =>
    execute(async () => (await import('./commands/demo.js')).default(options)),
  );

program
  .command('ask')
  .description(
    'Interroge les bases Notion en langage naturel via le serveur MCP Notion (lecture seule)',
  )
  .argument(
    '<question>',
    'question en français, ex. « quelles exigences arrivent à échéance avant mars ? »',
  )
  .option('--max-steps <n>', "nombre maximal d'appels d'outils", '8')
  .action(async (question: string, options: { maxSteps?: string }) =>
    execute(async () =>
      (await import('./commands/ask.js')).default({
        question,
        maxSteps: options.maxSteps,
      } satisfies AskCommandOptions),
    ),
  );

program
  .command('status')
  .description('Résume le dernier run (durée, tokens, coût, compteurs)')
  .option('--all', 'liste les derniers runs')
  .option('--json', 'sortie JSON')
  .action(async (options: { all?: boolean; json?: boolean }) =>
    execute(async () => (await import('./commands/status.js')).default(options)),
  );

program
  .command('config')
  .description('Valide .env et config/*.yaml puis affiche un résumé de la configuration')
  .option('--json', 'sortie JSON')
  .action(async (options: { json?: boolean }) =>
    execute(async () => (await import('./commands/config.js')).default(options)),
  );

const notion = program.command('notion').description('Workers Notion : init, push, pull, watch');
notion
  .command('init')
  .description('Crée les 6 bases Notion sous la page parente (idempotent) et écrit notion/ids.json')
  .action(async () => execute(async () => (await import('./commands/notion-init.js')).default()));
notion
  .command('push')
  .description('Pousse le store local vers Notion (upsert par ID métier)')
  .option('--run <id>', 'ne pousser que les objets de ce run')
  .option(
    '--only <liste>',
    'collections : textes,exigences,controles,risques,jurisprudence,relations',
  )
  .action(async (options: NotionPushCommandOptions) =>
    execute(async () => (await import('./commands/notion-push.js')).default(options)),
  );
notion
  .command('pull')
  .description('Rapatrie statuts, corrections et décisions depuis Notion vers data/store/')
  .action(async () => execute(async () => (await import('./commands/notion-pull.js')).default()));
notion
  .command('watch')
  .description('Push et pull périodiques (toutes les 5 minutes par défaut)')
  .option('--interval <minutes>', 'intervalle en minutes', '5')
  .option('--once', 'un seul cycle push / pull')
  .action(async (options: NotionWatchCommandOptions) =>
    execute(async () => (await import('./commands/notion-watch.js')).default(options)),
  );

await program.parseAsync(process.argv);
