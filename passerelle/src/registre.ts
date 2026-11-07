import type { DatabaseSync } from 'node:sqlite';
import type { RefDocument } from './documents/depot.ts';

export type ClasseActif = 'credit-prive' | 'placement-prive' | 'infrastructure';

export interface Dossier {
  dossierId: string;
  nom: string;
  contrepartie: string;
  classeActif: ClasseActif;
  montant: number;
  secteur: string;
  phase: string;
  statut: 'actif' | 'cloture' | 'abandonne';
  cleInstance?: string;
  urlDocuments?: string;
  creePar: string;
  creeLe: string;
}

export interface Tache {
  tacheId: string;
  dossierId: string;
  typeTache: string;
  roleRequis: string;
  application: string;
  statut: 'ouverte' | 'completee';
  cleJob: string;
  contexte: Record<string, unknown>;
  ouverteLe: string;
  echeance: string;
  escalades: number;
  refus: number;
  completeePar?: string;
  completeeLe?: string;
  resultat?: Record<string, unknown>;
}

export interface DocumentTache extends RefDocument {
  tacheId: string;
  dossierId: string;
  type: string;
  deposePar: string;
  deposeLe: string;
}

/** Registre persistant (SQLite) des dossiers, tâches, documents et événements traités. */
export class Registre {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dossiers (
        dossier_id TEXT PRIMARY KEY, donnees TEXT NOT NULL, phase TEXT NOT NULL, statut TEXT NOT NULL,
        cle_instance TEXT, url_documents TEXT
      );
      CREATE TABLE IF NOT EXISTS taches (
        tache_id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, type_tache TEXT NOT NULL, role_requis TEXT NOT NULL,
        application TEXT NOT NULL, statut TEXT NOT NULL, cle_job TEXT NOT NULL UNIQUE, contexte TEXT NOT NULL,
        ouverte_le TEXT NOT NULL, echeance TEXT NOT NULL, escalades INTEGER NOT NULL DEFAULT 0,
        refus INTEGER NOT NULL DEFAULT 0, completee_par TEXT, completee_le TEXT, resultat TEXT
      );
      CREATE INDEX IF NOT EXISTS taches_dossier ON taches(dossier_id);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT NOT NULL, tache_id TEXT NOT NULL, dossier_id TEXT NOT NULL, type TEXT NOT NULL,
        nom TEXT NOT NULL, url TEXT NOT NULL, sha256 TEXT NOT NULL, depose_par TEXT NOT NULL, depose_le TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evenements (evenement_id TEXT PRIMARY KEY, dossier_id TEXT NOT NULL, type TEXT NOT NULL, recu_le TEXT NOT NULL);
    `);
  }

  /** Prochain identifiant INV-AAAA-NNNN. */
  prochainDossierId(annee = new Date().getFullYear()): string {
    const prefixe = `INV-${annee}-`;
    const r = this.db
      .prepare("SELECT MAX(CAST(SUBSTR(dossier_id, 10) AS INTEGER)) AS n FROM dossiers WHERE dossier_id LIKE ? || '%'")
      .get(prefixe) as { n: number | null };
    return `${prefixe}${String((r.n ?? 0) + 1).padStart(4, '0')}`;
  }

  creerDossier(d: Dossier): void {
    this.db
      .prepare('INSERT INTO dossiers (dossier_id, donnees, phase, statut, cle_instance, url_documents) VALUES (?, ?, ?, ?, ?, ?)')
      .run(d.dossierId, JSON.stringify(d), d.phase, d.statut, d.cleInstance ?? null, d.urlDocuments ?? null);
  }

  majDossier(dossierId: string, maj: Partial<Pick<Dossier, 'phase' | 'statut' | 'cleInstance' | 'urlDocuments'>>): void {
    const d = this.dossier(dossierId);
    if (!d) return;
    const n = { ...d, ...maj };
    this.db
      .prepare('UPDATE dossiers SET donnees = ?, phase = ?, statut = ?, cle_instance = ?, url_documents = ? WHERE dossier_id = ?')
      .run(JSON.stringify(n), n.phase, n.statut, n.cleInstance ?? null, n.urlDocuments ?? null, dossierId);
  }

  dossier(dossierId: string): Dossier | undefined {
    const r = this.db.prepare('SELECT donnees FROM dossiers WHERE dossier_id = ?').get(dossierId) as { donnees: string } | undefined;
    return r ? (JSON.parse(r.donnees) as Dossier) : undefined;
  }

  dossiers(): Dossier[] {
    return (this.db.prepare('SELECT donnees FROM dossiers ORDER BY dossier_id DESC').all() as { donnees: string }[]).map(
      (r) => JSON.parse(r.donnees) as Dossier,
    );
  }

  ouvrirTache(t: Omit<Tache, 'statut' | 'escalades' | 'refus'>): Tache {
    // Idempotent : un job réessayé (même clé) renvoie la tâche déjà ouverte.
    const existante = this.tacheParJob(t.cleJob);
    if (existante) return existante;
    this.db
      .prepare(
        `INSERT INTO taches (tache_id, dossier_id, type_tache, role_requis, application, statut, cle_job, contexte, ouverte_le, echeance)
         VALUES (?, ?, ?, ?, ?, 'ouverte', ?, ?, ?, ?)`,
      )
      .run(t.tacheId, t.dossierId, t.typeTache, t.roleRequis, t.application, t.cleJob, JSON.stringify(t.contexte), t.ouverteLe, t.echeance);
    return this.tache(t.tacheId)!;
  }

  /** Marque la tâche complétée ; renvoie false si elle ne l'était plus (concurrence, double clic). */
  completerTache(tacheId: string, par: string, resultat: Record<string, unknown>, le = new Date().toISOString()): boolean {
    const r = this.db
      .prepare("UPDATE taches SET statut = 'completee', completee_par = ?, completee_le = ?, resultat = ? WHERE tache_id = ? AND statut = 'ouverte'")
      .run(par, le, JSON.stringify(resultat), tacheId);
    return r.changes === 1;
  }

  incrementer(tacheId: string, champ: 'escalades' | 'refus', echeance?: string): void {
    this.db.prepare(`UPDATE taches SET ${champ} = ${champ} + 1${echeance ? ', echeance = ?' : ''} WHERE tache_id = ?`).run(
      ...(echeance ? [echeance, tacheId] : [tacheId]),
    );
  }

  private versTache(r: Record<string, unknown>): Tache {
    return {
      tacheId: r.tache_id as string,
      dossierId: r.dossier_id as string,
      typeTache: r.type_tache as string,
      roleRequis: r.role_requis as string,
      application: r.application as string,
      statut: r.statut as Tache['statut'],
      cleJob: r.cle_job as string,
      contexte: JSON.parse(r.contexte as string),
      ouverteLe: r.ouverte_le as string,
      echeance: r.echeance as string,
      escalades: Number(r.escalades),
      refus: Number(r.refus),
      completeePar: (r.completee_par as string) ?? undefined,
      completeeLe: (r.completee_le as string) ?? undefined,
      resultat: r.resultat ? JSON.parse(r.resultat as string) : undefined,
    };
  }

  tache(tacheId: string): Tache | undefined {
    const r = this.db.prepare('SELECT * FROM taches WHERE tache_id = ?').get(tacheId);
    return r ? this.versTache(r) : undefined;
  }

  tacheParJob(cleJob: string): Tache | undefined {
    const r = this.db.prepare('SELECT * FROM taches WHERE cle_job = ?').get(cleJob);
    return r ? this.versTache(r) : undefined;
  }

  taches(filtre: { dossierId?: string; application?: string; statut?: string } = {}): Tache[] {
    const cond: string[] = [];
    const vals: string[] = [];
    for (const [col, v] of [['dossier_id', filtre.dossierId], ['application', filtre.application], ['statut', filtre.statut]] as const) {
      if (v) {
        cond.push(`${col} = ?`);
        vals.push(v);
      }
    }
    const sql = `SELECT * FROM taches ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY ouverte_le`;
    return this.db.prepare(sql).all(...vals).map((r) => this.versTache(r));
  }

  ajouterDocument(d: DocumentTache): void {
    this.db
      .prepare('INSERT INTO documents (id, tache_id, dossier_id, type, nom, url, sha256, depose_par, depose_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(d.id, d.tacheId, d.dossierId, d.type, d.nom, d.url, d.sha256, d.deposePar, d.deposeLe);
  }

  documents(filtre: { tacheId?: string; dossierId?: string }): DocumentTache[] {
    const [col, v] = filtre.tacheId ? ['tache_id', filtre.tacheId] : ['dossier_id', filtre.dossierId ?? ''];
    return (this.db.prepare(`SELECT * FROM documents WHERE ${col} = ? ORDER BY depose_le`).all(v) as Record<string, string>[]).map((r) => ({
      id: r.id!,
      tacheId: r.tache_id!,
      dossierId: r.dossier_id!,
      type: r.type!,
      nom: r.nom!,
      url: r.url!,
      sha256: r.sha256!,
      deposePar: r.depose_par!,
      deposeLe: r.depose_le!,
    }));
  }

  /** Enregistre un événement ; renvoie false s'il a déjà été traité (idempotence). */
  enregistrerEvenement(evenementId: string, dossierId: string, type: string): boolean {
    const r = this.db
      .prepare('INSERT OR IGNORE INTO evenements (evenement_id, dossier_id, type, recu_le) VALUES (?, ?, ?, ?)')
      .run(evenementId, dossierId, type, new Date().toISOString());
    return r.changes === 1;
  }
}
