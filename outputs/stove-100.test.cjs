// 실행: node stove-100.test.cjs (같은 폴더의 stove-100.js를 검사합니다.)
// 실제 사이트 접속이나 플레이크 차감 없이 모의 DOM으로 안전 조건을 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'stove-100.js'), 'utf8');

async function run({ initial = 0, frozen = false, disabled = false, funds = 62000,
  overlay = false, interrupted = false, duplicate = false, jump = false, missing = false,
  origin = 'https://reward.onstove.com', startPath = '/ko/event', counterDelay = 0,
  counterNever = false, duplicateCounter = false, dailyLimit = 30, decoyCount = false } = {}) {
  let done = initial, clock = 0, clicks = 0, wrongClicks = 0, repeats = 0, active;
  const rect = { left: 0, top: 0, width: 100, height: 50 };
  const element = label => ({
    innerText: label, isConnected: true, disabled,
    getClientRects: () => [rect], getBoundingClientRect: () => rect,
    getAttribute: () => null, contains: () => false, scrollIntoView() {}
  });
  const initialButton = element('100 뽑기');
  const repeatButton = element('100 뽑기 한번 더!');
  const expensive = element('1,000 뽑기');
  expensive.click = () => { wrongClicks++; };
  const click = () => { clicks++; if (!frozen) { done += jump ? 2 : 1; funds -= 90; } active = repeatButton; };
  initialButton.click = click;
  repeatButton.click = () => { repeats++; click(); };
  active = initialButton;
  let missions = startPath !== '/ko/event', counterReadyAt = counterDelay;
  const transitions = [], drawTimes = [], readyScreens = [];
  const completedCard = element('받기 완료');
  completedCard.closest = () => completedCard;
  completedCard.querySelector = selector => selector === 'img' ? null : element('완료한 미션');
  completedCard.querySelectorAll = () => [];
  const location = { origin, pathname: startPath };
  const tab = element('미션');
  tab.disabled = false;
  tab.click = () => { transitions.push('mission'); missions = true; location.pathname = '/ko'; };
  const capsuleTab = element('캡슐 뽑기');
  capsuleTab.disabled = false;
  capsuleTab.click = () => { transitions.push('capsule'); missions = false; location.pathname = '/ko/event'; counterReadyAt = clock + counterDelay; };
  const counterBox = { get innerText() { return '오늘 뽑기\n' + (!counterNever && clock >= counterReadyAt ? `${done}/${dailyLimit}회` : ''); } };
  const counterLabel = { ...element('오늘 뽑기'), parentElement: counterBox };
  const body = { get innerText() { return missing ? '로그인' : missions ? '데일리 미션' : decoyCount ? '실시간 댓글: 오늘 뽑기 30/30회' : counterBox.innerText; } };
  const dailySection = { parentElement: body, contains: el => el === dailyTitle || el === completedCard };
  const dailyTitle = { ...element('데일리 미션'), childElementCount: 0, parentElement: dailySection };
  const window = {};
  let released;
  const complete = new Promise(resolve => { released = resolve; });
  const context = vm.createContext({
    window, location,
    Date: { now: () => clock },
    setTimeout(resolve, ms) { clock += ms; if (interrupted) window.stove100.stop(); queueMicrotask(resolve); },
    console: {
      log(message) {
        if (message.startsWith('[화면 준비 완료] ')) readyScreens.push(message.slice(11));
        if (message === '실행 결과: window.stove100') released();
      },
      warn() {}, error() {}, table(rows) { assert.ok(rows.length > 0); }
    },
    document: {
      body,
      addEventListener() {}, removeEventListener() {},
      elementFromPoint: () => overlay ? null : active,
      querySelectorAll(selector) {
        if (selector === '.stds-box > span') return missions || missing ? [] : duplicateCounter ? [counterLabel, counterLabel] : [counterLabel];
        if (selector === 'h1,h2,h3,h4,p,span') return missions ? [dailyTitle] : [];
        if (selector === 'button,a,[role="tab"]') return [tab, capsuleTab];
        if (selector === 'button') return missions ? [completedCard] : active === initialButton
          ? [initialButton, expensive, tab] : [initialButton, expensive, repeatButton, tab];
        if (selector.startsWith('span.')) return [element(String(funds)), element('2,330')];
        return [];
      }
    }
  });
  const draw = initialButton.click;
  initialButton.click = () => { drawTimes.push({ at: clock, readyAt: counterReadyAt }); draw(); };
  const repeat = repeatButton.click;
  repeatButton.click = () => { drawTimes.push({ at: clock, readyAt: counterReadyAt }); repeat(); };
  vm.runInContext(source, context);
  if (duplicate) vm.runInContext(source, context);
  if (origin === 'https://reward.onstove.com') await complete;
  assert.equal(wrongClicks, 0, '1,000 뽑기를 누르면 안 됩니다.');
  return { done, clicks, repeats, state: window.stove100, transitions, drawTimes, readyScreens, elapsedMs: clock };
}

module.exports = { run };
if (require.main === module) (async () => {
  let r = await run();
  assert.equal(r.clicks, 30); assert.equal(r.repeats, 29); assert.equal(r.done, 30);
  assert.equal(r.state.status, 'complete');
  r = await run({ initial: 7 });
  assert.equal(r.clicks, 23); assert.equal(r.state.completed, 23); assert.equal(r.done, 30);
  r = await run({ initial: 29 }); assert.equal(r.clicks, 1);
  r = await run({ initial: 30 }); assert.equal(r.clicks, 0);
  r = await run({ frozen: true }); assert.equal(r.clicks, 1); assert.equal(r.state.completed, 0); assert.equal(r.state.status, 'error');
  assert.equal(r.state.failures.length, 1); assert.equal(r.state.failures[0].미션, '캡슐 뽑기');
  assert.match(r.state.failures[0].사유, /대기 시간 초과/);
  r = await run({ disabled: true }); assert.equal(r.clicks, 0);
  r = await run({ funds: 99 }); assert.equal(r.clicks, 0);
  r = await run({ overlay: true }); assert.equal(r.clicks, 0);
  r = await run({ interrupted: true }); assert.equal(r.clicks, 0); assert.equal(r.state.status, 'stopped');
  r = await run({ duplicate: true }); assert.equal(r.clicks, 30);
  r = await run({ jump: true }); assert.equal(r.clicks, 1); assert.equal(r.state.status, 'error');
  r = await run({ missing: true }); assert.equal(r.clicks, 0);
  r = await run({ origin: 'https://example.com' }); assert.equal(r.clicks, 0);
  console.log('PASS: 13 scenarios; 30/23/1/0 draws, repeat button, no 31st draw, no 1,000 draw, timeout, disabled, balance, overlay, stop, duplicate, count conflict, missing counter, wrong site.');
})().catch(error => { console.error(error); process.exitCode = 1; });
