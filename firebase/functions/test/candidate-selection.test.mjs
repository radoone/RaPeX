import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRagCandidates } from '../lib/candidate-selection.js';

const row = (id, evidence = {}) => ({ id, meta: {recordid:id}, fields: {brand:'Any local brand'}, ...evidence });

test('one budget covers all photos, with independent text/image ranking and no brand restriction', () => {
  const pool = [
    ...Array.from({length:12}, (_,i)=>row('text-'+i,{textDistance:.1+i*.01})),
    ...Array.from({length:20}, (_,i)=>row('photo-'+i,{imageDistance:.2+i*.005})),
  ];
  const selected = selectRagCandidates(pool);
  assert.deepEqual(selected.map(a=>a.id), ['photo-0','photo-1','photo-2','text-0','text-1','text-2']);
  assert.equal(selectRagCandidates([...pool].reverse()).length,6);
  assert.deepEqual(selectRagCandidates([...pool].reverse()).map(a=>a.id),selected.map(a=>a.id));
});

test('thresholds reject weak hits, duplicate photos do not multiply slots, and exact GTINs bypass caps', () => {
  const exact = Array.from({length:8},(_,i)=>row('exact-'+i));
  const a = row('shared',{textDistance:.1,matchedImageUrls:['one']});
  const b = row('shared',{imageDistance:.15,matchedImageUrls:['two']});
  const selected = selectRagCandidates([...exact,a,b,row('too-weak',{textDistance:.39,imageDistance:.36})],new Set(exact.map(a=>a.id)));
  assert.equal(selected.length,9);
  assert.deepEqual(selected.slice(0,8).map(a=>a.id),exact.map(a=>a.id));
  assert.deepEqual(selected.at(-1).matchedImageUrls,['one','two']);
  assert.equal(selected.at(-1).imageDistance,.15);
});

test('missing vector evidence remains unavailable and is never reported as a clean shortlist', () => {
  assert.throws(()=>selectRagCandidates([row('broken')]),/no vector distance/);
  assert.throws(()=>selectRagCandidates([row('broken',{textDistance:NaN})]),/no vector distance/);
  assert.deepEqual(selectRagCandidates([]),[]);
});
