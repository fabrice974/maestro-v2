import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerApp } from '../src/app.ts';
import { Journal } from '../src/audit/journal.ts';
import { DepotLocal } from '../src/documents/local.ts';
import { chargerGouvernance } from '../src/gouvernance/charger.ts';
import type { GestionnaireJob, JobRecu, Moteur } from '../src/moteur.ts';
import { Registre } from '../src/registre.ts';
import { Services } from '../src/services.ts';

class FauxMoteur implements Moteur {
  demarrages: { processus: string; variables: Record<string, unknown>; businessId: string }[] = [];
  messages: { nom: string; cle: string; variables: Record<string, unknown>; id: string }[] = [];
  gestionnaires = new Map<string, GestionnaireJob>();
  async demarrer(processus: string, variables: Record<string, unknown>, businessId: string) {
    this.demarrages.push({ processus, variables, businessId });
    return { cleInstance: '2251799813685249', version: 1 };
  }
  async publier(nom: string, cle: string, variables: Record<string, unknown>, id: string) {
    this.messages.push({ nom, cle, variables, id });
  }
  ecouter(type: string, g: GestionnaireJob) {
    this.gestionnaires.set(type, g);
  }
  async arreter() {}
}

const DEAL = { authorization: 'Bearer demo-jeton-deal-flow' };
const DEBOURSE = { authorization: 'Bearer demo-jeton-debourse' };
const SUIVI = { authorization: 'Bearer demo-jeton-suivi-periodique' };

function job(variables: Record<string, unknown>, cleJob = String(Math.random())): JobRecu {
  return { type: 'tache.ouvrir', cleJob, cleInstance: '1', processus: 'tache-metier', versionProcessus: 1, element: 'ouvrir', variables, entetes: {} };
}

let moteur: FauxMoteur;
let s: Services;
let app: ReturnType<typeof creerApp>;

beforeEach(() => {
  const db = new DatabaseSync(':memory:');
  moteur = new FauxMoteur();
  s = new Services(
    chargerGouvernance(),
    new Registre(db),
    new Journal(db),
    new DepotLocal(mkdtempSync(join(tmpdir(), 'api-')), 'POC-Maestro-Camunda'),
    moteur,
    { facteurSla: 1, delaiSuivi: 'P1M' },
  );
  app = creerApp(s);
});

async function nouveauDossier() {
  const r = await app.inject({
    method: 'POST',
    url: '/dossiers',
    headers: { ...DEAL, 'x-utilisateur': 'alice' },
    payload: { nom: 'Parc éolien Mékinac', contrepartie: 'Énergie Boréale inc.', classeActif: 'infrastructure', montant: 120_000_000, secteur: 'energie' },
  });
  return r;
}

async function tacheDebourseApprouver(dossierId: string) {
  return s.ouvrirTache(job({ typeTache: 'debourse.approuver', dossierId }));
}

