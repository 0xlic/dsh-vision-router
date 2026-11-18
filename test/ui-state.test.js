import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoWriter, rankModels } from '../ui-state.js';

const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(initial = {}) {
  let state = { status: 'ready', value: { a: 0, b: 0, untouched: 10 }, revision: 1, writable: true, ...initial };
  const listeners = new Set();
  const calls = [];
  let active = 0;
  let maximum = 0;
  const emit = patch => {
    state = { ...state, ...patch };
    for (const fn of [...listeners]) fn();
  };
  const form = {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    mutate(ops, revision) {
      active++;
      maximum = Math.max(maximum, active);
      return new Promise((resolve, reject) => calls.push({ ops, revision,
        success() {
          const value = { ...state.value };
          for (const op of ops) value[op.path[0]] = op.value;
          emit({ value, revision: state.revision + 1 });
          active--; resolve(true);
        },
        conflict(value = state.value) { emit({ value, revision: state.revision + 1 }); active--; resolve(false); },
        fail() { active--; reject(new Error('transport')); },
      }));
    },
  };
  return { form, calls, emit, listeners, get maximum() { return maximum; } };
}
const fields = call => call.ops.map(op => op.path[0]);

test('optimistic microtask batching writes only edited fields and uses stable snapshots', async () => {
  const f = fixture();
  const writer = createAutoWriter(f.form);
  const initial = writer.getSnapshot();
  assert.equal(initial, writer.getSnapshot());
  let notifications = 0;
  writer.subscribe(() => { notifications++; assert.notEqual(writer.getSnapshot(), initial); });
  writer.update('a', 1);
  const optimistic = writer.getSnapshot();
  assert.equal(optimistic.value.a, 1);
  assert.equal(optimistic.status, 'saving');
  writer.update('a', n => n + 1);
  writer.update('b', 3);
  assert.equal(f.calls.length, 0);
  await tick();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(fields(f.calls[0]), ['a', 'b']);
  assert.equal(f.calls[0].revision, 1);
  assert.deepEqual(f.calls[0].ops.map(op => op.value), [2, 3]);
  f.calls[0].success(); await tick();
  assert.equal(writer.getSnapshot().status, 'ready');
  assert.equal(writer.getSnapshot().value.untouched, 10);
  assert.equal(optimistic.value.a, 1, 'earlier snapshots are never mutated');
  const ready = writer.getSnapshot();
  f.emit({});
  assert.equal(writer.getSnapshot(), ready);
  assert.ok(notifications >= 3);
  await writer.dispose();
});

test('single write queue retains newer same-field updates and advances revision after success', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1); await tick();
  writer.update('a', n => n + 1);
  writer.update('b', 4);
  await tick();
  assert.equal(f.calls.length, 1);
  f.calls[0].success(); await tick();
  assert.equal(writer.getSnapshot().value.a, 2);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(fields(f.calls[1]), ['a', 'b']);
  assert.equal(f.calls[1].revision, 2);
  writer.update('a', 5);
  f.calls[1].success(); await tick();
  assert.deepEqual(fields(f.calls[2]), ['a']);
  assert.equal(f.calls[2].revision, 3);
  f.calls[2].success(); await tick();
  assert.equal(writer.getSnapshot().value.a, 5);
  assert.equal(f.maximum, 1);
  await writer.dispose();
});

test('first edit revision fence catches external update before microtask without overwriting it', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1);
  f.emit({ revision: 2, value: { a: 8, b: 9, untouched: 99 } });
  await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(writer.getSnapshot().status, 'conflict');
  assert.deepEqual(writer.getSnapshot().value, { a: 1, b: 9, untouched: 99 });
  assert.equal(writer.retry(), false);
  writer.update('b', 3); await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(writer.reload(), true);
  assert.deepEqual(writer.getSnapshot().value, { a: 8, b: 9, untouched: 99 });
  writer.update('a', 4); await tick();
  assert.equal(f.calls[0].revision, 2);
  f.calls[0].success(); await tick();
  assert.equal(f.form.getSnapshot().value.untouched, 99);
  await writer.dispose();
});

