import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt (dossier qui contient `modeles/` et `config/`). */
export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Charge `.env` (racine du dépôt par défaut) dans process.env sans écraser les variables déjà définies. */
export function chargerEnv(chemin = join(RACINE, '.env')): void {
  if (!existsSync(chemin)) return;
  for (const ligne of readFileSync(chemin, 'utf8').split(/\r?\n/)) {
    const l = ligne.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const i = l.indexOf('=');
    const cle = l.slice(0, i).trim();
    const valeur = l.slice(i + 1).trim();
    if (process.env[cle] === undefined) process.env[cle] = valeur;
  }
}

export const ROLES_PHASE = {
  pre: 'pre-investissement',
  post: 'post-investissement',
} as const;