describe('API de la passerelle', () => {
  it('POST /dossiers démarre backbone avec dossierId comme businessId', async () => {
    const r = await nouveauDossier();
    expect(r.statusCode).toBe(201);
    const { dossierId } = r.json();
    expect(dossierId).toMatch(/^INV-\d{4}-0001$/);
    expect(moteur.demarrages[0]).toMatchObject({ processus: 'backbone', businessId: dossierId, variables: { dossierId, delaiSuivi: 'P1M' } });
  });

  it('refuse un jeton inconnu (401) et une application sans droit de création (403)', async () => {
    expect((await app.inject({ method: 'GET', url: '/dossiers' })).statusCode).toBe(401);
    const r = await app.inject({
      method: 'POST',
      url: '/dossiers',
      headers: { ...SUIVI, 'x-utilisateur': 'kevin' },
      payload: { nom: 'x', contrepartie: 'y', classeActif: 'credit-prive', montant: 1, secteur: 'z' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('ouvre une tâche avec rôle résolu et l’expose à son application seulement', async () => {
    const { dossierId } = (await nouveauDossier()).json();
    const t = await s.ouvrirTache(job({ typeTache: 'dealflow.qualifier-occasion', dossierId, classeActif: 'infrastructure' }));
    expect(t.roleRequis).toBe('analyste-infrastructure');
    const liste = await app.inject({ method: 'GET', url: '/taches?statut=ouverte', headers: DEAL });
    expect(liste.json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/taches?statut=ouverte', headers: DEBOURSE })).json()).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/taches/${t.tacheId}`, headers: DEBOURSE })).statusCode).toBe(403);
  });

  it('job réessayé : même tâche (idempotence de tache.ouvrir)', async () => {
    const a = await s.ouvrirTache(job({ typeTache: 'debourse.approuver', dossierId: 'INV-2026-0001' }, 'job-42'));
    const b = await s.ouvrirTache(job({ typeTache: 'debourse.approuver', dossierId: 'INV-2026-0001' }, 'job-42'));
    expect(b.tacheId).toBe(a.tacheId);
  });

  it('complétion valide → message tache.completee ; seconde complétion → 409 sans nouvel audit', async () => {
    const { dossierId } = (await nouveauDossier()).json();
    const { tacheId } = await tacheDebourseApprouver(dossierId);
    const completer = () =>
      app.inject({ method: 'POST', url: `/taches/${tacheId}/completer`, headers: { ...DEBOURSE, 'x-utilisateur': 'ines' }, payload: { decision: 'approuve' } });
    expect((await completer()).statusCode).toBe(200);
    expect(moteur.messages.at(-1)).toMatchObject({ nom: 'tache.completee', cle: tacheId, id: `${tacheId}:completee`, variables: { resultat: { decision: 'approuve', completeePar: 'ines' } } });
    const nbAudit = s.journal.lister().filter((e) => e.action === 'tache.completee').length;
    expect((await completer()).statusCode).toBe(409);
    expect(s.journal.lister().filter((e) => e.action === 'tache.completee').length).toBe(nbAudit);
  });

  it('S1 : une autre application tente de compléter → 403 + message tache.refusee + audit', async () => {
    const { dossierId } = (await nouveauDossier()).json();
    const { tacheId } = await tacheDebourseApprouver(dossierId);
    const r = await app.inject({ method: 'POST', url: `/taches/${tacheId}/completer`, headers: { ...SUIVI, 'x-utilisateur': 'ines' }, payload: { decision: 'approuve' } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('APPLICATION_NON_AUTORISEE');
    expect(moteur.messages.at(-1)).toMatchObject({ nom: 'tache.refusee', cle: tacheId });
    expect(s.journal.lister().at(-1)).toMatchObject({ action: 'tache.refusee', application: 'suivi-periodique' });
  });

  it('S2 : le préparateur ne peut pas approuver (séparation des tâches)', async () => {
    const { dossierId } = (await nouveauDossier()).json();
    const prep = await s.ouvrirTache(job({ typeTache: 'debourse.preparer-instruction', dossierId }));
    s.registre.completerTache(prep.tacheId, 'ines', {});
    const { tacheId } = await tacheDebourseApprouver(dossierId);
    const r = await app.inject({ method: 'POST', url: `/taches/${tacheId}/completer`, headers: { ...DEBOURSE, 'x-utilisateur': 'ines' }, payload: { decision: 'approuve' } });
    expect(r.json().code).toBe('SEPARATION_TACHES');
  });

  it('accepte decision: null envoyé par un client généré (C#/NSwag)', async () => {
    const { dossierId } = (await nouveauDossier()).json();
    const { tacheId } = await s.ouvrirTache(job({ typeTache: 'debourse.preparer-instruction', dossierId }));
    const r = await app.inject({ method: 'POST', url: `/taches/${tacheId}/completer`, headers: { ...DEBOURSE, 'x-utilisateur': 'hugo' }, payload: { champs: { referencePaiement: 'R' }, decision: null } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('DONNEES_INVALIDES');
  });

  it('date invalide → 422 détaillé, jamais 500, et refus visible', async () => {
    const { dossierId } = (await nouveauDossier()).json();
    const { tacheId } = await s.ouvrirTache(job({ typeTache: 'debourse.kyc', dossierId }));
    const r = await app.inject({
      method: 'POST',
      url: `/taches/${tacheId}/completer`,
      headers: { ...DEBOURSE, 'x-utilisateur': 'julie' },
      payload: { decision: 'conforme', champs: { dateVerification: '31/12/2026' } },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().erreurs[0].champ).toBe('dateVerification');
    expect(moteur.messages.at(-1)?.nom).toBe('tache.refusee');
  });

  it('dépôt de document : type attendu, empreinte, puis complétion acceptée', async () => {
    const { dossierId } = (await nouveauDossier()).json();
    const { tacheId } = await s.ouvrirTache(job({ typeTache: 'debourse.preparer-instruction', dossierId }));
    const limite = '----maestro';
    const corps = (type: string) =>
      [`--${limite}`, 'Content-Disposition: form-data; name="type"', '', type, `--${limite}`, 'Content-Disposition: form-data; name="fichier"; filename="instr.txt"', 'Content-Type: text/plain', '', 'contenu', `--${limite}--`, ''].join('\r\n');
    const headers = { ...DEBOURSE, 'x-utilisateur': 'hugo', 'content-type': `multipart/form-data; boundary=${limite}` };
    expect((await app.inject({ method: 'POST', url: `/taches/${tacheId}/documents`, headers, payload: corps('inconnu') })).statusCode).toBe(422);
    const ok = await app.inject({ method: 'POST', url: `/taches/${tacheId}/documents`, headers, payload: corps('instruction-paiement') });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sha256).toHaveLength(64);
    const c = await app.inject({ method: 'POST', url: `/taches/${tacheId}/completer`, headers: { ...DEBOURSE, 'x-utilisateur': 'hugo' }, payload: { champs: { referencePaiement: 'REF-1' } } });
    expect(c.statusCode).toBe(200);
  });

  it('événements : application autorisée, idempotence sur evenementId', async () => {
    const { dossierId } = (await nouveauDossier()).json();
    const envoyer = (h: Record<string, string>) =>
      app.inject({ method: 'POST', url: `/dossiers/${dossierId}/evenements/remboursement-complet`, headers: { ...h, 'x-utilisateur': 'kevin' }, payload: { evenementId: 'ev-1', donnees: { date: '2026-11-07' } } });
    expect((await envoyer(DEBOURSE)).statusCode).toBe(403);
    expect((await envoyer(SUIVI)).json()).toEqual({ doublon: false });
    expect((await envoyer(SUIVI)).json()).toEqual({ doublon: true });
    expect(moteur.messages.filter((m) => m.nom === 'remboursement-complet')).toHaveLength(1);
  });
});
