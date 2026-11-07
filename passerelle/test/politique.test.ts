import { describe, expect, it } from 'vitest';
import { chargerGouvernance, resoudreRole } from '../src/gouvernance/charger.ts';
import { validerDonnees, verifierCompletion } from '../src/gouvernance/politique.ts';

const g = chargerGouvernance();
const AUJ = '2026-11-07';

describe('chargement de la gouvernance', () => {
  it('développe les équipes en personnes', () => {
    expect(g.roles.get('tresorerie')).toEqual(['hugo', 'ines']);
    expect(g.roles.get('analyste-credit-prive')).toContain('alice');
  });
  it('résout les gabarits de rôle', () => {
    expect(resoudreRole('analyste-{{classeActif}}', { classeActif: 'infrastructure' })).toBe('analyste-infrastructure');
    expect(() => resoudreRole('revue-{{chantier}}', {})).toThrow(/chantier/);
  });
});

describe('verifierCompletion', () => {
  const base = { typeTache: 'debourse.approuver', roleRequis: 'tresorerie', utilisateur: 'ines', application: 'debourse', historique: [] };

  it('refuse APPLICATION_NON_AUTORISEE quand suivi-periodique complète debourse.approuver', () => {
    expect(verifierCompletion(g, { ...base, application: 'suivi-periodique' })?.code).toBe('APPLICATION_NON_AUTORISEE');
  });
  it('refuse ROLE_ABSENT', () => {
    expect(verifierCompletion(g, { ...base, utilisateur: 'alice' })?.code).toBe('ROLE_ABSENT');
  });
  it('refuse SEPARATION_TACHES quand le préparateur approuve', () => {
    const historique = [{ typeTache: 'debourse.preparer-instruction', completeePar: 'ines' }];
    expect(verifierCompletion(g, { ...base, historique })?.code).toBe('SEPARATION_TACHES');
  });
  it('accepte un approbateur valide', () => {
    const historique = [{ typeTache: 'debourse.preparer-instruction', completeePar: 'hugo' }];
    expect(verifierCompletion(g, { ...base, historique })).toBeNull();
  });
});

describe('validerDonnees', () => {
  const def = g.taches.get('debourse.demande')!;
  const ok = { montantTirage: '25000000', dateValeur: '2026-11-20', compteBeneficiaire: 'CA00-FICTIF' };

  it('accepte des données complètes', () => {
    expect(validerDonnees(def, ok, ['avis-tirage'], undefined, AUJ)).toEqual([]);
  });
  it('signale un champ obligatoire manquant', () => {
    expect(validerDonnees(def, { ...ok, dateValeur: '' }, ['avis-tirage'], undefined, AUJ)).toEqual([
      { champ: 'dateValeur', erreur: expect.stringMatching(/obligatoire/) },
    ]);
  });
  it('signale une date passée quand la règle exige le futur', () => {
    const e = validerDonnees(def, { ...ok, dateValeur: '2026-01-01' }, ['avis-tirage'], undefined, AUJ);
    expect(e[0]?.champ).toBe('dateValeur');
  });
  it('signale une date mal formée sans lever d’exception', () => {
    const e = validerDonnees(def, { ...ok, dateValeur: '20/11/2026' }, ['avis-tirage'], undefined, AUJ);
    expect(e[0]?.erreur).toMatch(/AAAA-MM-JJ/);
  });
  it('signale un document obligatoire absent', () => {
    expect(validerDonnees(def, ok, [], undefined, AUJ)[0]?.champ).toBe('document:avis-tirage');
  });
  it('exige une décision permise', () => {
    const appro = g.taches.get('debourse.approuver')!;
    expect(validerDonnees(appro, {}, [], undefined, AUJ)[0]?.champ).toBe('decision');
    expect(validerDonnees(appro, {}, [], 'peut-etre', AUJ)[0]?.champ).toBe('decision');
    expect(validerDonnees(appro, {}, [], 'approuve', AUJ)).toEqual([]);
  });
});
