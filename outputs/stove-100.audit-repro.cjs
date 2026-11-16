// Regression derived from the live audit; isolated DOM, virtual time, no real requests.
const fs = require('node:fs');
const path = require('node:path');

async function reproduce(source) {
  const doc = document.implementation.createHTMLDocument('late daily / chat regression');
  Object.defineProperty(doc, 'visibilityState', { value: 'visible' });
  const location = { origin: 'https://reward.onstove.com', pathname: '/ko/event' };
  let clock = 0, pumping = false, steps = 0, clicked = 0, chatExpanded = true;
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const timers = [];
  const channel = new MessageChannel();
  const win = { open() { return { closed: false, close() { this.closed = true; } }; }, confirm: () => true, alert() {} };
  function timeout(fn, ms) {
    timers.push({ at: clock + ms, fn });
    if (!pumping) { pumping = true; channel.port2.postMessage(null); }
  }
  channel.port1.onmessage = () => {
    if (++steps > 5000) throw new Error('Fixture timer budget exceeded');
    timers.sort((a, b) => a.at - b.at);
    const next = timers.shift();
    if (next) { clock = next.at; next.fn(); }
    pumping = timers.length > 0;
    if (pumping) channel.port2.postMessage(null);
  };
  function prepare() {
    for (const el of doc.querySelectorAll('*')) {
      el.getClientRects = () => [{ left: 1000, top: 300, width: 80, height: 40 }];
      el.getBoundingClientRect = () => ({ left: 1000, top: 300, width: 80, height: 40 });
      el.scrollIntoView = () => { doc.fixtureTop = el; };
    }
    const header = doc.getElementById('chat-header'), content = doc.getElementById('chat-body');
    if (header) header.getBoundingClientRect = () => ({ height: 24 });
    if (content) content.getBoundingClientRect = () => ({ height: chatExpanded ? 500 : 22 });
    doc.elementFromPoint = () => chatExpanded ? content : doc.fixtureTop;
  }
  doc.body.innerHTML = '<div class="stds-box"><span>오늘 뽑기</span><span>30/30회</span></div><button id="missions">미션</button>';
  prepare();
  doc.getElementById('missions').onclick = () => {
    location.pathname = '/ko';
    doc.body.innerHTML = '<button id="capsule">캡슐 뽑기</button><main><section id="daily"><h1>데일리 미션 참여하고 매일 보상받기!</h1><p>0/1 데일리 미션 달성</p></section>' +
      '<section><h2>위클리 미션 참여하고 보상받기!</h2><div class="stds-box"><p class="text-xl">매일 스토브 앱 로그인하기</p><button id="weekly">미션하기</button></div></section>' +
      '<aside><div id="chat-header" class="flex items-center justify-between relative"><div id="toggle" class="absolute inset-0 cursor-pointer"></div><div><p>실시간 댓글</p></div></div><div id="chat-body">실시간 댓글 내용</div></aside></main>';
    prepare();
    doc.getElementById('capsule').onclick = () => {
      location.pathname = '/ko/event';
      doc.body.innerHTML = '<div class="stds-box"><span>오늘 뽑기</span><span>30/30회</span></div>';
      prepare();
    };
    doc.getElementById('toggle').onclick = () => { chatExpanded = false; };
    doc.getElementById('weekly').onclick = () => win.open('https://store.onstove.com/ko/stoveApp', '_blank');
    timeout(() => {
      doc.getElementById('daily').insertAdjacentHTML('beforeend', '<div class="stds-box"><p class="text-xl">용사단 키우기 방문하기</p><button id="daily-button">미션하기</button></div>');
      prepare();
      doc.getElementById('daily-button').onclick = event => { clicked++; event.target.textContent = '받기 완료'; };
    }, 150);
  };
  new Function('window','document','location','Date','setTimeout','console',source)(win,doc,location,{now:()=>clock},timeout,{
    log(message) { if (message === '실행 결과: window.stove100') finish(); }, warn() {}, error() {}, table() {}
  });
  await finished;
  channel.port1.close(); channel.port2.close();
  const state = win.stove100;
  if (clicked !== 1 || chatExpanded || state.status !== 'complete' || state.missionResults[0]?.label !== '용사단키우기방문하기' || !state.missionResults[0]?.received || !state.skippedMissions.includes('매일스토브앱로그인하기') || state.popupOpened !== 0) throw new Error('Audit regression still present: ' + JSON.stringify(state));
  return { fixed: true, version: state.version, elapsedVirtualMs: clock, dailyClicked: clicked, chatCollapsed: !chatExpanded, firstMission: state.missionResults[0].label, dailyReceived: state.missionResults[0].received, weeklyStatus: 'excluded', status: state.status, conclusion: 'Late daily cards are awaited, chat is collapsed, the daily reward is confirmed, and the app-login weekly mission is excluded without opening a popup.' };
}

const source = fs.readFileSync(path.join(__dirname, 'stove-100.js'), 'utf8');
const html = '<!doctype html><meta charset="utf-8"><title>Audit repro</title><pre id="result">RUNNING</pre><script>' +
  reproduce.toString() + '\nreproduce(' + JSON.stringify(source).replace(/</g, '\\u003c') + ')' +
  '.then(r=>{document.title="FIXED";document.getElementById("result").textContent=JSON.stringify(r,null,2)})' +
  '.catch(e=>{document.title="FAIL";document.getElementById("result").textContent=e.stack});</script>';
fs.writeFileSync(path.join(__dirname, 'stove-100.audit-repro.html'), html);
console.log('Created isolated audit reproduction. Production script unchanged.');
