import { applicationPossede, type Gouvernance } from './charger.ts';
import type { DefinitionTache } from './schemas.ts';

export type CodeRefus = 'APPLICATION_NON_AUTORISEE' | 'ROLE_ABSENT' | 'SEPARATION_TACHES' | 'DONNEES_INVALIDES';

export interface Refus {
  code: CodeRefus;
  message: string;
}

export interface ContexteCompletion {
  typeTache: string;
  roleRequis: string;
  utilisateur: string;
  application: string;
  /** Tâches déjà complétées sur le même dossier. */
  historique: { typeTache: string; completeePar: string }[];
}

/** Contrôles de sécurité avant de laisser une complétion atteindre le backbone. */
export function verifierCompletion(g: Gouvernance, c: ContexteCompletion): Refus | null {
  const app = g.applications.get(c.application);
  if (!app || !applicationPossede(app, c.typeTache)) {
    return {
      code: 'APPLICATION_NON_AUTORISEE',
      message: `L'application « ${c.application} » n'est pas autorisée à compléter les tâches « ${c.typeTache} ».`,
    };
  }
  const membres = g.roles.get(c.roleRequis) ?? [];
  if (!membres.includes(c.utilisateur)) {
    return {
      code: 'ROLE_ABSENT',
      message: `« ${c.utilisateur} » ne détient pas le rôle « ${c.roleRequis} » requis par « ${c.typeTache} ».`,
    };
  }
  for (const regle of g.separationTaches.filter((r) => r.tache === c.typeTache)) {
    const conflit = c.historique.find((h) => regle.interditSi.includes(h.typeTache) && h.completeePar === c.utilisateur);
    if (conflit) {
      return {
        code: 'SEPARATION_TACHES',
        message: `Séparation des tâches : « ${c.utilisateur} » a déjà complété « ${conflit.typeTache} » sur ce dossier et ne peut pas compléter « ${c.typeTache} ».`,
      };
    }
  }
  return null;
}

export interface ErreurChamp {
  champ: string;
  erreur: string;
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valide les champs saisis et la présence des documents obligatoires.
 * @param aujourdhui date du jour au format AAAA-MM-JJ (injectée pour les tests)
 */
export function validerDonnees(
  def: DefinitionTache,
  champs: Record<string, unknown>,
  typesDocumentsDeposes: string[],
  decision: string | undefined,
  aujourdhui: string,
): ErreurChamp[] {
  const erreurs: ErreurChamp[] = [];
  for (const c of def.champs) {
    const v = champs[c.nom];
    const vide = v === undefined || v === null || v === '';
    if (vide) {
      if (c.obligatoire) erreurs.push({ champ: c.nom, erreur: `« ${c.libelle} » est obligatoire` });
      continue;
    }
    switch (c.type) {
      case 'date': {
        const s = String(v);
        if (!DATE_ISO.test(s) || Number.isNaN(Date.parse(s))) {
          erreurs.push({ champ: c.nom, erreur: `« ${c.libelle} » doit être une date AAAA-MM-JJ` });
        } else if (c.regle === 'futur' && s < aujourdhui) {
          erreurs.push({ champ: c.nom, erreur: `« ${c.libelle} » doit être aujourd'hui ou dans le futur` });
        } else if (c.regle === 'passe' && s > aujourdhui) {
          erreurs.push({ champ: c.nom, erreur: `« ${c.libelle} » ne peut pas être dans le futur` });
        }
        break;
      }
      case 'nombre':
      case 'montant': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''));
        if (!Number.isFinite(n)) erreurs.push({ champ: c.nom, erreur: `« ${c.libelle} » doit être un nombre` });
        else if (c.type === 'montant' && n < 0) erreurs.push({ champ: c.nom, erreur: `« ${c.libelle} » ne peut pas être négatif` });
        break;
      }
      case 'booleen':
        if (typeof v !== 'boolean' && !['true', 'false', 'on'].includes(String(v))) {
          erreurs.push({ champ: c.nom, erreur: `« ${c.libelle} » doit être vrai ou faux` });
        }
        break;
      case 'choix':
        if (!c.choix?.includes(String(v))) erreurs.push({ champ: c.nom, erreur: `« ${c.libelle} » : valeur non permise` });
        break;
      default:
        break;
    }
  }
  for (const d of def.documents) {
    if (d.obligatoire && !typesDocumentsDeposes.includes(d.type)) {
      erreurs.push({ champ: `document:${d.type}`, erreur: `Document obligatoire manquant : ${d.libelle}` });
    }
  }
  if (def.decision) {
    if (!decision) erreurs.push({ champ: 'decision', erreur: 'Une décision est requise' });
    else if (!def.decision.includes(decision)) erreurs.push({ champ: 'decision', erreur: `Décision « ${decision} » non permise` });
  }
  return erreurs;
}

/** Normalise les valeurs saisies (nombres, booléens) avant de les transmettre au BPMN. */
export function normaliserChamps(def: DefinitionTache, champs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of def.champs) {
    const v = champs[c.nom];
    if (v === undefined || v === '') continue;
    if (c.type === 'nombre' || c.type === 'montant') out[c.nom] = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''));
    else if (c.type === 'booleen') out[c.nom] = v === true || v === 'true' || v === 'on';
    else out[c.nom] = v;
  }
  return out;
}
