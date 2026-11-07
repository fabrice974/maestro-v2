import { Processus } from './constructeur.ts';

/** Patron « tâche métier garantie » : réutilisé par TOUTES les tâches humaines. */
export function tacheMetier(): Processus {
  return new Processus(
    'tache-metier',
    'Tâche métier garantie',
    "La tâche est réalisée dans l'application métier ; le backbone garantit qu'elle est complétée par la bonne personne, avec les bonnes pièces, dans les délais (escalade sinon). Chaque refus de sécurité ou de validation est visible ici.",
  )
    .debut('debut', 'Tâche requise')
    .service('ouvrir', "Ouvrir la tâche dans l'application", 'tache.ouvrir')
    .ou('fusion')
    .evenementiel('attente', 'En attente de l’application')
    .attendreMessage('completee', 'Tâche complétée et validée', 'tache.completee', '=tacheId')
    .attendreMessage('refusee', 'Tentative refusée (sécurité / validation)', 'tache.refusee', '=tacheId')
    .attendreDelai('sla', 'Délai SLA dépassé', '=delaiSla')
    .service('clore', 'Clore et auditer', 'tache.clore')
    .service('refus', 'Consigner le refus', 'tache.consigner-refus')
    .service('escalade', 'Escalader au superviseur', 'tache.escalader')
    .fin('fin', 'Tâche terminée')
    .chaine('debut', 'ouvrir', 'fusion', 'attente')
    .chaine('attente', 'completee', 'clore', 'fin')
    .chaine('attente', 'refusee', 'refus', 'fusion')
    .chaine('attente', 'sla', 'escalade', 'fusion');
}

export function revueDiligente(): Processus {
  return new Processus('revue-diligente', 'Revue diligente', 'Chantiers parallèles confiés aux équipes internes et aux contributeurs externes, puis synthèse.')
    .debut('debut', 'Revue diligente lancée')
    .regle('regle-chantiers', 'Déterminer les chantiers requis', 'chantiers-revue-diligente', 'chantiers')
    .tache('chantier', 'Chantier de revue diligente', 'revue.chantier', 'resultatChantier', {
      multi: { collection: '=chantiers', element: 'chantier', collectionSortie: 'constats', elementSortie: '=resultatChantier' },
    })
    .tache('synthese', 'Synthèse et recommandation', 'revue.synthese', 'synthese')
    .fin('fin', 'Revue diligente terminée')
    .chaine('debut', 'regle-chantiers', 'chantier', 'synthese', 'fin');
}

export function dealFlow(): Processus {
  const abandon = (decision: string) => `${decision}`;
  return new Processus('deal-flow', 'Deal flow', "Du stade « à venir » jusqu'au stade « assigné ».")
    .debut('debut', 'Occasion à venir')
    .tache('qualifier', "Qualifier l'occasion", 'dealflow.qualifier-occasion', 'qualification')
    .regle('regle-admissibilite', 'Filtrage : admissibilité au mandat', 'admissibilite-mandat', 'admissibilite')
    .ou('gw-admissible', 'Admissible ?')
    .tache('analyse', 'Analyse préliminaire et mémo', 'dealflow.analyse-preliminaire', 'analyse')
    .ou('gw-analyse', 'Poursuivre ?')
    .tache('principe', 'Approbation de principe', 'dealflow.approbation-principe', 'approbationPrincipe')
    .ou('gw-principe', 'Approuvé ?')
    .appel('revue', 'Revue diligente', 'revue-diligente')
    .ou('gw-revue', 'Recommandation ?')
    .tache('structuration', 'Structuration et négociation', 'dealflow.structuration', 'structuration')
    .regle('regle-approbation', "Déterminer l'instance d'approbation", 'niveau-approbation', 'instanceApprobation', {
      montantDecision: '=structuration.champs.montantEngagement',
      classeActif: '=classeActif',
    })
    .tache('finale', 'Approbation finale', 'dealflow.approbation-finale', 'approbationFinale')
    .ou('gw-finale', 'Approuvé ?')
    .tache('juridique', 'Documentation juridique et clôture', 'dealflow.documentation-juridique', 'documentation')
    .tache('assigner', 'Assigner le mandat', 'dealflow.assigner-mandat', 'mandat')
    .script('marquer-assigne', 'Stade : assigné', '="assigne"', 'issueDealFlow')
    .fin('fin-assigne', 'Mandat assigné')
    .ou('fusion-abandon')
    .script('marquer-abandon', 'Stade : abandonné', '="abandonne"', 'issueDealFlow')
    .fin('fin-abandon', 'Occasion abandonnée')
    .chaine('debut', 'qualifier', 'regle-admissibilite', 'gw-admissible')
    .relier('gw-admissible', 'analyse', { nom: 'oui', condition: 'admissibilite.admissible = true' })
    .relier('gw-admissible', 'fusion-abandon', { nom: 'non', condition: abandon('admissibilite.admissible = false') })
    .relier('analyse', 'gw-analyse')
    .relier('gw-analyse', 'principe', { nom: 'poursuivre', condition: 'analyse.decision = "poursuivre"' })
    .relier('gw-analyse', 'fusion-abandon', { nom: 'abandonner', condition: 'analyse.decision != "poursuivre"' })
    .relier('principe', 'gw-principe')
    .relier('gw-principe', 'revue', { nom: 'approuvé', condition: 'approbationPrincipe.decision = "approuve"' })
    .relier('gw-principe', 'fusion-abandon', { nom: 'refusé', condition: 'approbationPrincipe.decision != "approuve"' })
    .relier('revue', 'gw-revue')
    .relier('gw-revue', 'structuration', { nom: 'favorable', condition: 'synthese.decision != "defavorable"' })
    .relier('gw-revue', 'fusion-abandon', { nom: 'défavorable', condition: 'synthese.decision = "defavorable"' })
    .chaine('structuration', 'regle-approbation', 'finale', 'gw-finale')
    .relier('gw-finale', 'juridique', { nom: 'approuvé', condition: 'approbationFinale.decision = "approuve"' })
    .relier('gw-finale', 'fusion-abandon', { nom: 'refusé', condition: 'approbationFinale.decision != "approuve"' })
    .chaine('juridique', 'assigner', 'marquer-assigne', 'fin-assigne')
    .chaine('fusion-abandon', 'marquer-abandon', 'fin-abandon');
}

