/**
 * Règles d'affaires (DMN). Ce fichier sert à GÉNÉRER modeles/dmn/*.dmn la première fois ;
 * ensuite, les fichiers .dmn sont la référence et se modifient dans Camunda Modeler (voir playbooks).
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Entree {
  libelle: string;
  expression: string;
  type: 'string' | 'number' | 'boolean';
}
interface Sortie {
  nom: string;
  libelle: string;
  type: 'string' | 'number' | 'boolean';
}
interface Regle {
  si: string[];
  alors: string[];
  note?: string;
}
export interface Table {
  id: string;
  nom: string;
  politique: 'FIRST' | 'UNIQUE' | 'COLLECT';
  entrees: Entree[];
  sorties: Sortie[];
  regles: Regle[];
}

export function versDmn(t: Table): string {
  const entrees = t.entrees
    .map(
      (e, i) =>
        `<input id="Input_${i + 1}" label="${esc(e.libelle)}"><inputExpression id="InputExpression_${i + 1}" typeRef="${e.type}"><text>${esc(e.expression)}</text></inputExpression></input>`,
    )
    .join('\n      ');
  const sorties = t.sorties.map((s, i) => `<output id="Output_${i + 1}" label="${esc(s.libelle)}" name="${esc(s.nom)}" typeRef="${s.type}" />`).join('\n      ');
  const regles = t.regles
    .map(
      (r, i) =>
        `<rule id="Rule_${i + 1}">${r.note ? `<description>${esc(r.note)}</description>` : ''}${r.si
          .map((x, j) => `<inputEntry id="In_${i + 1}_${j + 1}"><text>${esc(x)}</text></inputEntry>`)
          .join('')}${r.alors.map((x, j) => `<outputEntry id="Out_${i + 1}_${j + 1}"><text>${esc(x)}</text></outputEntry>`).join('')}</rule>`,
    )
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Defs_${t.id}" name="${esc(t.nom)}" namespace="http://maestro.poc/dmn" exporter="maestro-generateur" exporterVersion="1.0" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.8.0">
  <decision id="${t.id}" name="${esc(t.nom)}">
    <decisionTable id="Table_${t.id.replace(/-/g, '_')}" hitPolicy="${t.politique}">
      ${entrees}
      ${sorties}
      ${regles}
    </decisionTable>
  </decision>
  <dmndi:DMNDI>
    <dmndi:DMNDiagram id="Diag_${t.id.replace(/-/g, '_')}">
      <dmndi:DMNShape id="Shape_${t.id.replace(/-/g, '_')}" dmnElementRef="${t.id}">
        <dc:Bounds height="80" width="180" x="160" y="100" />
      </dmndi:DMNShape>
    </dmndi:DMNDiagram>
  </dmndi:DMNDI>
</definitions>
`;
}

export const TABLES: Table[] = [
  {
    id: 'admissibilite-mandat',
    nom: 'Admissibilité au mandat',
    politique: 'FIRST',
    entrees: [
      { libelle: 'Secteur', expression: 'secteur', type: 'string' },
      { libelle: 'Montant ($)', expression: 'montant', type: 'number' },
    ],
    sorties: [
      { nom: 'admissible', libelle: 'Admissible', type: 'boolean' },
      { nom: 'motif', libelle: 'Motif', type: 'string' },
    ],
    regles: [
      { si: ['"charbon","armement","tabac","sables-bitumineux"', '-'], alors: ['false', '"Secteur exclu par la politique ESG"'] },
      { si: ['-', '< 10000000'], alors: ['false', '"Sous le ticket minimal du mandat (10 M$)"'] },
      { si: ['-', '> 750000000'], alors: ['false', '"Au-delà de la limite de concentration (750 M$)"'] },
      { si: ['-', '-'], alors: ['true', '"Admissible"'] },
    ],
  },
  {
    id: 'chantiers-revue-diligente',
    nom: 'Chantiers de revue diligente requis',
    politique: 'COLLECT',
    entrees: [{ libelle: "Classe d'actif", expression: 'classeActif', type: 'string' }],
    sorties: [{ nom: 'chantier', libelle: 'Chantier', type: 'string' }],
    regles: [
      { si: ['-'], alors: ['"financiere"'], note: 'Toujours requis' },
      { si: ['-'], alors: ['"juridique"'], note: 'Toujours requis' },
      { si: ['"placement-prive"'], alors: ['"fiscale"'] },
      { si: ['"placement-prive"'], alors: ['"esg"'] },
      { si: ['"infrastructure"'], alors: ['"technique"'] },
      { si: ['"infrastructure"'], alors: ['"assurances"'] },
    ],
  },
  {
    id: 'niveau-approbation',
    nom: "Instance d'approbation",
    politique: 'FIRST',
    entrees: [{ libelle: 'Montant soumis ($)', expression: 'montantDecision', type: 'number' }],
    sorties: [{ nom: 'instanceApprobation', libelle: 'Instance (rôle)', type: 'string' }],
    regles: [
      { si: ['> 100000000'], alors: ['"comite-conseil"'], note: 'Seuil du comité du conseil' },
      { si: ['-'], alors: ['"comite-investissement"'] },
    ],
  },
  {
    id: 'controles-debourse',
    nom: 'Contrôles requis pour un déboursé',
    politique: 'FIRST',
    entrees: [{ libelle: 'Montant du tirage ($)', expression: 'montantTirage', type: 'number' }],
    sorties: [{ nom: 'conformiteRequise', libelle: 'Approbation conformité requise', type: 'boolean' }],
    regles: [
      { si: ['> 50000000'], alors: ['true'], note: 'Seuil conformité' },
      { si: ['-'], alors: ['false'] },
    ],
  },
  {
    id: 'alerte-covenants',
    nom: 'Statut des clauses financières',
    politique: 'FIRST',
    entrees: [
      { libelle: 'Dette nette / BAIIA', expression: 'ratioLevier', type: 'number' },
      { libelle: 'Couverture du service de la dette', expression: 'ratioCouverture', type: 'number' },
    ],
    sorties: [{ nom: 'statut', libelle: 'Statut', type: 'string' }],
    regles: [
      { si: ['<= 4.0', '>= 1.5'], alors: ['"conforme"'] },
      { si: ['<= 4.4', '>= 1.35'], alors: ['"surveillance"'], note: 'Dépassement de 10 % au plus' },
      { si: ['-', '-'], alors: ['"bris"'] },
    ],
  },
];
