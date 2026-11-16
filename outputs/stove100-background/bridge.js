// Injected into the selected page; all browser privileges stay in the extension.
function installBridge(binding, options = {}) {
  const pending = new Map(), targets = new Map();
  let sequence = 0;
  const call = (op, data) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    window[binding](JSON.stringify({ id, op, data }));
  });
  window.__stove100Background = {
    binding, options: { enterStovePoints: options.enterStovePoints === true },
    reply(id, value, error) {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      error ? item.reject(new Error(error)) : item.resolve(value);
    },
    async click(element) {
      const id = ++sequence;
      targets.set(id, element);
      try { return await call('click', id); } finally { targets.delete(id); }
    },
    activate(id) {
      const element = targets.get(id);
      if (!element?.isConnected || element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('클릭 직전 버튼이 바뀌었습니다.');
      if (window.stove100?.stopped) throw new Error('사용자가 중지했습니다.');
      element.click();
    },
    begin: label => call('begin', label),
    close: () => call('close'),
    finish: state => call('finish', JSON.parse(JSON.stringify(state))),
    cancel(reason) {
      if (window.stove100?.running) window.stove100.stop();
      for (const item of pending.values()) item.reject(new Error(reason));
      pending.clear(); targets.clear();
    }
  };
}
