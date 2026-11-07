import { createHash } from 'node:crypto';

export interface RefDocument {
  id: string;
  nom: string;
  url: string;
  sha256: string;
}

export interface DepotDocuments {
  readonly mode: 'graph' | 'local';
  /** Crée (si besoin) l'arborescence sous la racine de la PoC et renvoie l'URL du dernier dossier. */
  creerDossier(chemin: string[]): Promise<{ url: string }>;
  deposer(chemin: string[], nom: string, contenu: Buffer): Promise<RefDocument>;
  existe(chemin: string[], nom: string): Promise<boolean>;
  /** URL de la racine (pour le cockpit). */
  urlRacine(): Promise<string>;
}

export class ErreurCheminInterdit extends Error {}
export class ErreurDepotIndisponible extends Error {}

/** Refuse tout segment qui pourrait sortir de la racine de la PoC. */
export function segmentSur(s: string): string {
  const t = s.trim();
  if (!t || t === '.' || t === '..' || /[\\/]/.test(t) || t.includes('..') || /[<>:"|?*\x00-\x1f]/.test(t)) {
    throw new ErreurCheminInterdit(`Segment de chemin interdit : « ${s} »`);
  }
  return t;
}

export function sha256(contenu: Buffer): string {
  return createHash('sha256').update(contenu).digest('hex');
}
