import { randomUUID } from 'node:crypto';
import type { Journal } from './audit/journal.ts';
import type { DepotDocuments, RefDocument } from './documents/depot.ts';
import { applicationDe, resoudreRole, type Gouvernance } from './gouvernance/charger.ts';
import { normaliserChamps, validerDonnees, verifierCompletion, type ErreurChamp, type Refus } from './gouvernance/politique.ts';
import type { DefinitionTache } from './gouvernance/schemas.ts';
import { ajusterDuree, aujourdhuiLocal, dureeEnSecondes } from './duree.ts';
import type { JobRecu, Moteur } from './moteur.ts';
import type { ClasseActif, Dossier, Registre, Tache } from './registre.ts';

export const DOSSIERS_PHASE: Record<string, string> = {
  'deal-flow': '01-deal-flow',
  'revue-diligente': '02-revue-diligente',
  debourse: '03-debourse',
  'suivi-periodique': '04-suivi-periodique',
  desinvestissement: '05-desinvestissement',
};

export interface Options {
  facteurSla: number;
  delaiSuivi: string;
  /** Notifie l'application propriétaire d'une nouvelle tâche (webhook). */
  notifier?: (appUrl: string, jeton: string, corps: object) => Promise<void>;
}

export class ErreurMetier extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface NouveauDossier {
  nom: string;
  contrepartie: string;
  classeActif: ClasseActif;
  montant: number;
  secteur: string;
}

/** Logique du backbone partagée par l'API REST et les workers Camunda. */
export class Services {
  constructor(
    readonly g: Gouvernance,
    readonly registre: Registre,
    readonly journal: Journal,
    readonly depot: DepotDocuments,
    readonly moteur: Moteur,
    readonly options: Options,
  ) {}

  // ───────────── Dossiers ─────────────

  async creerDossier(entree: NouveauDossier, application: string, utilisateur: string): Promise<Dossier> {
    const app = this.g.applications.get(application);
    if (!app?.peutCreerDossier) throw new ErreurMetier(403, 'APPLICATION_NON_AUTORISEE', `L'application « ${application} » ne peut pas créer de dossier.`);
    const dossierId = this.registre.prochainDossierId();
    const { url } = await this.depot.creerDossier([dossierId]);
    for (const sous of Object.values(DOSSIERS_PHASE)) await this.depot.creerDossier([dossierId, sous]);
    const dossier: Dossier = {
      ...entree,
      dossierId,
      phase: 'deal-flow',
      statut: 'actif',
      urlDocuments: url,
      creePar: utilisateur,
      creeLe: new Date().toISOString(),
    };
    this.registre.creerDossier(dossier);
    const { cleInstance, version } = await this.moteur.demarrer(
      'backbone',
      { ...entree, dossierId, delaiSuivi: this.options.delaiSuivi },
      dossierId,
    );
    this.registre.majDossier(dossierId, { cleInstance });
    this.journal.ajouter({
      acteur: utilisateur,
      application,
      action: 'dossier.cree',
      dossierId,
      cleInstance,
      versionModele: `backbone v${version}`,
      details: { ...entree, urlDocuments: url },
    });
    return { ...dossier, cleInstance };
  }

