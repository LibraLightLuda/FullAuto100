const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/stove100-background/background.js','utf8').split('async function run(tabId, options, attempt)')[0];
function fixture(options={}) {
  const updated=new Set(), removed=new Set(), calls=[], saved=[], timers=new Set();
  const storage={}, exports=[], shown=[];
  const event=list=>({addListener:fn=>list.add(fn),removeListener:fn=>list.delete(fn)});
  const tabs=new Map((options.tabs||[{id:1,url:'https://example.com/',status:'complete',incognito:false}]).map(t=>[t.id,{...t}]));
  const ctx=vm.createContext({importScripts(){},console,crypto,clearInterval(){},
    setTimeout:fn=>{timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn),
    chrome:{storage:{local:{
      set:async value=>{Object.assign(storage,structuredClone(value));saved.push(structuredClone(value));},
      get:async keys=>Object.fromEntries([keys].flat().map(key=>[key,structuredClone(storage[key])]))
    }},downloads:{
      download:async options=>{exports.push(options);return exports.length;},
      search:async()=>[{state:'complete'}],erase:async()=>{},show:id=>shown.push(id)
    },tabs:{
      onUpdated:event(updated),onRemoved:event(removed),
      get:async id=>{if(!tabs.has(id))throw Error('No tab');return {...tabs.get(id)};},
      query:async()=>[...tabs.values()].filter(t=>t.url.startsWith('https://reward.onstove.com/')),
      create:async value=>{calls.push(['create',value]);const t={id:99,...value,status:options.hold?'loading':'complete',incognito:false};tabs.set(99,t);return {...t};},
      update:async(id,value)=>{calls.push(['update',id,value]);Object.assign(tabs.get(id),value,{status:'complete'});return {...tabs.get(id)};}
    }},calls});
  vm.runInContext(source+'\nasync function run(id, options, attempt){calls.push(["run",id]);await save({...attempt,running:false,status:"complete",phase:"draws",updatedAt:attempt.startedAt});return {ok:true,tabId:id};}',ctx);
  return {ctx,calls,saved,tabs,updated,removed,timers,storage,exports,shown,start:id=>vm.runInContext('start('+JSON.stringify(id??null)+')',ctx)};
}
(async()=>{
  let f=fixture();await f.start(1);assert.equal(f.calls[0][0],'create');assert.equal(f.calls[0][1].url,'https://reward.onstove.com/ko');assert.equal(f.calls[0][1].active,false);assert.equal(f.tabs.get(1).url,'https://example.com/');
  f=fixture({tabs:[{id:1,url:'https://example.com/',incognito:false},{id:2,url:'https://reward.onstove.com/ko',status:'complete',incognito:false}]});await f.start(1);assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],2);
  f=fixture({tabs:[{id:2,url:'https://reward.onstove.com/ko/event',status:'complete',incognito:false},{id:3,url:'https://reward.onstove.com/ko',status:'complete',incognito:false}]});await f.start(3);assert.equal(f.calls[0][1],3);
  f=fixture({tabs:[{id:2,url:'https://reward.onstove.com/ko',status:'unloaded',discarded:true,incognito:false}]});await f.start(2);assert.equal(f.calls[0][0],'update');assert.equal(f.calls[1][0],'run');
  f=fixture({hold:true});let pending=f.start(1);await new Promise(setImmediate);assert(!f.calls.some(c=>c[0]==='run'));await assert.rejects(f.start(1),/이미/);f.tabs.get(99).status='complete';for(const fn of [...f.updated])fn(99,{status:'complete'},f.tabs.get(99));await pending;assert.equal(f.updated.size,0);assert.equal(f.removed.size,0);
  for(const mode of ['redirect','close','timeout','stop']) {
    f=fixture({hold:true});pending=f.start(1);await new Promise(setImmediate);
    if(mode==='redirect')for(const fn of [...f.updated])fn(99,{status:'complete'},{url:'https://accounts.onstove.com/login'});
    if(mode==='close')for(const fn of [...f.removed])fn(99);
    if(mode==='timeout')for(const fn of [...f.timers])fn();
    if(mode==='stop')vm.runInContext('openingCancelled=true;cancelOpening()',f.ctx);
    await assert.rejects(pending);assert(!f.calls.some(c=>c[0]==='run'));assert.equal(f.updated.size,0);assert.equal(f.removed.size,0);assert.equal(f.storage.lastRun.status,mode==='stop'?'stopped':'error');
    assert.equal(f.storage.runHistory.length,1);
    assert.equal(f.exports.length,1,'startup failures and cancellation export logs');
  }
  f=fixture({tabs:[{id:2,url:'https://reward.onstove.com/ko',status:'complete',incognito:false}]});
  await f.start(2);
  const first=f.storage.lastRun.runId;
  for(let i=0;i<4;i++) await f.start(2);
  await vm.runInContext('save({ runId:"interrupted-run", running:true, phase:"missions", status:"running", updatedAt:new Date().toISOString() })',f.ctx);
  await f.start(2);
  assert.equal(f.storage.runHistory.length,5);
  assert.equal(new Set(f.storage.runHistory.map(run=>run.runId)).size,5);
  assert(!f.storage.runHistory.some(run=>run.runId===first));
  assert.equal(f.storage.runHistory[1].status,'interrupted');
  assert.deepEqual(f.storage.runHistory[0].timeline.map(item=>item.step.phase),['opening','draws']);
  await vm.runInContext('writeLogs(true)',f.ctx);
  assert.deepEqual(f.shown,[1]);
  const archive=f.exports[0];
  assert.equal(archive.filename,'FullAuto100-logs/recent-runs.json');
  assert.equal(archive.conflictAction,'overwrite');
  assert.equal(JSON.parse(decodeURIComponent(archive.url.split(',')[1])).runs.length,5);
  console.log('PASS: 9 auto-open scenarios; reuse, new inactive tab, preferred tab, discarded tab, load completion, duplicate start, redirect, closure, timeout and stop.');
  console.log('PASS: latest five attempts, interruption recovery, phase history and reveal exported log.');
})().catch(e=>{console.error(e);process.exitCode=1;});
