import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface EntreeAudit {
  acteur: string;
  application: string;
  action: string;
  dossierId?: string;
  tacheId?: string;
  details?: Record<string, unknown>;
  document?: { nom: string; url: string; sha256: string };
  versionModele?: string;
  cleInstance?: string;
}

export interface EntreeAuditScellee extends EntreeAudit {
  seq: number;
  horodatage: string;
  hashPrecedent: string;
  hash: string;
}

const GENESE = '0'.repeat(64);

/** JSON canonique : clés triées récursivement, pour un hash stable. */
function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonique((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function calculerHash(e: Omit<EntreeAuditScellee, 'hash'>): string {
  return createHash('sha256').update(canonique(e)).digest('hex');
}

/**
 * Journal d'audit en ajout seul. Chaque entrée contient le hash de la précédente :
 * toute modification a posteriori rompt la chaîne et est détectée par verifier().
 */
export class Journal {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY,
        horodatage TEXT NOT NULL,
        dossier_id TEXT,
        contenu TEXT NOT NULL,
        hash_precedent TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS audit_dossier ON audit(dossier_id);
      CREATE TRIGGER IF NOT EXISTS audit_sans_update BEFORE UPDATE ON audit
        BEGIN SELECT RAISE(ABORT, 'journal d''audit en ajout seul'); END;
      CREATE TRIGGER IF NOT EXISTS audit_sans_delete BEFORE DELETE ON audit
        BEGIN SELECT RAISE(ABORT, 'journal d''audit en ajout seul'); END;
    `);
  }

  ajouter(e: EntreeAudit, horodatage = new Date().toISOString()): EntreeAuditScellee {
    const dernier = this.db.prepare('SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1').get() as
      | { seq: number; hash: string }
      | undefined;
    const sansHash = { ...e, seq: (dernier?.seq ?? 0) + 1, horodatage, hashPrecedent: dernier?.hash ?? GENESE };
    const scellee: EntreeAuditScellee = { ...sansHash, hash: calculerHash(sansHash) };
    this.db
      .prepare('INSERT INTO audit (seq, horodatage, dossier_id, contenu, hash_precedent, hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(scellee.seq, horodatage, e.dossierId ?? null, JSON.stringify(e), scellee.hashPrecedent, scellee.hash);
    return scellee;
  }

  lister(filtre: { dossierId?: string; depuisSeq?: number } = {}): EntreeAuditScellee[] {
    const lignes = (
      filtre.dossierId
        ? this.db.prepare('SELECT * FROM audit WHERE dossier_id = ? ORDER BY seq').all(filtre.dossierId)
        : this.db.prepare('SELECT * FROM audit WHERE seq > ? ORDER BY seq').all(filtre.depuisSeq ?? 0)
    ) as { seq: number; horodatage: string; contenu: string; hash_precedent: string; hash: string }[];
    return lignes.map((l) => ({
      ...(JSON.parse(l.contenu) as EntreeAudit),
      seq: l.seq,
      horodatage: l.horodatage,
      hashPrecedent: l.hash_precedent,
      hash: l.hash,
    }));
  }

  verifier(): { valide: boolean; entrees: number; rompueA?: number; dernierHash: string } {
    let precedent = GENESE;
    const toutes = this.lister();
    for (const e of toutes) {
      const { hash, ...reste } = e;
      if (e.hashPrecedent !== precedent || calculerHash(reste) !== hash) {
        return { valide: false, entrees: toutes.length, rompueA: e.seq, dernierHash: precedent };
      }
      precedent = hash;
    }
    return { valide: true, entrees: toutes.length, dernierHash: precedent };
  }
}
