const MOIS: Record<string, string> = {
  janvier: '01',
  fevrier: '02',
  février: '02',
  mars: '03',
  avril: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  aout: '08',
  août: '08',
  septembre: '09',
  octobre: '10',
  novembre: '11',
  decembre: '12',
  décembre: '12',
};

const DATE_FR =
  /(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i;

/** « 17 janvier 2025 » → « 2025-01-17 ». Renvoie `null` si aucune date française n'est trouvée. */
export function parseDateFr(text: string): string | null {
  const match = DATE_FR.exec(text);
  if (!match) return null;
  const day = match[1]!.padStart(2, '0');
  const month = MOIS[match[2]!.toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${day}`;
}

/** Date d'application déclarée par le texte (« s'applique à partir du … »), ou `null`. */
export function detectApplicationDate(text: string): string | null {
  const match = /s['’]appliqu(?:e|ent)\s+(?:à\s+partir\s+du|à\s+compter\s+du)\s+([^.;\n]+)/i.exec(
    text,
  );
  return match ? parseDateFr(match[1]!) : null;
}
