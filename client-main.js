// ui-state.js is inlined by scripts/build-client.mjs; no extra browser imports.
window.__ModuleLoader__.load({
  id: '@lichen/dsh-vision-router',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'lichen-vision-router';
    const en = {
      title: 'Vision router', whitelist: 'Non-multimodal models', fallback: 'Vision fallbacks',
      whiteHelp: 'Only these models receive the vision tool; they also accept pasted images, recognized through it.', fallbackHelp: 'Try in order on error or timeout.',
      add: 'Add', search: 'Search models…', empty: 'No models added', noMatches: 'No matching models',
      close: 'Close', remove: 'Remove', up: 'Move up', down: 'Move down',
      timeout: 'Timeout (seconds)', tokens: 'Output token limit',
      ready: 'Changes apply automatically', saving: 'Applying…', loading: 'Loading…',
      error: 'Not applied. Changes retained.', conflict: 'Settings changed elsewhere. Reload to continue.',
      retry: 'Retry', reload: 'Discard and reload', unavailable: 'Settings unavailable', readonly: 'Read-only',
      catalogError: 'Could not load models', partial: 'Some providers unavailable',
      limit: 'Selection limit reached', missing: 'Currently unavailable',
      warning: 'Add a vision model to enable recognition.', range: 'Range',
    };
    const zh = {
      title: '视觉路由', whitelist: '非多模态模型', fallback: '视觉兜底模型',
      whiteHelp: '仅为这些模型提供识图工具；它们也可以直接接收粘贴的图片，经识图工具识别。', fallbackHelp: '按顺序调用，失败或超时自动切换。',
      add: '添加', search: '搜索模型…', empty: '尚未添加模型', noMatches: '没有匹配的模型',
      close: '关闭', remove: '移除', up: '上移', down: '下移',
      timeout: '超时（秒）', tokens: '输出 token 上限',
      ready: '更改实时生效', saving: '正在生效…', loading: '加载中…',
      error: '未生效，修改已保留。', conflict: '设置已被其他页面修改，请重新载入。',
      retry: '重试', reload: '放弃修改并重新载入', unavailable: '设置不可用', readonly: '只读',
      catalogError: '模型加载失败', partial: '部分提供商暂不可用',
      limit: '已达到添加上限', missing: '暂不可用',
      warning: '请添加视觉模型以启用识别。', range: '范围',
    };
    const keyOf = (provider, model) => JSON.stringify([provider, model]);
    const css = `
.vr-page{display:flex;flex-direction:column;gap:24px;width:100%;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5;box-sizing:border-box}
.vr-page *{box-sizing:border-box}.vr-page h2,.vr-page h3,.vr-page p{margin:0}.vr-page h2{font-size:20px;font-weight:600}.vr-page h3{font-size:14px;font-weight:600}
.vr-line{display:flex;align-items:center;gap:8px}.vr-spread{justify-content:space-between}.vr-heading{flex-wrap:wrap}.vr-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.vr-count{font-weight:400;color:var(--dsw-alias-label-secondary);margin-left:8px}
.vr-section{display:flex;flex-direction:column;gap:10px}.vr-page button{font:inherit;font-size:13px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:6px 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);cursor:pointer}
.vr-page button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.vr-page button:disabled,.vr-page input:disabled{opacity:.45;cursor:not-allowed}.vr-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.vr-page input{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:7px 10px;min-width:0}
.vr-list{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;max-height:280px;overflow:auto;overscroll-behavior:contain}.vr-row{display:flex;gap:10px;align-items:center;padding:9px 12px}.vr-row+.vr-row{border-top:1px solid var(--dsw-alias-border-l1)}
.vr-info{flex:1;min-width:0}.vr-name,.vr-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vr-detail{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}.vr-order{color:var(--dsw-alias-label-secondary);font-size:12px;min-width:14px}
.vr-page .vr-icon{width:27px;height:27px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);flex-shrink:0}.vr-tools{display:flex;gap:2px}.vr-empty{color:var(--dsw-alias-label-secondary);font-size:13px;padding:12px}
.vr-picker{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);padding:8px;display:flex;flex-direction:column;gap:6px}.vr-picker input{width:100%}.vr-search{flex:1;min-width:0}.vr-results{max-height:280px;overflow:auto;overscroll-behavior:contain}
.vr-page .vr-option{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;padding:8px;border-radius:6px}.vr-option .vr-plus{color:var(--dsw-alias-label-secondary)}.vr-picker-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 4px}
.vr-options{display:flex;flex-wrap:wrap;gap:16px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:16px}.vr-options label{display:flex;flex-direction:column;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}.vr-options input{width:150px;font-size:14px;color:var(--dsw-alias-label-primary)}
.vr-error{color:var(--dsw-alias-state-error-primary);font-size:12px}.vr-warn{color:var(--dsw-alias-state-warn-primary);font-size:12px}.vr-feedback{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
`;
    return {
      inject: ['slots', 'locale', 'configForms', 'connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }));
        const t = ctx.locale.bind(NS);
        const writer = createAutoWriter(ctx.configForms.get('vision-router'));
        ctx.effect(() => () => writer.dispose());

        // One shared catalog cache; refresh never touches settings or the writer.
        let catalog = { status: 'idle', groups: [], failures: [] };
        let request = null;
        let controller;
        let disposed = false;
        let stale = false;
        const catalogListeners = new Set();
        const catalogSnapshot = () => catalog;
        const catalogSubscribe = listener => { catalogListeners.add(listener); return () => catalogListeners.delete(listener); };
        const publishCatalog = next => { catalog = next; for (const listener of catalogListeners) listener(); };
        function loadCatalog(force = false) {
          if (request) return request;
          if (disposed || (!force && !stale && catalog.status === 'ready')) return Promise.resolve();
          stale = false;
          controller = new AbortController();
          const signal = controller.signal;
          const timer = setTimeout(() => controller.abort(), 20000);
          // Claim the in-flight slot before publishing: a listener that renders
          // synchronously must not restart this load.
          request = Promise.resolve().then(() => ctx.connection.rpc.call('/api', 'vision-router/catalog', {}, signal)).then(result => {
            if (signal.aborted) throw new Error('Catalog cancelled');
            if (!result.ok || !Array.isArray(result.value?.groups) || !Array.isArray(result.value?.failures)) throw new Error('Catalog unavailable');
            if (!disposed) publishCatalog({ status: 'ready', ...result.value });
          }).catch(() => { if (!disposed) publishCatalog({ ...catalog, status: 'error' }); }).finally(() => {
            clearTimeout(timer); request = null;
          });
          // Old groups stay visible while a refresh is in flight.
          publishCatalog({ ...catalog, status: 'loading' });
          return request;
        }
        ctx.on('connection/reset', () => { stale = true; if (catalogListeners.size) void loadCatalog(true); });
        ctx.effect(() => () => { disposed = true; controller?.abort(); catalogListeners.clear(); });

        const button = (text, onClick, disabled, props = {}) => h('button', { type: 'button', onClick, disabled, ...props }, text);
        function IconButton({ label, children, onClick, disabled, buttonRef }) {
          return button(children, onClick, disabled, { className: 'vr-icon', 'aria-label': label, title: label, ref: buttonRef });
        }
        function AddPicker({ field, title, entries, limit, onClose, locked }) {
          const data = React.useSyncExternalStore(catalogSubscribe, catalogSnapshot);
          const [query, setQuery] = React.useState('');
          const input = React.useRef(null);
          // Every open refreshes: accounts added since the last visit must be
          // discoverable, and stale data still shows while loading.
          React.useEffect(() => { input.current?.focus(); void loadCatalog(true); }, []);
          const candidates = rankModels(data.groups, query, entries);
          function add(model) {
            if (locked) return;
            writer.update(field, current => {
              if (current.length >= limit || current.some(row => keyOf(row.provider, row.model) === keyOf(model.provider, model.model))) return current;
              return [...current, { provider: model.provider, model: model.model }];
            });
            // Stay open for batch adding; the picked row leaves the candidates.
            input.current?.focus();
          }
          return h('div', { className: 'vr-picker', role: 'region', 'aria-label': `${t('add')} ${t(title)}`,
            onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } } },
            h('div', { className: 'vr-line' },
              h('input', { ref: input, className: 'vr-search', type: 'search', value: query, placeholder: t('search'), 'aria-label': `${t('search')} ${t(title)}`,
                onChange: event => setQuery(event.target.value), onKeyDown: event => {
                  if (event.key === 'Enter' && !event.nativeEvent?.isComposing) {
                    // Enter adds the best match only after the user typed something;
                    // an empty box must never silently add the first catalog row.
                    if (!query.trim()) { event.preventDefault(); return; }
                    event.preventDefault();
                    if (candidates[0]) add(candidates[0]);
                  }
                  if (event.key === 'Escape' && query) {
                    // First Escape clears the term; the second closes the picker.
                    event.preventDefault(); event.stopPropagation(); setQuery('');
                  }
                } }),
              h(IconButton, { label: t('close'), onClick: onClose }, '×'),
            ),
            h('div', { className: 'vr-results', 'aria-busy': data.status === 'loading' },
              candidates.length ? candidates.map(model => h('button', { type: 'button', key: keyOf(model.provider, model.model), className: 'vr-option', disabled: locked,
                onClick: () => add(model), 'aria-label': `${t('add')} ${model.name} · ${model.provider}` },
                h('span', { className: 'vr-info' }, h('span', { className: 'vr-name', style: { display: 'block' } }, model.name),
                  h('span', { className: 'vr-detail', style: { display: 'block' }, title: `${model.provider} / ${model.model}` }, `${model.provider} / ${model.model}`)),
                h('span', { className: 'vr-plus', 'aria-hidden': true }, '+'),
              )) : h('p', { className: 'vr-empty' }, t(data.status === 'loading' ? 'loading' : data.status === 'error' ? 'catalogError' : 'noMatches')),
            ),
            (data.status === 'error' || data.failures.length > 0) && h('div', { className: 'vr-picker-footer' },
              h('span', { className: 'vr-warn', role: 'status' }, t(data.status === 'error' ? 'catalogError' : 'partial')),
              button(t('retry'), () => { void loadCatalog(true); }, data.status === 'loading'),
            ),
          );
        }
        function ModelList({ field, title, help, ordered, entries, locked, open, onToggle }) {
          const trigger = React.useRef(null);
          const data = React.useSyncExternalStore(catalogSubscribe, catalogSnapshot);
          const metadata = new Map(data.groups.flatMap(group => group.models.map(model => [keyOf(group.id, model.id), model])));
          const failed = new Set(data.failures.map(row => row.id));
          const max = ordered ? 20 : 100;
          const close = () => { onToggle(null); trigger.current?.focus(); };
          const remove = pair => {
            writer.update(field, current => current.filter(row => keyOf(row.provider, row.model) !== keyOf(pair.provider, pair.model)));
            trigger.current?.focus();
          };
          const move = (pair, delta) => writer.update(field, current => {
            const index = current.findIndex(row => keyOf(row.provider, row.model) === keyOf(pair.provider, pair.model));
            if (index < 0 || index + delta < 0 || index + delta >= current.length) return current;
            const next = [...current]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next;
          });
          return h('section', { className: 'vr-section' },
            h('div', { className: 'vr-line vr-spread' },
              h('h3', null, t(title), entries.length > 0 && h('span', { className: 'vr-count' }, `${entries.length} / ${max}`)),
              button(`+ ${t('add')}`, () => onToggle(open ? null : field), locked || entries.length >= max,
                { ref: trigger, 'aria-expanded': open, 'aria-label': `${t('add')} ${t(title)}`, title: entries.length >= max ? `${t('limit')} (${max})` : undefined }),
            ),
            h('p', { className: 'vr-muted' }, t(help)),
            open && h(AddPicker, { field, title, entries, limit: max, onClose: close, locked }),
            entries.length ? h('div', { className: 'vr-list' }, entries.map((pair, index) => {
              const key = keyOf(pair.provider, pair.model);
              const model = metadata.get(key);
              const missing = data.status === 'ready' && !failed.has(pair.provider) && !model;
              return h('div', { className: 'vr-row', key },
                ordered && h('span', { className: 'vr-order', 'aria-hidden': true }, index + 1),
                h('div', { className: 'vr-info' }, h('div', { className: 'vr-name', title: model?.name || pair.model }, model?.name || pair.model),
                  h('div', { className: 'vr-detail', title: `${pair.provider} / ${pair.model}` },
                    `${pair.provider} / ${pair.model}${missing ? ` · ${t('missing')}` : ''}`)),
                missing && h('span', { className: 'vr-warn', 'aria-hidden': true, title: t('missing') }, '!'),
                h('div', { className: 'vr-tools' },
                  ordered && h(IconButton, { label: `${t('up')} ${pair.model}`, onClick: () => move(pair, -1), disabled: locked || index === 0 }, '↑'),
                  ordered && h(IconButton, { label: `${t('down')} ${pair.model}`, onClick: () => move(pair, 1), disabled: locked || index === entries.length - 1 }, '↓'),
                  h(IconButton, { label: `${t('remove')} ${pair.model}`, onClick: () => remove(pair), disabled: locked }, '×'),
                ),
              );
            })) : !open && h('p', { className: 'vr-empty' }, t('empty')),
          );
        }
        function NumberSetting({ field, label, value, min, max, scale = 1, locked }) {
          const [text, setText] = React.useState(String(value / scale));
          const [focused, setFocused] = React.useState(false);
          React.useEffect(() => { if (!focused) setText(String(value / scale)); }, [value, focused, scale]);
          const valid = text.trim() !== '' && Number.isInteger(Number(text)) && Number(text) >= min && Number(text) <= max;
          // Commit on blur or Enter: one write per finished edit, never per keystroke.
          const commit = () => {
            const number = Number(text);
            if (text.trim() && Number.isInteger(number) && number >= min && number <= max) writer.update(field, number * scale);
            else setText(String(value / scale));
          };
          return h('label', null, t(label), h('input', { type: 'number', min, max, step: 1, value: text, disabled: locked, 'aria-invalid': !valid,
            onFocus: () => setFocused(true),
            onBlur: () => { setFocused(false); commit(); },
            onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); commit(); } },
            onChange: event => setText(event.target.value) }), !valid && h('span', { className: 'vr-error' }, `${t('range')} ${min}–${max}`));
        }
        function Page() {
          React.useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot());
          const state = React.useSyncExternalStore(writer.subscribe, writer.getSnapshot);
          const [picker, setPicker] = React.useState(null);
          React.useEffect(() => { void loadCatalog(); }, []);
          const locked = !state.writable || state.status === 'conflict' || state.status === 'error';
          const value = state.value;
          const status = !state.writable && value ? 'readonly' : state.status === 'ready' ? 'ready' : state.status;
          return h('div', { className: 'vr-page' }, h('style', null, css),
            h('header', { className: 'vr-line vr-spread vr-heading' }, h('h2', null, t('title')),
              !['error', 'conflict'].includes(state.status) && h('span', { className: 'vr-muted', role: 'status' }, t(status))),
            ['error', 'conflict'].includes(state.status) && h('div', { className: 'vr-feedback', role: 'alert' },
              h('span', { className: 'vr-error' }, t(state.status)),
              state.status === 'error' && button(t('retry'), () => { void writer.retry(); }, false),
              button(t('reload'), () => writer.reload(), false),
            ),
            !value ? h('p', { className: 'vr-muted' }, t(state.status === 'loading' ? 'loading' : 'unavailable')) : h(React.Fragment, null,
              h(ModelList, { field: 'nonMultimodalModels', title: 'whitelist', help: 'whiteHelp', ordered: false, entries: value.nonMultimodalModels, locked,
                open: picker === 'nonMultimodalModels', onToggle: setPicker }),
              h(ModelList, { field: 'visionModels', title: 'fallback', help: 'fallbackHelp', ordered: true, entries: value.visionModels, locked,
                open: picker === 'visionModels', onToggle: setPicker }),
              value.nonMultimodalModels.length > 0 && value.visionModels.length === 0 && h('p', { className: 'vr-warn' }, t('warning')),
              h('div', { className: 'vr-options' },
                h(NumberSetting, { field: 'timeoutMs', label: 'timeout', value: value.timeoutMs, min: 1, max: 300, scale: 1000, locked }),
                h(NumberSetting, { field: 'maxTokens', label: 'tokens', value: value.maxTokens, min: 128, max: 32768, locked }),
              ),
            ),
          );
        }
        function EyeIcon({ size = 18 }) {
          return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
            strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
            h('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z' }), h('circle', { cx: 12, cy: 12, r: 3 }));
        }
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: 'vision-router' }, EyeIcon));
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'vision-router', order: 13, label: () => t('title') }, Page));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@lichen/dsh-vision-router' }, Page));
      },
    };
  },
});
