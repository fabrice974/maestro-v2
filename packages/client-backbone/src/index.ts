/**
 * Client TypeScript du backbone, généré depuis contrats/openapi.yaml (npm run generer:client).
 * C'est la SEULE dépendance d'une application TypeScript envers le backbone.
 */
import createClient from 'openapi-fetch';
import type { components, paths } from './schema.d.ts';

export type Schemas = components['schemas'];
export type Tache = Schemas['Tache'];
export type TacheDetaillee = Schemas['TacheDetaillee'];
export type DefinitionTache = Schemas['DefinitionTache'];
export type Champ = Schemas['Champ'];
export type Personne = Schemas['Personne'];
export type Dossier = Schemas['Dossier'];
export type Erreur = Schemas['Erreur'];

export interface OptionsClient {
  url: string;
  jeton: string;
}

export function creerClientBackbone({ url, jeton }: OptionsClient) {
  return createClient<paths>({ baseUrl: url, headers: { Authorization: `Bearer ${jeton}` } });
}

export type ClientBackbone = ReturnType<typeof creerClientBackbone>;

/** En-tête de l'utilisateur qui agit. */
export const enTantQue = (utilisateur: string) => ({ 'X-Utilisateur': utilisateur });
