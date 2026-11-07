/**
 * Frontière avec Camunda. Seul ce fichier importe le SDK : le reste de la passerelle (et à plus forte
 * raison les applications) ne dépend que de l'interface Moteur.
 */
import createCamundaClient from '@camunda8/orchestration-cluster-api';

export interface JobRecu {
  type: string;
  cleJob: string;
  cleInstance: string;
  processus: string;
  versionProcessus: number;
  element: string;
  variables: Record<string, unknown>;
  entetes: Record<string, string>;
}

export type GestionnaireJob = (job: JobRecu) => Promise<Record<string, unknown> | void>;

export interface Moteur {
  demarrer(processus: string, variables: Record<string, unknown>, businessId: string): Promise<{ cleInstance: string; version: number }>;
  /** Publie un message (mis en tampon si aucune instance n'attend encore). messageId garantit l'idempotence. */
  publier(nom: string, cleCorrelation: string, variables: Record<string, unknown>, messageId: string): Promise<void>;
  ecouter(type: string, gestionnaire: GestionnaireJob): void;
  arreter(): Promise<void>;
  /** Identifiants des processus et décisions présents sur le cluster (toutes versions). */
  definitionsDeployees?(): Promise<{ processus: Set<string>; decisions: Set<string> }>;
  /** Déploie des fichiers BPMN/DMN ; renvoie « id vN » pour chaque ressource. */
  deployer?(fichiers: string[]): Promise<string[]>;
}

export class MoteurCamunda implements Moteur {
  private readonly client = createCamundaClient();
  private readonly workers: { stop(): unknown }[] = [];

  async demarrer(processus: string, variables: Record<string, unknown>, businessId: string) {
    const r = await this.client.createProcessInstance({
      processDefinitionId: processus,
      variables,
      businessId,
    } as Parameters<typeof this.client.createProcessInstance>[0]);
    return { cleInstance: String(r.processInstanceKey), version: Number(r.processDefinitionVersion) };
  }

  async publier(nom: string, cleCorrelation: string, variables: Record<string, unknown>, messageId: string) {
    await this.client.publishMessage({ name: nom, correlationKey: cleCorrelation, variables, messageId, timeToLive: 30 * 24 * 3_600_000 }); // 30 jours : un fait métier arrivé pendant une autre étape attend le prochain point d'attente
  }

  ecouter(type: string, gestionnaire: GestionnaireJob) {
    const w = this.client.createJobWorker({
      jobType: type,
      maxParallelJobs: 8,
      jobTimeoutMs: 120_000,
      pollIntervalMs: 300,
      jobHandler: async (job) => {
        const recu: JobRecu = {
          type: job.type,
          cleJob: String(job.jobKey),
          cleInstance: String(job.processInstanceKey),
          processus: String(job.processDefinitionId),
          versionProcessus: job.processDefinitionVersion,
          element: String(job.elementId),
          variables: (job.variables ?? {}) as Record<string, unknown>,
          entetes: (job.customHeaders ?? {}) as Record<string, string>,
        };
        try {
          const sortie = await gestionnaire(recu);
          return job.complete((sortie ?? {}) as Record<string, unknown>);
        } catch (e) {
          console.error(`[worker ${type}] échec job ${recu.cleJob} :`, (e as Error).message);
          return job.fail({ errorMessage: (e as Error).message, retries: Math.max(0, (job.retries ?? 1) - 1), retryBackOff: 5_000 });
        }
      },
    });
    this.workers.push(w);
  }

  async definitionsDeployees() {
    const opts = { consistency: { waitUpToMs: 0 } } as never;
    const p = (await this.client.searchProcessDefinitions({ page: { limit: 500 } } as never, opts)) as { items: { processDefinitionId: string }[] };
    const d = (await this.client.searchDecisionDefinitions({ page: { limit: 500 } } as never, opts)) as { items: { decisionDefinitionId: string }[] };
    return {
      processus: new Set(p.items.map((x) => String(x.processDefinitionId))),
      decisions: new Set(d.items.map((x) => String(x.decisionDefinitionId))),
    };
  }

  async deployer(fichiers: string[]) {
    const r = await this.client.deployResourcesFromFiles(fichiers);
    return [
      ...(r.processes ?? []).map((x) => `${x.processDefinitionId} v${x.processDefinitionVersion}`),
      ...(r.decisions ?? []).map((x) => `${x.decisionDefinitionId} v${x.version}`),
    ];
  }

  async arreter() {
    for (const w of this.workers) w.stop();
  }
}
