// Read the adapter registry directly. Native sessionController.modelCatalog()
// may be filtered by dsh-scoped-models; the raw LLM directory is not.
export async function readCatalog(llm, signal, timeoutMs = 15000) {
  signal?.throwIfAborted();
  const providers = llm.listProviders();
  const rows = await Promise.all(providers.map(async provider => {
    let timer;
    let abort;
    try {
      const interrupted = new Promise((_, reject) => {
        abort = () => reject(signal.reason ?? new Error('Cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(new Error('Catalog timeout')), timeoutMs);
      });
      const models = await Promise.race([Promise.resolve().then(() => llm.listModels(provider.id)), interrupted]);
      signal?.throwIfAborted();
      const seen = new Set();
      return {
        id: provider.id, name: provider.name,
        models: models.filter(model => {
          if (!model.id || seen.has(model.id)) return false;
          seen.add(model.id); return true;
        }).map(model => ({ id: model.id, name: model.name || model.id,
          ...(Array.isArray(model.inputModalities) ? { inputModalities: [...model.inputModalities] } : {}) })),
      };
    } catch {
      signal?.throwIfAborted();
      // Provider errors can contain credentials; never forward their message.
      return { id: provider.id, name: provider.name, failed: true };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }));
  signal?.throwIfAborted();
  return {
    groups: rows.filter(row => !row.failed),
    failures: rows.filter(row => row.failed).map(({ id, name }) => ({ id, name })),
  };
}

export function installCatalogEndpoint(ctx) {
  // The shared /api RPC interceptor belongs to DSH Gateway (singleton).
  // An exact authenticated owner-only Fetch route can coexist with it.
  const method = 'vision-router/catalog';
  ctx.effect(() => ctx.connection.fetch.register({
    path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return new Response('Expected application/json', { status: 415 });
      }
      let envelope;
      try { envelope = await request.json(); }
      catch { return new Response('Invalid JSON', { status: 400 }); }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
          envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string' || envelope.method !== method) {
        return new Response('Invalid RPC envelope', { status: 400 });
      }
      const payload = envelope.payload;
      let result;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) {
        result = { ok: false, error: { code: 'vision-router/invalid-input', message: 'Expected an empty object', details: {} } };
      } else {
        try { result = { ok: true, value: await readCatalog(ctx.llm, request.signal) }; }
        catch {
          result = { ok: false, error: { code: 'vision-router/catalog-unavailable', message: 'Model catalog unavailable', details: {} } };
        }
      }
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result }, { headers: { 'cache-control': 'no-store' } });
    },
  }));
}
