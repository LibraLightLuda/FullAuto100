'use strict';
const releaseAPI = 'https://api.github.com/repos/LibraLightLuda/FullAuto100/releases/latest';
function newerVersion(latest, current) {
  const parts = version => /^\d+\.\d+\.\d+$/.test(version || '') ? version.split('.').map(Number) : null;
  const a = parts(latest), b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
function installerRelease(release) {
  const version = (release.tag_name || '').replace(/^v/, '');
  if (release.draft || release.prerelease || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('안정 버전 릴리즈를 확인하지 못했습니다.');
  const name = 'FullAuto100-Setup-v' + version + '.exe';
  const asset = release.assets?.find(file => file.name === name && file.state === 'uploaded');
  const url = 'https://github.com/LibraLightLuda/FullAuto100/releases/download/v' + version + '/' + name;
  if (!asset || asset.browser_download_url !== url) throw new Error('설치 파일이 등록되지 않은 릴리즈입니다.');
  return { version, url, name };
}
let updateRequest;
async function checkUpdate(force = false) {
  if (updateRequest) return updateRequest;
  updateRequest = (async () => {
    const { updateInfo } = await chrome.storage.local.get('updateInfo');
    if (!force && updateInfo && Date.now() - updateInfo.checkedAt < 86400000) return updateInfo;
    try {
      const response = await fetch(releaseAPI, {
        headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('GitHub 응답 ' + response.status);
      const latest = installerRelease(await response.json());
      const info = { ...latest, available: newerVersion(latest.version, chrome.runtime.getManifest().version), checkedAt: Date.now() };
      await chrome.storage.local.set({ updateInfo: info });
      await chrome.action.setTitle({ title: info.available ? 'FullAuto100 새 버전 ' + info.version : 'FullAuto100' });
      return info;
    } catch (error) {
      return { ...updateInfo, error: '업데이트 확인 실패 · ' + error.message };
    }
  })();
  try { return await updateRequest; } finally { updateRequest = null; }
}
async function downloadUpdate() {
  const info = await checkUpdate(true);
  if (info.error) throw new Error(info.error);
  if (!info.available) throw new Error('현재 최신 버전입니다.');
  const id = await chrome.downloads.download({ url: info.url, filename: info.name, saveAs: false });
  return { id, version: info.version };
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'fullauto100-update') checkUpdate();
});
chrome.alarms.create('fullauto100-update', { delayInMinutes: 1, periodInMinutes: 1440 });
