// Framework-free state shared by every mounted settings page. The plugin owns
// this writer: page unmounts only unsubscribe; plugin unload calls dispose().
export function createAutoWriter(form) {
  let live = form.getSnapshot();
  let snapshot;
  let projectedLive;
  let projectedVersion = -1;
  let value;
  let version = 0;
  let fence;
  let paused = null;
  let running = false;
  let scheduled = false;
  let disposed = false;
  let disposal;
  let resolveDisposal;
  const dirty = new Map();
  const listeners = new Set();

  function publish() {
    if (projectedLive !== live.value || projectedVersion !== version) {
      value = dirty.size ? { ...live.value } : live.value;
      for (const [field, entry] of dirty) value[field] = entry.value;
      projectedLive = live.value;
      projectedVersion = version;
    }
    const writable = live.status === 'ready' && !!live.writable;
    const status = live.status !== 'ready' ? live.status
      : paused || (dirty.size || running ? 'saving' : 'ready');
    if (snapshot && snapshot.value === value && snapshot.status === status && snapshot.writable === writable) return;
    snapshot = { value, status, writable };
    for (const listener of [...listeners]) listener();
  }

  function finishDisposal() {
    if (disposed && !running && !scheduled && (!dirty.size || paused || live.status !== 'ready' || !live.writable)) {
      resolveDisposal?.();
    }
  }

  function schedule() {
    if (scheduled || running || paused || !dirty.size) {
      finishDisposal();
      return;
    }
    scheduled = true;
    queueMicrotask(flush);
  }

  async function flush() {
    scheduled = false;
    live = form.getSnapshot();
    if (running || paused || !dirty.size || live.status !== 'ready' || !live.writable) {
      publish();
      finishDisposal();
      return;
    }
    // The fence belongs to the first edit, not to the eventual microtask.
    if (!Object.is(live.revision, fence)) {
      paused = 'conflict';
      publish();
      finishDisposal();
      return;
    }
    const batch = new Map(dirty);
    const ops = [...batch].map(([field, entry]) => ({ op: 'set', path: [field], value: entry.value }));
    running = true;
    publish();
    try {
      const ok = await form.mutate(ops, fence);
      live = form.getSnapshot();
      if (ok) {
        for (const [field, entry] of batch) {
          // A newer same-field edit must survive an older request's success.
          if (dirty.get(field) === entry) dirty.delete(field);
        }
        version++;
        fence = dirty.size ? live.revision : undefined;
      } else {
        // mutate(false) has already fetched the current server state.
        paused = 'conflict';
      }
    } catch {
      live = form.getSnapshot();
      paused = 'error';
    } finally {
      running = false;
      publish();
      schedule();
    }
  }

  publish();
  const off = form.subscribe(() => {
    live = form.getSnapshot();
    if (dirty.size && !running && !paused && !Object.is(live.revision, fence)) paused = 'conflict';
    publish();
    schedule();
  });
  // Close the getSnapshot/subscribe gap without performing any writes.
  live = form.getSnapshot();
  publish();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(field, updaterOrValue) {
      if (disposed || !snapshot.writable) return false;
      if (typeof field !== 'string') throw new TypeError('field must be a string');
      const next = typeof updaterOrValue === 'function' ? updaterOrValue(snapshot.value?.[field]) : updaterOrValue;
      if (Object.is(snapshot.value?.[field], next)) return true;
      if (!dirty.size) fence = live.revision;
      dirty.set(field, { value: next });
      version++;
      publish();
      schedule();
      return true;
    },
    retry() {
      if (disposed || paused !== 'error') return false;
      paused = null;
      publish();
      schedule();
      return true;
    },
    reload() {
      // Never pretend to cancel a request that can still commit remotely.
      if (disposed || running) return false;
      dirty.clear();
      version++;
      fence = undefined;
      paused = null;
      live = form.getSnapshot();
      publish();
      return true;
    },
    dispose() {
      if (disposal) return disposal;
      disposal = new Promise(resolve => { resolveDisposal = resolve; });
      disposed = true;
      off();
      listeners.clear();
      // Do not cancel the microtask or the remaining successful write queue.
      schedule();
      finishDisposal();
      return disposal;
    },
  };
}

const pairKey = (provider, model) => JSON.stringify([provider, model]);

// Each whitespace-separated term may match a different metadata field.
function matchQuality(text, term) {
  if (text === term) return 0;
  if (text.startsWith(term)) return 1;
  if (text.includes(term)) return 2;
  let position = 0;
  for (const character of text) if (character === term[position]) position++;
  return position === term.length ? 3 : Infinity;
}

export function rankModels(groups, query = '', selectedPairs = []) {
  const selected = new Set(selectedPairs.map(pair => pairKey(pair.provider, pair.model)));
  const seen = new Set();
  const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const matches = [];
  for (const group of groups) {
    for (const model of group.models) {
      const key = pairKey(group.id, model.id);
      if (seen.has(key)) continue;
      seen.add(key);
      if (selected.has(key)) continue;
      const row = { provider: group.id, providerName: group.name || group.id,
        model: model.id, name: model.name || model.id,
        ...(Array.isArray(model.inputModalities) ? { inputModalities: [...model.inputModalities] } : {}) };
      const fields = [row.provider, row.providerName, row.model, row.name].map(text => text.toLowerCase());
      const qualities = terms.map(term => Math.min(...fields.map(field => matchQuality(field, term))));
      if (qualities.some(quality => !Number.isFinite(quality))) continue;
      matches.push({ row, worst: Math.max(0, ...qualities), total: qualities.reduce((a, b) => a + b, 0) });
    }
  }
  // ES stable sort preserves catalog order for equally relevant models.
  matches.sort((a, b) => a.worst - b.worst || a.total - b.total);
  return matches.map(match => match.row);
}
