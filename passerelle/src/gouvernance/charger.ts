import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { RACINE } from '@maestro/commun';
import {
  CatalogueSchema,
  OrganisationSchema,
  SecuriteSchema,
  type Application,
  type DefinitionTache,
  type Personne,
} from './schemas.ts';

export interface Gouvernance {
  taches: Map<string, DefinitionTache>;
  personnes: Personne[];
  equipes: Record<string, { nom: string }>;
  /** rôle → ids de personnes (équipes déjà développées) */
  roles: Map<string, string[]>;
  applications: Map<string, Application>;
  separationTaches: { tache: string; interditSi: string[] }[];
}

function lire<T>(fichier: string, schema: z.ZodType<T>): T {
  const brut = parse(readFileSync(fichier, 'utf8'));
  const r = schema.safeParse(brut);
  if (!r.success) {
    const details = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide dans ${fichier} :\n${details}`);
  }
  return r.data;
}

export function chargerGouvernance(dir = join(RACINE, 'config')): Gouvernance {
  const catalogue = lire(join(dir, 'taches.yaml'), CatalogueSchema);
  const org = lire(join(dir, 'organisation.yaml'), OrganisationSchema);
  const secu = lire(join(dir, 'securite.yaml'), SecuriteSchema);

  const idsPersonnes = new Set(org.personnes.map((p) => p.id));
  const roles = new Map<string, string[]>();
  for (const [role, membres] of Object.entries(org.roles)) {
    const ids = new Set<string>();
    for (const m of membres) {
      if (m.startsWith('equipe:')) {
        const eq = m.slice('equipe:'.length);
        if (!org.equipes[eq]) throw new Error(`organisation.yaml : rôle ${role} → équipe inconnue « ${eq} »`);
        org.personnes.filter((p) => p.equipe === eq).forEach((p) => ids.add(p.id));
      } else {
        if (!idsPersonnes.has(m)) throw new Error(`organisation.yaml : rôle ${role} → personne inconnue « ${m} »`);
        ids.add(m);
      }
    }
    roles.set(role, [...ids]);
  }

  for (const sep of secu.separationTaches) {
    for (const t of [sep.tache, ...sep.interditSi]) {
      if (!catalogue[t]) throw new Error(`securite.yaml : séparation des tâches → type de tâche inconnu « ${t} »`);
    }
  }

  return {
    taches: new Map(Object.entries(catalogue).map(([typeTache, d]) => [typeTache, { ...d, typeTache }])),
    personnes: org.personnes,
    equipes: org.equipes,
    roles,
    applications: new Map(Object.entries(secu.applications).map(([id, a]) => [id, { ...a, id }])),
    separationTaches: secu.separationTaches,
  };
}

/** Résout les gabarits {{variable}} d'un rôle avec les variables du processus. */
export function resoudreRole(gabarit: string, variables: Record<string, unknown>): string {
  return gabarit.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, nom: string) => {
    const v = variables[nom];
    if (v === undefined || v === null || v === '') throw new Error(`Variable « ${nom} » requise pour résoudre le rôle « ${gabarit} »`);
    return String(v);
  });
}

/** L'application possède-t-elle ce type de tâche ? (motifs « prefixe.* » acceptés) */
export function applicationPossede(app: Application, typeTache: string): boolean {
  return app.typesTache.some((motif) =>
    motif.endsWith('.*') ? typeTache.startsWith(motif.slice(0, -1)) : motif === typeTache,
  );
}

/** Application propriétaire d'un type de tâche (première trouvée). */
export function applicationDe(g: Gouvernance, typeTache: string): Application | undefined {
  return [...g.applications.values()].find((a) => applicationPossede(a, typeTache));
}
