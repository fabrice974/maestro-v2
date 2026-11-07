import { join } from 'node:path';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RACINE } from '@maestro/commun';
import { ErreurCheminInterdit, ErreurDepotIndisponible } from './documents/depot.ts';
import { ErreurMetier, type Services } from './services.ts';

const NouveauDossierSchema = z.object({
  nom: z.string().min(1),
  contrepartie: z.string().min(1),
  classeActif: z.enum(['credit-prive', 'placement-prive', 'infrastructure']),
  montant: z.coerce.number().positive(),
  secteur: z.string().min(1),
});

// Les clients générés (ex. NSwag/C#) envoient null pour les propriétés absentes : accepté.
const CompletionSchema = z.object({
  champs: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  decision: z.string().nullish().transform((v) => v ?? undefined),
});

const EvenementSchema = z.object({
  evenementId: z.string().min(1),
  donnees: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
});

declare module 'fastify' {
  interface FastifyRequest {
    application: string;
    utilisateur: string;
  }
}

export interface OptionsApp {
  operateUrl?: string;
}

export function creerApp(s: Services, opts: OptionsApp = {}) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
  app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024 } });
  app.register(fastifyStatic, { root: join(RACINE, 'passerelle', 'public'), prefix: '/cockpit/' });

  /** Authentifie l'application (jeton Bearer) et lit l'utilisateur simulé (X-Utilisateur). */
  async function authentifier(req: FastifyRequest, rep: FastifyReply) {
    const jeton = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    // Relu à chaque requête : une révocation dans config/securite.yaml prend effet immédiatement.
    const appId = [...s.g.applications.values()].find((a) => a.jeton === jeton)?.id;
    if (!appId) {
      s.journal.ajouter({ acteur: 'inconnu', application: 'inconnue', action: 'authentification.refusee', details: { url: req.url } });
      return rep.code(401).send({ code: 'NON_AUTHENTIFIE', message: 'Jeton d’application invalide ou absent' });
    }
    req.application = appId;
    req.utilisateur = String(req.headers['x-utilisateur'] ?? '');
    if (req.method !== 'GET' && !s.g.personnes.some((p) => p.id === req.utilisateur)) {
      return rep.code(401).send({ code: 'UTILISATEUR_INCONNU', message: 'En-tête X-Utilisateur absent ou inconnu' });
    }
  }

  app.setErrorHandler((err, _req, rep) => {
    if (err instanceof ErreurMetier) return rep.code(err.statut).send({ code: err.code, message: err.message, erreurs: err.details });
    if (err instanceof ErreurDepotIndisponible) return rep.code(503).send({ code: 'SHAREPOINT_INDISPONIBLE', message: err.message });
    if (err instanceof ErreurCheminInterdit) return rep.code(400).send({ code: 'NOM_INTERDIT', message: err.message });
    if (err instanceof z.ZodError) return rep.code(400).send({ code: 'REQUETE_INVALIDE', message: 'Requête invalide', erreurs: err.issues });
    const statut = (err as { statusCode?: number }).statusCode;
    if (statut && statut < 500) return rep.code(statut).send({ code: 'REQUETE_INVALIDE', message: (err as Error).message });
    app.log.error(err);
    return rep.code(500).send({ code: 'ERREUR_INTERNE', message: (err as Error).message });
  });

  app.get('/sante', async () => ({ statut: 'ok', documents: s.depot.mode }));
  app.get('/', async (_req, rep) => rep.redirect('/cockpit/'));

  // ───── Données du cockpit (lecture seule, démo locale) ─────
  app.get('/cockpit/api/etat', async () => ({
    dossiers: s.registre.dossiers(),
    taches: s.registre.taches(),
    audit: s.journal.lister().slice(-200).reverse(),
    verification: s.journal.verifier(),
    operateUrl: opts.operateUrl ?? null,
    documentsRacine: await s.depot.urlRacine().catch(() => null),
  }));

  // ───── API des applications ─────
  app.register(async (api) => {
    api.addHook('preHandler', authentifier);

    api.get('/organisation/personnes', async () =>
      s.g.personnes.map((p) => ({ ...p, roles: [...s.g.roles].filter(([, m]) => m.includes(p.id)).map(([r]) => r) })),
    );

    api.post('/dossiers', async (req, rep) => {
      const d = await s.creerDossier(NouveauDossierSchema.parse(req.body), req.application, req.utilisateur);
      return rep.code(201).send(d);
    });

    api.get('/dossiers', async () => s.registre.dossiers());

    api.get<{ Params: { dossierId: string } }>('/dossiers/:dossierId', async (req) => {
      const d = s.registre.dossier(req.params.dossierId);
      if (!d) throw new ErreurMetier(404, 'DOSSIER_INCONNU', `Dossier ${req.params.dossierId} inconnu`);
      return {
        ...d,
        taches: s.registre.taches({ dossierId: d.dossierId }),
        documents: s.registre.documents({ dossierId: d.dossierId }),
        audit: s.journal.lister({ dossierId: d.dossierId }),
      };
    });

    api.post<{ Params: { dossierId: string; type: string } }>('/dossiers/:dossierId/evenements/:type', async (req, rep) => {
      const e = EvenementSchema.parse(req.body);
      const r = await s.emettreEvenement(req.params.dossierId, req.params.type, e.evenementId, e.donnees, req.application, req.utilisateur);
      return rep.code(202).send(r);
    });

    api.get<{ Querystring: { statut?: string; dossierId?: string } }>('/taches', async (req) =>
      // Une application ne voit que ses propres tâches.
      s.registre.taches({ application: req.application, statut: req.query.statut, dossierId: req.query.dossierId }).map((t) => ({
        ...t,
        titre: s.g.taches.get(t.typeTache)?.titre,
      })),
    );

    api.get<{ Params: { tacheId: string } }>('/taches/:tacheId', async (req) => {
      const t = s.tachePourApplication(req.params.tacheId, req.application);
      const def = s.definition(t.typeTache);
      return {
        ...t,
        definition: { ...def, roleRequis: t.roleRequis, gabaritRole: def.roleRequis },
        candidats: (s.g.roles.get(t.roleRequis) ?? []).map((id) => s.g.personnes.find((p) => p.id === id)),
        documents: s.registre.documents({ tacheId: t.tacheId }),
        dossier: s.registre.dossier(t.dossierId),
      };
    });

    api.post<{ Params: { tacheId: string } }>('/taches/:tacheId/documents', async (req) => {
      s.tachePourApplication(req.params.tacheId, req.application);
      let type = '';
      let fichier: { nom: string; contenu: Buffer } | undefined;
      for await (const part of req.parts()) {
        if (part.type === 'field' && part.fieldname === 'type') type = String(part.value);
        if (part.type === 'file') fichier = { nom: part.filename, contenu: await part.toBuffer() };
      }
      if (!type || !fichier) throw new ErreurMetier(400, 'REQUETE_INVALIDE', 'Champs multipart « type » et « fichier » requis');
      return s.deposerDocument(req.params.tacheId, type, fichier.nom, fichier.contenu, req.application, req.utilisateur);
    });

    api.post<{ Params: { tacheId: string } }>('/taches/:tacheId/completer', async (req) => {
      const t = s.registre.tache(req.params.tacheId);
      // Contrôle d'appartenance volontairement délégué à verifierCompletion pour qu'un refus soit visible dans le BPMN.
      if (!t) throw new ErreurMetier(404, 'TACHE_INCONNUE', `Tâche ${req.params.tacheId} inconnue`);
      return s.completer(req.params.tacheId, CompletionSchema.parse(req.body ?? {}), req.application, req.utilisateur);
    });

    api.get<{ Querystring: { dossierId?: string } }>('/audit', async (req) => s.journal.lister({ dossierId: req.query.dossierId }));
    api.get('/audit/verification', async () => s.journal.verifier());
  });

  return app;
}
