/**
 * Mini-constructeur BPMN (Zeebe) : décrit un processus en TypeScript, produit le XML sémantique.
 * La mise en page (BPMNDI) est ajoutée ensuite par bpmn-auto-layout.
 * Les fichiers .bpmn générés restent la référence : ils s'ouvrent et se modifient dans Camunda Modeler.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Noeud {
  id: string;
  rendu: (entrees: string[], sorties: string[]) => string;
}

interface Flux {
  id: string;
  de: string;
  vers: string;
  nom?: string;
  condition?: string;
}

export interface MultiInstance {
  collection: string;
  element: string;
  collectionSortie?: string;
  elementSortie?: string;
}

const lignes = (entrees: string[], sorties: string[]) =>
  [...entrees.map((f) => `<bpmn:incoming>${f}</bpmn:incoming>`), ...sorties.map((f) => `<bpmn:outgoing>${f}</bpmn:outgoing>`)].join('');

function extensions(parts: string[]): string {
  const p = parts.filter(Boolean);
  return p.length ? `<bpmn:extensionElements>${p.join('')}</bpmn:extensionElements>` : '';
}

function entetes(h?: Record<string, string>): string {
  if (!h || !Object.keys(h).length) return '';
  return `<zeebe:taskHeaders>${Object.entries(h)
    .map(([k, v]) => `<zeebe:header key="${esc(k)}" value="${esc(v)}" />`)
    .join('')}</zeebe:taskHeaders>`;
}

function io(entrees?: Record<string, string>, sorties?: Record<string, string>): string {
  const e = Object.entries(entrees ?? {}).map(([cible, source]) => `<zeebe:input source="${esc(source)}" target="${esc(cible)}" />`);
  const s = Object.entries(sorties ?? {}).map(([cible, source]) => `<zeebe:output source="${esc(source)}" target="${esc(cible)}" />`);
  return e.length || s.length ? `<zeebe:ioMapping>${[...e, ...s].join('')}</zeebe:ioMapping>` : '';
}

export class Processus {
  private noeuds: Noeud[] = [];
  private flux: Flux[] = [];
  private messages = new Map<string, string>();

  constructor(
    readonly id: string,
    readonly nom: string,
    private readonly documentation?: string,
  ) {}

  private ajouter(id: string, rendu: Noeud['rendu']) {
    if (this.noeuds.some((n) => n.id === id)) throw new Error(`id en double : ${id}`);
    this.noeuds.push({ id, rendu });
    return this;
  }

  private message(nom: string, correlation: string): string {
    const id = `Msg_${nom.replace(/[^A-Za-z0-9]/g, '_')}`;
    this.messages.set(id, `<bpmn:message id="${id}" name="${esc(nom)}">${extensions([`<zeebe:subscription correlationKey="${esc(correlation)}" />`])}</bpmn:message>`);
    return id;
  }

  debut(id: string, nom: string) {
    return this.ajouter(id, (e, s) => `<bpmn:startEvent id="${id}" name="${esc(nom)}">${lignes(e, s)}</bpmn:startEvent>`);
  }

  fin(id: string, nom: string) {
    return this.ajouter(id, (e, s) => `<bpmn:endEvent id="${id}" name="${esc(nom)}">${lignes(e, s)}</bpmn:endEvent>`);
  }

  service(id: string, nom: string, type: string, opts: { entetes?: Record<string, string>; entrees?: Record<string, string> } = {}) {
    return this.ajouter(
      id,
      (e, s) =>
        `<bpmn:serviceTask id="${id}" name="${esc(nom)}">${extensions([
          `<zeebe:taskDefinition type="${esc(type)}" retries="3" />`,
          entetes(opts.entetes),
          io(opts.entrees),
        ])}${lignes(e, s)}</bpmn:serviceTask>`,
    );
  }

  /** Activité d'appel vers un autre processus. */
  appel(
    id: string,
    nom: string,
    processId: string,
    opts: { propager?: boolean; entrees?: Record<string, string>; sorties?: Record<string, string>; multi?: MultiInstance } = {},
  ) {
    const multi = opts.multi
      ? `<bpmn:multiInstanceLoopCharacteristics>${extensions([
          `<zeebe:loopCharacteristics inputCollection="${esc(opts.multi.collection)}" inputElement="${esc(opts.multi.element)}"${
            opts.multi.collectionSortie ? ` outputCollection="${esc(opts.multi.collectionSortie)}" outputElement="${esc(opts.multi.elementSortie ?? '')}"` : ''
          } />`,
        ])}</bpmn:multiInstanceLoopCharacteristics>`
      : '';
    return this.ajouter(
      id,
      (e, s) =>
        `<bpmn:callActivity id="${id}" name="${esc(nom)}">${extensions([
          `<zeebe:calledElement processId="${esc(processId)}" propagateAllChildVariables="${opts.propager ?? true}" />`,
          io(opts.entrees, opts.sorties),
        ])}${lignes(e, s)}${multi}</bpmn:callActivity>`,
    );
  }

  /** Tâche métier garantie : appel de tache-metier avec le type de tâche ; le résultat est rangé dans `sortie`. */
  tache(id: string, nom: string, typeTache: string, sortie: string, opts: { multi?: MultiInstance } = {}) {
    return this.appel(id, nom, 'tache-metier', {
      propager: false,
      entrees: { typeTache: `="${typeTache}"` },
      sorties: { [sortie]: '=resultat' },
      multi: opts.multi,
    });
  }

  /** Business rule task (DMN, liaison latest). Un écouteur d'exécution consigne la décision dans l'audit. */
  regle(id: string, nom: string, decisionId: string, variable: string, entrees?: Record<string, string>) {
    return this.ajouter(
      id,
      (e, s) =>
        `<bpmn:businessRuleTask id="${id}" name="${esc(nom)}">${extensions([
          `<zeebe:calledDecision decisionId="${esc(decisionId)}" resultVariable="${esc(variable)}" />`,
          io(entrees),
          entetes({ regle: decisionId, variable }),
          `<zeebe:executionListeners><zeebe:executionListener eventType="end" retries="3" type="regle.consigner" /></zeebe:executionListeners>`,
        ])}${lignes(e, s)}</bpmn:businessRuleTask>`,
    );
  }

  /** Script FEEL natif (aucun worker). */
  script(id: string, nom: string, expression: string, variable: string) {
    return this.ajouter(
      id,
      (e, s) =>
        `<bpmn:scriptTask id="${id}" name="${esc(nom)}">${extensions([
          `<zeebe:script expression="${esc(expression)}" resultVariable="${esc(variable)}" />`,
        ])}${lignes(e, s)}</bpmn:scriptTask>`,
    );
  }

  ou(id: string, nom = '') {
    return this.ajouter(id, (e, s) => `<bpmn:exclusiveGateway id="${id}" name="${esc(nom)}">${lignes(e, s)}</bpmn:exclusiveGateway>`);
  }

  et(id: string, nom = '') {
    return this.ajouter(id, (e, s) => `<bpmn:parallelGateway id="${id}" name="${esc(nom)}">${lignes(e, s)}</bpmn:parallelGateway>`);
  }

  evenementiel(id: string, nom = '') {
    return this.ajouter(id, (e, s) => `<bpmn:eventBasedGateway id="${id}" name="${esc(nom)}">${lignes(e, s)}</bpmn:eventBasedGateway>`);
  }

  attendreMessage(id: string, nom: string, message: string, correlation: string) {
    const ref = this.message(message, correlation);
    return this.ajouter(
      id,
      (e, s) =>
        `<bpmn:intermediateCatchEvent id="${id}" name="${esc(nom)}">${lignes(e, s)}<bpmn:messageEventDefinition messageRef="${ref}" /></bpmn:intermediateCatchEvent>`,
    );
  }

  attendreDelai(id: string, nom: string, duree: string) {
    return this.ajouter(
      id,
      (e, s) =>
        `<bpmn:intermediateCatchEvent id="${id}" name="${esc(nom)}">${lignes(e, s)}<bpmn:timerEventDefinition><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">${esc(duree)}</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`,
    );
  }

  /** Événement de bordure « message » (non interrompant par défaut). */
  bordureMessage(id: string, nom: string, attacheA: string, message: string, correlation: string, interrompant = false) {
    const ref = this.message(message, correlation);
    return this.ajouter(
      id,
      (e, s) =>
        `<bpmn:boundaryEvent id="${id}" name="${esc(nom)}" attachedToRef="${attacheA}" cancelActivity="${interrompant}">${lignes(e, s)}<bpmn:messageEventDefinition messageRef="${ref}" /></bpmn:boundaryEvent>`,
    );
  }

  /** Relie a → b (et ainsi de suite) ; une condition FEEL s'écrit sans le « = » initial. */
  relier(de: string, vers: string, opts: { nom?: string; condition?: string } = {}) {
    this.flux.push({ id: `Flux_${this.flux.length + 1}`, de, vers, ...opts });
    return this;
  }

  chaine(...ids: string[]) {
    for (let i = 0; i < ids.length - 1; i++) this.relier(ids[i]!, ids[i + 1]!);
    return this;
  }

  xml(): string {
    for (const f of this.flux) {
      for (const bout of [f.de, f.vers]) if (!this.noeuds.some((n) => n.id === bout)) throw new Error(`${this.id} : flux vers un nœud inconnu ${bout}`);
    }
    const corps = this.noeuds
      .map((n) =>
        n.rendu(
          this.flux.filter((f) => f.vers === n.id).map((f) => f.id),
          this.flux.filter((f) => f.de === n.id).map((f) => f.id),
        ),
      )
      .join('\n    ');
    const flux = this.flux
      .map(
        (f) =>
          `<bpmn:sequenceFlow id="${f.id}" sourceRef="${f.de}" targetRef="${f.vers}"${f.nom ? ` name="${esc(f.nom)}"` : ''}>${
            f.condition ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">=${esc(f.condition)}</bpmn:conditionExpression>` : ''
          }</bpmn:sequenceFlow>`,
      )
      .join('\n    ');
    return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:modeler="http://camunda.org/schema/modeler/1.0" id="Defs_${this.id}" targetNamespace="http://maestro.poc/bpmn" exporter="maestro-generateur" exporterVersion="1.0" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.8.0">
  <bpmn:process id="${this.id}" name="${esc(this.nom)}" isExecutable="true">
    ${this.documentation ? `<bpmn:documentation>${esc(this.documentation)}</bpmn:documentation>` : ''}
    ${corps}
    ${flux}
  </bpmn:process>
  ${[...this.messages.values()].join('\n  ')}
</bpmn:definitions>
`;
  }
}
