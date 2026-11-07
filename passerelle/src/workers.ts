import type { Moteur } from './moteur.ts';
import type { Services } from './services.ts';

/**
 * Types de jobs pris en charge par la passerelle. Les BPMN n'utilisent QUE ces types génériques :
 * aucune logique métier d'application n'est exécutée dans un worker.
 */
export function enregistrerWorkers(moteur: Moteur, s: Services): string[] {
  const types: Record<string, Parameters<Moteur['ecouter']>[1]> = {
    'tache.ouvrir': (job) => s.ouvrirTache(job),
    'tache.clore': async (job) => {
      s.journal.ajouter({
        acteur: 'backbone',
        application: 'passerelle',
        action: 'tache.close',
        dossierId: String(job.variables.dossierId),
        tacheId: String(job.variables.tacheId),
        cleInstance: job.cleInstance,
        versionModele: `${job.processus} v${job.versionProcessus}`,
      });
    },
    'tache.consigner-refus': (job) => s.consignerRefus(job),
    'tache.escalader': (job) => s.escalader(job),
    'dossier.phase': (job) => s.changerPhase(job),
    'regle.consigner': (job) => s.consignerDecision(job),
    'debourse.executer-paiement': async (job) => {
      // Paiement SIMULÉ : génère un avis d'exécution déposé dans SharePoint et audité.
      const v = job.variables;
      // Idempotence : un job réactivé (délai dépassé, échec de complétion) ne paie pas deux fois.
      const deja = s.journal.lister({ dossierId: String(v.dossierId) }).find((e) => e.action === 'paiement.execute' && e.cleInstance === job.cleInstance);
      if (deja) return { paiement: { ...(deja.details as object), avis: deja.document } };
      const reference = `PMT-${String(v.dossierId)}-${job.cleInstance.slice(-8)}`;
      const montant = Number((v.demande as { champs?: { montantTirage?: number } })?.champs?.montantTirage ?? v.montant ?? 0);
      const avis = [
        "AVIS D'EXÉCUTION DE PAIEMENT (SIMULATION — PoC Maestro)",
        `Dossier : ${String(v.dossierId)} — ${String(v.nom ?? '')}`,
        `Référence : ${reference}`,
        `Montant : ${montant.toLocaleString('fr-CA')} $`,
        `Exécuté le : ${new Date().toISOString()}`,
      ].join('\n');
      const doc = await s.deposerDocumentSysteme(String(v.dossierId), 'debourse', `avis-execution__${reference}.txt`, avis, job.cleInstance);
      s.journal.ajouter({
        acteur: 'backbone',
        application: 'passerelle',
        action: 'paiement.execute',
        dossierId: String(v.dossierId),
        cleInstance: job.cleInstance,
        details: { reference, montant },
        document: doc,
      });
      return { paiement: { reference, montant, avis: doc } };
    },
  };
  for (const [type, gestionnaire] of Object.entries(types)) moteur.ecouter(type, gestionnaire);
  return Object.keys(types);
}
