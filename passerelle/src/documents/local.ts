import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { segmentSur, sha256, type DepotDocuments, type RefDocument } from './depot.ts';

/** Dépôt de repli : un dossier local qui imite l'arborescence SharePoint. */
export class DepotLocal implements DepotDocuments {
  readonly mode = 'local' as const;
  private readonly racine: string;

  constructor(dossier: string, racineNom: string) {
    this.racine = resolve(dossier, segmentSur(racineNom));
    mkdirSync(this.racine, { recursive: true });
  }

  private chemin(segments: string[]): string {
    return join(this.racine, ...segments.map(segmentSur));
  }

  async creerDossier(chemin: string[]) {
    const p = this.chemin(chemin);
    mkdirSync(p, { recursive: true });
    return { url: pathToFileURL(p).href };
  }

  async deposer(chemin: string[], nom: string, contenu: Buffer): Promise<RefDocument> {
    const dossier = this.chemin(chemin);
    mkdirSync(dossier, { recursive: true });
    const fichier = join(dossier, segmentSur(nom));
    writeFileSync(fichier, contenu);
    return { id: [...chemin, nom].join('/'), nom, url: pathToFileURL(fichier).href, sha256: sha256(contenu) };
  }

  async existe(chemin: string[], nom: string) {
    return existsSync(join(this.chemin(chemin), segmentSur(nom)));
  }

  async urlRacine() {
    return pathToFileURL(this.racine).href;
  }
}
