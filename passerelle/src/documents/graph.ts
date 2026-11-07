import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { ErreurDepotIndisponible, segmentSur, sha256, type DepotDocuments, type RefDocument } from './depot.ts';

const exec = promisify(execCb);

export type FournisseurJeton = () => Promise<string>;

/** Jeton Graph délégué obtenu via Azure CLI (PoC). Cible : client credentials + Sites.Selected. */
export function jetonAzureCli(): FournisseurJeton {
  let cache: { jeton: string; expire: number } | undefined;
  return async () => {
    if (cache && cache.expire - Date.now() > 120_000) return cache.jeton;
    try {
      // Commande fixe, sans entrée externe : exécution via le shell (az est un script .cmd sous Windows).
      const { stdout } = await exec('az account get-access-token --resource https://graph.microsoft.com -o json', {
        timeout: 30_000,
      });
      const r = JSON.parse(stdout) as { accessToken: string; expires_on?: number; expiresOn?: string };
      const expire = r.expires_on ? r.expires_on * 1000 : Date.parse(r.expiresOn ?? '') || Date.now() + 30 * 60_000;
      cache = { jeton: r.accessToken, expire };
      return r.accessToken;
    } catch (e) {
      throw new ErreurDepotIndisponible(`Impossible d'obtenir un jeton Graph via Azure CLI (az login ?) : ${(e as Error).message}`);
    }
  };
}

/** Dépôt SharePoint : bibliothèque d'un groupe Microsoft 365, confiné à un dossier racine. */
export class DepotGraph implements DepotDocuments {
  readonly mode = 'graph' as const;
  private readonly base: string;

  constructor(
    groupId: string,
    private readonly racine: string,
    private readonly jeton: FournisseurJeton,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}/drive`;
    segmentSur(racine);
  }

  private cheminEncode(segments: string[]): string {
    return [this.racine, ...segments].map((s) => encodeURIComponent(segmentSur(s))).join('/');
  }

  private async appel(url: string, init: RequestInit = {}): Promise<Response> {
    let r: Response;
    try {
      r = await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${await this.jeton()}`, ...(init.headers ?? {}) },
      });
    } catch (e) {
      if (e instanceof ErreurDepotIndisponible) throw e;
      throw new ErreurDepotIndisponible(`SharePoint injoignable : ${(e as Error).message}`);
    }
    if (r.status >= 500 || r.status === 401 || r.status === 429) {
      throw new ErreurDepotIndisponible(`SharePoint a répondu ${r.status} : ${(await r.text()).slice(0, 200)}`);
    }
    return r;
  }

  async creerDossier(chemin: string[]) {
    let url = '';
    // Crée chaque niveau (idempotent : conflictBehavior=replace n'écrase pas le contenu d'un dossier).
    for (let i = 0; i < chemin.length; i++) {
      const parent = this.cheminEncode(chemin.slice(0, i));
      const r = await this.appel(`${this.base}/root:/${parent}:/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: segmentSur(chemin[i]!), folder: {}, '@microsoft.graph.conflictBehavior': 'replace' }),
      });
      if (!r.ok && r.status !== 409) throw new Error(`Création du dossier ${chemin[i]} : ${r.status} ${(await r.text()).slice(0, 200)}`);
      if (r.ok) url = ((await r.json()) as { webUrl: string }).webUrl;
    }
    if (!url) url = (await this.element(chemin))?.webUrl ?? '';
    return { url };
  }

  private async element(chemin: string[]): Promise<{ id: string; webUrl: string } | null> {
    const r = await this.appel(`${this.base}/root:/${this.cheminEncode(chemin)}?$select=id,webUrl`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Lecture SharePoint : ${r.status}`);
    return (await r.json()) as { id: string; webUrl: string };
  }

  async deposer(chemin: string[], nom: string, contenu: Buffer): Promise<RefDocument> {
    // Upload simple (≤ 4 Mo) — suffisant pour la PoC.
    const r = await this.appel(`${this.base}/root:/${this.cheminEncode([...chemin, nom])}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(contenu),
    });
    if (!r.ok) throw new Error(`Dépôt SharePoint ${nom} : ${r.status} ${(await r.text()).slice(0, 200)}`);
    const item = (await r.json()) as { id: string; webUrl: string };
    return { id: item.id, nom, url: item.webUrl, sha256: sha256(contenu) };
  }

  async existe(chemin: string[], nom: string) {
    return (await this.element([...chemin, nom])) !== null;
  }

  async urlRacine() {
    return (await this.element([]))?.webUrl ?? '';
  }
}
