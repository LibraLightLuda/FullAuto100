// Isolated browser DOM fixtures: no real requests or rewards.
async function testStoveMissions(source) {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  async function run(options = {}) {
    const doc = document.implementation.createHTMLDocument('STOVE response fixture');
    let pageHidden = false;
    Object.defineProperty(doc, 'visibilityState', { get: () => pageHidden ? 'hidden' : 'visible' });
    const location = { origin: 'https://reward.onstove.com', pathname: options.startPath || '/ko/event', href: 'https://reward.onstove.com/ko/event' };
    let clock = 0, timerId = 0, pumping = false, steps = 0, phase = '', currentOwner = '';
    const timers = [], calls = [], windows = [], failures = [], summaries = [], auditOutputs = [], events = new EventTarget(), responded = new Set();
    let aStatus = options.allDone ? 'done' : options.claimOnly ? 'claim' : 'go';
    let bStatus = options.allDone ? 'done' : 'go';
    let prizeClaimed = false;
    let postDone = !!options.allDone, surveyDone = !!options.allDone, surveySelected = !!options.selected;
    let chatExpanded = !!options.chatOpen, weeklyDone = false, dailyLoaded = false, refreshLoading = false, recoverGesture = false;
    let finished;
    const completion = new Promise(resolve => { finished = resolve; });
    const note = name => calls.push({ name, at: clock });
    const channel = new MessageChannel();
    channel.port1.onmessage = () => pump();
    const resourceObservers = new Set();
    class FixturePerformanceObserver {
      constructor(callback) { this.callback = callback; }
      observe() { resourceObservers.add(this); }
      disconnect() { resourceObservers.delete(this); }
    }
    const emitResource = entry => { for (const observer of resourceObservers) observer.callback({ getEntries: () => [entry] }); };
    const win = {
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
      focus() { note('focus'); if (options.focusThrows) throw new Error('focus request denied'); if (!options.focusDenied) setHidden(false); }
    };
    events.addEventListener('focus', () => { if (pageHidden) failures.push('synthetic focus while document is hidden'); });
    function setHidden(hidden) {
      if (pageHidden === hidden) return;
      pageHidden = hidden; note(hidden ? 'hidden' : 'visible');
      doc.dispatchEvent(new Event('visibilitychange'));
      if (!hidden) events.dispatchEvent(new Event('focus'));
      else if (options.returnAfter) fakeTimeout(() => setHidden(false), options.returnAfter, true);
    }
    const baselineOpen = () => {
      if (options.h5Flow && !recoverGesture && !(options.firstVisitWorks && currentOwner === 'a')) {
        note('untracked:' + currentOwner);
        if (options.closingBetweenChecks) {
          let reads = 0;
          return { get closed() { return ++reads > 1; } };
        }
        return options.closedReference ? { closed: true } : null;
      }
      if (options.backgroundPopup) setHidden(true);
      if (options.popupNull) return null;
      const owner = currentOwner;
      const popup = { owner, closed: false, close() {
        if (!options.stop && !options.changePage && !options.noResponse && !options.manual && !(owner === 'post' && options.latePost))
          assert(responded.has(owner + ':visit'), 'window closes after visit response');
        note('close:' + owner);
        if (!options.closeFail) {
          this.closed = true;
          if (!options.stayHiddenAfterClose && windows.every(p => p.closed)) setHidden(false);
        }
      } };
      windows.push(popup); note('open:' + owner); return popup;
    };
    const baselineConfirm = () => false, baselineAlert = () => {};
    const baselineFetch = (url, init) => new Promise(resolve => {
      const requestStartedAt = clock;
      if (/\/mission\/component|\/v1\/page/.test(url)) {
        const startedAt = clock;
        if (options.refreshNeverFinishes) return;
        fakeTimeout(() => {
          note('refresh:response'); refreshLoading = false;
          if (!options.refreshHTTPError && options.serverReady) {
            if (currentOwner === 'a') aStatus = 'claim';
            if (currentOwner === 'b') bStatus = 'claim';
          }
          if (!options.refreshNoDOM) renderMissions();
          const status = options.refreshHTTPError ? 503 : 200;
          const data = { code: 0 };
          resolve({ status, json: () => Promise.resolve(data), clone: () => ({ json: () => Promise.resolve(data) }) });
          emitResource({ name: url, startTime: options.refreshStaleOnly ? -1 : startedAt, responseEnd: clock, responseStatus: options.resourceUnknownStatus ? 0 : status });
        }, options.refreshFastToggle || options.refreshFastReplace ? 1 : options.refreshDelay ?? 80, true);
        return;
      }
      const { owner, stage, delay, code } = JSON.parse(init.body);
      if (options.noResponse && owner === 'a') return;
      fakeTimeout(() => {
        responded.add(owner + ':' + stage); note('response:' + owner + ':' + stage);
        const data = { code };
        resolve({ status: 200, json: () => Promise.resolve(data), clone: () => ({ json: () => Promise.resolve(data) }) });
        if (options.visitSavedFetch) emitResource({ name: url, startTime: requestStartedAt, responseEnd: clock, responseStatus: 200 });
      }, delay, true);
    });
    Object.assign(win, { open: baselineOpen, confirm: baselineConfirm, alert: baselineAlert, fetch: baselineFetch });
    const request = (owner, stage, callback, delay, code = 0) => (options.visitSavedFetch ? baselineFetch : win.fetch)(
      'https://api.onstove.com/flake-shop/v1/mission/participate', {
        method: 'POST', body: JSON.stringify({ owner, stage, delay: delay ?? (stage === 'claim' ? options.claimDelay ?? 60 : options.visitDelay ?? 75), code })
      }).then(response => response.json()).then(callback);
    function fakeTimeout(fn, ms, external = false) {
      const id = ++timerId;
      timers.push({ at: clock + (pageHidden && options.throttleBackground && !external ? Math.max(ms,45000) : ms), id, fn });
      if (!pumping) { pumping = true; channel.port2.postMessage(null); }
      return id;
    }
    function fakeClearTimeout(id) { const index = timers.findIndex(timer=>timer.id===id); if (index>=0) timers.splice(index,1); }
    function pump() {
      if (++steps > 30000) { timers.length = 0; finished(); return; }
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const timer = timers.shift();
      if (timer) { clock = timer.at; try {
        timer.fn();
        const resume = doc.querySelector('[role="status"] button');
        if (resume) {
          if (options.stopRecovery) win.stove100.stop();
          else if (!options.leaveRecoveryPending) {
            note('resume'); recoverGesture = !options.recoveryBlocked;
            resume.click(); recoverGesture = false;
          }
        }
      } catch (error) { failures.push(error.message); } }
      pumping = timers.length > 0;
      if (pumping) channel.port2.postMessage(null);
    }
    function prepare() {
      for (const el of doc.querySelectorAll('*')) {
        el.getClientRects = () => el.hidden ? [] : [{ left: 0, top: 0, width: 80, height: 40 }];
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 80, height: 40 });
        el.scrollIntoView = () => { doc.fixtureTop = el; };
      }
      const header = doc.getElementById('chat-header'), content = doc.getElementById('chat-body');
      if (header) header.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 24 });
      if (content) content.getBoundingClientRect = () => ({ left: 0, top: 24, width: 300, height: chatExpanded ? 500 : 22 });
      doc.elementFromPoint = () => options.permanentOverlay ? doc.getElementById('blocker') :
        chatExpanded ? content : doc.fixtureTop || null;
    }
    function bind(id, fn) {
      doc.getElementById(id).addEventListener('click', event => { try { fn(event); } catch (error) { failures.push(error.message); } });
    }
    function showReceipt() {
      const popup = doc.createElement('div'); popup.id = 'stds-dialog-layer-popup';
      popup.innerHTML = '<p><span class="flakeshop-alert-receive_complete">100 플레이크</span>가 지급되었습니다!</p><button>확인</button>';
      doc.body.append(popup); prepare();
      popup.querySelector('button').onclick = () => { note('confirm'); popup.remove(); };
    }
    const label = status => status === 'done' ? '받기 완료' : status === 'claim' ? '받기' : '미션 하기';
    function renderMissions() {
      phase = 'missions';
      doc.body.innerHTML = `${(options.h5Flow || options.reopenPost) && !options.noRefresh ? `<button id="refresh" ${refreshLoading ? 'disabled' : ''}><i class="ic-v2-control-refresh-line"></i></button>` : ''}<section id="mission-widget-101"><h1>데일리 미션 참여하고 매일 보상받기!</h1><button id="capsule">캡슐 뽑기</button>
        <div class="stds-box"><p>완료 시 200 플레이크</p><h3>${options.excludedVariant ? '경품\u200b 응모 하 기' : '경품 <span>응모</span>하기'}</h3><button id="excluded">${prizeClaimed ? '받기 완료' : options.excludedClaim ? '받기' : '미션하기'}</button></div>
        <div class="stds-box"><p class="text-xl">이미 끝남</p><span>100 플레이크 받기 완료</span><button id="done">미션하기</button></div>
        <div class="stds-box"><p>완료 시 100 플레이크</p><p class="text-xl">첫 미션</p><button id="a" ${options.lateEnable && clock < 5000 ? 'disabled' : ''}>${label(aStatus)}</button></div>
        <div class="stds-box"><p>완료 시 100 플레이크</p><p class="text-xl">두 번째 미션</p><button id="b">${label(bStatus)}</button></div>
        </section>
        ${options.loadingRace ? `<section><h2>위클리 미션 참여하고 보상받기!</h2><div class="stds-box"><p class="text-xl">먼저 로드된 주간 미션</p><button id="weekly">${weeklyDone ? '받기 완료' : '미션하기'}</button></div></section>` : ''}
        <div id="content-mission-swiper-384">
          <div class="stds-box"><p>받은 글</p><span>100 플레이크 받기 완료</span><a id="post-done" href="https://example.com/done">열기</a></div>
          <div class="stds-box"><p>안 받은 글</p>${postDone ? '<span>100 플레이크 받기 완료</span>' : ''}<a id="post" href="https://example.com/post">열기</a></div>
          <div class="stds-box"><p>같은 글</p><a id="post-copy" href="https://example.com/post">열기</a></div>
        </div>
        <div id="survey-mission-swiper-385"><div class="stds-box"><p>설문 질문</p>
          ${options.checkbox ? `<input id="choice" type="checkbox" ${surveySelected ? 'checked' : ''}>` : `<button id="choice" class="survey-item${surveySelected ? ' survey-item--active' : ''}">첫 항목</button>`}
          <button id="choice2" class="survey-item">두 번째 항목</button>
          <button id="submit" ${surveySelected ? '' : 'disabled'}>${surveyDone ? '100 플레이크 받기 완료' : '설문 참여하고 100 플레이크 받기'}</button>
        </div></div>
        ${options.withChat || options.chatOpen ? '<aside><div id="chat-header" class="flex items-center justify-between relative"><div id="chat-toggle" class="absolute inset-0 cursor-pointer"></div><div><p>실시간 댓글</p></div></div><div id="chat-body">댓글</div></aside>' : ''}
        ${options.permanentOverlay ? '<div id="blocker">알 수 없는 팝업</div>' : ''}`;
      prepare();
      if ((options.h5Flow || options.reopenPost) && !options.noRefresh) bind('refresh', () => {
        if (options.backgroundRefresh) setHidden(true);
        note('refresh'); refreshLoading = true;
        if (options.refreshNoDOM) { /* Real page need not render a disabled state. */ }
        else if (options.refreshFastToggle) {
          const button = doc.getElementById('refresh');
          button.disabled = true; button.disabled = false;
        } else renderMissions();
        const url = options.refreshOnlyPage ? 'https://api.onstove.com/flake-shop/v1/page?page_type=MISSION' :
          (options.refreshOtherOrigin ? 'https://example.com' : 'https://api.onstove.com') + '/flake-shop/v1/mission/component?component_no=' + (options.refreshOtherComponent ? '999' : '101');
        const fetcher = options.refreshSavedFetch ? baselineFetch : win.fetch;
        fetcher(url, { method: 'GET' }).then(response => response.json());
      });
      bind('capsule', () => { note('capsule'); location.pathname = '/ko/event'; renderDraws(); });
      if (options.withChat || options.chatOpen) bind('chat-toggle', () => { note('toggle-chat'); chatExpanded = !chatExpanded; renderMissions(); });
      if (options.loadingRace) bind('weekly', () => { note('weekly'); weeklyDone = true; renderMissions(); });
      for (const id of ['done','post-done','post-copy','choice2']) bind(id, () => { note(id); });
      bind('excluded',()=>{note('excluded');if(options.excludedClaim){prizeClaimed=true;renderMissions();}});
      bind('a', () => {
        currentOwner = 'a';
        if (aStatus === 'claim') {
          assert(windows.filter(p => p.owner === 'a').every(p => p.closed), 'a reward must follow its popup closure');
          if (options.backgroundClaim) setHidden(true);
          note('claim:a'); request('a','claim',()=>{ aStatus = 'done'; renderMissions(); showReceipt(); }); return;
        }
        note('a');
        assert(win.confirm('참여 확인?'), 'native confirmation accepted'); win.alert('미션을 확인합니다');
        if (options.h5Flow) {
          const popup = win.open('https://example.com/a1', 'stove-h5-a', 'width=540,height=960');
          if (!popup || popup.closed) return; // Same early return as the site's desktop H5 helper.
        } else {
          win.open(options.manual ? 'https://store.onstove.com/ko/stoveApp' : 'https://example.com/a1', '_blank', options.noopener ? 'noopener,noreferrer' : undefined);
          win.open('https://example.com/a2', '_blank', options.noopener ? 'noopener,noreferrer' : undefined);
        }
        if (options.stop) fakeTimeout(() => win.stove100.stop(), 1, true);
        if (options.changePage) { location.origin = 'https://example.com'; return; }
        if (!options.manual) request('a','visit',()=>{
          if (!options.noReward) events.addEventListener('focus', () => { aStatus = 'claim'; renderMissions(); }, { once: true });
        }, undefined, options.noReward ? 6020 : 0);
        if (options.rerender) fakeTimeout(renderMissions, 700);
      });
      bind('b', () => {
        currentOwner = 'b';
        if (bStatus === 'claim') {
          assert(windows.filter(p => p.owner === 'b').every(p => p.closed), 'b reward must follow its popup closure');
          note('claim:b'); request('b','claim',()=>{ bStatus = 'done'; renderMissions(); showReceipt(); }); return;
        }
        assert(aStatus === 'done' || options.noReward || options.manual ||
          win.stove100.missionResults[0]?.status === 'timeout', 'next mission must follow previous reward or exhausted retry');
        note('b');
        const popup = win.open('https://example.com/b', options.h5Flow ? 'stove-h5-b' : '_blank', options.h5Flow ? 'width=540,height=960' : undefined);
        if (options.h5Flow && (!popup || popup.closed)) return;
        request('b','visit',()=>{ events.addEventListener('focus', () => { bStatus = 'claim'; renderMissions(); }, { once: true }); }, options.delayedClaim ? 19000 : undefined);
      });
      bind('post', event => {
        event.preventDefault(); currentOwner = 'post'; note('post');
        if (options.reopenPost && calls.filter(x => x.name === 'post').length === 1) return;
        win.open('https://example.com/post', '_blank');
        request('post','visit',()=>{ postDone = true; renderMissions(); }, options.latePost ? 35000 : undefined);
      });
      bind('choice', () => { note('choice'); surveySelected = true; renderMissions(); });
      bind('submit', () => { currentOwner = 'survey'; note('submit'); assert(win.confirm('설문 확인?'), 'survey confirm');
        request('survey','visit',()=>{ surveyDone = true; renderMissions(); showReceipt(); }); });
    }
    function renderMissionRoute() {
      if ((!options.loadingRace && !options.partialDaily) || dailyLoaded) { renderMissions(); return; }
      phase = 'loading';
      doc.body.innerHTML = `<main><section><h1>데일리 미션 참여하고 매일 보상받기!</h1>
        ${options.partialDaily ? '<p>0/4 데일리 미션 달성</p><div class="stds-box"><p class="text-xl">불완전한 데일리 목록</p><button id="early">미션하기</button></div>' : ''}
        </section><section><h2>위클리 미션 참여하고 보상받기!</h2><div class="stds-box"><p class="text-xl">먼저 로드된 주간 미션</p><button id="early-weekly">미션하기</button></div></section></main>`;
      prepare();
      bind('early-weekly', () => note('early-weekly'));
      if (options.partialDaily) bind('early', () => note('early-daily'));
      fakeTimeout(() => { dailyLoaded = true; renderMissions(); }, 750);
    }
    function renderDraws() {
      phase = 'draws'; doc.body.innerHTML = '<div class="stds-box"><span>오늘 뽑기</span><span>30/30회</span></div><button id="missions">미션</button><button id="capsule">캡슐 뽑기</button>';
      prepare(); bind('missions', () => { note('missions-tab'); location.pathname = '/ko'; renderMissionRoute(); });
    }
    if (location.pathname === '/ko/event') renderDraws();
    else if (location.pathname === '/ko') renderMissionRoute();
    else {
      doc.body.innerHTML = '<button id="missions">미션</button>'; prepare();
      bind('missions', () => { note('missions-tab'); location.pathname = '/ko'; renderMissionRoute(); });
    }
    if (options.lateEnable) fakeTimeout(() => { if (phase === 'missions') renderMissions(); }, 5000);
    const log = { log(message) { if (message.startsWith('STOVE_AUDIT_JSON ')) auditOutputs.push(JSON.parse(message.slice('STOVE_AUDIT_JSON '.length))); if (message === '실행 결과: window.stove100') finished(); }, warn() {}, error() {},
      table(rows) { summaries.push(rows.map(row => ({ ...row }))); } };
    const execute = () => new Function('window','document','location','Date','setTimeout','console','URL','performance','PerformanceObserver','clearTimeout',source)(win,doc,location,{now:()=>clock},fakeTimeout,log,URL,{now:()=>clock},FixturePerformanceObserver,fakeClearTimeout);
    execute(); if (options.duplicate) execute(); await completion;
    channel.port1.close(); channel.port2.close(); timers.length = 0;
    assert(steps <= 30000, 'virtual timer budget');
    assert(failures.length === 0, 'fixture event failures: ' + failures.join('; '));
    assert(win.open === baselineOpen && win.confirm === baselineConfirm && win.alert === baselineAlert && win.fetch === baselineFetch, 'hooks restored');
    assert(!win.stove100.running, 'run finishes');
    assert(resourceObservers.size === 0, 'resource observers disconnected');
    assert(auditOutputs.length === 1 && JSON.stringify(auditOutputs[0]) === JSON.stringify(win.stove100), 'one complete JSON diagnostic is printed for copy and collection');
    assert(!doc.querySelector('[role="status"]') && !win.stove100.waitingForPopup, 'recovery panel and waiting status removed');
    assert(!win.stove100.waitingForFocus, 'foreground waiting status removed');
    if (!options.closeFail) assert(windows.every(p => p.closed), 'owned windows closed');
    assert(!calls.some(x => ['done','post-done','post-copy','choice2',...(!options.excludedClaim?['excluded']:[])].includes(x.name)), 'excluded/completed/duplicate/other option must not be clicked');
    assert(summaries.length === (win.stove100.failures.length ? 1 : 0), 'failure table printed once at the end');
    if (summaries.length) assert(JSON.stringify(summaries[0]) === JSON.stringify(win.stove100.failures), 'printed summary matches stored failures');
    return { calls, state: win.stove100, windows, elapsedMs: clock };
  }
  const count = (r, name) => r.calls.filter(x => x.name === name).length;
  let r = await run();
  assert(r.state.version === 'v5.7-github-updates' && r.state.status === 'complete', 'response-driven run completes: '+JSON.stringify(r.state));
  assert(r.state.failures.length === 0, 'successful items excluded from failure log');
  for (const name of ['a','claim:a','b','claim:b','post','choice','submit']) assert(count(r,name) === 1, 'exactly once: ' + name);
  assert(r.state.pending.length === 0 && r.state.missionResults.length === 4 && r.state.missionResults.every(x=>x.received), 'each reward confirmed');
  assert(r.state.popupOpened === 4 && r.state.popupClosed === 4, 'per-mission windows tracked');
  const closes = r.calls.filter(x => x.name === 'close:a');
  assert(closes.length === 2, 'individual window closure');
  for (const [left,right] of [['response:a:visit','claim:a'],['response:a:claim','b'],['response:b:visit','claim:b'],['response:b:claim','post']]) {
    assert(r.calls.findIndex(x=>x.name===right) > r.calls.findIndex(x=>x.name===left), 'response order: ' + left + ' -> ' + right);
  }
  assert(r.calls.find(x=>x.name==='b').at - r.calls.find(x=>x.name==='a').at < 1000, 'fast responses have no fixed four-second delay');
  r = await run({startPath:'/ko'}); assert(count(r,'capsule')===1 && count(r,'claim:a')===1, 'start from mission tab');
  r = await run({startPath:'/ko/shop'}); assert(count(r,'capsule')===1 && count(r,'claim:b')===1, 'start from shop tab');
  r = await run({selected:true}); assert(count(r,'choice')===0 && count(r,'submit')===1, 'preserve survey selection');
  r = await run({checkbox:true}); assert(count(r,'choice')===1 && count(r,'submit')===1, 'checkbox with replaced DOM');
  r = await run({popupNull:true}); assert(r.state.status==='complete' && r.state.untrackedPopups===4, 'untracked popup reported');
  assert(r.state.failures.length===3 && r.state.failures.every(failure=>failure.단계==='새 창 닫기'), 'popup warnings summarized and deduplicated per mission');
  r = await run({stop:true}); assert(r.state.status==='stopped' && !count(r,'b') && !count(r,'claim:a'), 'stop before claim');
  r = await run({changePage:true}); assert(r.state.status==='error' && !count(r,'b'), 'page guard');
  r = await run({duplicate:true}); assert(count(r,'a')===1 && count(r,'claim:a')===1, 'duplicate run guard');
  r = await run({rerender:true}); assert(count(r,'a')===1 && count(r,'claim:a')===1 && !r.state.pending.length, 'reacquire refreshed cards');
  r = await run({allDone:true}); assert(r.state.missionResults.length===0, 'all completed skip');
  r = await run({excludedClaim:true}); assert(count(r,'excluded')===1 && r.state.missionResults.some(x=>x.label.includes('경품')&&x.received), 'ready prize reward is claimed without entry');
  r = await run({lateEnable:true}); assert(count(r,'a')===1 && count(r,'claim:a')===1, 'wait for enabled fresh button');
  r = await run({claimOnly:true}); assert(!count(r,'a') && count(r,'claim:a')===1, 'already receivable claim without visit');
  r = await run({noReward:true}); assert(r.state.status==='partial' && r.state.pending.includes('첫미션') && count(r,'b')===1 && !count(r,'claim:a'), 'unmet mission reported without false receipt');
  assert(r.state.failures.length===1 && r.state.failures[0].서버코드===6020 && /조건 미충족/.test(r.state.failures[0].사유), 'condition failure includes server response code');
  r = await run({delayedClaim:true}); assert(count(r,'claim:b')===1 && !r.state.pending.length && r.calls.findIndex(x=>x.name==='post') > r.calls.findIndex(x=>x.name==='claim:b'), 'slow response awaited before next mission');
  r = await run({closeFail:true}); assert(r.state.status==='error' && !count(r,'claim:a') && !count(r,'b'), 'do not advance if window cannot close');
  r = await run({excludedVariant:true}); assert(!count(r,'excluded'), 'exclusion handles split title, whitespace, zero-width and leading reward paragraph');
  r = await run({visitDelay:6500}); assert(count(r,'claim:a')===1 && r.calls.find(x=>x.name==='claim:a').at >= 6500, 'wait for slow visit response');
  r = await run({claimDelay:6800}); assert(count(r,'b')===1 && r.calls.find(x=>x.name==='b').at > 6800, 'wait for slow receipt response');
  r = await run({noResponse:true}); assert(r.state.status==='partial' && !count(r,'claim:a') && count(r,'a')===1 && count(r,'b')===1, 'exhausted retries continue without repeating an ambiguous request');
  assert(r.state.failures.length===1 && r.state.missionResults[0].retries.length===2 && /응답 대기 시간 초과/.test(r.state.failures[0].사유), 'exhausted timeout and both retries retained');
  r = await run({latePost:true}); assert(r.state.status==='complete' && count(r,'post')===1 && r.state.missionResults.find(item=>item.kind==='post').retries.length===1, 'late post response recovers without duplicate click');
  r = await run({reopenPost:true}); assert(r.state.status==='complete' && count(r,'post')===2 && r.state.missionResults.find(item=>item.kind==='post').retries[0].reopened, 'post link reopens after a confirmed refresh when no request was sent');
  r = await run({manual:true}); assert(r.state.status==='partial' && r.state.missionResults[0].status==='manual' && !count(r,'claim:a'), 'app-only destination reported without false claim');
  assert(r.state.failures.length===1 && /앱에서 실제 참여/.test(r.state.failures[0].사유), 'app-required reason in final summary');
  r = await run({chatOpen:true}); assert(r.state.status==='complete' && count(r,'toggle-chat')===1 && count(r,'claim:a')===1, 'expanded chat collapsed once before click');
  r = await run({withChat:true}); assert(r.state.status==='complete' && !count(r,'toggle-chat'), 'collapsed chat stays collapsed');
  r = await run({permanentOverlay:true}); assert(r.state.status==='error' && r.state.responses.length===0 && !count(r,'a') && r.elapsedMs<=10000 && /버튼을 누르지 못/.test(r.state.error), 'click failure does not enter thirty-second response wait');
  assert(r.state.pending.includes('첫미션') && r.state.pending.includes('두번째미션'), 'unprocessed missions preserved after error');
  r = await run({loadingRace:true}); assert(r.state.status==='complete' && !count(r,'early-weekly') && count(r,'a')===1 && r.calls.findIndex(x=>x.name==='weekly')>r.calls.findIndex(x=>x.name==='claim:b'), 'daily section loads before weekly selection');
  r = await run({partialDaily:true}); assert(r.state.status==='complete' && !count(r,'early-daily') && !count(r,'early-weekly') && count(r,'a')===1, 'daily counter prevents partial list readiness');
  r = await run({h5Flow:true,serverReady:true});
  assert(r.state.status==='complete' && count(r,'a')===1 && count(r,'b')===1 && count(r,'refresh')===2 && !count(r,'resume'), 'untracked H5 visits reconcile server state without re-clicking either mission');
  assert(count(r,'claim:a')===1 && count(r,'claim:b')===1 && r.state.popupClosed===0, 'claim sequentially without inventing closed popup handles');
  r = await run({h5Flow:true,serverReady:true,closedReference:true});
  assert(r.state.status==='complete' && r.state.untrackedPopups>=2 && !count(r,'resume'), 'closed COOP-style references reconcile without false closure counts');
  r = await run({h5Flow:true,serverReady:true,closingBetweenChecks:true});
  assert(r.state.status==='complete' && count(r,'refresh')===2 && count(r,'a')===1 && count(r,'b')===1 && !count(r,'resume') && r.state.popupClosed===0, 'handle lost between wrapper and site checks still reconciles without replay or false close counts');
  r = await run({h5Flow:true});
  assert(r.state.status==='complete' && count(r,'resume')===2 && count(r,'a')===2 && count(r,'b')===2, 'real blocked H5 early return recovered through synchronous user click');
  for(const id of ['a','b']) assert(count(r,'response:'+id+':visit')===1 && count(r,'claim:'+id)===1, 'recovery never duplicates server participation or receipt: '+id);
  r = await run({h5Flow:true,stopRecovery:true});
  assert(r.state.status==='stopped' && !count(r,'claim:a') && !count(r,'b'), 'stop during popup recovery cleans hooks and does not advance');
  r = await run({h5Flow:true,recoveryBlocked:true});
  assert(r.state.status==='error' && /直接|직접 클릭한 뒤에도/.test(r.state.error) && count(r,'resume')===1 && !count(r,'claim:a') && !count(r,'b'), 'persistent popup denial gives precise failure, no retry loop or false claim');
  r = await run({h5Flow:true,refreshNeverFinishes:true});
  assert(r.state.status==='error' && /미션 상태 재조회/.test(r.state.error) && !count(r,'resume') && !count(r,'b'), 'failed refresh cannot authorize visit retry');
  r = await run({h5Flow:true,noRefresh:true});
  assert(r.state.status==='partial' && !count(r,'resume') && count(r,'a')===1 && count(r,'b')===1, 'missing refresh control skips uncertain visits after retries without replay');
  r = await run({popupNull:true,noopener:true,visitDelay:19000});
  assert(r.state.status==='complete' && count(r,'a')===1 && !count(r,'refresh') && !count(r,'resume'), 'noopener null retains original response and waits for delayed server state');
  r = await run({h5Flow:true,refreshFastToggle:true});
  assert(r.state.status==='complete' && count(r,'resume')===2 && count(r,'claim:a')===1 && count(r,'claim:b')===1, 'disabled true/false within one task is observed before 150ms polling');
  r = await run({h5Flow:true,refreshFastReplace:true});
  assert(r.state.status==='complete' && count(r,'resume')===2 && count(r,'refresh')===2, 'refresh button replacement and 1ms completion do not time out');
  r = await run({h5Flow:true,refreshNoDOM:true});
  assert(r.state.status==='complete' && count(r,'resume')===2 && count(r,'claim:b')===1, 'refresh response with unchanged DOM must resume instead of timing out');
  assert(r.state.refreshChecks.length===2 && r.state.refreshChecks.every(check=>check.status==='complete' && check.responses.some(response=>response.path.endsWith('/mission/component'))), 'refresh response evidence retained in final JSON');
  r = await run({h5Flow:true,refreshNoDOM:true,refreshSavedFetch:true,resourceUnknownStatus:true});
  assert(r.state.status==='complete' && r.state.refreshChecks.every(check=>check.responses.every(response=>response.source==='resource' && response.status===0)), 'captured native fetch still observed without pretending unknown HTTP status is 200');
  r = await run({h5Flow:true,firstVisitWorks:true,refreshNoDOM:true,refreshSavedFetch:true});
  assert(r.state.status==='complete' && count(r,'a')===1 && count(r,'b')===2 && count(r,'resume')===1 && count(r,'claim:a')===1 && count(r,'claim:b')===1, 'reported sequence: first visit succeeds, second blocked visit recovers and claims only once');
  r = await run({h5Flow:true,refreshNoDOM:true,refreshOnlyPage:true});
  assert(r.state.status==='error' && !count(r,'resume') && r.state.refreshChecks[0].responses.every(response=>response.path.endsWith('/page')), 'page-shell response alone cannot authorize current mission retry');
  r = await run({h5Flow:true,refreshNoDOM:true,refreshOtherComponent:true});
  assert(r.state.status==='error' && !count(r,'resume') && r.state.refreshChecks[0].component==='101', 'unrelated component response cannot authorize current mission retry');
  r = await run({h5Flow:true,refreshNoDOM:true,refreshHTTPError:true});
  assert(r.state.status==='error' && /서버\/네트워크 오류/.test(r.state.error) && !count(r,'resume') && !count(r,'claim:a'), 'failed refresh response stops immediately with server evidence');
  r = await run({h5Flow:true,refreshNoDOM:true,refreshDelay:6500});
  assert(r.state.status==='complete' && r.calls.find(x=>x.name==='resume').at>=6500, 'slow refresh waits for completed request rather than button state or a fixed delay');
  r = await run({h5Flow:true,refreshNoDOM:true,refreshSavedFetch:true,refreshStaleOnly:true});
  assert(r.state.status==='error' && !count(r,'resume') && r.state.refreshChecks[0].responses.length===0, 'resource request started before refresh cannot release the wait');
  r = await run({h5Flow:true,refreshNoDOM:true,refreshOtherOrigin:true});
  assert(r.state.status==='error' && !count(r,'resume') && r.state.refreshChecks[0].responses.length===0, 'same path on an unrelated origin cannot release the wait');
  r = await run({backgroundPopup:true,focusDenied:true,throttleBackground:true});
  assert(r.state.status==='complete' && count(r,'claim:a')===1 && count(r,'claim:b')===1 && r.elapsedMs<30000, 'background response must close owned tabs before throttled polling times out');
  assert(r.state.popupClosed===4 && r.state.focusWaitMs>0, 'tracked background windows close after responses and before claims');
  r = await run({backgroundPopup:true,throttleBackground:true});
  assert(r.state.status==='complete' && r.elapsedMs<30000 && count(r,'claim:a')===1, 'immediate focus request accepted without blocking ordinary mission flow');
  r = await run({backgroundPopup:true,popupNull:true,focusDenied:true,throttleBackground:true,returnAfter:45000});
  assert(r.state.status==='complete' && r.state.focusWaitMs>=45000 && r.calls.find(x=>x.name==='claim:a').at>=45000 && !r.state.error, 'untracked tab pauses timeout and claims only after real visibility returns');
  r = await run({backgroundPopup:true,focusDenied:true,stayHiddenAfterClose:true,throttleBackground:true,returnAfter:45000});
  assert(r.state.status==='complete' && r.state.popupClosed===4 && r.state.focusWaitMs>=45000, 'closing a child does not falsely imply the original tab became visible');
  r = await run({backgroundPopup:true,popupNull:true,focusDenied:true,throttleBackground:true,stop:true});
  assert(r.state.status==='stopped' && !count(r,'claim:a') && !count(r,'b') && r.elapsedMs<30000, 'stop wakes background focus wait immediately and clears waiting state');
  r = await run({backgroundClaim:true,focusDenied:true,throttleBackground:true,returnAfter:45000});
  assert(r.state.status==='complete' && count(r,'claim:a')===1 && r.calls.find(x=>x.name==='b').at>=45000, 'focus lost during claim response cannot expire timeout or advance while hidden');
  r = await run({backgroundPopup:true,focusDenied:true,throttleBackground:true,visitSavedFetch:true});
  assert(r.state.status==='complete' && r.state.popupClosed===4 && r.elapsedMs<30000, 'saved native fetch resource callback closes tabs without waiting for throttled timer');
  r = await run({backgroundPopup:true,focusThrows:true,throttleBackground:true});
  assert(r.state.status==='complete' && r.state.focusRequestError==='focus request denied', 'focus request rejection is recorded and real child closure still resumes safely');
  r = await run({h5Flow:true,serverReady:true,backgroundRefresh:true,focusDenied:true,throttleBackground:true,returnAfter:45000});
  assert(r.state.status==='complete' && r.state.focusWaitMs>=90000 && count(r,'claim:a')===1 && count(r,'claim:b')===1 && !count(r,'resume'), 'focus pause during nested refresh also extends the outer mission deadline without replay');
  r = await run({backgroundPopup:true,manual:true,focusDenied:true,throttleBackground:true});
  assert(r.state.status==='partial' && r.state.missionResults[0].status==='manual' && !count(r,'claim:a') && count(r,'claim:b')===1, 'app-only popup closes before focus wait even without a participation response');
  r = await run({backgroundPopup:true,noResponse:true,focusDenied:true,throttleBackground:true});
  assert(r.state.status==='error' && /서버 응답도 확인되지/.test(r.state.error) && !count(r,'claim:a') && !count(r,'b'), 'a genuine missing server response still stops and closes owned tabs while hidden');
  r = await run({h5Flow:true,backgroundRefresh:true,focusDenied:true,throttleBackground:true,refreshHTTPError:true});
  assert(r.state.status==='error' && /서버\/네트워크 오류/.test(r.state.error) && r.elapsedMs<30000 && !count(r,'resume'), 'known refresh error wakes and stops focus wait without a user return');
  return 'PASS: 59 browser response/DOM scenarios; background timer throttling, immediate response closure, real visibility return, nested refresh, cancellation and failure handling verified.';
}

if (typeof module !== 'undefined' && require.main === module) {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'stove-100.js'), 'utf8');
  const html = '<!doctype html><meta charset="utf-8"><title>STOVE snippet tests</title><pre id="result">RUNNING</pre><script>' +
    testStoveMissions.toString() + '\n' +
    'testStoveMissions(' + JSON.stringify(source).replace(/</g, '\\u003c') + ')' +
    '.then(r => { document.getElementById("result").textContent = r; document.title = "PASS"; })' +
    '.catch(e => { document.getElementById("result").textContent = e.stack; document.title = "FAIL"; });</script>';
  fs.writeFileSync(path.join(__dirname, 'stove-100.missions.test.html'), html);
  console.log('Created stove-100.missions.test.html; open in a browser to run isolated DOM tests.');
}
