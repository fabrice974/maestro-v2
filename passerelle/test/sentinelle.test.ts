import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { RACINE } from '@maestro/commun';
import { Journal } from '../src/audit/journal.ts';
import type { Moteur } from '../src/moteur.ts';
import { listerModeles, verifierEtRedeployer } from '../src/sentinelle.ts';

const MODELES = join(RACINE, 'modeles');

function fauxMoteur(processus: string[], decisions: string[]) {
  const deploiements: string[][] = [];
  const m: Moteur = {
    demarrer: async () => ({ cleInstance: '1', version: 1 }),
    publier: async () => {},
    ecouter: () => {},
    arreter: async () => {},
    definitionsDeployees: async () => ({ processus: new Set(processus), decisions: new Set(decisions) }),
    deployer: async (f) => {
      deploiements.push(f);
      return f.map((x) => `${x.split(/[\\/]/).pop()} v1`);
    },
  };
  return { m, deploiements };
}

describe('sentinelle des modèles', () => {
  const tous = listerModeles(MODELES);

  it('lit les identifiants exécutables des BPMN et DMN', () => {
    expect(tous.filter((x) => x.type === 'processus').map((x) => x.id)).toEqual(expect.arrayContaining(['backbone', 'tache-metier', 'debourse']));
    expect(tous.filter((x) => x.type === 'decision').map((x) => x.id)).toContain('niveau-approbation');
  });

  it('cluster effacé : redéploie tout et l’audite', async () => {
    const { m, deploiements } = fauxMoteur([], []);
    const journal = new Journal(new DatabaseSync(':memory:'));
    const r = await verifierEtRedeployer(m, journal, MODELES);
    expect(r.length).toBe(tous.length);
    expect(deploiements).toHaveLength(1);
    expect(journal.lister().at(-1)?.action).toBe('modeles.redeployes');
  });

  it('cluster complet : ne déploie rien', async () => {
    const p = tous.filter((x) => x.type === 'processus').map((x) => x.id);
    const d = tous.filter((x) => x.type === 'decision').map((x) => x.id);
    const { m, deploiements } = fauxMoteur(p, d);
    expect(await verifierEtRedeployer(m, new Journal(new DatabaseSync(':memory:')), MODELES)).toEqual([]);
    expect(deploiements).toHaveLength(0);
  });

  it('un seul modèle manquant : ne redéploie que son fichier', async () => {
    const p = tous.filter((x) => x.type === 'processus' && x.id !== 'debourse').map((x) => x.id);
    const d = tous.filter((x) => x.type === 'decision').map((x) => x.id);
    const { m, deploiements } = fauxMoteur(p, d);
    await verifierEtRedeployer(m, new Journal(new DatabaseSync(':memory:')), MODELES);
    expect(deploiements[0]).toHaveLength(1);
    expect(deploiements[0]![0]).toMatch(/debourse\.bpmn$/);
  });
});