export function debourse(): Processus {
  return new Processus('debourse', 'Déboursé', 'Orchestration fortement auditée : conditions préalables, KYC, instruction, quatre yeux, conformité, paiement.')
    .debut('debut', 'Déboursé demandé')
    .tache('demande', 'Demande de déboursé', 'debourse.demande', 'demande')
    .et('fourche')
    .tache('cp', 'Vérifier les conditions préalables', 'debourse.conditions-prealables', 'conditionsPrealables')
    .tache('kyc', 'Contrôle KYC / LCB-FT', 'debourse.kyc', 'kyc')
    .et('jonction')
    .ou('gw-kyc', 'KYC conforme ?')
    .tache('instruction', "Préparer l'instruction de paiement", 'debourse.preparer-instruction', 'instruction')
    .regle('regle-controles', 'Déterminer les contrôles requis', 'controles-debourse', 'conformiteRequise', {
      montantTirage: '=demande.champs.montantTirage',
    })
    .tache('approuver', 'Approuver le déboursé (quatre yeux)', 'debourse.approuver', 'approbation')
    .ou('gw-approuve', 'Approuvé ?')
    .ou('gw-conformite', 'Conformité requise ?')
    .tache('conformite', 'Approbation conformité', 'debourse.approuver-conformite', 'approbationConformite')
    .ou('gw-conformite-ok', 'Approuvé ?')
    .ou('fusion-paiement')
    .service('payer', 'Exécuter le paiement (simulé)', 'debourse.executer-paiement')
    .script('marquer-debourse', 'Déboursé effectué', '="debourse"', 'issueDebourse')
    .fin('fin-ok', 'Fonds déboursés')
    .ou('fusion-refus')
    .script('marquer-refus', 'Déboursé refusé', '="refuse"', 'issueDebourse')
    .fin('fin-refus', 'Déboursé refusé')
    .chaine('debut', 'demande', 'fourche')
    .relier('fourche', 'cp')
    .relier('fourche', 'kyc')
    .relier('cp', 'jonction')
    .relier('kyc', 'jonction')
    .relier('jonction', 'gw-kyc')
    .relier('gw-kyc', 'instruction', { nom: 'conforme', condition: 'kyc.decision = "conforme"' })
    .relier('gw-kyc', 'fusion-refus', { nom: 'non conforme', condition: 'kyc.decision != "conforme"' })
    .chaine('instruction', 'regle-controles', 'approuver', 'gw-approuve')
    .relier('gw-approuve', 'gw-conformite', { nom: 'approuvé', condition: 'approbation.decision = "approuve"' })
    .relier('gw-approuve', 'fusion-refus', { nom: 'refusé', condition: 'approbation.decision != "approuve"' })
    .relier('gw-conformite', 'conformite', { nom: 'oui', condition: 'conformiteRequise = true' })
    .relier('gw-conformite', 'fusion-paiement', { nom: 'non', condition: 'conformiteRequise != true' })
    .relier('conformite', 'gw-conformite-ok')
    .relier('gw-conformite-ok', 'fusion-paiement', { nom: 'approuvé', condition: 'approbationConformite.decision = "approuve"' })
    .relier('gw-conformite-ok', 'fusion-refus', { nom: 'refusé', condition: 'approbationConformite.decision != "approuve"' })
    .chaine('fusion-paiement', 'payer', 'marquer-debourse', 'fin-ok')
    .chaine('fusion-refus', 'marquer-refus', 'fin-refus');
}

