/**
 * Réponses simulées par type de tâche (robot de démo et bouton « pré-remplir » des applications).
 * Aucune règle d'affaires ici : seulement des données plausibles pour une caisse d'investissement.
 */
export interface ReponseSimulee {
  champs: Record<string, unknown>;
  decision?: string;
}

const jour = (decalage = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return d.toLocaleDateString('sv-SE');
};

export interface ContexteSimulation {
  montant?: number;
  chantier?: string;
  /** Mois de suivi (1, 2, ...) pour faire varier les ratios. */
  mois?: number;
  /** Personne à qui assigner le mandat. */
  gestionnaire?: string;
}

export function reponseSimulee(typeTache: string, c: ContexteSimulation = {}): ReponseSimulee {
  const montant = c.montant ?? 40_000_000;
  switch (typeTache) {
    case 'dealflow.qualifier-occasion':
      return { champs: { dateReceptionTeaser: jour(-3), sourceOccasion: 'mandataire', resumeThese: 'Actif essentiel, flux contractés à long terme, contrepartie de qualité.' } };
    case 'dealflow.analyse-preliminaire':
      return { champs: { rendementCible: 9.5, dureeAnnees: 7 }, decision: 'poursuivre' };
    case 'dealflow.approbation-principe':
      return { champs: { dateComite: jour() }, decision: 'approuve' };
    case 'dealflow.structuration':
      return { champs: { montantEngagement: montant, modalitesCles: 'Prêt de premier rang, SOFR + 450 pb, sûretés sur les actifs', dateCloturePrevue: jour(30) } };
    case 'dealflow.approbation-finale':
      return { champs: { dateDecision: jour() }, decision: 'approuve' };
    case 'dealflow.documentation-juridique':
      return { champs: { dateSignature: jour() } };
    case 'dealflow.assigner-mandat':
      return { champs: { gestionnaireAssigne: c.gestionnaire ?? 'kevin', dateAssignation: jour() } };
    case 'revue.chantier':
      return { champs: { niveauRisque: c.chantier === 'technique' ? 'moyen' : 'faible', constatsCles: `Constats du chantier ${c.chantier ?? ''} : aucun enjeu bloquant.` } };
    case 'revue.synthese':
      return { champs: { conditions: 'Mise à jour du rapport technique avant le premier tirage' }, decision: 'favorable-avec-conditions' };
    case 'debourse.demande':
      return { champs: { montantTirage: Math.round(montant * 0.6), dateValeur: jour(5), compteBeneficiaire: 'CA-0000-FICTIF-001' } };
    case 'debourse.conditions-prealables':
      return { champs: { cpOpinionJuridique: true, cpAssurances: true, cpGaranties: true, dateValiditeCertificat: jour(60) } };
    case 'debourse.kyc':
      return { champs: { dateVerification: jour() }, decision: 'conforme' };
    case 'debourse.preparer-instruction':
      return { champs: { referencePaiement: `INSTR-${Date.now().toString(36).toUpperCase()}` } };
    case 'debourse.approuver':
    case 'debourse.approuver-conformite':
    case 'desinvest.approbation':
      return { champs: {}, decision: 'approuve' };
    case 'suivi.collecte-mensuelle': {
      // Mois 1 : conforme. Mois 2 : levier 4,2 → surveillance. Mois 3+ : conforme.
      const levier = c.mois === 2 ? 4.2 : 3.4;
      const baiia = 25_000_000;
      return {
        champs: {
          periode: jour().slice(0, 7),
          detteNette: Math.round(baiia * levier),
          baiia,
          fluxDisponibles: 18_000_000,
          serviceDette: c.mois === 2 ? 12_500_000 : 10_000_000,
        },
      };
    }
    case 'suivi.plan-action':
      return { champs: { mesures: 'Réduction des dépenses en capital, revue mensuelle avec la direction', dateRevue: jour(30) } };
    case 'suivi.decision-maintien':
      return { champs: { justification: 'Plan crédible, sûretés suffisantes' }, decision: 'garder' };
    case 'desinvest.these-sortie':
      return { champs: { modeSortie: 'vente-secondaire', motif: 'Rééquilibrage du portefeuille, prime offerte par un acheteur secondaire' } };
    case 'desinvest.evaluation':
      return { champs: { valeurEstimee: Math.round(montant * 1.08), dateEvaluation: jour() } };
    case 'desinvest.execution':
      return { champs: { dateCloture: jour(), produitNet: Math.round(montant * 1.07) } };
    default:
      return { champs: {} };
  }
}
