/** Convertit une durée ISO-8601 simple (PnDTnHnMnS, PnW) en secondes. */
export function dureeEnSecondes(iso: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m || iso === 'P' || iso.endsWith('T')) throw new Error(`Durée ISO-8601 invalide : ${iso}`);
  const [, w, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return (w! * 7 + d!) * 86_400 + h! * 3_600 + mi! * 60 + s!;
}

/** Applique un facteur (démo accélérée) et renvoie une durée PTnS d'au moins 30 secondes. */
export function ajusterDuree(iso: string, facteur: number): string {
  return `PT${Math.max(30, Math.round(dureeEnSecondes(iso) * facteur))}S`;
}

export function aujourdhuiLocal(d = new Date()): string {
  return d.toLocaleDateString('sv-SE');
}
