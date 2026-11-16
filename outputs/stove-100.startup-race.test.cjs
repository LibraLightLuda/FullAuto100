// Startup regression: isolated fixtures, no browser/server connection or real rewards.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {run}=require('./stove-100.test.cjs');

async function main(){
  const results=[];
  for(const startPath of ['/ko','/ko/event']){
    for(const initial of [0,7,30]){
      const result=await run({startPath,initial,counterDelay:450,disabled:initial===30});
      assert.equal(result.state.version,'v5.7-github-updates');
      assert.equal(result.state.status,'complete');
      assert.equal(result.state.startCount,initial);
      assert.equal(result.clicks,30-initial);assert.equal(result.done,30);
      assert.deepEqual(result.readyScreens,['미션','캡슐뽑기']);
      assert.deepEqual(result.transitions,startPath==='/ko'?['capsule']:['mission','capsule']);
      assert.ok(result.drawTimes.every(draw=>draw.at>=draw.readyAt),'wait for numeric count before any draw');
      results.push({startPath,initial,delayedCountMs:450,clicks:result.clicks,readyScreens:result.readyScreens,transitions:result.transitions,status:result.state.status});
    }
  }
  let result=await run({startPath:'/ko',initial:30,counterNever:true});
  assert.equal(result.clicks,0);assert.equal(result.state.status,'error');
  assert.match(result.state.error,/캡슐뽑기 화면 데이터 대기 시간 초과/);
  assert.ok(result.elapsedMs>=15000);assert.deepEqual(result.transitions,['capsule']);
  results.push({scenario:'numeric count never arrives',clicks:0,status:result.state.status});
  result=await run({duplicateCounter:true});
  assert.equal(result.clicks,0);assert.match(result.state.error,/횟수 영역이 여러 개/);
  results.push({scenario:'ambiguous count rejected',clicks:0,status:result.state.status});
  result=await run({dailyLimit:31});
  assert.equal(result.clicks,0);assert.match(result.state.error,/일일 횟수 표시/);
  results.push({scenario:'unexpected daily limit rejected',clicks:0,status:result.state.status});
  result=await run({initial:31});
  assert.equal(result.clicks,0);assert.match(result.state.error,/일일 횟수 표시/);
  results.push({scenario:'out-of-range count rejected',clicks:0,status:result.state.status});
  result=await run({initial:7,counterDelay:150,decoyCount:true});
  assert.equal(result.state.startCount,7);assert.equal(result.clicks,23);
  assert.deepEqual(result.readyScreens,['미션','캡슐뽑기']);
  results.push({scenario:'chat text cannot replace actual counter',initial:7,clicks:23,status:result.state.status});
  result=await run({startPath:'/ko',initial:30,funds:null,disabled:true,counterDelay:150});
  assert.equal(result.clicks,0);assert.equal(result.state.status,'complete');
  assert.deepEqual(result.readyScreens,['미션','캡슐뽑기']);
  results.push({scenario:'already complete does not require draw funds or enabled draw button',clicks:0,status:result.state.status});
  const report={passed:true,version:'v5.7-github-updates',scenarios:results.length,results};
  fs.writeFileSync(path.join(__dirname,'stove-100.startup-flow.result.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: '+results.length+' startup scenarios; mission-first transitions, delayed and invalid counters, both starting screens, 0/7/30 counts.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
