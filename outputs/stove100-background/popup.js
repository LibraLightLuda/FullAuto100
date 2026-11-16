'use strict';
const get = id => document.getElementById(id);
const start = get('start'), stop = get('stop'), option = get('enter-stove-points');
const status = get('status'), notice = get('notice');
let busy = false, commandError = '';
let updateAvailable = false;
const labels = { running: '진행 중', complete: '완료 ✓', partial: '일부 미완료', stopped: '중지됨', interrupted: '실행 끊김', error: '오류' };

function progress(id, done, total, note, active, unit) {
  const bar = get(id + '-bar');
  bar.max = Math.max(1, total ?? 0);
  bar.value = total == null ? 0 : total === 0 ? 1 : done;
  bar.setAttribute('aria-valuetext', total == null ? '확인 대기' : total === 0 ? '처리할 항목 없음' : total + unit + ' 중 ' + done + unit + ' 완료');
  get(id + '-count').textContent = total == null ? '—' : done + ' / ' + total + unit;
  get(id + '-note').textContent = note;
  get(id + '-card').dataset.active = active;
}

function render(state) {
  const running = Boolean(state?.running);
  const stage = running ? 'running' : state?.status;
  status.dataset.status = stage || 'idle';
  status.textContent = labels[stage] || '대기';
  start.disabled = busy || running;
  stop.disabled = !running;
  option.disabled = busy || running;
  get('update').disabled = busy || running;

  const missions = (state?.missionResults || []).filter(record => record.status !== 'excluded');
  const total = state?.missionsReady ? missions.length : null;
  const received = missions.filter(record => record.received).length;
  const current = missions.find(record => record.status === 'running');
  progress('mission', received, total, total == null ? (running ? '수령할 항목 확인 중' : '수령할 항목 확인 대기') :
    total === 0 ? '수령할 항목 없음' : received === total ? '보상 수령 완료' :
      (running && current ? current.label : '남은 항목 ' + (total - received) + '개'), running && state.step === 'missions', '개');

  const target = Number.isInteger(state?.target) ? state.target : null;
  const draws = state?.completed || 0;
  const milestones = state?.drawMilestones;
  const milestoneNote = milestones?.total ? ' · 누적 보상 ' + milestones.received + ' / ' + milestones.total + '개' : '';
  progress('draw', draws, target, target == null ? (running && state.step === 'draws' ? '오늘 뽑기 횟수 확인 중' : '미션 처리 후 시작') :
    (target === 0 ? '오늘 30회 완료' : '오늘 ' + (state.startCount + draws) + ' / 30회') + milestoneNote, running && state.step === 'draws', '회');

  const message = commandError || state?.error || (stage === 'partial' ? '받지 못한 미션 보상이 있습니다.' : '');
  notice.textContent = message;
  notice.hidden = !message;
}

async function refresh() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'status' });
    if (result.error) throw new Error(result.error);
    render(result.state);
  } catch (error) {
    notice.textContent = error.message;
    notice.hidden = false;
  }
}
start.onclick = async () => {
  busy = true;
  commandError = '';
  const enterStovePoints = option.checked;
  render({ running: true, step: 'missions' });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({ type: 'start', tabId: tab?.id, options: { enterStovePoints } });
    if (result.error) throw new Error(result.error);
  } catch (error) { commandError = error.message; }
  finally { busy = false; await refresh(); }
};
stop.onclick = async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'stop' });
    if (result.error) throw new Error(result.error);
  } catch (error) { commandError = error.message; }
  await refresh();
};
get('open-logs').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'logs' });
    if (result.error) throw new Error(result.error);
    commandError = '';
  } catch (error) { commandError = error.message; }
  finally { button.disabled = false; await refresh(); }
};
if (new URLSearchParams(location.search).has('complete')) {
  document.title = 'FullAuto100 완료';
  document.body.classList.add('complete-window');
  get('completion').hidden = false;
  get('close-completion').onclick = () => window.close();
  get('close-completion').focus();
} else {
  const updateButton = get('update'), updateNote = get('update-note');
  const showUpdate = info => {
    if (info.error) throw new Error(info.error);
    updateAvailable = info.available;
    updateNote.textContent = info.available ? '새 버전 ' + info.version + ' 사용 가능' : '현재 v' + chrome.runtime.getManifest().version + ' · 최신 버전';
    updateButton.textContent = info.available ? '최신 설치 파일 받기' : '업데이트 확인';
  };
  updateButton.onclick = async () => {
    updateButton.disabled = true;
    try {
      const info = await chrome.runtime.sendMessage({ type: updateAvailable ? 'download-update' : 'check-update', force: true });
      if (updateAvailable) {
        if (info.error) throw new Error(info.error);
        updateNote.textContent = '받은 EXE에서 기존 폴더에 설치한 뒤 크롬을 새로고침하세요.';
      } else showUpdate(info);
    } catch (error) { updateNote.textContent = error.message; }
    finally { updateButton.disabled = false; }
  };
  chrome.runtime.sendMessage({ type: 'check-update' }).then(showUpdate).catch(error => { updateNote.textContent = error.message; });
  refresh();
  setInterval(refresh, 1000);
}
