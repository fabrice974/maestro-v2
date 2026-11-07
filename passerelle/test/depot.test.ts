import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErreurCheminInterdit, ErreurDepotIndisponible, sha256 } from '../src/documents/depot.ts';
import { DepotGraph } from '../src/documents/graph.ts';
import { DepotLocal } from '../src/documents/local.ts';

describe('DepotLocal', () => {
  const depot = new DepotLocal(mkdtempSync(join(tmpdir(), 'depot-')), 'POC-Maestro-Camunda');

  it('dépose un document et calcule son empreinte', async () => {
    const contenu = Buffer.from('rapport de chantier');
    const ref = await depot.deposer(['INV-2026-0001', '02-revue-diligente'], 'rapport.txt', contenu);
    expect(ref.sha256).toBe(sha256(contenu));
    expect(await depot.existe(['INV-2026-0001', '02-revue-diligente'], 'rapport.txt')).toBe(true);
    expect(await depot.existe(['INV-2026-0001'], 'absent.txt')).toBe(false);
  });

  it('refuse les chemins qui sortent de la racine', async () => {
    await expect(depot.deposer(['..'], 'x.txt', Buffer.from('x'))).rejects.toBeInstanceOf(ErreurCheminInterdit);
    await expect(depot.deposer(['a/b'], 'x.txt', Buffer.from('x'))).rejects.toBeInstanceOf(ErreurCheminInterdit);
    await expect(depot.deposer(['INV-1'], '..\\x.txt', Buffer.from('x'))).rejects.toBeInstanceOf(ErreurCheminInterdit);
  });
});

describe('DepotGraph', () => {
  it('signale SharePoint indisponible sans lever d’erreur générique', async () => {
    const enPanne = (async () => new Response('down', { status: 503 })) as typeof fetch;
    const depot = new DepotGraph('g', 'POC-Maestro-Camunda', async () => 'jeton', enPanne);
    await expect(depot.deposer(['INV-1'], 'a.txt', Buffer.from('a'))).rejects.toBeInstanceOf(ErreurDepotIndisponible);
  });

  it('confine les URL au dossier racine et encode les segments', async () => {
    const urls: string[] = [];
    const espion = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ id: '1', webUrl: 'https://sp/x' }), { status: 201 });
    }) as unknown as typeof fetch;
    const depot = new DepotGraph('g', 'POC-Maestro-Camunda', async () => 'jeton', espion);
    await depot.deposer(['INV-2026-0001', '03-debourse'], 'avis tirage.pdf', Buffer.from('a'));
    expect(urls[0]).toContain('/root:/POC-Maestro-Camunda/INV-2026-0001/03-debourse/avis%20tirage.pdf:/content');
  });
});
