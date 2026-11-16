const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const version = '5.7.0';
let stored = {}, fetches = 0, downloads = [];
const release = v => ({
  tag_name: 'v' + v, draft: false, prerelease: false, assets: [{
    name: 'FullAuto100-Setup-v' + v + '.exe', state: 'uploaded',
    browser_download_url: 'https://github.com/LibraLightLuda/FullAuto100/releases/download/v' + v + '/FullAuto100-Setup-v' + v + '.exe'
  }]
});
let answer = release('5.8.0'), failure = false;
const ctx = vm.createContext({
  Date, AbortSignal, chrome: {
    storage: { local: { get: async () => stored, set: async v => { stored = { ...stored, ...v }; } } },
    runtime: { getManifest: () => ({ version }) },
    action: { setTitle: async () => {} },
    alarms: { onAlarm: { addListener() {} }, create() {} },
    downloads: { download: async v => { downloads.push(v); return 1; } }
  },
  fetch: async () => { fetches++; if (failure) throw Error('offline'); return { ok: true, json: async () => answer }; }
});
vm.runInContext(fs.readFileSync(__dirname + '/stove100-background/update.js','utf8'), ctx);
const run = expression => vm.runInContext(expression,ctx);
(async () => {
  assert(run("newerVersion('5.10.0','5.9.9')"));
  assert(!run("newerVersion('5.7.0','5.7.0')"));
  assert(!run("newerVersion('5.6.9','5.7.0')"));
  assert(!run("newerVersion('garbage','5.7.0')"));
  const info = await run('checkUpdate()');
  assert(info.available); assert.equal(info.version,'5.8.0');
  await run('checkUpdate()'); assert.equal(fetches,1,'cached check avoids repeated API calls');
  await run('downloadUpdate()'); assert.equal(downloads.length,1);
  assert.equal(downloads[0].url,release('5.8.0').assets[0].browser_download_url);
  failure = true; assert((await run('checkUpdate(true)')).error);
  await assert.rejects(run('downloadUpdate()'));
  assert.equal(downloads.length,1);
  failure = false; answer = release('5.7.0');
  assert(!(await run('checkUpdate(true)')).available);
  answer = release('5.8.0'); answer.assets[0].browser_download_url = 'https://example.com/bad.exe';
  assert((await run('checkUpdate(true)')).error);
  answer = release('5.8.0'); answer.prerelease = true;
  assert((await run('checkUpdate(true)')).error);
  console.log('PASS: update version comparison, API cache, installer download, offline, invalid origin and prerelease');
})().catch(error => {console.error(error);process.exitCode=1;});
