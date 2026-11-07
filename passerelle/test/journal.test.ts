import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Journal } from '../src/audit/journal.ts';

function journalAvec3() {
  const db = new DatabaseSync(':memory:');
  const j = new Journal(db);
  j.ajouter({ acteur: 'alice', application: 'deal-flow', action: 'dossier.cree', dossierId: 'INV-2026-0001' });
  j.ajouter({ acteur: 'hugo', application: 'debourse', action: 'tache.completee', dossierId: 'INV-2026-0001', tacheId: 't1' });
  j.ajouter({
    acteur: 'passerelle',
    application: 'passerelle',
    action: 'document.depose',
    dossierId: 'INV-2026-0002',
    document: { nom: 'a.pdf', url: 'https://x', sha256: 'ab' },
  });
  return { db, j };
}

describe('Journal d’audit', () => {
  it('chaîne valide après 3 ajouts', () => {
    const { j } = journalAvec3();
    const v = j.verifier();
    expect(v).toMatchObject({ valide: true, entrees: 3 });
    const [e1, e2] = j.lister();
    expect(e2!.hashPrecedent).toBe(e1!.hash);
  });

  it('filtre par dossier', () => {
    const { j } = journalAvec3();
    expect(j.lister({ dossierId: 'INV-2026-0001' })).toHaveLength(2);
  });

  it('UPDATE et DELETE sont refusés par la base', () => {
    const { db } = journalAvec3();
    expect(() => db.exec("UPDATE audit SET contenu = '{}' WHERE seq = 2")).toThrow(/ajout seul/);
    expect(() => db.exec('DELETE FROM audit WHERE seq = 1')).toThrow(/ajout seul/);
  });

  it('verifier détecte une ligne altérée', () => {
    const { db, j } = journalAvec3();
    db.exec('DROP TRIGGER audit_sans_update');
    db.exec(`UPDATE audit SET contenu = '{"acteur":"mallory","application":"debourse","action":"tache.completee","dossierId":"INV-2026-0001","tacheId":"t1"}' WHERE seq = 2`);
    expect(j.verifier()).toMatchObject({ valide: false, rompueA: 2 });
  });
});
