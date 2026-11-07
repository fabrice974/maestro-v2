/** Lecture d'ecosysteme.yaml et localisation des dépôts voisins (partagé par ecosysteme.ts et impact.ts). */
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { parse } from 'yaml';
import { RACINE } from '@maestro/commun';

export interface Depot {
  nom: string;
  id?: string;
  type?: 'node' | 'dotnet';
  port?: number;
  installer?: string;
  demarrer?: string;
  contrat?: string;
  generer?: string;
  role?: string;
}

export interface Ecosysteme {
  organisation: string;
  sdk: Depot;
  applications: Depot[];
}

export const eco = parse(readFileSync(join(RACINE, 'ecosysteme.yaml'), 'utf8')) as Ecosysteme;

/** Racine du dépôt principal, même depuis un worktree (.claude/worktrees/…). */
const marqueur = `${sep}.claude${sep}worktrees${sep}`;
const racinePrincipale = RACINE.includes(marqueur) ? RACINE.split(marqueur)[0]! : RACINE;

/** Dossier qui contient maestro-v2 et ses dépôts voisins (surcharge : MAESTRO_ECOSYSTEME_DIR). */
export const DOSSIER_ECOSYSTEME = process.env.MAESTRO_ECOSYSTEME_DIR ?? dirname(racinePrincipale);
export const cheminDepot = (nom: string) => join(DOSSIER_ECOSYSTEME, nom);
export const depots = (): Depot[] => [eco.sdk, ...eco.applications];
