import type { Position } from "./types";

const BASE = 65536;

function compare(a: Position, b: Position): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}

export function comparePosition(a: Position, b: Position): number {
  return compare(a, b);
}

export function generateBetween(left: Position, right: Position, siteBias: number): Position {
  const half = Math.floor(BASE / 2);
  let bias = siteBias;
  if (bias < 0) bias = -bias;
  bias = bias % half;

  for (let i = 0; ; i++) {
    const leftVal = i < left.length ? left[i] : 0;
    const rightVal = i < right.length ? right[i] : BASE;

    if (i >= left.length && i < right.length) {
      if (rightVal > 0) {
        const out = left.slice(0);
        out.push(Math.floor(rightVal / 2));
        return out;
      }
      const out = left.slice(0);
      out.push(0);
      out.push(half + bias);
      return out;
    }

    if (leftVal + 1 < rightVal) {
      const gap = rightVal - leftVal - 1;
      if (gap <= 1) {
        const out = left.slice(0);
        out.push(half + bias);
        return out;
      }
      const mid = leftVal + 1 + (bias % gap);
      const out = left.slice(0, i + 1);
      if (out.length <= i) out.length = i + 1;
      out[i] = mid;
      return out;
    }

    if (leftVal + 1 === rightVal) {
      const out = left.slice(0);
      out.push(half + bias);
      return out;
    }
  }
}

export interface Element {
  position: Position;
  value: string;
  deleted: boolean;
}

function indexOfByPosition(elements: Element[], pos: Position): number {
  for (let i = 0; i < elements.length; i++) {
    if (compare(elements[i].position, pos) === 0) return i;
  }
  return -1;
}

export class CrdtEngine {
  private elements: Element[] = [];

  constructor() {
    this.elements = [
      { position: [0], value: "\u0000", deleted: true },
      { position: [BASE - 1], value: "\u0000", deleted: true },
    ];
  }

  insert(left: Position, right: Position, value: string, siteBias: number): Element {
    const position = generateBetween(left, right, siteBias);
    const el: Element = { position: position.slice(), value, deleted: false };
    this.insertElement(el);
    return el;
  }

  private insertElement(el: Element): void {
    if (indexOfByPosition(this.elements, el.position) >= 0) return;
    let insertAt = 0;
    while (insertAt < this.elements.length && compare(this.elements[insertAt].position, el.position) < 0) {
      insertAt++;
    }
    this.elements.splice(insertAt, 0, el);
  }

  delete(pos: Position): void {
    const i = indexOfByPosition(this.elements, pos);
    if (i >= 0) this.elements[i].deleted = true;
  }

  applyRemote(position: Position, value: string, deleted: boolean): void {
    const i = indexOfByPosition(this.elements, position);
    if (i >= 0) {
      if (deleted) {
        this.elements[i].deleted = true;
      } else {
        this.elements[i].deleted = false;
      }
      return;
    }
    if (deleted) return;
    this.insertElement({ position: position.slice(), value, deleted: false });
  }

  getText(): string {
    return this.elements
      .filter((el) => !el.deleted && el.value !== "\u0000")
      .map((el) => el.value)
      .join("");
  }

  getPositions(): Position[] {
    return this.elements.filter((el) => !el.deleted).map((el) => el.position.slice());
  }

  getElements(): readonly Element[] {
    return this.elements;
  }

  positionToIndex(pos: Position): number {
    let index = 0;
    for (const el of this.elements) {
      if (el.deleted || el.value === "\u0000") continue;
      if (compare(el.position, pos) < 0) index++;
      else break;
    }
    return index;
  }

  indexToPosition(index: number): Position {
    const positions = this.getPositions();
    if (positions.length === 0) return generateBetween([0], [BASE - 1], 0);
    if (index <= 0) return generateBetween([0], positions[0], 0);
    if (index >= positions.length) return generateBetween(positions[positions.length - 1], [BASE - 1], 0);
    return generateBetween(positions[index - 1], positions[index], 0);
  }

  clone(): CrdtEngine {
    const other = new CrdtEngine();
    other.elements = this.elements.map((el) => ({
      position: el.position.slice(),
      value: el.value,
      deleted: el.deleted,
    }));
    return other;
  }
}
