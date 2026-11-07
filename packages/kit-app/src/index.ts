/**
 * Kit d'application simulée. Une application = un identifiant, un jeton, une couleur et
 * (facultatif) des écrans propres. Tout le reste — boîte de tâches, formulaire généré à partir de la
 * définition de la tâche, dépôt de pièces, webhook — est fourni ici, sur le seul contrat de la passerelle.
 */
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { creerClientBackbone, enTantQue, type ClientBackbone, type Personne, type TacheDetaillee } from '@maestro/client-backbone';
import { reponseSimulee } from '@maestro/commun/simulation';
import { e, page, rendreChamps, rendreDepots } from './html.ts';

export { e, page } from './html.ts';

export interface ContexteEcran {
  client: ClientBackbone;
  utilisateur: string;
  personnes: Personne[];
  rendre: (titre: string, corps: string, message?: string) => string;
}

export interface OptionsApp {
  id: string;
  nom: string;
  port: number;
  jeton: string;
  couleur: string;
  /** Utilisateur proposé par défaut. */
  utilisateurParDefaut: string;
  urlPasserelle?: string;
  /** HTML ajouté en haut de la page d'accueil (ex. formulaire « Nouvelle occasion »). */
  accueil?: (c: ContexteEcran) => Promise<string>;
  /** Routes propres à l'application. */
  routes?: (app: FastifyInstance, ctx: (req: FastifyRequest) => Promise<ContexteEcran>) => void;
}

export const msg = (ok: boolean, texte: string) => `<div class="msg ${ok ? 'ok' : 'ko'}">${texte}</div>`;

/** Transforme un corps de formulaire « champs.x=… » en { champs, decision }. */
export function lireFormulaire(corps: Record<string, unknown>) {
  const champs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(corps)) if (k.startsWith('champs.')) champs[k.slice(7)] = v;
  return { champs, decision: corps.decision ? String(corps.decision) : undefined };
}

