import type { DiagramEdge } from '@on.auto/definitions';
import { textField } from '@on.auto/workflow-engine';

import type { PlacedTask } from './placed-tasks.ts';
import { casesOf, catchLabelOf, conditionOf } from './task-flow.ts';

export interface Exit {
  readonly from: number;
  readonly label?: string;
  readonly dashed?: boolean;
}

type Visited = ReadonlySet<PlacedTask>;

type Onward = (exits: readonly Exit[], visited: Visited) => void;

interface Place {
  readonly tasks: readonly PlacedTask[];
  readonly onward: Onward;
  readonly leave: Onward;
  readonly draw: (edge: DiagramEdge) => void;
}

interface Spot {
  readonly place: Place;
  readonly position: number;
  readonly task: PlacedTask;
}

const unvisited: Visited = new Set();

function runEnds(): void {}

function labelled(exits: readonly Exit[], label: string): readonly Exit[] {
  return exits.map((exit) => ({ ...exit, label: exit.label === undefined ? label : `${exit.label}, ${label}` }));
}

function nodesWithin(tasks: readonly PlacedTask[]): readonly number[] {
  return tasks.flatMap(({ node, body, recovery }) => [
    ...(node === undefined ? [] : [node]),
    ...nodesWithin(body),
    ...nodesWithin(recovery),
  ]);
}

function drawn({ from, label, dashed = false }: Exit, to: number): DiagramEdge {
  return { from, to, ...(label === undefined ? {} : { label }), ...(dashed ? { dashed } : {}) };
}

function routed(next: string | undefined, spot: Spot, exits: readonly Exit[], visited: Visited): void {
  const { place, position } = spot;
  if (next === 'exit') {
    place.leave(exits, visited);
  } else if (next !== 'end') {
    const target = place.tasks.findIndex(({ name }) => name === next);
    arrive(place, target === -1 ? position + 1 : target, exits, visited);
  }
}

function completed(spot: Spot, exits: readonly Exit[], visited: Visited): void {
  routed(textField(spot.task.task, 'then'), spot, exits, visited);
}

function finishing(spot: Spot): Onward {
  return (exits, visited) => {
    completed(spot, exits, visited);
  };
}

function bodyPlace(spot: Spot): Place {
  const done = finishing(spot);
  const looped: Onward = (exits, visited) => {
    done(exits, visited);
    if (!visited.has(spot.task)) {
      arrive(bodyPlace(spot), 0, labelled(exits, 'next item'), new Set([...visited, spot.task]));
    }
  };
  const { draw } = spot.place;
  return { tasks: spot.task.body, onward: spot.task.kind === 'for' ? looped : done, leave: done, draw };
}

function branchPlaces(spot: Spot): readonly Place[] {
  const done = finishing(spot);
  const { draw } = spot.place;
  return spot.task.body.map((branch) => ({ tasks: [branch], onward: done, leave: done, draw }));
}

function innerPlaces(spot: Spot): readonly Place[] {
  return spot.task.kind === 'fork' ? branchPlaces(spot) : [bodyPlace(spot)];
}

function entered(spot: Spot, exits: readonly Exit[], visited: Visited): void {
  const { node, kind, body } = spot.task;
  if (node !== undefined) {
    for (const exit of exits) {
      spot.place.draw(drawn(exit, node));
    }
  } else if (kind === 'fork' && body.length === 0) {
    completed(spot, exits, visited);
  } else {
    for (const place of innerPlaces(spot)) {
      arrive(place, 0, exits, visited);
    }
  }
}

function arrive(place: Place, position: number, exits: readonly Exit[], visited: Visited): void {
  const task = place.tasks[position];
  if (task === undefined) {
    place.onward(exits, visited);
    return;
  }
  if (visited.has(task)) {
    return;
  }
  const condition = conditionOf(task.task);
  const entering = condition === undefined ? exits : labelled(exits, `if ${condition}`);
  entered({ place, position, task }, entering, new Set([...visited, task]));
  if (condition !== undefined) {
    arrive(place, position + 1, labelled(exits, 'otherwise'), visited);
  }
}

function wiredSwitch(spot: Spot, from: number): void {
  const cases = casesOf(spot.task.task);
  for (const { name, next } of cases) {
    routed(next, spot, [{ from, label: name }], unvisited);
  }
  if (cases.every(({ when }) => when !== undefined)) {
    completed(spot, [{ from, label: 'no case holds' }], unvisited);
  }
}

function wiredTry(spot: Spot): void {
  const label = catchLabelOf(spot.task.task);
  const failing = nodesWithin(spot.task.body).map((from) => ({ from, label, dashed: true }));
  const { draw } = spot.place;
  const recovery: Place = { tasks: spot.task.recovery, onward: finishing(spot), leave: finishing(spot), draw };
  arrive(recovery, 0, failing, unvisited);
  wired(recovery);
}

function wiredTask(spot: Spot): void {
  const { node, kind } = spot.task;
  if (node === undefined) {
    for (const place of innerPlaces(spot)) {
      wired(place);
    }
    if (kind === 'try') {
      wiredTry(spot);
    }
  } else if (kind === 'switch') {
    wiredSwitch(spot, node);
  } else if (kind !== 'raise') {
    completed(spot, [{ from: node }], unvisited);
  }
}

function wired(place: Place): void {
  for (const [position, task] of place.tasks.entries()) {
    wiredTask({ place, position, task });
  }
}

export function edgesOf(tasks: readonly PlacedTask[], entries: readonly Exit[]): readonly DiagramEdge[] {
  const edges = new Map<string, DiagramEdge>();
  const draw = (edge: DiagramEdge) => {
    edges.set(JSON.stringify(edge), edge);
  };
  const top: Place = { tasks, onward: runEnds, leave: runEnds, draw };
  arrive(top, 0, entries, unvisited);
  wired(top);
  return [...edges.values()];
}