export function suiviPeriodique(): Processus {
  return new Processus('suivi-periodique', 'Suivi périodique (mensuel)', 'Collecte et analyse mensuelles ; sortie par remboursement complet ou décision de désinvestir.')
    .debut('debut', 'Post-investissement')
    .ou('fusion')
    .evenementiel('attente', 'Attente du prochain cycle')
    .attendreDelai('mois', 'Fin du mois', '=delaiSuivi')
    .attendreMessage('rembourse', 'Remboursement complet', 'remboursement-complet', '=dossierId')
    .attendreMessage('desinvestir-demande', 'Décision de désinvestir', 'decision-desinvestir', '=dossierId')
    .tache('collecte', 'Collecte mensuelle', 'suivi.collecte-mensuelle', 'collecte')
    .regle('regle-covenants', 'Analyser les clauses financières', 'alerte-covenants', 'statutCovenants', {
      ratioLevier: '=collecte.champs.detteNette / collecte.champs.baiia',
      ratioCouverture: '=collecte.champs.fluxDisponibles / collecte.champs.serviceDette',
    })
    .script(
      'surveillance',
      'Mettre à jour la surveillance',
      '={moisConformes: if statutCovenants = "conforme" then (if surveillance = null then 1 else surveillance.moisConformes + 1) else 0, active: statutCovenants != "conforme" or (surveillance != null and surveillance.active and moisConformes < 2)}',
      'surveillance',
    )
    .ou('gw-statut', 'Statut des clauses ?')
    .tache('plan', "Plan d'action", 'suivi.plan-action', 'planAction')
    .ou('gw-bris', 'Bris ?')
    .tache('decision', 'Décision de maintien ou de sortie', 'suivi.decision-maintien', 'decisionMaintien')
    .ou('gw-decision', 'Décision ?')
    .ou('fusion-sortie')
    .script('marquer-desinvestir', 'Sortie : désinvestir', '="desinvestir"', 'issueSuivi')
    .fin('fin-desinvestir', 'Désinvestissement requis')
    .script('marquer-rembourse', 'Sortie : remboursé', '="rembourse"', 'issueSuivi')
    .fin('fin-rembourse', 'Remboursé en totalité')
    .chaine('debut', 'fusion', 'attente')
    .chaine('attente', 'mois', 'collecte', 'regle-covenants', 'surveillance', 'gw-statut')
    .relier('gw-statut', 'fusion', { nom: 'conforme', condition: 'statutCovenants = "conforme"' })
    .relier('gw-statut', 'plan', { nom: 'surveillance / bris', condition: 'statutCovenants != "conforme"' })
    .relier('plan', 'gw-bris')
    .relier('gw-bris', 'fusion', { nom: 'surveillance', condition: 'statutCovenants = "surveillance"' })
    .relier('gw-bris', 'decision', { nom: 'bris', condition: 'statutCovenants = "bris"' })
    .relier('decision', 'gw-decision')
    .relier('gw-decision', 'fusion', { nom: 'garder', condition: 'decisionMaintien.decision = "garder"' })
    .relier('gw-decision', 'fusion-sortie', { nom: 'désinvestir', condition: 'decisionMaintien.decision = "desinvestir"' })
    .chaine('attente', 'desinvestir-demande', 'fusion-sortie', 'marquer-desinvestir', 'fin-desinvestir')
    .chaine('attente', 'rembourse', 'marquer-rembourse', 'fin-rembourse');
}

