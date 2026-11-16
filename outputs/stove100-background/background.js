'use strict';
importScripts('bridge.js');
importScripts('update.js');
let session = null, starting = false, openingCancelled = false, cancelOpening = null;
const entryURL = 'https://reward.onstove.com/ko';
const allowed = url => /^https:\/\/reward\.onstove\.com\/ko(?:\/|$)/.test(url || '');
const command = (s, method, params = {}) => chrome.debugger.sendCommand({ tabId: s.tabId }, method, params);
async function evaluate(s, expression, userGesture = false, contextId) {
  const result = await command(s, 'Runtime.evaluate', { expression, userGesture, returnByValue: true, contextId });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
const pageLost = '실행 중 스토브 페이지가 다시 열려 연결이 끊겼습니다. 중복 처리를 막기 위해 중지했습니다.';
async function callBridge(s, contextId, method, args, userGesture = false) {
  const called = await evaluate(s, `(() => {
    const bridge = window.__stove100Background;
    if (bridge?.binding !== ${JSON.stringify(s.binding)}) return false;
    bridge.${method}(...${JSON.stringify(args)});
    return true;
  })()`, userGesture, contextId);
  if (!called) throw new Error(pageLost);
}
let saving = Promise.resolve(), exporting = Promise.resolve();
function save(value) {
  const task = saving.then(async () => {
    const { runHistory = [] } = await chrome.storage.local.get('runHistory');
    const previous = runHistory.find(run => run.runId === value.runId);
    const timeline = previous?.timeline || [];
    const current = value.missionResults?.find(record => record.status === 'running');
    const step = { status: value.status || 'running', phase: value.phase,
      mission: current?.label, retries: current?.retries?.length, draws: value.completed, error: value.error };
    if (JSON.stringify(timeline.at(-1)?.step) !== JSON.stringify(step)) timeline.push({ at: value.updatedAt, step });
    const record = { ...value, timeline,
      missionResults: value.missionResults?.map(({ key, ...result }) => result) };
    await chrome.storage.local.set({ lastRun: value,
      runHistory: [record, ...runHistory.filter(run => run.runId !== value.runId)].slice(0, 5) });
  });
  saving = task.catch(() => {});
  return task;
}
async function recoverInterrupted(beforeStart = false) {
  const { lastRun } = await chrome.storage.local.get('lastRun');
  if (lastRun?.running && lastRun.runId && !session && (beforeStart || !starting)) {
    await save({ ...lastRun, running: false, status: 'interrupted',
      updatedAt: new Date().toISOString(), error: '크롬 또는 확장 연결이 종료됐습니다. 마지막 저장 상태입니다.' });
    return true;
  }
}
function writeLogs(show = false) {
  const task = exporting.then(async () => {
    await saving;
    const { runHistory = [], logDownloadId } = await chrome.storage.local.get(['runHistory', 'logDownloadId']);
    const id = await chrome.downloads.download({
      url: 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ runs: runHistory }, null, 2)),
      filename: 'FullAuto100-logs/recent-runs.json', conflictAction: 'overwrite', saveAs: false
    });
    for (let i = 0; i < 40; i++) {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === 'interrupted') throw new Error('로그 파일을 저장하지 못했습니다.');
      if (item?.state === 'complete') {
        await chrome.storage.local.set({ logDownloadId: id });
        if (Number.isInteger(logDownloadId) && logDownloadId !== id) await chrome.downloads.erase({ id: logDownloadId }).catch(() => {});
        if (show) chrome.downloads.show(id);
        return { ok: true };
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('로그 파일 저장 시간이 초과됐습니다.');
  });
  exporting = task.catch(() => {});
  return task;
}
const closed = (s, id) => { if (s.children.delete(id)) s.closed++; };
async function status(s, state) {
  s.status = { ...state, runId: s.runId, startedAt: s.startedAt, updatedAt: new Date().toISOString(), tabId: s.tabId,
    extensionPopupsOpened: s.opened, extensionPopupsClosed: s.closed };
  await save(s.status);
  await chrome.action.setBadgeText({ text: state.running ? '실행' : state.status === 'complete' ? '완료' : '확인' });
}
async function closeOwned(s) {
  // webNavigation supplies ownership even when window.open returns null (noopener).
  s.closeRequested = true;
  if (s.closing) return s.closing;
  s.closing = (async () => {
    while (s.children.size) {
      const id = s.children.values().next().value;
      try { await chrome.tabs.get(id); } catch { closed(s, id); continue; }
      await chrome.tabs.remove(id);
      closed(s, id);
    }
  })();
  try { await s.closing; } finally { s.closing = null; }
}
async function cleanup(s) {
  if (s.cleaning) return;
  s.cleaning = true;
  clearInterval(s.monitor);
  let cleanupError;
  try { await closeOwned(s); } catch (error) { cleanupError = error.message; }
  try { await evaluate(s, 'window.__stove100Background?.cancel("실행 연결 종료"); delete window.__stove100Background'); } catch {}
  try { await command(s, 'Emulation.setFocusEmulationEnabled', { enabled: false }); } catch {}
  try { await chrome.tabs.update(s.tabId, { autoDiscardable: s.autoDiscardable }); } catch {}
  if (s.attached) try { await chrome.debugger.detach({ tabId: s.tabId }); } catch {}
  if (cleanupError) await status(s, { ...s.status, running: false, status: 'error', error: '새 창 정리 실패: ' + cleanupError });
  else if (s.status) await status(s, { ...s.status, running: false });
  if (session === s) session = null;
  await writeLogs().catch(error => console.warn('로그 파일 저장 실패', error.message));
}
async function fail(s, error) {
  if (s.cleaning || s.failing) return;
  s.failing = true;
  let latest = s.status;
  try { latest = await evaluate(s, '(() => { const s = window.stove100; if (s?.running) s.stop(); return s && JSON.parse(JSON.stringify(s)); })()') || latest; } catch {}
  await status(s, { ...latest, running: false, status: 'error', error: error.message || String(error) });
  await cleanup(s);
}
async function waitForPage(tabId) {
  return new Promise((resolve, reject) => {
    const finish = (error, tab) => {
      cancelOpening = null;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      error ? reject(error) : resolve(tab);
    };
    const updated = (id, change, tab) => {
      if (id !== tabId || change.status !== 'complete') return;
      finish(allowed(tab.url) ? null : new Error('플레이크샵에 로그인한 뒤 다시 시작하세요.'), tab);
    };
    const removed = id => { if (id === tabId) finish(new Error('준비 중 플레이크샵 탭이 닫혔습니다.')); };
    const timer = setTimeout(() => finish(new Error('플레이크샵 페이지 로딩 시간이 초과됐습니다. 로그인·네트워크 상태를 확인하세요.')), 30000);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    cancelOpening = () => finish(new Error('사용자 요청으로 준비를 중지했습니다.'));
    if (openingCancelled) { cancelOpening(); return; }
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') updated(tabId, { status: 'complete' }, tab); }, finish);
  });
}
async function start(preferredTabId, options = {}) {
  if (session || starting) throw new Error('이미 실행 또는 준비 중입니다. 완료되거나 중지한 뒤 다시 시작하세요.');
  starting = true;
  openingCancelled = false;
  const attempt = { runId: crypto.randomUUID(), startedAt: new Date().toISOString(),
    version: 'v5.7-github-updates', running: true, status: 'running', phase: 'opening',
    options: { enterStovePoints: options?.enterStovePoints === true } };
  try {
    await recoverInterrupted(true);
    await save({ ...attempt, updatedAt: attempt.startedAt });
    const preferred = preferredTabId == null ? null : await chrome.tabs.get(preferredTabId).catch(() => null);
    const candidates = await chrome.tabs.query({ url: 'https://reward.onstove.com/*' });
    if (openingCancelled) throw new Error('사용자 요청으로 준비를 중지했습니다.');
    let tab = allowed(preferred?.url) ? preferred : candidates.find(t => allowed(t.url) && t.incognito === (preferred?.incognito ?? false));
    if (!tab) tab = await chrome.tabs.create({ url: entryURL, active: false });
    else if (tab.discarded) tab = await chrome.tabs.update(tab.id, { url: entryURL });
    tab = await waitForPage(tab.id);
    return await run(tab.id, attempt.options, attempt);
  } catch (error) {
    const { lastRun } = await chrome.storage.local.get('lastRun');
    if (lastRun?.runId === attempt.runId && lastRun.running) {
      await save({ ...lastRun, running: false, status: openingCancelled ? 'stopped' : 'error',
        error: error.message, updatedAt: new Date().toISOString() });
      await writeLogs().catch(exportError => console.warn('로그 파일 저장 실패', exportError.message));
    }
    throw error;
  } finally { starting = false; cancelOpening = null; }
}
async function run(tabId, options, attempt) {
  if (session) throw new Error('이미 실행 중입니다. 완료되거나 중지한 뒤 다시 시작하세요.');
  const tab = await chrome.tabs.get(tabId);
  if (!allowed(tab.url)) throw new Error('스토브 플레이크샵 한국어 페이지에서 시작하세요.');
  const s = session = { tabId, attached: false, autoDiscardable: tab.autoDiscardable,
    binding: '__fullAuto100_' + crypto.randomUUID().replaceAll('-', ''), runId: attempt.runId, startedAt: attempt.startedAt,
    children: new Set(), opened: 0, closed: 0, label: null, closeRequested: false };
  try {
    await chrome.debugger.attach({ tabId }, '1.3'); s.attached = true;
    await command(s, 'Runtime.enable');
    await command(s, 'Page.enable');
    if (await evaluate(s, '!!window.stove100?.running')) throw new Error('기존 스니펫이 실행 중입니다. 먼저 기존 실행을 중지하세요.');
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    await command(s, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    const ready = await evaluate(s, 'document.visibilityState === "visible" && document.hasFocus()');
    if (!ready) throw new Error('크롬이 백그라운드 실행 준비를 허용하지 않았습니다.');
    await command(s, 'Runtime.addBinding', { name: s.binding });
    await evaluate(s, '(' + installBridge.toString() + ')(' + JSON.stringify(s.binding) + ',' + JSON.stringify(options) + ')');
    await status(s, { running: true, status: 'running', phase: 'preparing', step: 'missions', version: 'v5.7-github-updates' });
    const source = await (await fetch(chrome.runtime.getURL('engine.js'))).text();
    await evaluate(s, source);
    // The extension watchdog is outside the page's throttled timer queue.
    s.monitor = setInterval(async () => {
      if (s.cleaning || s.failing || s.monitorBusy) return;
      s.monitorBusy = true;
      try {
        const tabNow = await chrome.tabs.get(s.tabId);
        if (!allowed(tabNow.url)) throw new Error('실행 페이지가 바뀌어 중지했습니다.');
        const state = await evaluate(s, 'window.stove100 && JSON.parse(JSON.stringify(window.stove100))');
        if (!state) throw new Error(pageLost);
        if (state.running) {
          await command(s, 'Emulation.setFocusEmulationEnabled', { enabled: true });
          if (!s.cleaning && !s.failing) await status(s, state);
        }
      } catch (error) { await fail(s, error); }
      finally { s.monitorBusy = false; }
    }, 1000);
    return { ok: true };
  } catch (error) {
    await fail(s, error);
    throw new Error(error.message + ' F12 개발자도구를 닫은 뒤 확장 기능에서 시작하세요.');
  }
}
chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  const s = session;
  if (!s || s.cleaning || !s.label || details.sourceTabId !== s.tabId || details.sourceFrameId !== 0) return;
  s.children.add(details.tabId); s.opened++;
  if (s.closeRequested) closeOwned(s).catch(error => fail(s, error));
});
chrome.tabs.onRemoved.addListener(tabId => { if (session) closed(session, tabId); });
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const s = session;
  if (!s || s.cleaning || s.failing || source.tabId !== s.tabId || method !== 'Runtime.bindingCalled' || params.name !== s.binding) return;
  let message;
  try {
    message = JSON.parse(params.payload);
    if (!Number.isSafeInteger(message.id)) return;
    if (!allowed((await chrome.tabs.get(s.tabId)).url)) throw new Error('실행 페이지가 변경됐습니다.');
    switch (message.op) {
      case 'click':
        if (!Number.isSafeInteger(message.data)) throw new Error('잘못된 클릭 요청입니다.');
        await callBridge(s, params.executionContextId, 'activate', [message.data], true);
        break;
      case 'begin':
        await closeOwned(s); s.label = String(message.data); s.closeRequested = false; break;
      case 'close': await closeOwned(s); break;
      case 'finish':
        await closeOwned(s);
        await status(s, message.data);
        await callBridge(s, params.executionContextId, 'reply', [message.id, true]);
        await cleanup(s);
        if (s.status.status === 'complete') {
          try {
            await chrome.windows.create({
              url: chrome.runtime.getURL('popup.html?complete'), type: 'popup', width: 465, height: 275, focused: true
            });
          } catch (error) { console.warn('완료 창을 열지 못했습니다.', error.message); }
        }
        return;
      default: throw new Error('지원하지 않는 실행 요청입니다.');
    }
    await callBridge(s, params.executionContextId, 'reply', [message.id, true]);
  } catch (error) {
    if (message?.id) try {
      await callBridge(s, params.executionContextId, 'reply', [message.id, null, error.message]);
    } catch { await fail(s, new Error(pageLost)); }
    else await fail(s, error);
  }
});
chrome.debugger.onDetach.addListener((source, reason) => {
  if (session?.tabId === source.tabId && !session.cleaning) fail(session, new Error('브라우저 실행 연결이 끊겼습니다: ' + reason));
});
chrome.runtime.onStartup.addListener(async () => {
  try {
    if (await recoverInterrupted()) await writeLogs();
  } catch (error) { console.warn('중단 로그 복구 실패', error.message); }
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) return;
  (async () => {
    if (message.type === 'check-update') return checkUpdate(message.force === true);
    if (message.type === 'download-update') {
      if (session || starting) throw new Error('자동 처리가 끝난 뒤 업데이트하세요.');
      return downloadUpdate();
    }
    if (message.type === 'start') return start(message.tabId, message.options);
    if (!session && !starting) await recoverInterrupted();
    if (message.type === 'logs') return writeLogs(true);
    if (message.type === 'stop' && starting && !session) {
      openingCancelled = true; cancelOpening?.(); return { ok: true };
    }
    if (message.type === 'stop' && session) {
      await evaluate(session, 'window.stove100?.stop()');
      return { ok: true };
    }
    return { ok: true, state: starting && !session ? { running: true, phase: 'opening', step: 'missions' } : (await chrome.storage.local.get('lastRun')).lastRun || null };
  })().then(reply, error => reply({ error: error.message }));
  return true;
});
