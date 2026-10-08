import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesignStore } from '../src/core/history.js';
import { defaultDesign } from '../src/core/model.js';

test('a dragged value becomes one undoable command', () => {
  const store = new DesignStore(defaultDesign());
  const events = [];
  store.addEventListener('change', e => events.push(e.detail.kind));
  store.begin('Change focal length');
  for (let f = 1.71; f <= 2.2; f += 0.01) { store.design.collector.focalLength = f; store.preview(); }
  assert.equal(store.commit(), true);
  assert.equal(store.undoStack.length, 1);
  assert.equal(store.undoStack[0].patches.length, 1);
  const after = store.design.collector.focalLength;
  store.undo();
  assert.equal(store.design.collector.focalLength, 1.71);
  store.redo();
  assert.equal(store.design.collector.focalLength, after);
  assert.equal(events.filter(k => k === 'preview').length > 10, true);
  assert.deepEqual(events.filter(k => k !== 'preview'), ['commit', 'undo', 'redo']);
});

test('an invalid commit rolls back and leaves history untouched', () => {
  const store = new DesignStore(defaultDesign());
  const before = structuredClone(store.design);
  assert.throws(() => store.transact('Break it', d => { d.collector.apertureWidth = -2; }), /apertureWidth/);
  assert.deepEqual(store.design, before);
  assert.equal(store.undoStack.length, 0);
  assert.equal(store.revision, 0);
});

test('a transaction that changes nothing is not recorded', () => {
  const store = new DesignStore(defaultDesign());
  assert.equal(store.transact('Nothing', d => { d.collector.focalLength = d.collector.focalLength; }), false);
  assert.equal(store.undoStack.length, 0);
});

test('switching a union variant undoes cleanly', () => {
  const store = new DesignStore(defaultDesign());
  const before = structuredClone(store.design);
  store.transact('Use a pillbox sun', d => { d.sun = { shape: 'pillbox', halfAngleMrad: 4.65 }; });
  store.undo();
  assert.deepEqual(store.design, before);
});

test('a new edit clears redo, and history is bounded', () => {
  const store = new DesignStore(defaultDesign(), { maxCommands: 5 });
  for (let i = 0; i < 8; i++) store.transact(`Step ${i}`, d => { d.simulation.seed = i + 10; });
  assert.equal(store.undoStack.length, 5);
  store.undo();
  assert.equal(store.canRedo, true);
  store.transact('Branch', d => { d.title = 'Branch'; });
  assert.equal(store.canRedo, false);
  assert.equal(store.undoLabel, 'Branch');
});
