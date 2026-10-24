import * as matchingWork from '../../lib/matching-work.js';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Evaluate owning source with explicit I/O substitutes. No Firebase SDK, credentials or live calls.
export function sourceFunction(module, name, deps = {}) {
  deps = { ...matchingWork, ...deps };
  const source = readFileSync(new URL(`../../src/${module}.ts`, import.meta.url), 'utf8');
  const tree = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Missing owning function ${name}`);
  const js = ts.transpileModule(node.getText(tree).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(deps), `${js}\nreturn ${name};`)(...Object.values(deps));
}
const DEL = Symbol('delete');
export class Timestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
  static now() { return new Timestamp(Date.now()); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  static fromMillis(n) { return new Timestamp(n); }
}
export const FieldValue = { serverTimestamp: () => Timestamp.now(), delete: () => DEL, vector: a => ({ toArray: () => a }) };
export function database() {
  const rows = new Map();
  let serial = Promise.resolve(), sequence = 0;
  const merge = (path, data) => {
    const value = { ...rows.get(path) };
    for (const [k, v] of Object.entries(data)) if (v === DEL) delete value[k]; else value[k] = v;
    rows.set(path, value);
  };
  const doc = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`), get: async () => snapshot(path), set: async data => merge(path, data) });
  const snapshot = path => { const exists = rows.has(path), data = exists ? { ...rows.get(path) } : undefined; return { id: path.split('/').at(-1), ref: doc(path), exists, data: () => data && { ...data }, get: key => key.split('.').reduce((v, k) => v?.[k], data) }; };
  const collection = (path, filters = [], cap = Infinity) => ({
    orderBy: () => collection(path, filters, cap), startAfter: () => collection(path, filters, cap),
    doc: id => doc(`${path}/${id}`), where: (k, op, v) => collection(path, [...filters, [k, v]], cap), limit: n => collection(path, filters, n),
    get: async () => {
      const docs = [...rows.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .map(snapshot).filter(d => filters.every(([k, v]) => d.get(k) === v)).slice(0, cap);
      return { docs, empty: !docs.length, size: docs.length };
    },
    add: async data => { const ref = doc(`${path}/auto-${++sequence}`); await ref.set(data); return ref; },
    findNearest: options => ({ get: async () => {
      if (db.indexFailure) throw new Error('FAILED_PRECONDITION Missing vector index configuration');
      const all = await collection(path).get();
      return { docs: all.docs.slice(0, options.limit).map(s => ({ ...s, get: key => key === 'distance' ? .01 : s.get(key) })) };
    } }),
  });
  const db = { rows, doc, collection, runTransaction: callback => {
    const run = serial.then(async () => {
      const operations = [];
      const result = await callback({ get: ref => ref.get(), set: (ref, data) => operations.push(() => merge(ref.path, data)), create: (ref, data) => operations.push(() => { assert.ok(!rows.has(ref.path)); merge(ref.path, data); }) });
      operations.forEach(op => op());
      return result;
    });
    serial = run.catch(() => {});
    return run;
  } };
  return db;
}
export const collections = { merchants: 'merchants', alerts: 'rapex_alerts', subProducts: 'products', subAlerts: 'alerts', subChecks: 'checks' };
export const logger = { info() {}, warn() {}, error() {} };
