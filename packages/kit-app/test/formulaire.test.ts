import { describe, expect, it } from 'vitest';
import { lireFormulaire } from '../src/index.ts';
import { rendreChamps, rendreDepots } from '../src/html.ts';

const def = {
  typeTache: 'debourse.demande',
  titre: 'Demande',
  phase: 'debourse',
  roleRequis: 'gestionnaire-portefeuille',
  delaiSla: 'P2D',
  champs: [
    { nom: 'dateValeur', libelle: 'Date de valeur', type: 'date' as const, obligatoire: true, regle: 'futur' as const },
    { nom: 'note', libelle: 'Note <b>', type: 'texte' as const, obligatoire: false },
  ],
  documents: [{ type: 'avis-tirage', libelle: 'Avis', obligatoire: true }],
  decision: ['approuve', 'refuse'],
};

describe('formulaire généré', () => {
  it('un champ date obligatoire produit <input type="date" required>', () => {
    expect(rendreChamps(def)).toMatch(/<input type="date" id="c_dateValeur" name="champs.dateValeur" value="" required>/);
  });
  it('échappe les libellés et ajoute la décision', () => {
    const html = rendreChamps(def);
    expect(html).toContain('Note &lt;b&gt;');
    expect(html).toContain('<select id="decision" name="decision" required>');
  });
  it('un document obligatoire produit un champ fichier et l’état « non déposé »', () => {
    const html = rendreDepots(def, [], '/x');
    expect(html).toContain('type="file"');
    expect(html).toContain('Obligatoire — non déposé');
  });
  it('lit un formulaire « champs.x »', () => {
    expect(lireFormulaire({ 'champs.dateValeur': '2026-12-01', decision: 'approuve', u: 'kevin' })).toEqual({ champs: { dateValeur: '2026-12-01' }, decision: 'approuve' });
  });
});
