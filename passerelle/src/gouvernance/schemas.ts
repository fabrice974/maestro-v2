import { z } from 'zod';

export const ChampSchema = z.object({
  nom: z.string(),
  libelle: z.string(),
  type: z.enum(['texte', 'nombre', 'montant', 'date', 'booleen', 'choix']),
  obligatoire: z.boolean().default(false),
  choix: z.array(z.string()).optional(),
  regle: z.enum(['passe', 'futur']).optional(),
});

export const DocumentRequisSchema = z.object({
  type: z.string(),
  libelle: z.string(),
  obligatoire: z.boolean().default(false),
});

export const DefinitionTacheSchema = z.object({
  titre: z.string(),
  phase: z.string(),
  roleRequis: z.string(),
  delaiSla: z.string().regex(/^P(T?\d+[DHMS])+$|^P\d+D(T\d+[HMS])*$/, 'durée ISO-8601 attendue (ex. P2D, PT4H)'),
  champs: z.array(ChampSchema).default([]),
  documents: z.array(DocumentRequisSchema).default([]),
  decision: z.array(z.string()).optional(),
});

export const CatalogueSchema = z.record(z.string(), DefinitionTacheSchema);

export const OrganisationSchema = z.object({
  equipes: z.record(z.string(), z.object({ nom: z.string() })),
  personnes: z.array(
    z.object({
      id: z.string(),
      nom: z.string(),
      equipe: z.string(),
      titre: z.string().optional(),
      externe: z.boolean().optional(),
    }),
  ),
  roles: z.record(z.string(), z.array(z.string())),
});

export const SecuriteSchema = z.object({
  applications: z.record(
    z.string(),
    z.object({
      nom: z.string(),
      jeton: z.string(),
      url: z.string().url(),
      typesTache: z.array(z.string()),
      evenements: z.array(z.string()).default([]),
      peutCreerDossier: z.boolean().default(false),
      /** Voir toutes les tâches, pièces et l'audit d'un dossier (sinon : seulement ce qui concerne l'application). */
      lectureDossierComplete: z.boolean().default(false),
    }),
  ),
  separationTaches: z.array(z.object({ tache: z.string(), interditSi: z.array(z.string()) })).default([]),
});

export type Champ = z.infer<typeof ChampSchema>;
export type DefinitionTache = z.infer<typeof DefinitionTacheSchema> & { typeTache: string };
export type Personne = z.infer<typeof OrganisationSchema>['personnes'][number];
export type Application = z.infer<typeof SecuriteSchema>['applications'][string] & { id: string };