  async emettreEvenement(dossierId: string, type: string, evenementId: string, donnees: Record<string, unknown>, application: string, utilisateur: string) {
    const app = this.g.applications.get(application);
    if (!app?.evenements.includes(type)) {
      this.journal.ajouter({ acteur: utilisateur, application, action: 'evenement.refuse', dossierId, details: { type, motif: 'APPLICATION_NON_AUTORISEE' } });
      throw new ErreurMetier(403, 'APPLICATION_NON_AUTORISEE', `L'application « ${application} » ne peut pas émettre « ${type} ».`);
    }
    if (!this.registre.dossier(dossierId)) throw new ErreurMetier(404, 'DOSSIER_INCONNU', `Dossier ${dossierId} inconnu`);
    if (!this.registre.enregistrerEvenement(evenementId, dossierId, type)) return { doublon: true };
    await this.moteur.publier(type, dossierId, { [type.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())]: donnees }, evenementId);
    this.journal.ajouter({ acteur: utilisateur, application, action: 'evenement.emis', dossierId, details: { type, evenementId, donnees } });
    return { doublon: false };
  }

  // ───────────── Tâches (côté backbone / workers) ─────────────

  definition(typeTache: string): DefinitionTache {
    const def = this.g.taches.get(typeTache);
    if (!def) throw new Error(`Type de tâche inconnu dans config/taches.yaml : ${typeTache}`);
    return def;
  }

  /** Worker tache.ouvrir : enregistre la tâche, notifie l'application, renvoie tacheId et délai au BPMN. */
  async ouvrirTache(job: JobRecu) {
    const v = job.variables;
    const typeTache = String(v.typeTache ?? job.entetes.typeTache ?? '');
    const dossierId = String(v.dossierId ?? '');
    const def = this.definition(typeTache);
    const app = applicationDe(this.g, typeTache);
    if (!app) throw new Error(`Aucune application ne possède le type de tâche ${typeTache} (config/securite.yaml)`);
    const roleRequis = resoudreRole(def.roleRequis, v);
    if (!this.g.roles.has(roleRequis)) throw new Error(`Rôle « ${roleRequis} » absent de config/organisation.yaml`);
    const delaiSla = ajusterDuree(def.delaiSla, this.options.facteurSla);
    const maintenant = new Date();
    const contexte: Record<string, unknown> = {};
    for (const k of ['nom', 'contrepartie', 'classeActif', 'montant', 'secteur', 'chantier', 'instanceApprobation', 'montantTirage', 'periode', 'statutCovenants']) {
      if (v[k] !== undefined) contexte[k] = v[k];
    }
    const tache = this.registre.ouvrirTache({
      tacheId: randomUUID(),
      dossierId,
      typeTache,
      roleRequis,
      application: app.id,
      cleJob: job.cleJob,
      contexte,
      ouverteLe: maintenant.toISOString(),
      echeance: new Date(maintenant.getTime() + dureeEnSecondes(delaiSla) * 1000).toISOString(),
    });
    if (def.phase && DOSSIERS_PHASE[def.phase]) this.registre.majDossier(dossierId, { phase: def.phase });
    this.journal.ajouter({
      acteur: 'backbone',
      application: 'passerelle',
      action: 'tache.ouverte',
      dossierId,
      tacheId: tache.tacheId,
      cleInstance: job.cleInstance,
      versionModele: `${job.processus} v${job.versionProcessus}`,
      details: { typeTache, roleRequis, application: app.id, echeance: tache.echeance },
    });
    this.options.notifier?.(app.url, app.jeton, { tacheId: tache.tacheId, typeTache, dossierId }).catch(() => undefined);
    return { tacheId: tache.tacheId, roleRequis, delaiSla };
  }

  async escalader(job: JobRecu) {
    const tacheId = String(job.variables.tacheId);
    const t = this.registre.tache(tacheId);
    const delai = String(job.variables.delaiSla ?? 'PT60S');
    this.registre.incrementer(tacheId, 'escalades', new Date(Date.now() + dureeEnSecondes(delai) * 1000).toISOString());
    const superviseurs = this.g.roles.get('superviseur-taches') ?? [];
    this.journal.ajouter({
      acteur: 'backbone',
      application: 'passerelle',
      action: 'tache.escaladee',
      dossierId: t?.dossierId,
      tacheId,
      cleInstance: job.cleInstance,
      details: { typeTache: t?.typeTache, superviseurs, escalades: (t?.escalades ?? 0) + 1 },
    });
    return { escalades: (t?.escalades ?? 0) + 1 };
  }

  async consignerRefus(job: JobRecu) {
    const tacheId = String(job.variables.tacheId);
    this.registre.incrementer(tacheId, 'refus');
    return { refusConsignes: (this.registre.tache(tacheId)?.refus ?? 0) };
  }

  async changerPhase(job: JobRecu) {
    const dossierId = String(job.variables.dossierId);
    const phase = job.entetes.phase;
    const statut = job.entetes.statut as Dossier['statut'] | undefined;
    if (phase) this.registre.majDossier(dossierId, { phase });
    if (statut) this.registre.majDossier(dossierId, { statut });
    this.journal.ajouter({
      acteur: 'backbone',
      application: 'passerelle',
      action: statut ? `dossier.${statut}` : 'dossier.phase',
      dossierId,
      cleInstance: job.cleInstance,
      versionModele: `${job.processus} v${job.versionProcessus}`,
      details: { phase, statut, element: job.element },
    });
  }

  /** Enregistre une décision DMN (après une business rule task) dans l'audit, pour la traçabilité des règles. */
  async consignerDecision(job: JobRecu) {
    const variable = job.entetes.variable ?? '';
    this.journal.ajouter({
      acteur: 'backbone',
      application: 'passerelle',
      action: 'regle.evaluee',
      dossierId: String(job.variables.dossierId),
      cleInstance: job.cleInstance,
      versionModele: `${job.processus} v${job.versionProcessus}`,
      details: { regle: job.entetes.regle, variable, valeur: job.variables[variable] },
    });
  }

  /** Dépose un document produit par le backbone lui-même (ex. avis d'exécution du paiement). */
  async deposerDocumentSysteme(dossierId: string, phase: string, nom: string, contenu: string, cleInstance: string): Promise<RefDocument> {
    const ref = await this.depot.deposer([dossierId, DOSSIERS_PHASE[phase] ?? phase], nom, Buffer.from(contenu, 'utf8'));
    this.journal.ajouter({ acteur: 'backbone', application: 'passerelle', action: 'document.genere', dossierId, cleInstance, document: ref });
    return ref;
  }

  // ───────────── Tâches (côté applications) ─────────────

  tachePourApplication(tacheId: string, application: string): Tache {
    const t = this.registre.tache(tacheId);
    if (!t) throw new ErreurMetier(404, 'TACHE_INCONNUE', `Tâche ${tacheId} inconnue`);
    if (t.application !== application) {
      this.journal.ajouter({ acteur: application, application, action: 'acces.refuse', dossierId: t.dossierId, tacheId, details: { motif: 'APPLICATION_NON_AUTORISEE' } });
      throw new ErreurMetier(403, 'APPLICATION_NON_AUTORISEE', `La tâche ${tacheId} n'appartient pas à l'application « ${application} ».`);
    }
    return t;
  }

  async deposerDocument(tacheId: string, type: string, nomFichier: string, contenu: Buffer, application: string, utilisateur: string) {
    const t = this.registre.tache(tacheId);
    if (!t) throw new ErreurMetier(404, 'TACHE_INCONNUE', `Tâche ${tacheId} inconnue`);
    if (t.statut !== 'ouverte') throw new ErreurMetier(409, 'TACHE_DEJA_COMPLETEE', 'La tâche est déjà complétée');
    const def = this.definition(t.typeTache);
    if (!def.documents.some((d) => d.type === type)) {
      throw new ErreurMetier(422, 'TYPE_DOCUMENT_INCONNU', `Le type de document « ${type} » n'est pas attendu pour ${t.typeTache}`);
    }
    const nomFinal = `${type}__${nomFichier}`;
    const ref = await this.depot.deposer([t.dossierId, DOSSIERS_PHASE[def.phase] ?? def.phase], nomFinal, contenu);
    const deposeLe = new Date().toISOString();
    this.registre.ajouterDocument({ ...ref, tacheId, dossierId: t.dossierId, type, deposePar: utilisateur, deposeLe });
    this.journal.ajouter({ acteur: utilisateur, application, action: 'document.depose', dossierId: t.dossierId, tacheId, document: ref, details: { type } });
    return { ...ref, type };
  }

  async completer(
    tacheId: string,
    entree: { champs?: Record<string, unknown>; decision?: string },
    application: string,
    utilisateur: string,
  ): Promise<{ resultat: Record<string, unknown> }> {
    const t = this.registre.tache(tacheId);
    if (!t) throw new ErreurMetier(404, 'TACHE_INCONNUE', `Tâche ${tacheId} inconnue`);
    if (t.statut !== 'ouverte') throw new ErreurMetier(409, 'TACHE_DEJA_COMPLETEE', `La tâche a déjà été complétée par ${t.completeePar}`);
    const def = this.definition(t.typeTache);
    const historique = this.registre
      .taches({ dossierId: t.dossierId, statut: 'completee' })
      .map((h) => ({ typeTache: h.typeTache, completeePar: h.completeePar ?? '' }));

    const refus: Refus | null = verifierCompletion(this.g, {
      typeTache: t.typeTache,
      roleRequis: t.roleRequis,
      utilisateur,
      application,
      historique,
    });
    if (refus) {
      await this.refuser(t, refus, application, utilisateur);
      throw new ErreurMetier(403, refus.code, refus.message);
    }

    const docs = this.registre.documents({ tacheId });
    const champs = entree.champs ?? {};
    const erreurs: ErreurChamp[] = validerDonnees(def, champs, docs.map((d) => d.type), entree.decision, aujourdhuiLocal());
    if (erreurs.length) {
      await this.refuser(t, { code: 'DONNEES_INVALIDES', message: erreurs.map((e) => e.erreur).join(' ; ') }, application, utilisateur);
      throw new ErreurMetier(422, 'DONNEES_INVALIDES', 'Données invalides', erreurs);
    }

    const resultat = {
      typeTache: t.typeTache,
      champs: normaliserChamps(def, champs),
      decision: entree.decision ?? null,
      documents: docs.map((d) => ({ type: d.type, nom: d.nom, url: d.url, sha256: d.sha256 })),
      completeePar: utilisateur,
    };
    if (!this.registre.completerTache(tacheId, utilisateur, resultat)) {
      throw new ErreurMetier(409, 'TACHE_DEJA_COMPLETEE', 'La tâche vient d’être complétée par une autre requête');
    }
    await this.moteur.publier('tache.completee', tacheId, { resultat }, `${tacheId}:completee`);
    this.journal.ajouter({
      acteur: utilisateur,
      application,
      action: 'tache.completee',
      dossierId: t.dossierId,
      tacheId,
      details: { typeTache: t.typeTache, decision: entree.decision ?? null, champs: resultat.champs, documents: resultat.documents.map((d) => `${d.type}:${d.sha256.slice(0, 12)}`) },
    });
    return { resultat };
  }

  private async refuser(t: Tache, refus: Refus, application: string, utilisateur: string) {
    this.journal.ajouter({
      acteur: utilisateur,
      application,
      action: 'tache.refusee',
      dossierId: t.dossierId,
      tacheId: t.tacheId,
      details: { typeTache: t.typeTache, code: refus.code, message: refus.message },
    });
    // Le refus est rendu visible dans Operate (étape « Consigner le refus » de tache-metier).
    await this.moteur.publier(
      'tache.refusee',
      t.tacheId,
      { dernierRefus: { ...refus, utilisateur, application } },
      `${t.tacheId}:refus:${t.refus + 1}:${Date.now()}`,
    );
  }
}
