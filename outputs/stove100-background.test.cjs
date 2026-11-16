const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require('playwright');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(options) {
  window.audit = []; window.fixtureFrames = 0;
  function frame() { window.fixtureFrames++; requestAnimationFrame(frame); } requestAnimationFrame(frame);
  let draws = options.draws ?? 28;
  const states = Object.fromEntries(['a','b','post','banner1','banner2','survey','miniReady'].map(id=>[id,options.done?'done':'go']));
  const selected = new Set(options.selected ? [1] : []);
  const note = name => window.audit.push({ name, at: performance.now(), focus: document.hasFocus(), visibility: document.visibilityState });
  document.body.innerHTML = '<nav><button id="missions">미션</button><button id="draws">캡슐 뽑기</button></nav><span class="whitespace-nowrap block overflow-ellipsis">9,999</span><main></main>';
  const main = document.querySelector('main');
  async function participate(id, stage) {
    note(id + ':' + stage);
    const result = await fetch('https://api.onstove.com/flake-shop/v1/mission/participate', { method: 'POST', body: JSON.stringify({id, stage}) });
    await result.json(); note(id + ':' + stage + ':response');
    if (!result.ok) return;
    const update = () => { states[id] = stage === 'visit' && !['banner1','banner2','survey'].includes(id) ? 'claim' : 'done'; renderMissions(); };
    if (document.hasFocus()) update(); else window.addEventListener('focus', update, {once:true});
  }
  function renderMissions() {
    history.replaceState(null, '', '/ko');
    const card = (id, label) => '<div class="stds-box" data-id="' + id + '"><p class="text-xl">' + label + '</p>' +
      (states[id] === 'done' && options.done ? '<span class="flakeshop-mission-badge-receive_complete">수령 완료</span>' :
        '<button>' + ({go:'미션하기', claim:'받기',done:'받기 완료'}[states[id]]) + '</button>') + '</div>';
    main.innerHTML = '<section id="mission-widget-1"><h2>데일리 미션</h2><span>0 / 3 데일리 미션 달성</span>' + card('a', '첫번째 방문') + card('b','두번째 방문') + '<div class="stds-box"><p class="text-xl">경품 응모하기</p><button id="prize">미션하기</button></div></section>' +
      '<section><h2>인기 게시글 보고 플레이크 받기!</h2><div id="content-mission-swiper-1"><div class="stds-box" data-id="post"><p class="text-xl">게시글</p><a href="https://popup.test/post" target="_blank" rel="noopener noreferrer">게시글 보기</a><button ' + (states.post==='done'?'disabled':'') + '>' + (states.post==='done'?'받기 완료':states.post==='claim'?'받기':'준비 중') + '</button></div></div></section>';
    if (options.lower) {
      // Real single-post layout has a titled widget but no content-mission-swiper id.
      const content = document.getElementById('content-mission-swiper-1'); content.parentElement.id='mission-widget-post'; content.removeAttribute('id');
      content.querySelector('p').textContent='미니게임 플레이 후기와 경품 응모 이야기';
      main.insertAdjacentHTML('beforeend','<section id="mission-widget-survey"><h2>설문조사 참여하고 플레이크 받기!</h2><div class="stds-box"><p class="text-xl">설문 질문</p>'+[0,1,2].map(i=>'<button class="survey-item '+(selected.has(i)?'survey-item--active':'')+'" data-option="'+i+'">선택 '+i+'</button>').join('')+'<button id="survey-submit" '+(selected.size===(options.multi?2:1)?'':'disabled')+'>'+(states.survey==='done'?'100 플레이크 받기 완료':'설문 참여하고 100 플레이크 받기')+'</button></div></section>'+ '<section id="mission-widget-banner"><div id="mission-banner-swiper-9"><swiper-container>'+['banner1','banner2'].map(id=>'<swiper-slide><div class="stds-box" data-banner="'+id+'"><a href="https://popup.test/'+(id==='banner1'?'post':id)+'"></a><span>'+(states[id]==='done'?'100 플레이크 받기 완료':'클릭 시 100 플레이크')+'</span><p>'+id+'</p></div></swiper-slide>').join('')+'<div class="stds-box"><a id="mini-banner" href="https://popup.test/mini"></a><span>클릭 시 200 플레이크</span><p>별도 플레이 조건</p><p>앱 미니게임 플레이하기</p></div></div></section>');
      const source = document.getElementById('mission-widget-1');
      source.insertAdjacentHTML('beforeend','<div class="stds-box"><p class="text-xl">앱 미니게임 플레이하기</p><button id="mini">미션하기</button></div><div class="stds-box"><p class="text-xl">미니게임 플레이하기</p><button id="mini-claim" '+(states.miniReady==='done'?'disabled':'')+'> '+(states.miniReady==='done'?'받기 완료':'받기')+'</button></div><div class="stds-box"><p class="text-xl">매일 스토브 앱 로그인하기</p><button id="app-login">미션하기</button></div>');
      for(const id of ['mini','app-login','mini-banner']) document.getElementById(id).onclick=event=>{event.preventDefault();note('FORBIDDEN:'+id);};
      document.getElementById('mini-claim').onclick=()=>participate('miniReady','claim');
      for(const button of document.querySelectorAll('[data-option]')) button.onclick=()=>{const i=Number(button.dataset.option);note('select:'+i);selected.has(i)?selected.delete(i):selected.add(i);renderMissions();};
      document.getElementById('survey-submit').onclick=()=>participate('survey','visit');
      const swiper=document.querySelector('swiper-container');
      const revealSlide=index=>{[...swiper.children].forEach((slide,i)=>{slide.style.position=i===index?'relative':'absolute';slide.style.left=i===index?'0':'-9000px';});};
      swiper.swiper={slideTo:revealSlide}; revealSlide(0);
      for(const card of document.querySelectorAll('[data-banner]')) {
        card.style.minHeight='90px';card.querySelector('a').style.cssText='position:absolute;inset:0';
        card.onclick=async event=>{event.preventDefault();const id=card.dataset.banner;await participate(id,'visit');window.open('https://popup.test/'+id,'_blank','noopener,noreferrer');};
      }
    }
    document.getElementById('prize').onclick = () => { note('FORBIDDEN:prize'); };
    for (const id of ['a','b','post']) {
      const card = main.querySelector('[data-id="'+id+'"]');
      if (!card.querySelector('button')) continue;
      card.querySelector('button').onclick = () => {
        if (states[id] === 'claim') return participate(id,'claim');
        if (states[id] !== 'go' || id === 'post') return;
        note(id + ':activation:' + navigator.userActivation.isActive);
        const popup = window.open('https://popup.test/' + id, id === 'a' ? 'mission-game' : '_blank', id === 'a' ? 'width=540,height=600' : 'noopener,noreferrer');
        if (id === 'a' && (!popup || popup.closed)) { note('BLOCKED'); return; }
        participate(id, 'visit');
      };
      if(id==='post') card.querySelector('a').addEventListener('click', () => participate(id,'visit'));
    }
  }
  function renderDraws() {
    history.replaceState(null,'','/ko/event');
    main.innerHTML = '<div class="stds-box"><span>오늘 뽑기</span><b>' + draws + '/30회</b></div><button id="draw100">100 뽑기</button><button id="draw1000">1,000 뽑기</button>';
    if (options.milestones) {
      main.insertAdjacentHTML('beforeend','<article class="grid-area-item2"><button id="extra1">2,000 플레이크 받기</button><button id="extra2">5,000 플레이크 받기</button><button id="extra3" disabled><i class="ic-v2-control-check-line"></i>플레이크 받기 완료</button></article><button id="unrelated">10,000 플레이크 받기</button>');
      document.getElementById('unrelated').onclick = () => note('FORBIDDEN:unrelated reward');
      for (const id of ['extra1','extra2']) document.getElementById(id).onclick = event => {
        const button = event.currentTarget;
        note(id + ':claim');
        for (const target of main.querySelectorAll('.grid-area-item2 button')) target.disabled = true;
        setTimeout(() => {
          if (id === 'extra1') button.innerHTML = '<i class="ic-v2-control-check-line"></i>수령 완료';
          const alert = document.createElement('div');
          alert.setAttribute('role','alertdialog');
          alert.innerHTML = '<p>' + (id === 'extra1' ? '2,000 플레이크가 지급되었습니다.' : '이미 수령한 보상입니다.') + '</p><button>확인</button>';
          alert.querySelector('button').onclick = () => { note(id + ':confirm'); alert.remove(); };
          document.body.append(alert);
          if (id === 'extra1') setTimeout(() => { document.getElementById('extra2').disabled = false; }, 350);
        }, 50);
      };
    }
    document.getElementById('draw1000').onclick = () => note('FORBIDDEN:1000');
    document.getElementById('draw100').onclick = event => {
      event.target.disabled = true; note('draw');
      let left = 10;
      function animate() {
        if (--left) return requestAnimationFrame(animate);
        draws++; note('draw:confirmed'); renderDraws();
        if (options.milestones && draws === 30) {
          main.insertAdjacentHTML('beforeend','<div id="stds-gift-dialog-overview"><div class="stds-dialog-panel"><p>캡슐 뽑기 결과</p><button>닫기</button></div></div>');
          const result = document.getElementById('stds-gift-dialog-overview');
          result.querySelector('button').onclick = () => { note('draw-result:close'); result.remove(); };
        }
      }
      requestAnimationFrame(animate);
    };
  }
  document.getElementById('draws').onclick = () => { note('screen:draws'); renderDraws(); };
  document.getElementById('missions').onclick = () => { note('screen:missions'); renderMissions(); };
  renderMissions();
}
async function until(read, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await delay(100); }
  throw new Error('Timeout: ' + label);
}
(async () => {
  const extensionPath = path.join(__dirname, 'stove100-background');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fullauto100-test-'));
  const downloads = path.join(profile,'downloads');
  fs.mkdirSync(path.join(profile,'Default'));
  fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({download:{default_directory:downloads,prompt_for_download:false}}));
  const child = require('node:child_process').spawn(chromium.executablePath(), [
    '--remote-debugging-port=0', '--user-data-dir='+profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions-except='+extensionPath, '--load-extension='+extensionPath, 'about:blank'
  ], {windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint = await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error('Test browser launch timed out')),20000);
    child.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.once('error',reject);
  });
  // No automation defaults: preserve real popup blocking, background throttling and native visibility.
  const browser = await chromium.connectOverCDP(endpoint,{noDefaults:true});
  const context = browser.contexts()[0];
  const report = { date: new Date().toISOString().slice(0,10), browser: context.browser()?.version(), results: [], profile, realAccountRequests: 0 };
  try {
    const worker = await until(async () => {
      for (const w of context.serviceWorkers()) if (w.url().endsWith('/background.js') && await w.evaluate(()=>chrome.runtime.getManifest().name) === 'FullAuto100 백그라운드 실행') return w;
    }, 'FullAuto100 worker');
    let options = {}, requests = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      if (url.hostname === 'reward.onstove.com') return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{font:16px Arial}button,a{display:inline-block;padding:16px;margin:10px}.stds-box{padding:12px}nav{position:sticky;top:0;background:white}</style><script>window.onload=()=>('+fixture.toString()+')('+JSON.stringify(options)+')</script>'});
      if (url.hostname === 'api.onstove.com') {
        const body = JSON.parse(route.request().postData()); requests.push(body);
        await delay(options.slow ? 2500 : 180);
        if (options.alreadyClaimed && body.id === 'a' && body.stage === 'claim') {
          return route.fulfill({status:409,contentType:'application/json',body:'{"code":6015}'});
        }
        return route.fulfill({ status: options.error && body.id === 'a' || options.bannerError && body.id === 'banner1' ? 500 : 200, contentType:'application/json',body:'{"code":0}'});
      }
      if (url.hostname === 'popup.test') return route.fulfill({contentType:'text/html',body:'<title>Owned fixture popup</title>'});
      return route.abort();
    });
    const page = await context.newPage();
    const control = await context.newPage(); await control.goto('about:blank');
    const pageCDP = await context.newCDPSession(page);
    const windowInfo = await pageCDP.send('Browser.getWindowForTarget');
    const minimize = () => pageCDP.send('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'minimized'}});
    const restore = () => pageCDP.send('Browser.setWindowBounds',{windowId:windowInfo.windowId,bounds:{windowState:'normal'}});
    const start = async () => worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({url:'https://reward.onstove.com/*'});
      if (tabs.length !== 1) throw new Error('fixture source tab is not unique: '+JSON.stringify({tabs:await chrome.tabs.query({}),permissions:await chrome.permissions.getAll(),manifest:chrome.runtime.getManifest()}));
      return start(tabs[0].id);
    });
    const complete = () => until(() => worker.evaluate(async () => {
      const r = (await chrome.storage.local.get('lastRun')).lastRun;
      return !session && r && !r.running ? r : null;
    }), 'extension final report');
    const completionPage = () => context.pages().find(p => p.url().endsWith('/popup.html?complete'));
    const closeCompletion = async () => {
      const popup = await until(completionPage, 'completion window');
      await popup.getByRole('heading', { name: '오늘 자동 처리가 끝났습니다' }).waitFor();
      const win = await worker.evaluate(async () => (await chrome.windows.getAll({populate:true})).find(w =>
        w.tabs.some(tab => tab.url === chrome.runtime.getURL('popup.html?complete'))));
      assert.equal(win?.type,'popup');
      assert.notEqual(win.state,'minimized');
      try {
        await popup.getByRole('button', { name: '닫기' }).press('Enter',{timeout:5000});
      } catch (error) {
        // The window can close on keydown before Playwright sends keyup.
        if (!/Target page, context or browser has been closed/.test(error.message)) throw error;
      }
      await until(() => popup.isClosed(), 'completion window closed');
    };
    for (const scenario of [
      {name:'minimized draws + named popup + noopener tabs',draws:28},
      {name:'other selected tab, completed draws',draws:30,otherTab:true},
      {name:'already received missions',draws:30,done:true},
      {name:'already received server response is a successful claim',draws:30,alreadyClaimed:true},
      {name:'close final draw result and collect eligible milestones once',draws:29,done:true,milestones:true},
      {name:'server error stops without repeat',draws:30,error:true},
      {name:'stop while request pending',draws:30,slow:true,stop:true},
      {name:'debugger detach stops without next request',draws:30,slow:true,detach:true},
      {name:'page reload does not replay an action',draws:30,slow:true,reload:true},
      {name:'lower single post + survey + offscreen banners + conditional exclusions',draws:30,lower:true},
      {name:'lower rewards already received are skipped',draws:30,lower:true,done:true},
      {name:'survey preserves existing selection and fills required count',draws:30,lower:true,selected:true,multi:true},
      {name:'banner response failure is logged without claiming success or clicking next banner',draws:30,lower:true,bannerError:true}
    ].filter(()=>!process.env.STOVE_AUTO_ONLY)) {
      options = scenario; requests=[]; await restore();
      await page.goto('https://reward.onstove.com/ko');
      // Playwright enables focus emulation itself; disable it so only our extension can restore it.
      await pageCDP.send('Emulation.setFocusEmulationEnabled',{enabled:false});
      await control.bringToFront();
      if (!scenario.otherTab) await minimize();
      if (report.results.length===0) {
        const framesBefore = await page.evaluate(()=>fixtureFrames);
        await delay(1200);
        const delta = await page.evaluate(()=>fixtureFrames)-framesBefore;
        report.baselineState = await page.evaluate(()=>({visibility:document.visibilityState,focus:document.hasFocus()}));
        report.baselineBounds = (await pageCDP.send('Browser.getWindowBounds',{windowId:windowInfo.windowId})).bounds;
        if (report.baselineState.visibility === 'hidden') {
          assert(delta<=2, 'without emulation, hidden requestAnimationFrame must stop: '+delta+' '+JSON.stringify(report));
        } else {
          report.baselineUnavailable = 'Host reports the minimized fixture visible; native hidden-frame baseline is unavailable.';
          console.log('NOTE:',report.baselineUnavailable);
        }
        report.baselineHiddenFrames = delta;
      }
      await start();
      if (scenario.stop) {
        await until(()=>requests.length,'first request');
        await worker.evaluate(()=>evaluate(session,'window.stove100.stop()'));
      }
      if (scenario.detach || scenario.reload) {
        await until(()=>requests.length,'first request');
        if(scenario.detach) await worker.evaluate(()=>chrome.debugger.detach({tabId:session.tabId}));
        else await page.reload();
      }
      const result = await complete();
      if (result.status === 'complete') await closeCompletion();
      else assert.equal(completionPage(),undefined,'unsuccessful runs do not show a completion window');
      const audit = await page.evaluate(()=>audit);
      assert(!audit.some(a=>a.name.startsWith('FORBIDDEN')), 'excluded and 1000-flake actions untouched');
      assert(!audit.some(a=>a.name==='BLOCKED'), 'each mission click has a fresh user gesture');
      assert(!result.waitingForFocus && !result.waitingForPopup, 'no foreground or user-gesture wait');
      assert.equal(context.pages().filter(p=>p.url().startsWith('https://popup.test')).length,0,'owned tabs all closed');
      assert.equal(result.extensionPopupsClosed,result.extensionPopupsOpened,'final log confirms every owned tab closure, including error and stop');
      assert(!control.isClosed(), 'unrelated tab preserved');
      assert.equal(new Set(requests.map(r=>r.id+':'+r.stage)).size,requests.length,'no duplicate participation');
      if(scenario.error || scenario.detach || scenario.reload) {
        assert.equal(result.status,'error'); assert.equal(requests.length,1);
        if(scenario.reload) assert.match(result.error,/다시 열려 연결이 끊겼습니다/);
      }
      else if(scenario.bannerError) {
        assert.equal(result.status,'error'); assert.equal(requests.length,9);
        assert(!requests.some(r=>r.id==='banner2'));
        assert(result.pending.includes('banner2'));
        assert(result.missionResults.some(r=>r.kind==='banner' && r.status==='error' && !r.received));
      }
      else if(scenario.stop) { assert.equal(result.status,'stopped'); assert.equal(requests.length,1); }
      else {
        assert.equal(result.status,'complete',JSON.stringify(result));
        assert.equal(result.completed,30-scenario.draws);
        assert.equal(result.missionsReady,true);
        assert(result.missionResults.every(record=>record.received),'all counted missions received');
        const firstDraw = audit.findIndex(a=>a.name==='screen:draws');
        assert(firstDraw>=0 && audit.slice(firstDraw+1).every(a=>!a.name.endsWith(':claim:response')), 'all claims precede the capsule stage');
        assert.equal(requests.length,scenario.done?0:scenario.lower?10:6);
        assert.equal(result.extensionPopupsOpened,scenario.done?0:scenario.lower?5:3);
        assert.equal(result.extensionPopupsClosed,scenario.done?0:scenario.lower?5:3);
        if (scenario.milestones) {
          assert.deepEqual(result.drawMilestones,{total:2,received:2});
          assert.deepEqual(audit.map(a=>a.name).filter(name=>name.startsWith('extra') || name==='draw-result:close'),
            ['draw-result:close','extra1:claim','extra1:confirm','extra2:claim','extra2:confirm']);
        }
        if(scenario.lower) {
          assert(result.skippedMissions.includes('앱미니게임플레이하기'));
          assert(result.skippedMissions.includes('매일스토브앱로그인하기'));
          assert(!audit.some(a=>a.name==='select:1'),'existing selected option is never toggled off');
          if(!scenario.done) {
            assert.equal(audit.filter(a=>a.name.startsWith('select:')).length,1);
            assert(requests.findIndex(r=>r.id==='banner1')>requests.findIndex(r=>r.id==='survey'));
            assert(requests.findIndex(r=>r.id==='banner2')>requests.findIndex(r=>r.id==='banner1'));
          }
        }
        assert(audit.every(a=>a.name==='screen:draws'||a.focus),'site updates see a focused page without activating Chrome');
      }
      if (!scenario.otherTab && scenario.done) assert.equal((await pageCDP.send('Browser.getWindowBounds',{windowId:windowInfo.windowId})).bounds.windowState,'minimized');
      report.results.push({name:scenario.name,status:result.status,draws:result.completed,requests:requests.length,opened:result.extensionPopupsOpened,closed:result.extensionPopupsClosed});
      console.log('PASS:',scenario.name);
    }
    options={draws:30,done:true};requests=[];
    // Each auto-open case starts with its own fixture state, independent of the prior deliberate server error.
    await page.goto('https://reward.onstove.com/ko');
    await control.bringToFront();
    const existingTabId=(await worker.evaluate(()=>chrome.tabs.query({url:'https://reward.onstove.com/*'})))[0].id;
    const fromOtherTab=()=>worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return start(tab.id);});
    await fromOtherTab();
    let automaticResult=await complete();
    await closeCompletion();
    assert.equal(automaticResult.tabId,existingTabId,'reuse existing reward page from another selected tab');
    assert.equal(automaticResult.status,'complete',JSON.stringify({state:automaticResult,dom:await page.evaluate(()=>({url:location.href,body:document.body.innerText.slice(0,1000)}))}));
    report.results.push({name:'start from another tab reuses the existing reward page',status:automaticResult.status});
    await page.close();await control.bringToFront();requests=[];
    // tabs.create can navigate before Playwright attaches its request mock. Hold only that first
    // navigation so the new tab runs the same isolated fixture, never the real reward service.
    await worker.evaluate(()=>{
      globalThis.nativeTestCreate=chrome.tabs.create;
      chrome.tabs.create=async properties=>{
        const tab=await nativeTestCreate({...properties,url:'about:blank'});
        return new Promise(resolve=>{globalThis.testCreation={properties,id:tab.id,resolve};});
      };
    });
    const newPageReady=context.waitForEvent('page');
    const creating=fromOtherTab();
    const createdPage=await newPageReady;
    await until(()=>worker.evaluate(()=>!!globalThis.testCreation),'tab creation intercepted');
    const requested=await worker.evaluate(()=>testCreation.properties);
    assert.equal(requested.url,'https://reward.onstove.com/ko');assert.equal(requested.active,false);
    await createdPage.goto(requested.url);
    await worker.evaluate(async()=>{chrome.tabs.create=nativeTestCreate;testCreation.resolve(await chrome.tabs.get(testCreation.id));});
    await creating;automaticResult=await complete();
    await closeCompletion();
    const automaticPage=context.pages().find(p=>p.url().startsWith('https://reward.onstove.com/'));
    assert.equal(automaticResult.status,'complete',JSON.stringify({state:automaticResult,dom:automaticPage && await automaticPage.evaluate(()=>({url:location.href,body:document.body.innerText.slice(0,1200),html:document.body.innerHTML.slice(0,1500)}))}));assert.equal(automaticResult.completed,0);assert.equal(requests.length,0);
    assert.equal(control.url(),'about:blank','unrelated selected page is preserved');
    assert.equal((await worker.evaluate(()=>chrome.tabs.query({url:'https://reward.onstove.com/*'}))).length,1,'only one reward tab is created');
    await worker.evaluate(()=>writeLogs());
    const history=JSON.parse(fs.readFileSync(path.join(downloads,'FullAuto100-logs','recent-runs.json'),'utf8')).runs;
    assert.equal(history.length,process.env.STOVE_AUTO_ONLY?2:5);
    assert.equal(history[0].status,'complete');
    assert(history[0].timeline.some(event=>event.step.phase==='opening'));
    report.results.push({name:'start without a reward page creates and loads it automatically',status:automaticResult.status});
    console.log('PASS: automatic reward page reuse and creation from unrelated tabs');
    await context.unrouteAll({behavior:'ignoreErrors'});
    for (const [file,title] of [['stove-100.missions.test.html','PASS'],['stove-100.audit-repro.html','FIXED']]) {
      await control.setContent(fs.readFileSync(path.join(__dirname,file),'utf8'));
      await until(async()=>['PASS','FAIL','FIXED','BUG'].includes(await control.title()),file);
      assert.equal(await control.title(),title,await control.locator('body').innerText());
      console.log('PASS:',file);
    }
    report.legacyScenarios=85;
    report.passed=true;
  } finally {
    await browser.close(); child.kill();
    fs.writeFileSync(path.join(__dirname,'stove100-background.result.json'),JSON.stringify(report,null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
