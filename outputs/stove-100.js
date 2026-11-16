// 무인 실행: FullAuto100 확장 기능에서 '자동 처리 시작'.
// v5.5: 캡슐 결과 정리, 누적 보상 수령, 완료 창.
// 중지: window.stove100.stop() · 실행 버전: window.stove100.version
void (async () => {
  'use strict';
  if (location.origin !== 'https://reward.onstove.com' || !/^\/ko(?:\/|$)/.test(location.pathname)) {
    console.error('STOVE 플레이크샵 한국어 페이지에서 실행하세요.');
    return;
  }
  if (window.stove100?.running) {
    console.warn('이미 실행 중입니다. 중지: window.stove100.stop()');
    return;
  }

  const state = window.stove100 = {
    running: true, stopped: false, completed: 0, clicks: 0, rewards: [],
    version: 'v5.7-github-updates', phase: 'preparing', step: 'missions', missionResults: [], responses: [], refreshChecks: [], failures: [],
    popupOpened: 0, popupClosed: 0, untrackedPopups: 0, focusWaitMs: 0,
    stop() { this.stopped = true; activeAction?.wake?.(); }
  };
  const background = window.__stove100Background;
  state.options = { enterStovePoints: background?.options?.enterStovePoints === true };
  state.prizeEntry = { attempted: false, confirmed: false };
  state.executionMode = background ? 'extension' : 'snippet';
  const click = async element => background ? background.click(element) : element.click();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const addFailure = (label, stage, reason, response) => {
    if (state.failures.some(failure => failure.미션 === label && failure.사유 === reason)) return;
    state.failures.push({ 미션: label, 단계: stage, 사유: reason,
      HTTP: response?.status || '', 서버코드: response?.code ?? '' });
  };
  const normalize = value => (value || '').normalize('NFKC').replace(/[\s\u200b-\u200d\u2060\ufeff]+/g, '');
  const text = el => normalize(el?.innerText || el?.textContent);
  const visible = el => el && el.isConnected && el.getClientRects().length > 0;
  const enabled = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const initialLabel = /^100(?:플레이크)?뽑기!?$/;
  const repeatLabel = /^100(?:플레이크)?뽑기(?:한번더|다시뽑기)!?$/;
  const readCount = () => {
    const labels = [...document.querySelectorAll('.stds-box > span')]
      .filter(el => visible(el) && text(el) === '오늘뽑기');
    if (labels.length > 1) throw new Error('오늘 뽑기 횟수 영역이 여러 개라 클릭하지 않습니다.');
    if (!labels.length) return null;
    // 사이트가 조회 로딩/오류 표시를 숫자로 바꾼 뒤에만 횟수를 확정합니다.
    const match = text(labels[0].parentElement).match(/^오늘뽑기(\d+)\/(\d+)회$/);
    if (!match) return null;
    const done = Number(match[1]), limit = Number(match[2]);
    if (limit !== 30 || done < 0 || done > limit) throw new Error('일일 횟수 표시가 예상과 다릅니다.');
    return done;
  };
  const count = () => {
    const value = readCount();
    if (value === null) throw new Error('오늘 뽑기 횟수를 읽지 못했습니다. 클릭하지 않습니다.');
    return value;
  };
  const balance = () => {
    const el = [...document.querySelectorAll('span.whitespace-nowrap.block.overflow-ellipsis')]
      .find(el => visible(el) && /^[\d,]+$/.test(text(el)));
    return el ? Number(text(el).replace(/,/g, '')) : null;
  };
  const check = () => {
    if (state.stopped) throw new Error('사용자 요청으로 중지했습니다.');
    const allowed = state.phase === 'draws' ? location.pathname === '/ko/event' :
      state.phase === 'missions' ? /^\/ko\/?$/.test(location.pathname) : /^\/ko(?:\/|$)/.test(location.pathname);
    if (location.origin !== 'https://reward.onstove.com' || !allowed) {
      throw new Error('페이지가 변경되어 중지했습니다.');
    }
  };
  const waitFor = async (read, description, timeout = 15000) => {
    let deadline = Date.now() + timeout;
    let pausedFocusMs = state.focusWaitMs;
    while (true) {
      check();
      if (activeAction) {
        await waitForeground(activeAction, deadline);
        deadline += state.focusWaitMs - pausedFocusMs; pausedFocusMs = state.focusWaitMs;
      }
      if (Date.now() >= deadline) break;
      const value = read();
      if (value) return value;
      await (activeAction ? waitAction(activeAction, 150) : sleep(150));
    }
    throw new Error(`${description} 대기 시간 초과. 중복 차감을 막기 위해 재클릭하지 않습니다.`);
  };
  const findButton = () => {
    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const repeats = buttons.filter(b => repeatLabel.test(text(b)));
    const candidates = repeats.length ? repeats : buttons.filter(b => initialLabel.test(text(b)));
    if (candidates.length > 1) throw new Error('100 뽑기 버튼이 여러 개라 중지했습니다.');
    return enabled(candidates[0]) ? candidates[0] : null;
  };
  const unobstructed = button => {
    const r = button.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top && (top === button || button.contains(top));
  };


  const GO = /^미션하기$/;
  const CLAIM = /^(받기|보상받기|플레이크받기|[\d,]+플레이크받기)$/;
  const COMPLETE = /^(?:[\d,]*플레이크)?(?:받기완료|수령완료|참여완료|미션완료|지급완료|이미수령|이미받음)$/;
  const originals = { open: window.open, confirm: window.confirm, alert: window.alert, fetch: window.fetch };
  let activeAction = null, activeRefresh = null, hooksInstalled = false, responseObserver = null;
  const participateURL = value => /\/flake-shop\/v\d+\/mission\/participate(?:[?#]|$)/.test(String(value || ''));
  const refreshURL = value => {
    try {
      const url = new URL(value, location.href);
      return url.origin === 'https://api.onstove.com' && /^\/flake-shop\/v\d+\/(?:page|mission\/component)$/.test(url.pathname);
    } catch { return false; }
  };
  const finishRefresh = (refresh, url, status, source, failed = false) => {
    const parsed = new URL(url, location.href);
    refresh.responses.push({ path: parsed.pathname, component: parsed.searchParams.get('component_no'), status, source, failed });
    activeAction?.wake?.();
  };
  const networkStage = stage => {
    activeAction.stage = stage;
    activeAction.stageStarted = typeof performance === 'undefined' ? 0 : performance.now();
  };
  const finishResponse = (action, stage, status, data, failed = false) => {
    const values = [data?.code, data?.result?.code, data?.error?.code, data?.result_code];
    const code = values.map(Number).find(code => [6015,6017,6018,6020,6023].includes(code));
    const response = { label: action.record.label, stage, status, code: code || null, failed, completed: true };
    action.responses.push(response); state.responses.push(response);
    if (code === 6015) action.record.receipt = true;
    if (activeAction === action) {
      // 백그라운드 탭의 다음 타이머 실행을 기다리면 창 닫기·복귀까지 지연될 수 있습니다.
      closeActionWindows(action).catch(error => { action.windowError = error; action.wake?.(); });
      action.wake?.();
    }
  };
  const confirmed = new WeakSet();
  const done = card => !!card && ([card, ...card.querySelectorAll('button,span')].some(el => COMPLETE.test(text(el))) ||
    !!card.querySelector('.flakeshop-mission-badge-receive_complete'));
  const cardOf = el => {
    let card = el.closest('.stds-box');
    while (card && !card.querySelector('p,h2,h3,h4')) card = card.parentElement?.closest('.stds-box');
    return card || el.parentElement;
  };
  const titleOf = card => text(card?.querySelector('p.text-xl,h2,h3,h4') || card?.querySelector('p'));
  const keyOf = card => titleOf(card) + '|' + (card.querySelector('img')?.getAttribute('src') || '');
  const isPrize = card => /^경품응모(?:하기)?$/.test(titleOf(card));
  const excluded = card => !enabled(pickClaim(card)) && !rewardCards('post').includes(card) && !rewardCards('survey').includes(card) && ((isPrize(card) && !state.options.enterStovePoints) ||
    /미니게임.*(?:플레이|참여)|앱.*로그인|(?:게임설치|상품구매|플레이타임)/.test(
      card?.closest('[id^="mission-banner-swiper-"]') ? text(card) : titleOf(card)));
  const skip = card => {
    const label = titleOf(card);
    if (!state.skippedMissions.includes(label)) { state.skippedMissions.push(label); console.log('[별도 조건으로 제외] ' + label); }
  };
  const rewardCards = kind => {
    const prefix = { post: 'content-mission', survey: 'survey-mission', banner: 'mission-banner' }[kind];
    const scopes = [...document.querySelectorAll(`[id^="${prefix}-swiper-"]`)];
    // 게시글이 하나이면 사이트가 swiper 없이 카드만 렌더링합니다.
    const heading = { post: /^인기게시글보고플레이크받기/, survey: /^설문조사참여하고플레이크받기/ }[kind];
    if (heading) for (const widget of document.querySelectorAll('[id^="mission-widget-"]')) {
      if ([...widget.querySelectorAll('h1,h2,h3,h4,p,span')].some(el => !el.childElementCount && heading.test(text(el)))) scopes.push(widget);
    }
    const cards = [...new Set(scopes.flatMap(scope => [...scope.querySelectorAll('.stds-box')]))]
      .filter(card => kind === 'survey' ? card.querySelector('.survey-item,input[type="radio"],input[type="checkbox"]') || buttons(card).some(b => /설문|플레이크받기/.test(text(b))) : card.querySelector('a[href]'));
    if (kind === 'banner') for (const card of document.querySelectorAll('[id^="mission-widget-"] .stds-box')) {
      if (card.querySelector('a[href]') && !rewardCards('post').includes(card) && !rewardCards('survey').includes(card) &&
        [...card.querySelectorAll('span')].some(el => /^클릭시[\d,]+플레이크$/.test(text(el))) && !cards.includes(card)) cards.push(card);
    }
    return cards;
  };
  const buttons = card => [...(card?.querySelectorAll('button,a,[role="button"]') || [])];
  const pickGo = card => buttons(card).find(el => GO.test(text(el)));
  const pickClaim = card => buttons(card).find(el => CLAIM.test(text(el)));
  const missionCards = () => [...new Set([
    ...[...document.querySelectorAll('button')].filter(el => GO.test(text(el)) || CLAIM.test(text(el)) || COMPLETE.test(text(el))),
    ...[...document.querySelectorAll('.stds-box span,.flakeshop-mission-badge-receive_complete')]
      .filter(el => el.classList.contains('flakeshop-mission-badge-receive_complete') || (!el.childElementCount && COMPLETE.test(text(el))))
  ].map(cardOf))];
  const dailyMissionCards = () => {
    const leaves = [...document.querySelectorAll('h1,h2,h3,h4,p,span')].filter(el => !el.childElementCount && visible(el));
    const title = leaves.find(el => /^데일리미션(?:참여|$)/.test(text(el)));
    if (!title) return [];
    const total = document.body.innerText.match(/\/\s*(\d+)\s*데일리\s*미션\s*달성/);
    const cards = missionCards();
    for (let section = title.parentElement; section && section !== document.body; section = section.parentElement) {
      if (leaves.some(el => section.contains(el) && /^(위클리미션|인기게시글|설문조사)/.test(text(el)))) return [];
      const daily = cards.filter(card => section.contains(card));
      if (daily.length) return !total || daily.length >= Number(total[1]) ? daily : [];
    }
    return [];
  };
  const goTab = async (label, path, phase, ready) => {
    state.phase = 'navigating';
    console.log('[화면 준비] ' + label);
    if (!path.test(location.pathname)) {
      const tab = await waitFor(() => {
        const matches = [...document.querySelectorAll('button,a,[role="tab"]')].filter(el => enabled(el) && text(el) === label);
        if (matches.length > 1) throw new Error(label + ' 탭이 여러 개라 중지했습니다.');
        return matches[0];
      }, label + ' 탭');
      await click(tab);
    }
    const result = await waitFor(() => path.test(location.pathname) && ready(), label + ' 화면 데이터');
    state.phase = phase;
    console.log('[화면 준비 완료] ' + label);
    return result;
  };
  const alreadyReceived = message => /이미.{0,24}(?:받은|받았|받으셨|수령했|수령한|수령하였|수령하셨|수령완료|지급된|완료한|완료된)/.test(normalize(message));
  const receiptText = message => /플레이크.*(?:지급되었습니다|획득완료|받았습니다|수령했습니다)/.test(normalize(message));
  const autoConfirm = () => {
    if (!activeAction || activeAction.raffle) return;
    const dialogs = [...document.querySelectorAll(
      '[role="dialog"],[role="alertdialog"],dialog[open],.stds-modal,.stds-dialog,[id*="stds-dialog"],[class*="stds-dialog"],[class*="popup-common-"]'
    )].filter(visible);
    for (const dialog of dialogs) {
      const candidates = [...dialog.querySelectorAll('button')].filter(el => enabled(el) && /^(확인|예|네|확인했습니다)$/.test(text(el)));
      if (candidates.length !== 1 || confirmed.has(candidates[0])) continue;
      if (dialog.querySelector('.flakeshop-alert-receive_complete') || receiptText(dialog.innerText) ||
        (activeAction.stage === 'claim' && alreadyReceived(dialog.innerText))) activeAction.record.receipt = true;
      check(); confirmed.add(candidates[0]); candidates[0].click();
    }
  };
  const closeOne = popup => {
    try {
      const wasClosed = popup.handle.closed;
      if (!wasClosed) popup.handle.close();
      if (popup.handle.closed && !popup.counted) {
        popup.counted = true;
        if (!wasClosed) state.popupClosed++;
      }
      return popup.handle.closed;
    } catch (error) {
      addFailure(activeAction?.record.label || '새 창', '새 창 닫기', error.message);
      console.warn('[새 창 닫기 실패]', error.message); return false;
    }
  };
  const requestFocus = () => {
    if (background) return;
    try { window.focus?.(); } catch (error) { state.focusRequestError = error.message; }
  };
  const returnFocus = () => {
    requestFocus();
    if (document.visibilityState === 'hidden') return;
    // 사이트는 창 복귀 시 focus/visibilitychange로 서버에서 받은 미션 상태를 반영합니다.
    window.dispatchEvent?.(new Event('focus'));
    if (document.visibilityState === 'visible') document.dispatchEvent(new Event('visibilitychange'));
  };
  const wakeAction = () => activeAction?.wake?.();
  const waitAction = (action, delay = 50) => new Promise(resolve => {
    let timer;
    const wake = () => {
      clearTimeout(timer);
      if (action.wake === wake) action.wake = null;
      resolve();
    };
    action.wake = wake; timer = setTimeout(wake, delay);
  });
  const waitForeground = async (action, deadline) => {
    if (background) {
      if (document.visibilityState === 'hidden') throw new Error('백그라운드 실행 연결이 해제됐습니다. 중복 클릭 없이 중지합니다.');
      return;
    }
    if (document.visibilityState !== 'hidden') return;
    const pausedAt = Date.now();
    state.waitingForFocus = action.record.label;
    console.warn('[원래 탭 복귀 대기] ' + action.record.label + ': 원래 스토브 탭이 보이면 이어갑니다.');
    try {
      while (document.visibilityState === 'hidden') {
        check();
        if (action.windowError) throw action.windowError;
        const responses = activeRefresh?.responses || action.responses.filter(response => response.stage === action.stage);
        if (responses.some(response => response.failed || response.status >= 400)) throw new Error(action.record.label + ' 서버/네트워크 오류.');
        if (deadline && Date.now() >= deadline && !responses.length && !action.record.receipt && !done(action.getCard()) && !enabled(pickClaim(action.getCard()))) {
          throw new Error(action.record.label + ' 응답 대기 시간 초과. 원래 탭이 숨겨져 있고 서버 응답도 확인되지 않았습니다.');
        }
        requestFocus();
        if (document.visibilityState === 'hidden') await waitAction(action);
      }
      check(); returnFocus();
      console.log('[원래 탭 복귀] ' + action.record.label);
    } finally { state.focusWaitMs += Date.now() - pausedAt; delete state.waitingForFocus; }
  };
  const closeActionWindows = async action => {
    if (background) {
      action.closing ||= background.close().finally(() => { action.closing = null; });
      await action.closing;
    }
    for (const popup of action.windows) {
      if (popup.counted) continue;
      if (!closeOne(popup)) {
        const reason = '현재 미션의 새 창을 닫지 못해 다음 미션으로 넘어가지 않습니다.';
        addFailure(action.record.label, '새 창 닫기', reason);
        throw new Error(reason);
      }
    }
    returnFocus();
  };
  function trackedOpen(...args) {
    const popup = originals.open.apply(window, args);
    if (activeAction && /(?:\/stoveApp(?:[/?#]|$)|^intent:)/i.test(String(args[0] || ''))) activeAction.manual = true;
    if (activeAction && popup && popup !== window && !popup.closed) {
      if (!activeAction.windows.some(p => p.handle === popup)) {
        activeAction.windows.push({ handle: popup, counted: false });
        state.popupOpened++;
      }
    } else if (activeAction && (!popup || popup !== window && popup.closed)) {
      // shortcut: noopener/COOP로 참조가 끊긴 탭의 닫기 확인에는 확장 기능이 필요합니다.
      if (background) return popup;
      state.untrackedPopups++;
      activeAction.popupLost = true;
      const detached = String(args[2] || '').split(',').some(feature => /^(?:noopener|noreferrer)(?:\s*=\s*(?:1|yes|true))?$/i.test(feature.trim()));
      if (!detached) activeAction.popupBlocked = true;
      addFailure(activeAction.record.label, '새 창 닫기', '팝업 차단 또는 창 참조 미제공으로 자동 닫기를 확인하지 못했습니다.');
      console.warn('[새 창] 참조 없음: 닫기 확인과 별도로 미션 응답·상태를 확인합니다.');
    }
    if (activeAction) requestFocus();
    return popup;
  }
  const trackLink = event => {
    if (!activeAction || event.defaultPrevented) return;
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    event.preventDefault();
    trackedOpen(url.href, '_blank', link.rel?.includes('noreferrer') ? 'noopener,noreferrer' : link.rel?.includes('noopener') ? 'noopener' : undefined);
  };
  const installHooks = () => {
    window.open = trackedOpen;
    window.confirm = message => {
      if (!activeAction) return originals.confirm.call(window, message);
      console.log('[확인 처리]', message); return true;
    };
    window.alert = message => {
      if (!activeAction) return originals.alert.call(window, message);
      if (receiptText(message) || (activeAction.stage === 'claim' && alreadyReceived(message))) activeAction.record.receipt = true;
      console.log('[알림 확인]', message);
    };
    if (originals.fetch) window.fetch = function (...args) {
      const action = activeAction, stage = action?.stage;
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || args[0]?.href;
      const tracked = action && participateURL(url);
      const refresh = activeRefresh && refreshURL(url) ? activeRefresh : null;
      if (tracked) {
        action.requestStarted = true;
        action.fetchStage = stage;
      }
      return originals.fetch.apply(this, args).then(response => {
        if (action?.raffle && /\/emsbackapi\/v[\d.]+\/apply\/[^/?#]+/.test(url)) {
          state.prizeEntry.response = { status: response.status };
        }
        if (tracked) response.clone().json().then(
          data => finishResponse(action, stage, response.status, data),
          () => finishResponse(action, stage, response.status, null));
        if (refresh) response.clone().json().then(
          () => finishRefresh(refresh, url, response.status, 'fetch'),
          () => finishRefresh(refresh, url, response.status, 'fetch', true));
        return response;
      }, error => {
        if (tracked) finishResponse(action, stage, 0, null, true);
        if (refresh) finishRefresh(refresh, url, 0, 'fetch', true);
        throw error;
      });
    };
    // 초기화 때 fetch를 저장해 둔 사이트 코드도 실제 요청 종료를 감지합니다.
    if (typeof PerformanceObserver !== 'undefined') {
      responseObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (activeAction?.raffle && state.prizeEntry.attempted && /\/emsbackapi\/v[\d.]+\/apply\/[^/?#]+/.test(entry.name) && entry.startTime >= state.prizeEntry.startedAt) {
            state.prizeEntry.response = { status: entry.responseStatus || state.prizeEntry.response?.status || 0 };
          }
          if (activeRefresh && refreshURL(entry.name) && entry.startTime >= activeRefresh.startedAt) {
            finishRefresh(activeRefresh, entry.name, entry.responseStatus || 0, 'resource');
          }
          if (!activeAction || activeAction.fetchStage === activeAction.stage ||
            !participateURL(entry.name) || entry.startTime < activeAction.stageStarted) continue;
          finishResponse(activeAction, activeAction.stage, entry.responseStatus || 0, null);
        }
      });
      responseObserver.observe({ type: 'resource', buffered: false });
    }
    document.addEventListener('click', trackLink);
    window.addEventListener?.('focus', wakeAction);
    document.addEventListener('visibilitychange', wakeAction);
    hooksInstalled = true;
  };
  const refreshButton = () => {
    const matches = [...new Set([...document.querySelectorAll('[class*="ic-v2-control-refresh-line"]')]
      .map(icon => icon.closest('button')).filter(visible))];
    return matches.length === 1 ? matches[0] : null;
  };
  const refreshMissionState = async (action, read) => {
    action.rechecked = true;
    const button = refreshButton();
    if (!enabled(button)) return false;
    console.log('[새 창 복구] ' + action.record.label + ': 사이트의 미션 상태를 다시 조회합니다.');
    const refresh = { label: action.record.label, component: action.getCard()?.closest('[id^="mission-widget-"]')?.id.replace('mission-widget-', '') || null,
      startedAt: typeof performance === 'undefined' ? 0 : performance.now(), responses: [], status: 'waiting' };
    state.refreshChecks.push(refresh); activeRefresh = refresh;
    try {
      await click(button);
      await waitFor(() => {
        returnFocus(); autoConfirm();
        if (refresh.responses.some(response => response.failed || response.status >= 400)) throw new Error(action.record.label + ' 미션 재조회 서버/네트워크 오류.');
        if (read()) return true;
        // 페이지 틀의 응답이나 다른 카드 조회로 현재 미션의 재조회를 완료 처리하지 않습니다.
        const completed = refresh.responses.some(response => /\/mission\/component$/.test(response.path) && (!refresh.component || response.component === refresh.component));
        return completed && enabled(refreshButton()) && dailyMissionCards().length && action.getCard();
      }, action.record.label + ' 미션 상태 재조회');
      refresh.status = 'complete';
    } catch (error) {
      refresh.status = state.stopped ? 'stopped' : 'error'; refresh.error = error.message;
      throw error;
    } finally { activeRefresh = null; }
    console.log('[재조회 완료] ' + action.record.label + ': 미션 상태/조회 응답 확인');
    return true;
  };
  const resumeBlockedPopup = async action => {
    if (background) throw new Error(action.record.label + ': 브라우저가 새 창을 거부했습니다. 요청을 재전송하지 않고 실패 내역에 남깁니다.');
    if (action.retried) throw new Error(action.record.label + ': 직접 클릭한 뒤에도 새 창 열기가 거부됐습니다. 크롬 팝업 차단을 확인하세요.');
    const panel = document.createElement('div');
    panel.setAttribute('role', 'status');
    panel.style.cssText = 'position:fixed;inset:auto 16px 16px;z-index:2147483647;padding:20px;background:#fff;color:#111;border:2px solid #6255df;border-radius:12px;box-shadow:0 4px 24px #0006';
    const label = document.createElement('p'), button = document.createElement('button');
    label.textContent = action.record.label + ': 크롬이 새 창 열기를 거부했습니다. 아래 버튼을 누르면 이 미션부터 이어갑니다.';
    button.textContent = '새 창 열고 계속';
    button.style.cssText = 'padding:12px 20px;background:#6255df;color:white;border:0;border-radius:8px;cursor:pointer';
    let resumed = false;
    button.onclick = () => {
      try {
        check();
        const card = action.getCard();
        if (done(card) || enabled(pickClaim(card)) || action.record.receipt || action.requestStarted || action.responses.some(item => item.stage === 'visit')) { resumed = true; return; }
        if (excluded(card)) throw new Error('별도 조건이 필요한 미션은 실행하지 않습니다.');
        const target = action.pickVisit(card);
        if (!enabled(target)) throw new Error('미션 버튼이 준비되지 않았습니다.');
        action.retried = true; action.popupLost = false; action.popupBlocked = false; action.rechecked = false;
        networkStage('visit');
        // 실제 사용자 클릭 안에서 즉시 열어야 크롬의 새 창 차단을 복구할 수 있습니다.
        target.click(); resumed = true;
      } catch (error) { action.resumeError = error; resumed = true; }
    };
    panel.append(label, button); document.body.append(panel);
    state.waitingForPopup = action.record.label;
    console.warn('[직접 클릭 필요] 페이지의 "새 창 열고 계속" 버튼을 누르세요. 스니펫 재실행은 필요 없습니다.');
    try {
      while (!resumed) {
        await waitForeground(action);
        check(); autoConfirm(); returnFocus();
        if (done(action.getCard()) || enabled(pickClaim(action.getCard())) || action.record.receipt || action.requestStarted || action.responses.some(item => item.stage === 'visit')) break;
        await waitAction(action, 100);
      }
      if (action.resumeError) throw action.resumeError;
    } finally { panel.remove(); delete state.waitingForPopup; }
  };
  class MissionTimeout extends Error {}
  const waitMissionAttempt = async (read, description, timeout = 30000) => {
    let until = Date.now() + timeout;
    let pausedFocusMs = state.focusWaitMs;
    while (true) {
      if (activeAction?.manual) await closeActionWindows(activeAction);
      await waitForeground(activeAction, until);
      until += state.focusWaitMs - pausedFocusMs; pausedFocusMs = state.focusWaitMs;
      if (Date.now() >= until) break;
      check(); autoConfirm();
      if (activeAction?.windowError) throw activeAction.windowError;
      const responses = activeAction?.responses.filter(response => response.stage === activeAction.stage) || [];
      const response = responses.find(response => response.failed || response.code || response.status >= 400) || responses[responses.length - 1];
      const ready = read();
      if (ready !== 'received' && !activeAction?.record.receipt && (response?.failed || response?.status >= 400)) {
        throw new Error(description + ': 서버/네트워크 오류. 다음 미션으로 넘어가지 않습니다.');
      }
      if (!background && activeAction?.stage === 'visit' && !ready && !response && !activeAction.requestStarted && !activeAction.popupLost && activeAction.windows.some(popup => !popup.counted && popup.handle.closed)) {
        activeAction.popupLost = true; activeAction.popupBlocked = true;
        state.untrackedPopups++;
        addFailure(activeAction.record.label, '새 창 닫기', '미션 응답 전에 창 참조가 닫힘 상태로 바뀌어 실제 창의 닫기를 확인하지 못했습니다.');
      }
      if (activeAction?.popupLost && !ready) returnFocus();
      if (activeAction && (ready || response || activeAction.manual)) await closeActionWindows(activeAction);
      const result = read();
      if (result === 'received' || activeAction?.record.receipt) return 'received';
      if (response?.code && response.code !== 6015) return 'unavailable';
      if (result) return result;
      if (activeAction?.manual) return 'manual';
      if (activeAction?.stage === 'visit' && activeAction.popupBlocked && !activeAction.rechecked && !activeAction.requestStarted && !response) {
        const refreshed = await refreshMissionState(activeAction, read);
        if (read()) continue;
        if (refreshed && activeAction.popupBlocked && !activeAction.responses.some(item => item.stage === 'visit')) {
          await resumeBlockedPopup(activeAction);
          until = Date.now() + timeout;
          pausedFocusMs = state.focusWaitMs;
          continue;
        }
      }
      await waitAction(activeAction);
    }
    throw new MissionTimeout(description + ' 응답 대기 시간 초과. 수령을 확인하지 못했습니다.');
  };
  const waitMission = async (read, description) => {
    const action = activeAction, record = action.record;
    for (let attempt = 1; ; attempt++) {
      try {
        return await waitMissionAttempt(read, description);
      } catch (error) {
        if (!(error instanceof MissionTimeout) || attempt >= 3) throw error;
        check();
        await closeActionWindows(action);
        const retry = { atMs: Date.now(), stage: action.stage, attempt: attempt + 1, reason: error.message };
        (record.retries ??= []).push(retry);
        console.warn('[재확인] ' + description + ' ' + (attempt + 1) + '/3');
        let refreshed = false;
        try {
          refreshed = await refreshMissionState(action, read);
          retry.refresh = refreshed ? 'confirmed' : 'unavailable';
        } catch (refreshError) {
          check();
          retry.refresh = refreshError.message;
        }
        if (read()) continue;
        // A visit link can be reopened after an authoritative refresh. Claims and paid actions are never replayed.
        if (refreshed && action.stage === 'visit' && ['post', 'banner'].includes(record.kind) &&
          !action.requestStarted && !action.responses.some(response => response.stage === 'visit')) {
          if (background) await background.begin(record.label);
          if (read()) continue;
          networkStage('visit');
          retry.reopened = await clickFresh(action.getCard, action.pickVisit);
        }
      }
    }
  };
  const collapsedChats = new WeakSet();
  const collapseChat = () => {
    const title = [...document.querySelectorAll('p,span')].find(el => !el.childElementCount && visible(el) && text(el) === '실시간댓글');
    const header = title?.closest('div.justify-between');
    const body = header?.nextElementSibling;
    const toggle = header?.querySelector(':scope > div.absolute.inset-0.cursor-pointer');
    if (!body || !toggle || collapsedChats.has(header) || body.getBoundingClientRect().height <= header.getBoundingClientRect().height) return;
    collapsedChats.add(header);
    toggle.click();
    console.log('[화면 정리] 실시간 댓글 패널을 접었습니다.');
  };
  const reveal = el => {
    collapseChat();
    const slide = el.closest('swiper-slide'), swiper = el.closest('[id*="-swiper-"]');
    if (slide && swiper) {
      const index = [...swiper.querySelectorAll('swiper-slide')].indexOf(slide);
      const dot = swiper.querySelectorAll('.swiper-pagination-bullet')[index];
      const instance = slide.closest('swiper-container')?.swiper;
      if (instance?.slideTo) instance.slideTo(index, 0);
      else if (dot && !dot.classList.contains('swiper-pagination-bullet-active')) dot.click();
    }
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  };
  const clickFresh = async (getCard, pick) => {
    let deadline = Date.now() + 10000;
    let pausedFocusMs = state.focusWaitMs;
    while (true) {
      await waitForeground(activeAction);
      deadline += state.focusWaitMs - pausedFocusMs; pausedFocusMs = state.focusWaitMs;
      if (Date.now() >= deadline) break;
      const card = getCard();
      check(); autoConfirm();
      if (card && (done(card) || excluded(card))) return false;
      const button = pick(card);
      if (!enabled(button)) {
        if (pick === pickGo && enabled(pickClaim(card))) return false;
        await waitAction(activeAction); continue;
      }
      reveal(button);
      const current = getCard(), target = pick(current);
      if (current && excluded(current)) return false;
      if (!current || done(current) || !enabled(target) || !unobstructed(target)) { await waitAction(activeAction); continue; }
      await click(target); return true;
    }
    return false;
  };
  const enterPrize = async (record, getCard) => {
    if (!state.options.enterStovePoints || state.prizeEntry.attempted) throw new Error('추가 경품 응모는 허용하지 않습니다.');
    const action = activeAction, entry = state.prizeEntry;
    action.raffle = true;
    const panels = () => [...document.querySelectorAll('[role="dialog"],.stds-dialog-panel')].filter(visible);
    const pointAmount = card => Number(titleOf(card).match(/^(?:스토브|STOVE)([\d,]*)포인트$/i)?.[1].replace(/,/g, ''));
    const pointCards = () => [...new Set(panels().flatMap(panel => [...panel.querySelectorAll('li .stds-box')]))]
      .filter(card => visible(card) && Number.isFinite(pointAmount(card)));
    const countOf = card => {
      const label = [...card.querySelectorAll('p')].map(text).find(value => /응모/.test(value) && /\d/.test(value));
      const match = label?.match(/(?:응모(?:횟수)?[:：]?([\d,]+)회?|([\d,]+)회응모)/);
      return match ? Number((match[1] || match[2]).replace(/,/g, '')) : null;
    };
    try {
      if (!enabled(pickGo(getCard()))) throw new Error('경품 미션 버튼이 변경되었습니다.');
      // 경품 미션 버튼은 #apply로 문서를 다시 열어 실행 연결을 끊을 수 있습니다.
      const banner = await goTab('캡슐뽑기', /^\/ko\/event$/, 'navigating', () => {
        if (pointCards().length) return { alreadyOpen: true };
        const leaf = [...document.querySelectorAll('strong,h1,h2,h3,p')].find(el => visible(el) && text(el) === '행운득템!경품이벤트');
        const article = leaf?.closest('article');
        return visible(article) && { article };
      });
      if (!banner.alreadyOpen && !panels().length) {
        reveal(banner.article); await click(banner.article);
      }
      const card = await waitFor(() => {
        const cards = pointCards();
        const highest = Math.max(...cards.map(pointAmount));
        const targets = cards.filter(card => pointAmount(card) === highest);
        if (targets.length > 1) throw new Error('같은 금액의 스토브 포인트 경품이 여러 개라 대상을 확정하지 못했습니다.');
        return targets[0];
      }, '스토브 포인트 경품');
      const panel = card.closest('[role="dialog"],.stds-dialog-panel');
      const costMatch = text(panel).match(/1회응모([\d,]+)플레이크/);
      const cost = costMatch ? Number(costMatch[1].replace(/,/g, '')) : null;
      const before = countOf(card);
      const minus = card.querySelector('[class*="ic-v2-control-minus-line"]')?.closest('button');
      const quantity = minus?.parentElement?.parentElement;
      const quantityLabel = quantity && [...quantity.querySelectorAll('p')].filter(el => /^\d+$/.test(text(el)));
      if (!cost || balance() === null || balance() < cost) throw new Error('응모 비용 또는 보유 플레이크를 확인할 수 없거나 부족합니다.');
      if (before === null || quantityLabel?.length !== 1 || text(quantityLabel[0]) !== '1') throw new Error('응모 횟수와 1회 수량을 확인하지 못했습니다.');
      const submit = buttons(card).filter(el => enabled(el) && /^응모(?:하기)?$/.test(text(el)));
      if (submit.length !== 1) throw new Error('경품 응모 버튼을 확정하지 못했습니다.');
      entry.label = titleOf(card); entry.cost = cost;
      reveal(submit[0]);
      if (!unobstructed(submit[0])) throw new Error('경품 응모 버튼이 가려져 있습니다.');
      await click(submit[0]);
      const confirmation = await waitFor(() => {
        return panels().find(dialog => text(dialog).includes(entry.label) && /(?:^|\D)1회(?:\D|$)/.test(text(dialog)) && /응모/.test(text(dialog)) &&
          buttons(dialog).filter(el => enabled(el) && /^(확인|예)$/.test(text(el))).length === 1);
      }, '1회 응모 확인창');
      const confirm = buttons(confirmation).find(el => enabled(el) && /^(확인|예)$/.test(text(el)));
      entry.attempted = true; entry.startedAt = performance.now();
      await click(confirm);
      await waitFor(() => {
        if (entry.response?.status >= 400) throw new Error('경품 응모 서버 오류. 재응모하지 않습니다.');
        const fresh = pointCards().filter(card => titleOf(card) === entry.label);
        return fresh.length === 1 && countOf(fresh[0]) === before + 1 && entry.response &&
          buttons(fresh[0]).some(el => enabled(el) && /^응모(?:하기)?$/.test(text(el)));
      }, '응모 응답 및 내 응모 횟수 증가', 30000);
      entry.confirmed = true;
    } finally {
      // 응모 성공 여부와 관계없이 원래 미션 화면으로 돌아갑니다. 불확실한 차감은 재시도하지 않습니다.
      for (const panel of panels()) {
        const close = buttons(panel).find(el => enabled(el) && text(el) === '닫기');
        if (close) await click(close);
      }
      await goTab('미션', /^\/ko\/?$/, 'missions', () => dailyMissionCards().length);
      action.raffle = false;
      if (getCard()) reveal(getCard());
    }
    if (!enabled(pickClaim(getCard())) && !done(getCard())) {
      await refreshMissionState(action, () => done(getCard()) || enabled(pickClaim(getCard())));
    }
  };
  const processCard = async (record, getCard, pickVisit, prepare) => {
    const action = { record, getCard, pickVisit, windows: [], responses: [], stage: null, stageStarted: 0, manual: false };
    activeAction = action;
    try {
      if (background) await background.begin(record.label);
      check();
      record.status = 'running';
      if (excluded(getCard())) { skip(getCard()); record.status = 'excluded'; return; }
      if (done(getCard())) { record.received = true; record.status = 'received'; return; }
      const prize = isPrize(getCard());
      if (prize && !enabled(pickClaim(getCard()))) await enterPrize(record, getCard);
      if (prepare && !enabled(pickClaim(getCard()))) await prepare(getCard);
      if (!prize && !enabled(pickClaim(getCard())) && pickVisit && !record.missionClicked) {
        networkStage('visit');
        record.missionClicked = await clickFresh(getCard, pickVisit);
        if (!record.missionClicked && !done(getCard()) && !enabled(pickClaim(getCard()))) {
          throw new Error(record.label + ' 미션하기 버튼을 누르지 못했습니다. 가림·비활성화·화면 변경을 확인하세요. 요청을 보내지 않아 응답 대기를 시작하지 않습니다.');
        }
      }
      let progress = await waitMission(() => record.receipt || done(getCard()) ? 'received' : enabled(pickClaim(getCard())) ? 'claim' : null, record.label + ' 미션');
      if (progress === 'manual' || progress === 'unavailable') {
        record.status = progress;
        record.failureReason = progress === 'manual' ? '앱에서 실제 참여가 필요합니다.' : '서버가 미션 조건 미충족/참여 불가를 응답했습니다.';
        console.warn('[미션] ' + record.label + ': ' + record.failureReason);
        return;
      }
      if (progress === 'claim' && !record.claimClicked) {
        networkStage('claim');
        record.claimClicked = await clickFresh(getCard, pickClaim);
        if (!record.claimClicked && !record.receipt && !done(getCard())) throw new Error(record.label + ' 받기 버튼을 누르지 못했습니다.');
        progress = await waitMission(() => record.receipt || done(getCard()) ? 'received' : null, record.label + ' 수령');
      }
      record.received = progress === 'received';
      record.status = record.received ? 'received' : 'pending';
      if (!record.received) record.failureReason = '서버가 보상 수령 불가를 응답했습니다.';
      console.log('[미션] ' + record.label + ': ' + (record.received ? '보상 수령 응답 확인' : '서버가 수령 불가를 응답했습니다.'));
    } catch (error) {
      record.status = state.stopped ? 'stopped' : 'error';
      record.failureReason = error.message;
      if (error instanceof MissionTimeout) {
        check();
        await closeActionWindows(action);
        record.status = 'timeout';
        return;
      }
      throw error;
    } finally {
      if (!record.received && record.status !== 'excluded') {
        const responses = action.responses.filter(response => response.stage === action.stage);
        const response = responses.find(response => response.failed || response.code || response.status >= 400) || responses[responses.length - 1];
        addFailure(record.label, action.stage === 'claim' ? '받기' : '미션하기',
          record.failureReason || '보상 수령 완료를 확인하지 못했습니다.', response);
      }
      for (const popup of action.windows) closeOne(popup);
      if (background) await background.close();
      activeAction = null;
    }
  };
  const runMissions = async () => {
    installHooks();
    await goTab('미션', /^\/ko\/?$/, 'missions', () =>
      /데일리\s*미션|설문조사\s*참여하고/.test(document.body.innerText) &&
      dailyMissionCards().length);
    state.startBalance = balance();
    const records = new Map(), visited = new Set();
    state.skippedMissions = [];
    const recordFor = (key, label, kind) => {
      if (!records.has(key)) {
        const record = { key, label, kind, missionClicked: false, claimClicked: false, received: false, status: 'waiting' };
        records.set(key, record); state.missionResults.push(record);
      }
      return records.get(key);
    };
    const primaryCards = () => {
      const lower = new Set(['post', 'survey', 'banner'].flatMap(rewardCards));
      return missionCards().filter(card => !lower.has(card));
    };
    const hrefOf = card => card.querySelector('a[href]').href;
    const linksToProcess = kind => {
      const cards = rewardCards(kind);
      const received = new Set(cards.filter(done).map(hrefOf));
      return cards.filter(card => !received.has(hrefOf(card)));
    };
    const labelFor = (kind, card) => ({ mission: '', post: '인기 게시글: ', survey: '설문: ', banner: '클릭 배너: ' })[kind] + titleOf(card);
    for (const [kind, cards] of [['mission', primaryCards()], ['post', linksToProcess('post')],
      ['survey', rewardCards('survey')], ['banner', linksToProcess('banner')]]) {
      for (const card of cards) {
        if (done(card) || excluded(card)) continue;
        const key = kind === 'post' || kind === 'banner' ? hrefOf(card) : keyOf(card);
        recordFor(kind + ':' + key, labelFor(kind, card), kind);
      }
    }
    state.missionsReady = true;
    while (true) {
      check();
      const card = primaryCards().find(card => !done(card) && !visited.has(keyOf(card)));
      if (!card) break;
      const key = keyOf(card); visited.add(key);
      if (excluded(card)) { skip(card); continue; }
      const getCard = () => missionCards().find(card => keyOf(card) === key);
      await processCard(recordFor('mission:' + key, titleOf(card), 'mission'), getCard, pickGo);
    }
    const runLinks = async kind => {
      const visitedLinks = new Set();
      while (true) {
        check();
        const card = linksToProcess(kind).find(card => !visitedLinks.has(hrefOf(card)));
        if (!card) break;
        const href = hrefOf(card); visitedLinks.add(href);
        if (excluded(card)) { skip(card); continue; }
        const getCard = () => rewardCards(kind).find(card => hrefOf(card) === href);
        await processCard(recordFor(kind + ':' + href, labelFor(kind, card), kind), getCard,
          card => [...(card?.querySelectorAll('a[href]') || [])].find(link => link.href === href));
      }
    };
    await runLinks('post');
    const surveys = [...new Set(rewardCards('survey').map(keyOf))];
    for (const key of surveys) {
      const getCard = () => rewardCards('survey').find(card => keyOf(card) === key);
      if (excluded(getCard())) { skip(getCard()); continue; }
      if (done(getCard())) continue;
      const submitSurvey = card => buttons(card).find(button => /^설문참여하고[\d,]+플레이크받기$/.test(text(button)));
      await processCard(recordFor('survey:' + key, labelFor('survey', getCard()), 'survey'), getCard,
        submitSurvey, async getCard => {
          const selector = '.survey-item,input[type="radio"],input[type="checkbox"]', tried = new Set();
          // 기존 선택을 유지하고 사이트가 요구하는 선택 수까지만 추가합니다.
          while (!enabled(submitSurvey(getCard())) && !enabled(pickClaim(getCard()))) {
            const options = [...(getCard()?.querySelectorAll(selector) || [])];
            const index = options.findIndex((option, i) => !tried.has(i) && enabled(option) && !option.checked &&
              !option.classList.contains('survey-item--active') && !option.classList.contains('survey-item--completed') && option.getAttribute('aria-checked') !== 'true');
            if (index < 0) break;
            tried.add(index);
            if (!await clickFresh(getCard, card => card.querySelectorAll(selector)[index])) break;
          }
        });
    }
    await runLinks('banner');
    for (const [kind, cards] of [['mission', primaryCards()], ['post', rewardCards('post')],
      ['survey', rewardCards('survey')], ['banner', rewardCards('banner')]]) {
      for (const card of cards.filter(done)) {
        const key = kind === 'post' || kind === 'banner' ? hrefOf(card) : keyOf(card);
        const record = records.get(kind + ':' + key);
        if (record) Object.assign(record, { received: true, status: 'received' });
      }
    }
    state.pending = state.missionResults.filter(record => !record.received && record.status !== 'excluded').map(record => record.label);
  };

  const dialogPanels = () => [...document.querySelectorAll('.stds-dialog-panel,[role="dialog"],[role="alertdialog"]')].filter(visible);
  const resultPanel = () => dialogPanels().find(panel => panel.closest('#stds-gift-dialog-overview') ||
    panel.querySelector('.winning-gift-dialog__image-background'));
  const dialogButton = (panel, label) => {
    const matches = buttons(panel).filter(button => enabled(button) && text(button) === label);
    return matches.length === 1 ? matches[0] : null;
  };
  const closeDrawResults = async () => {
    for (let i = 0; resultPanel(); i++) {
      if (i >= 30) throw new Error('캡슐 결과창이 닫히지 않았습니다.');
      const panel = resultPanel(), others = new Set(dialogPanels());
      const close = await waitFor(() => dialogButton(panel, '닫기'), '캡슐 결과 닫기 버튼');
      await click(close);
      // 실물 경품의 정보 입력 안내에서는 닫기만 선택합니다.
      await sleep(150);
      const notice = dialogPanels().find(dialog => !others.has(dialog) &&
        buttons(dialog).some(button => /^입력하기?$/.test(text(button))));
      if (notice) {
        const dismiss = await waitFor(() => dialogButton(notice, '닫기'), '경품 정보 안내 닫기');
        await click(dismiss);
        await sleep(150);
      }
    }
  };
  const claimDrawMilestones = async () => {
    const buttonsOnTrack = () => [...document.querySelectorAll('article.grid-area-item2 button')].filter(visible);
    const received = button => button && (COMPLETE.test(text(button)) ||
      !!button.querySelector('[class*="ic-v2-control-check-line"]'));
    const labels = buttonsOnTrack().map(button => enabled(button) && !received(button) && /^[\d,]+플레이크받기$/.test(text(button)) ? text(button) : null);
    state.drawMilestones = { total: labels.filter(Boolean).length, received: 0 };
    for (const [index, label] of labels.entries()) {
      if (!label) continue;
      const current = () => buttonsOnTrack()[index];
      const button = await waitFor(() => {
        const target = current();
        if (received(target)) return true;
        if (!enabled(target) || text(target) !== label) return null;
        reveal(target);
        return unobstructed(target) && target;
      }, label + ' 준비');
      if (button !== true) {
          const existing = new Set(dialogPanels());
          await click(button);
          const reply = await waitFor(() => {
            const newPanels = dialogPanels().filter(panel => !existing.has(panel));
            const verified = received(current());
            const alert = newPanels.find(panel =>
              (verified || receiptText(panel.innerText) || alreadyReceived(panel.innerText)) && dialogButton(panel, '확인'));
            return alert || (verified && !newPanels.length);
          }, label + ' 수령 확인');
          if (reply !== true) {
            await click(dialogButton(reply, '확인'));
            await waitFor(() => !visible(reply), label + ' 안내 닫기');
          }
      }
      state.drawMilestones.received++;
    }
  };

  try {
    console.log('[STOVE 100] ' + state.version);
    if (!background) console.warn('[실행 방식] 일반 스니펫은 백그라운드 완료를 보장하지 않습니다. 무인 실행은 FullAuto100 확장 기능에서 시작하세요.');
    await runMissions();
    state.step = 'draws';
    const drawScreen = await goTab('캡슐뽑기', /^\/ko\/event$/, 'draws', () => {
      const value = readCount();
      return value === null ? null : { count: value };
    });
    const startCount = drawScreen.count;
    const target = 30 - startCount;
    state.startCount = startCount;
    state.target = target;
    await closeDrawResults();
    console.log(`[100 뽑기] 오늘 ${startCount}/30회, 이번 실행 최대 ${target}회`);
    if (!target) console.log('[100 뽑기] 오늘 뽑기는 이미 완료됐습니다.');
    if (target && balance() === null) throw new Error('뽑기 전 보유량을 확인하지 못했습니다.');
    let expected = startCount;

    while (expected < 30) {
      check();
      if (count() !== expected) throw new Error('다른 실행 또는 수동 뽑기로 횟수가 변경되었습니다.');
      const button = await waitFor(findButton, '100 뽑기 버튼');
      button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await sleep(250);
      await waitFor(() => !enabled(button) || unobstructed(button), '버튼 위 팝업/애니메이션 종료');
      check();
      if (!enabled(button) || !(initialLabel.test(text(button)) || repeatLabel.test(text(button)))) {
        throw new Error('버튼 상태가 바뀌어 중지했습니다.');
      }
      if (count() !== expected) throw new Error('클릭 전 횟수가 변경되었습니다.');
      const available = balance();
      if (available === null || available < 100) throw new Error('보유량 확인 실패 또는 100 플레이크 미만입니다.');

      const clickedAt = Date.now();
      state.clicks++;
      await click(button);
      await waitFor(() => {
        const now = count();
        if (now !== expected && now !== expected + 1) throw new Error('뽑기 횟수가 예상과 다르게 변경되었습니다.');
        return now === expected + 1;
      }, '뽑기 성공 횟수 반영');
      expected++;
      state.completed++;
      console.log(`[100 뽑기] ${state.completed}/${target}회 성공 확인 · 오늘 ${expected}/30회`);

      // shortcut: 뽑기 애니메이션을 최소 4초 기다립니다. 더 길어지면 간격을 늘리세요.
      await sleep(Math.max(0, 4000 - (Date.now() - clickedAt)));
      const reward = [...document.querySelectorAll('.l1l2-flakehub-popup-common-received_reward')]
        .find(visible)?.innerText.trim();
      if (reward) {
        state.rewards.push(reward);
        console.log(`[보상 표시] ${reward}`);
      }
    }
    await closeDrawResults();
    await claimDrawMilestones();
    console.log(`뽑기 완료: 오늘 30/30회. 이번 실행 성공 확인: ${state.completed}회.`);
    state.status = state.pending.length ? 'partial' : 'complete';
    console.log(`처리 종료: 뽑기 ${state.completed}회, 보상 수령 확인 ${state.missionResults.filter(record => record.received).length}개, 미확인 ${state.pending.length}개. 상세: window.stove100.missionResults`);
  } catch (error) {
    state.status = state.stopped ? 'stopped' : 'error';
    state.error = error.message;
    if (!state.failures.some(failure => failure.사유 === error.message)) {
      addFailure(state.phase === 'draws' ? '캡슐 뽑기' : '자동 처리',
        ({ draws: '뽑기', missions: '미션', navigating: '탭 이동', preparing: '시작 준비' })[state.phase] || state.phase, error.message);
    }
    console.error(`[자동 처리 중지: ${state.phase}] ${error.message} 뽑기 성공 ${state.completed}회 / 클릭 ${state.clicks}회`);
  } finally {
    if (activeAction) for (const popup of activeAction.windows) closeOne(popup);
    activeAction = null;
    if (hooksInstalled) {
      window.open = originals.open;
      window.confirm = originals.confirm;
      window.alert = originals.alert;
      if (originals.fetch) window.fetch = originals.fetch;
      responseObserver?.disconnect();
      document.removeEventListener('click', trackLink);
      window.removeEventListener?.('focus', wakeAction);
      document.removeEventListener('visibilitychange', wakeAction);
    }
    state.running = false;
    const extraPending = ['post', 'survey', 'banner'].flatMap(kind => {
      const cards = rewardCards(kind);
      const receivedLinks = new Set(cards.filter(done).map(card => card.querySelector('a[href]')?.href).filter(Boolean));
      return cards.filter(card => !receivedLinks.has(card.querySelector('a[href]')?.href));
    });
    state.pending = [...new Set([
      ...state.missionResults.filter(record => !record.received && record.status !== 'excluded').map(record => record.label),
      ...(state.phase === 'missions' && location.origin === 'https://reward.onstove.com' && /^\/ko\/?$/.test(location.pathname)
        ? [...new Set([...missionCards(), ...extraPending])]
          .filter(card => !done(card) && !excluded(card)).map(titleOf) : [])
    ])];
    if (state.status === 'complete' && state.pending.length) state.status = 'partial';
    state.endBalance = balance();
    const startBalance = state.startBalance ?? null;
    if (startBalance !== null && state.endBalance !== null) {
      state.netChange = state.endBalance - startBalance;
      console.log(`플레이크 ${startBalance.toLocaleString()} → ${state.endBalance.toLocaleString()} · 차감 포함 순증감 ${state.netChange.toLocaleString()}`);
    }
    if (state.failures.length) {
      console.warn('[실패·미완료 내역] ' + state.failures.length + '건');
      console.table(state.failures);
      console.log('실패 내역: window.stove100.failures');
    } else {
      console.log('[실패·미완료 내역] 없음');
    }
    if (state.pending.length) console.log('미수령·미처리 목록: window.stove100.pending', state.pending);
    console.log('STOVE_AUDIT_JSON ' + JSON.stringify(state));
    console.log('실행 결과: window.stove100');
    if (background) await background.finish(state);
    else if (state.status === 'complete') originals.alert?.call(window, '오늘 자동 처리가 완료됐습니다. 미션, 캡슐 30회, 누적 보상 확인을 마쳤습니다.');
  }
})();