test('false preserves inflight and queued drafts, never retries, and only reload resolves conflict', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1); await tick(); writer.update('a', 2); writer.update('b', 3);
  f.calls[0].conflict({ a: 7, b: 8, untouched: 90 }); await tick();
  assert.equal(writer.getSnapshot().status, 'conflict');
  assert.deepEqual(writer.getSnapshot().value, { a: 2, b: 3, untouched: 90 });
  assert.equal(writer.retry(), false);
  f.emit({ revision: 3, value: { a: 11, b: 12, untouched: 91 } }); await tick();
  assert.equal(f.calls.length, 1);
  writer.reload();
  assert.equal(writer.getSnapshot().status, 'ready');
  assert.deepEqual(writer.getSnapshot().value, f.form.getSnapshot().value);
  await writer.dispose();
});

test('transport error retains drafts and retries explicitly at the original revision', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1); await tick(); f.calls[0].fail(); await tick();
  assert.equal(writer.getSnapshot().status, 'error');
  writer.update('a', 2); writer.update('b', 3); await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(writer.getSnapshot().status, 'error');
  assert.equal(writer.retry(), true); await tick();
  assert.equal(f.calls[1].revision, 1);
  assert.deepEqual(f.calls[1].ops.map(op => op.value), [2, 3]);
  f.calls[1].success(); await tick();
  assert.equal(writer.getSnapshot().status, 'ready');
  await writer.dispose();
});

test('retry cannot silently rebase an error draft onto a newer external revision', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1); await tick(); f.calls[0].fail(); await tick();
  f.emit({ revision: 2, value: { a: 8, b: 0, untouched: 10 } });
  writer.retry(); await tick();
  assert.equal(writer.getSnapshot().status, 'conflict');
  assert.equal(f.calls.length, 1);
  assert.equal(writer.getSnapshot().value.a, 1);
  await writer.dispose();
});

test('loading, unavailable and read-only are non-writable and follow live state', async () => {
  const f = fixture({ status: 'loading', writable: true, value: undefined });
  const writer = createAutoWriter(f.form);
  assert.deepEqual(writer.getSnapshot(), { value: undefined, status: 'loading', writable: false });
  assert.equal(writer.update('a', 1), false);
  f.emit({ status: 'unavailable' });
  assert.equal(writer.getSnapshot().writable, false);
  f.emit({ status: 'ready', writable: false, value: { a: 3 } });
  assert.equal(writer.update('a', 4), false);
  f.emit({ writable: true }); writer.update('a', 4); await tick();
  f.calls[0].success(); await tick(); await writer.dispose();
});

test('temporary loading pauses a queued draft, then resumes without losing its fence', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1); f.emit({ status: 'loading' }); await tick();
  assert.equal(writer.getSnapshot().status, 'loading');
  assert.equal(writer.getSnapshot().writable, false);
  assert.equal(f.calls.length, 0);
  f.emit({ status: 'ready' }); await tick();
  assert.equal(f.calls.length, 1);
  f.calls[0].success(); await tick(); await writer.dispose();
});

test('multiple page subscriptions are independent; unmount never cancels writes', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  let a = 0; let b = 0;
  const offA = writer.subscribe(() => a++); const offB = writer.subscribe(() => b++);
  writer.update('a', 1); offA(); await tick();
  const before = a;
  f.calls[0].success(); await tick();
  assert.equal(a, before);
  assert.ok(b > a);
  offB();
  writer.update('b', 2); await tick();
  assert.equal(f.calls.length, 2);
  f.calls[1].success(); await tick(); await writer.dispose();
});