export async function demarrerApp(o: OptionsApp) {
  const url = o.urlPasserelle ?? process.env.PASSERELLE_URL ?? 'http://localhost:4000';
  const client = creerClientBackbone({ url, jeton: o.jeton });
  const app = Fastify({ logger: false });
  app.register(formbody);
  app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024 } });
  const notifications: { tacheId: string; typeTache: string; dossierId: string; recuLe: string }[] = [];

  let personnes: Personne[] = [];
  async function chargerPersonnes() {
    if (personnes.length) return personnes;
    const { data } = await client.GET('/organisation/personnes');
    personnes = data ?? [];
    return personnes;
  }

  async function ctx(req: FastifyRequest): Promise<ContexteEcran> {
    const q = req.query as { u?: string };
    const utilisateur = q.u || o.utilisateurParDefaut;
    const ps = await chargerPersonnes();
    return {
      client,
      utilisateur,
      personnes: ps,
      rendre: (titre, corps, message) => page({ titre: `${titre} — ${o.nom}`, app: o.nom, couleur: o.couleur, utilisateur, personnes: ps, corps, message }),
    };
  }

  const lien = (chemin: string, u: string) => `${chemin}${chemin.includes('?') ? '&' : '?'}u=${encodeURIComponent(u)}`;

  app.get('/', async (req, rep) => {
    const c = await ctx(req);
    const { data: taches = [] } = await client.GET('/taches', { params: { query: { statut: 'ouverte' } } });
    const lignes = taches
      .map((t) => {
        const enRetard = new Date(t.echeance) < new Date();
        return `<tr><td><a href="${e(lien(`/taches/${t.tacheId}`, c.utilisateur))}">${e(t.titre ?? t.typeTache)}</a>${t.contexte?.chantier ? ` <span class="etiquette">${e(t.contexte.chantier)}</span>` : ''}</td>
<td>${e(t.dossierId)}<br><span class="doux">${e(t.contexte?.nom ?? '')}</span></td><td><span class="etiquette">${e(t.roleRequis)}</span></td>
<td class="${enRetard ? 'ko' : ''}">${new Date(t.echeance).toLocaleString('fr-CA')}${t.escalades ? `<br>${t.escalades} escalade(s)` : ''}${t.refus ? `<br><span class="ko">${t.refus} refus</span>` : ''}</td></tr>`;
      })
      .join('');
    const haut = o.accueil ? await o.accueil(c) : '';
    const corps = `${haut}<div class="carte"><h2>Mes tâches ouvertes (${taches.length})</h2>
${taches.length ? `<table><thead><tr><th>Tâche</th><th>Dossier</th><th>Rôle requis</th><th>Échéance</th></tr></thead><tbody>${lignes}</tbody></table>` : '<p class="doux">Aucune tâche ouverte. Le backbone en créera quand le processus le demandera.</p>'}
<p class="doux">${notifications.length} notification(s) reçue(s) du backbone par webhook. <a href="${e(lien('/', c.utilisateur))}">Rafraîchir</a></p></div>`;
    return rep.type('text/html').send(c.rendre('Mes tâches', corps));
  });

  async function rendreTache(req: FastifyRequest, rep: FastifyReply, tacheId: string, message = '', valeurs: Record<string, unknown> = {}) {
    const c = await ctx(req);
    const { data: t, error } = await client.GET('/taches/{tacheId}', { params: { path: { tacheId } } });
    if (!t) return rep.type('text/html').send(c.rendre('Tâche', msg(false, e((error as { message?: string })?.message ?? 'Tâche introuvable'))));
    const tache = t as TacheDetaillee & { contexte?: Record<string, unknown> };
    const def = tache.definition;
    const peutAgir = tache.candidats.some((p) => p?.id === c.utilisateur);
    const ctxLignes = Object.entries({ ...(tache.dossier ?? {}), ...(tache.contexte ?? {}) })
      .filter(([k]) => ['dossierId', 'nom', 'contrepartie', 'classeActif', 'montant', 'chantier', 'instanceApprobation', 'phase'].includes(k))
      .map(([k, v]) => `<div><span class="doux">${e(k)}</span><br><strong>${e(typeof v === 'number' ? v.toLocaleString('fr-CA') : v)}</strong></div>`)
      .join('');
    const fermee = tache.statut !== 'ouverte';
    const corps = `<p><a href="${e(lien('/', c.utilisateur))}">← Mes tâches</a></p>
<div class="carte"><h2>${e(def.titre)} <span class="etiquette">${e(tache.typeTache)}</span></h2><div class="grille">${ctxLignes}</div>
<p class="doux">Rôle requis : <strong>${e(tache.roleRequis)}</strong> — personnes habilitées : ${tache.candidats.map((p) => e(p?.nom)).join(', ')}.
${peutAgir ? '' : `<br><span class="ko">Vous agissez en tant que ${e(c.utilisateur)}, qui ne détient pas ce rôle : la passerelle refusera la complétion (et le refus sera visible dans le BPMN).</span>`}</p></div>
${fermee ? msg(true, `Tâche complétée par ${e(tache.completeePar)}.`) : `
<div class="carte"><h2>Pièces justificatives</h2>${rendreDepots(def, tache.documents, lien(`/taches/${tacheId}/documents`, c.utilisateur))}</div>
<div class="carte"><h2>Saisie</h2><form method="post" action="${e(lien(`/taches/${tacheId}/completer`, c.utilisateur))}">${rendreChamps(def, valeurs)}
<p style="display:flex;gap:8px;margin-top:16px"><button type="submit">Compléter la tâche</button>
<a href="${e(lien(`/taches/${tacheId}?prerempli=1`, c.utilisateur))}"><button class="second" type="button">Pré-remplir (simulation)</button></a></p></form></div>`}`;
    return rep.type('text/html').send(c.rendre(def.titre, corps, message));
  }

  app.get<{ Params: { id: string }; Querystring: { prerempli?: string } }>('/taches/:id', async (req, rep) => {
    let valeurs: Record<string, unknown> = {};
    if (req.query.prerempli) {
      const { data: t } = await client.GET('/taches/{tacheId}', { params: { path: { tacheId: req.params.id } } });
      const ctxT = (t as { contexte?: Record<string, unknown> } | undefined)?.contexte ?? {};
      const r = reponseSimulee(t?.typeTache ?? '', { montant: Number(ctxT.montant ?? t?.dossier?.montant), chantier: ctxT.chantier as string });
      valeurs = { ...r.champs, decision: r.decision };
    }
    return rendreTache(req, rep, req.params.id, '', valeurs);
  });

  app.post<{ Params: { id: string } }>('/taches/:id/documents', async (req, rep) => {
    const c = await ctx(req);
    let type = '';
    let fichier: { nom: string; contenu: Buffer } | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'field' && part.fieldname === 'type') type = String(part.value);
      if (part.type === 'file') fichier = { nom: part.filename || 'piece.bin', contenu: await part.toBuffer() };
    }
    if (!fichier) return rendreTache(req, rep, req.params.id, msg(false, 'Aucun fichier reçu'));
    const form = new FormData();
    form.append('type', type);
    form.append('fichier', new Blob([new Uint8Array(fichier.contenu)]), fichier.nom);
    const { error } = await client.POST('/taches/{tacheId}/documents', {
      params: { path: { tacheId: req.params.id }, header: enTantQue(c.utilisateur) as never },
      body: form as never,
      bodySerializer: (b) => b as unknown as FormData,
    });
    return rendreTache(req, rep, req.params.id, error ? msg(false, e((error as { message: string }).message)) : msg(true, `Pièce « ${e(type)} » déposée dans SharePoint par le backbone.`));
  });

  app.post<{ Params: { id: string } }>('/taches/:id/completer', async (req, rep) => {
    const c = await ctx(req);
    const corps = lireFormulaire(req.body as Record<string, unknown>);
    const { error, response } = await client.POST('/taches/{tacheId}/completer', {
      params: { path: { tacheId: req.params.id }, header: enTantQue(c.utilisateur) as never },
      body: corps,
    });
    if (!error) return rep.redirect(lien('/', c.utilisateur) + '&fait=1');
    const err = error as { code: string; message: string; erreurs?: { champ: string; erreur: string }[] };
    const details = err.erreurs?.length ? `<ul>${err.erreurs.map((x) => `<li>${e(x.erreur)}</li>`).join('')}</ul>` : '';
    return rendreTache(req, rep, req.params.id, msg(false, `<strong>${response.status} ${e(err.code)}</strong> — ${e(err.message)}${details}`), { ...corps.champs, decision: corps.decision });
  });

  /** Le backbone notifie les nouvelles tâches ; la boîte de tâches reste la source (on peut aussi interroger GET /taches). */
  app.post('/webhooks/taches', async (req, rep) => {
    if ((req.headers.authorization ?? '') !== `Bearer ${o.jeton}`) return rep.code(401).send();
    notifications.push({ ...(req.body as { tacheId: string; typeTache: string; dossierId: string }), recuLe: new Date().toISOString() });
    return rep.code(204).send();
  });

  o.routes?.(app, ctx);
  await app.listen({ port: o.port, host: '127.0.0.1' });
  console.log(`${o.nom} prête sur http://localhost:${o.port}`);
  return app;
}