export function desinvestissement(): Processus {
  return new Processus('desinvestissement', 'Désinvestissement', 'Thèse de sortie, évaluation, approbation, exécution.')
    .debut('debut', 'Sortie envisagée')
    .tache('these', 'Thèse de sortie', 'desinvest.these-sortie', 'theseSortie')
    .tache('evaluation', 'Évaluation de la position', 'desinvest.evaluation', 'evaluation')
    .regle('regle-approbation', "Déterminer l'instance d'approbation", 'niveau-approbation', 'instanceApprobation', {
      montantDecision: '=evaluation.champs.valeurEstimee',
      classeActif: '=classeActif',
    })
    .tache('approbation', 'Approbation du désinvestissement', 'desinvest.approbation', 'approbationSortie')
    .ou('gw-approuve', 'Approuvé ?')
    .tache('execution', 'Exécution de la sortie', 'desinvest.execution', 'execution')
    .script('marquer-sorti', 'Sortie réalisée', '="sorti"', 'issueDesinvestissement')
    .fin('fin-sorti', 'Position sortie')
    .script('marquer-refus', 'Sortie refusée', '="refuse"', 'issueDesinvestissement')
    .fin('fin-refus', 'Sortie refusée')
    .chaine('debut', 'these', 'evaluation', 'regle-approbation', 'approbation', 'gw-approuve')
    .relier('gw-approuve', 'execution', { nom: 'approuvé', condition: 'approbationSortie.decision = "approuve"' })
    .relier('gw-approuve', 'marquer-refus', { nom: 'refusé', condition: 'approbationSortie.decision != "approuve"' })
    .chaine('execution', 'marquer-sorti', 'fin-sorti')
    .chaine('marquer-refus', 'fin-refus');
}

/** Backbone de bout en bout : pré-investissement (deal flow → déboursé) puis post-investissement. */
export function backbone(): Processus {
  return new Processus(
    'backbone',
    "Backbone — processus d'investissement de bout en bout",
    'Pré-investissement : deal flow jusqu’au premier déboursé. Post-investissement : suivi mensuel, tirages additionnels, désinvestissement.',
  )
    .debut('debut', 'Occasion enregistrée')
    .appel('deal-flow', 'Deal flow', 'deal-flow')
    .ou('gw-deal', 'Mandat assigné ?')
    .appel('debourse', 'Premier déboursé', 'debourse')
    .ou('gw-debourse', 'Fonds déboursés ?')
    .service('phase-post', 'Passer en post-investissement', 'dossier.phase', { entetes: { phase: 'suivi-periodique' } })
    .ou('fusion-suivi')
    .appel('suivi', 'Suivi périodique (mensuel)', 'suivi-periodique')
    .bordureMessage('tirage', 'Demande de tirage', 'suivi', 'demande-tirage', '=dossierId')
    .appel('tirage-debourse', 'Tirage additionnel', 'debourse', { propager: false })
    .fin('fin-tirage', 'Tirage traité')
    .ou('gw-suivi', 'Issue du suivi ?')
    .appel('desinvestissement', 'Désinvestissement', 'desinvestissement')
    .ou('gw-sortie', 'Sortie réalisée ?')
    .ou('fusion-cloture')
    .service('cloturer', 'Clôturer le dossier', 'dossier.phase', { entetes: { phase: 'cloture', statut: 'cloture' } })
    .fin('fin-cloture', 'Dossier clôturé')
    .ou('fusion-abandon')
    .service('abandonner', 'Marquer le dossier abandonné', 'dossier.phase', { entetes: { statut: 'abandonne' } })
    .fin('fin-abandon', 'Dossier abandonné')
    .chaine('debut', 'deal-flow', 'gw-deal')
    .relier('gw-deal', 'debourse', { nom: 'assigné', condition: 'issueDealFlow = "assigne"' })
    .relier('gw-deal', 'fusion-abandon', { nom: 'abandonné', condition: 'issueDealFlow != "assigne"' })
    .relier('debourse', 'gw-debourse')
    .relier('gw-debourse', 'phase-post', { nom: 'oui', condition: 'issueDebourse = "debourse"' })
    .relier('gw-debourse', 'fusion-abandon', { nom: 'refusé', condition: 'issueDebourse != "debourse"' })
    .chaine('phase-post', 'fusion-suivi', 'suivi', 'gw-suivi')
    .chaine('tirage', 'tirage-debourse', 'fin-tirage')
    .relier('gw-suivi', 'desinvestissement', { nom: 'désinvestir', condition: 'issueSuivi = "desinvestir"' })
    .relier('gw-suivi', 'fusion-cloture', { nom: 'remboursé', condition: 'issueSuivi = "rembourse"' })
    .relier('desinvestissement', 'gw-sortie')
    .relier('gw-sortie', 'fusion-cloture', { nom: 'sortie réalisée', condition: 'issueDesinvestissement = "sorti"' })
    .relier('gw-sortie', 'fusion-suivi', { nom: 'refusée : reprise du suivi', condition: 'issueDesinvestissement != "sorti"' })
    .chaine('fusion-cloture', 'cloturer', 'fin-cloture')
    .chaine('fusion-abandon', 'abandonner', 'fin-abandon');
}

export const TOUS = [tacheMetier, revueDiligente, dealFlow, debourse, suiviPeriodique, desinvestissement, backbone];