test('dispose detaches immediately but drains inflight and queued writes serially', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1); await tick(); writer.update('a', 2); writer.update('b', 3);
  let done = false;
  const disposal = writer.dispose().then(() => { done = true; });
  assert.equal(f.listeners.size, 0);
  assert.equal(writer.update('a', 9), false);
  assert.equal(writer.reload(), false);
  assert.equal(writer.retry(), false);
  await tick(); assert.equal(done, false);
  f.calls[0].success(); await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].revision, 2);
  f.calls[1].success(); await disposal;
  assert.deepEqual(f.form.getSnapshot().value, { a: 2, b: 3, untouched: 10 });
  assert.equal(f.maximum, 1);
});

test('dispose before microtask still writes; failure stops disposal drain without automatic retry', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1);
  const disposal = writer.dispose();
  assert.equal(disposal, writer.dispose());
  await tick(); assert.equal(f.calls.length, 1);
  f.calls[0].fail(); await disposal;
  assert.equal(writer.getSnapshot().status, 'error');
  assert.equal(writer.getSnapshot().value.a, 1);
  await tick(); assert.equal(f.calls.length, 1);
});

test('reload refuses to discard while a remote request can still commit', async () => {
  const f = fixture(); const writer = createAutoWriter(f.form);
  writer.update('a', 1); await tick(); writer.update('a', 2);
  assert.equal(writer.reload(), false);
  assert.equal(writer.getSnapshot().value.a, 2);
  f.calls[0].success(); await tick(); f.calls[1].success(); await tick();
  await writer.dispose();
});

test('rankModels orders exact, prefix, substring, then subsequence with stable ties', () => {
  const groups = [{ id: 'p', name: 'Provider', models: [
    { id: 'g-p-t-4-1', name: 'Fuzzy' }, { id: 'xgpt41x', name: 'Substring' },
    { id: 'gpt41-z', name: 'Prefix Z' }, { id: 'gpt41', name: 'Exact' },
    { id: 'gpt41-a', name: 'Prefix A' }, { id: 'gpt-4.1', name: 'Fuzzy second' },
  ] }];
  assert.deepEqual(rankModels(groups, 'GPT41').map(row => row.model),
    ['gpt41', 'gpt41-z', 'gpt41-a', 'xgpt41x', 'g-p-t-4-1', 'gpt-4.1']);
});

test('all query words match independently across metadata, ignoring case and whitespace', () => {
  const groups = [{ id: 'route-one', name: 'Acme Cloud', models: [
    { id: 'gpt-4.1', name: 'Vision Pro', inputModalities: ['text', 'image'] },
    { id: 'gpt-4.1-mini', name: 'Small' },
  ] }];
  const result = rankModels(groups, '  ACME   GPT41\tPRO route  ');
  assert.deepEqual(result, [{ provider: 'route-one', providerName: 'Acme Cloud', model: 'gpt-4.1', name: 'Vision Pro', inputModalities: ['text', 'image'] }]);
  assert.notEqual(result[0].inputModalities, groups[0].models[0].inputModalities);
  assert.deepEqual(rankModels(groups, 'nonexistent'), []);
});

test('full catalog has no truncation, deduplicates exact pairs, keeps distinct real provider routes', () => {
  const models = Array.from({ length: 1200 }, (_, i) => ({ id: `m${i}`, name: `Model ${i}` }));
  const groups = [
    { id: 'account-a', name: 'Same display name', models: [...models, models[0]] },
    { id: 'account-b', name: 'Same display name', models: [{ id: 'm0' }] },
    { id: 'account-a', models: [{ id: 'm1' }] },
  ];
  const original = JSON.stringify(groups);
  const rows = rankModels(groups, ' ', [{ provider: 'account-a', model: 'm0' }]);
  assert.equal(rows.length, 1200);
  assert.equal(rows.at(-1).provider, 'account-b');
  assert.equal(rows.at(-1).model, 'm0');
  assert.equal(rows.at(-1).name, 'm0');
  assert.equal(rows.some(row => row.provider === 'account-a' && row.model === 'm0'), false);
  assert.equal(JSON.stringify(groups), original);
  assert.deepEqual(rankModels(groups, 'm1199').map(row => row.model), ['m1199']);
});
