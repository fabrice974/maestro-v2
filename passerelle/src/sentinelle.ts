/**
 * Sentinelle des modèles : vérifie que chaque BPMN/DMN de modeles/ est déployé sur le cluster et
 * redéploie ceux qui manquent. Raison : un cluster d'essai Camunda efface son disque à chaque mise en
 * pause automatique (8 h après création/réveil pour l'étiquette dev, 48 h d'inactivité sinon).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Journal } from './audit/journal.ts';
import type { Moteur } from './moteur.ts';

interface Modele {
  fichier: string;
  id: string;
  type: 'processus' | 'decision';
}

/** Lit l'identifiant exécutable de chaque modèle (process id / decision id), pas le nom de fichier. */
export function listerModeles(racineModeles: string): Modele[] {
  const out: Modele[] = [];
  for (const [dir, type, motif] of [
    ['bpmn', 'processus', /<bpmn:process id="([^"]+)"/g],
    ['dmn', 'decision', /<decision id="([^"]+)"/g],
  ] as const) {
    let fichiers: string[] = [];
    try {
      fichiers = readdirSync(join(racineModeles, dir)).filter((f) => /\.(bpmn|dmn)$/.test(f) && !f.includes('.v2-'));
    } catch {
      continue;
    }
    for (const f of fichiers) {
      const chemin = join(racineModeles, dir, f);
      for (const m of readFileSync(chemin, 'utf8').matchAll(motif)) out.push({ fichier: chemin, id: m[1]!, type });
    }
  }
  return out;
}

/** Renvoie la liste des ressources redéployées (vide si tout était présent). */
export async function verifierEtRedeployer(moteur: Moteur, journal: Journal, racineModeles: string): Promise<string[]> {
  if (!moteur.definitionsDeployees || !moteur.deployer) return [];
  const presents = await moteur.definitionsDeployees();
  const manquants = listerModeles(racineModeles).filter((m) => !(m.type === 'processus' ? presents.processus : presents.decisions).has(m.id));
  if (!manquants.length) return [];
  const fichiers = [...new Set(manquants.map((m) => m.fichier))];
  const deployes = await moteur.deployer(fichiers);
  journal.ajouter({
    acteur: 'passerelle',
    application: 'passerelle',
    action: 'modeles.redeployes',
    details: { manquants: manquants.map((m) => m.id), deployes, motif: 'modèles absents du cluster (mise en pause d’un cluster d’essai ?)' },
  });
  return deployes;
}
