/**
 * Analyse d'impact : « si je change X, qu'est-ce qui est touché ? »
 * X = un rôle (ex. conformite), un type de tâche (ex. debourse.approuver), une règle DMN
 * (ex. niveau-approbation), une personne (ex. lea) ou une équipe (ex. credit-prive).
 *
 *   npm run impact -- conformite
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RACINE } from '@maestro/commun';
import { applicationDe, chargerGouvernance } from '../../passerelle/src/gouvernance/charger.ts';

const terme = process.argv[2];
if (!terme) {
  console.error('Usage : npm run impact -- <rôle | typeTache | règle DMN | personne | équipe>');
  process.exit(1);
}
const g = chargerGouvernance();
const titre = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ───── Lecture sémantique (gouvernance) ─────
titre(`Analyse d'impact pour « ${terme} »`);

/** Un gabarit de rôle (analyste-{{classeActif}}) correspond-il au terme ? */
const correspond = (gabarit: string, role: string) =>
  // Un gabarit fait d'une seule variable ({{instanceApprobation}}) est choisi par une règle DMN : traité à part.
  !/^\{\{\s*\w+\s*\}\}$/.test(gabarit) && new RegExp(`^${gabarit.replace(/\{\{\s*\w+\s*\}\}/g, '[\\w-]+')}$`).test(role);

if (g.roles.has(terme)) {
  titre('Rôle');
  const membres = g.roles.get(terme)!;
  console.log(`  Détenu par : ${membres.map((id) => g.personnes.find((p) => p.id === id)?.nom ?? id).join(', ') || '(personne !)'}`);
  const taches = [...g.taches.values()].filter((t) => correspond(t.roleRequis, terme));
  console.log(`  Requis par ${taches.length} type(s) de tâche :`);
  for (const t of taches) console.log(`    - ${t.typeTache} (${t.titre}) — application ${applicationDe(g, t.typeTache)?.id}${t.roleRequis !== terme ? ` [via ${t.roleRequis}]` : ''}`);
  if (terme.startsWith('comite-')) console.log('  ⚠ Peut être choisi dynamiquement par la règle niveau-approbation ({{instanceApprobation}}).');
  console.log('  Impact sécurité : retirer une personne de ce rôle lui retire immédiatement le droit de compléter ces tâches (contrôle à la complétion) ;');
  console.log('  les tâches déjà ouvertes restent visibles dans l’application mais toute complétion sera refusée (ROLE_ABSENT, visible dans Operate).');
}

if (g.taches.has(terme)) {
  const t = g.taches.get(terme)!;
  titre('Type de tâche');
  console.log(`  ${t.titre} — phase ${t.phase}, rôle ${t.roleRequis}, délai ${t.delaiSla}`);
  console.log(`  Application propriétaire : ${applicationDe(g, terme)?.id}`);
  console.log(`  Champs : ${t.champs.map((c) => `${c.nom}${c.obligatoire ? '*' : ''}`).join(', ') || '—'} ; documents : ${t.documents.map((d) => d.type).join(', ') || '—'}`);
  const sep = g.separationTaches.filter((r) => r.tache === terme || r.interditSi.includes(terme));
  for (const r of sep) console.log(`  Séparation des tâches : ${r.tache} interdit si la même personne a fait ${r.interditSi.join(', ')}`);
}

const personne = g.personnes.find((p) => p.id === terme);
if (personne) {
  titre('Personne');
  const roles = [...g.roles].filter(([, m]) => m.includes(terme)).map(([r]) => r);
  console.log(`  ${personne.nom} (${personne.equipe}${personne.externe ? ', EXTERNE' : ''}) — rôles : ${roles.join(', ')}`);
  const taches = [...g.taches.values()].filter((t) => roles.some((r) => correspond(t.roleRequis, r)));
  console.log(`  Peut compléter : ${taches.map((t) => t.typeTache).join(', ')}`);
  console.log('  Départ de cette personne : la retirer de config/organisation.yaml (et de ses rôles), redémarrer la passerelle ;');
  console.log('  vérifier ses tâches ouvertes dans le cockpit et l’accès SharePoint au dossier de la PoC.');
}

if (g.equipes[terme]) {
  titre('Équipe');
  console.log(`  Membres : ${g.personnes.filter((p) => p.equipe === terme).map((p) => p.nom).join(', ')}`);
  console.log(`  Rôles accordés à toute l'équipe : ${[...Object.entries(chargerBrutRoles())].filter(([, m]) => m.includes(`equipe:${terme}`)).map(([r]) => r).join(', ') || '—'}`);
}

function chargerBrutRoles(): Record<string, string[]> {
  const brut = readFileSync(join(RACINE, 'config', 'organisation.yaml'), 'utf8');
  const roles: Record<string, string[]> = {};
  let dans = false;
  for (const l of brut.split(/\r?\n/)) {
    if (/^roles:/.test(l)) dans = true;
    else if (/^\S/.test(l)) dans = false;
    else if (dans) {
      const m = /^\s+([\w-]+):\s*\[(.*)\]/.exec(l);
      if (m) roles[m[1]!] = m[2]!.split(',').map((s) => s.trim());
    }
  }
  return roles;
}

// ───── Recherche textuelle (tous les artefacts) ─────
const DOSSIERS = ['modeles', 'config', 'apps', 'contrats', 'passerelle/src', 'packages/commun/src'];
const EXCLUS = /node_modules|bin|obj|\.sqlite|schema\.d\.ts|Generated/;
function fichiers(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (EXCLUS.test(p)) return [];
      return statSync(p).isDirectory() ? fichiers(p) : /\.(bpmn|dmn|ya?ml|ts|cs|cshtml|json)$/.test(n) ? [p] : [];
    });
  } catch {
    return [];
  }
}
const categories: Record<string, string> = {
  modeles: 'Modèles BPMN / DMN (redéploiement requis)',
  config: 'Configuration de gouvernance (redémarrage de la passerelle)',
  apps: 'Applications (nouvelle version de l’application)',
  contrats: 'Contrat d’API (régénérer les clients TS et C#)',
  passerelle: 'Passerelle',
  packages: 'Paquets partagés',
};
const motif = new RegExp(terme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
let total = 0;
for (const d of DOSSIERS) {
  const occ: string[] = [];
  for (const f of fichiers(join(RACINE, d))) {
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .forEach((l, i) => {
        if (motif.test(l) && !l.includes('bpmndi:')) occ.push(`    ${relative(RACINE, f)}:${i + 1}  ${l.trim().slice(0, 110)}`);
      });
  }
  if (occ.length) {
    titre(categories[d.split('/')[0]!] ?? d);
    occ.slice(0, 40).forEach((o) => console.log(o));
    if (occ.length > 40) console.log(`    … ${occ.length - 40} autre(s)`);
    total += occ.length;
  }
}
console.log(`\n${total} occurrence(s). Guides : docs/playbooks/`);
