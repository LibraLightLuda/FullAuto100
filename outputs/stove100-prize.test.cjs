const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
function fixture(o) {
  window.calls=[]; let prize=o.ready?'claim':'go',mini=o.miniReady?'claim':'go',next='go',count=4;
  const note=x=>calls.push(x);
  window.__stove100Background={options:{enterStovePoints:o.opt===undefined?true:o.opt},click:async e=>e.click(),begin:async()=>{},close:async()=>{},finish:async()=>{}};
  document.body.innerHTML='<nav><button id="missions">미션</button><button id="draws">캡슐 뽑기</button></nav><span class="whitespace-nowrap block overflow-ellipsis">'+(o.poor?10:9999)+'</span><main></main>';
  const main=document.querySelector('main');
  function missions(){
    history.replaceState(null,'','/ko');
    const card=(id,label,status)=>'<div class="stds-box" id="'+id+'"><p class="text-xl">'+label+'</p><button '+(status==='done'?'disabled':'')+'>'+({go:'미션하기',claim:'받기',done:'받기 완료'}[status])+'</button></div>';
    main.innerHTML='<section><h2>데일리 미션</h2><span>0 / 3 데일리 미션 달성</span>'+card('prize','경품 응모하기',prize)+card('mini','미니게임 플레이하기',mini)+card('next','다음 방문 미션',next)+'</section>';
    document.querySelector('#prize button').onclick=()=>{
      note('prize:'+prize);
      if(prize==='claim'){prize='done';missions();}
      else location.assign('/ko/event#apply');
    };
    document.querySelector('#mini button').onclick=()=>{note('mini:'+mini);mini='done';missions();};
    document.querySelector('#next button').onclick=()=>{note('next:'+next);next=next==='go'?'claim':'done';missions();};
  }
  function draws(){history.replaceState(null,'','/ko/event');main.innerHTML='<div class="stds-box"><span>오늘 뽑기</span><b>30/30회</b></div><article><strong>행운 득템! 경품 이벤트</strong></article>';main.querySelector('article').onclick=open;}
  function open(){
    const d=document.createElement('div');d.setAttribute('role','dialog');
    const item=name=>'<li><div class="stds-box"><p class="text-xl">'+name+'</p><p class="count">'+count+'회 응모중</p><div><div><button><i class="ic-v2-control-minus-line"></i></button><p>'+(o.quantity?2:1)+'</p><button>+</button></div><button class="apply">응모하기</button></div></div></li>';
    d.innerHTML='<p>1회 응모 500 플레이크</p><ul>'+item('네이버페이 포인트')+item('스토브 5,000 포인트')+item('스토브 30,000 포인트')+(o.duplicate?item('스토브 30,000 포인트'):'')+'</ul><button class="close">닫기</button>';
    d.querySelector('.close').onclick=()=>d.remove();
    for(const c of d.querySelectorAll('li')) c.querySelector('.apply').onclick=()=>{
      note('apply:'+c.querySelector('p').textContent);
      const confirm=document.createElement('div');confirm.setAttribute('role','dialog');
      confirm.innerHTML='<p>'+c.querySelector('p').textContent+'에 '+(o.badConfirm?2:1)+'회 응모하시겠습니까?</p><button>확인</button><button class="close">닫기</button>';
      confirm.querySelector('.close').onclick=()=>confirm.remove();
      confirm.querySelector('button').onclick=async()=>{note('confirm');confirm.remove();const r=await fetch('https://api.onstove.com/emsbackapi/v3.0/apply/fixture',{method:'POST',body:JSON.stringify({req_cnt:1})});if(r.ok&&!o.noIncrement){count++;c.querySelector('.count').textContent=count+'회 응모중';prize='claim';}};
      document.body.append(confirm);
    };
    document.body.append(d);
  }
  document.getElementById('missions').onclick=missions;document.getElementById('draws').onclick=()=>{note('draw-stage');draws();};missions();
}
(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage();const source=fs.readFileSync(__dirname+'/stove-100.js','utf8');const results=[];
 try{
  for(const o of [{name:'default off',opt:false},{name:'one entry and return'},{name:'already ready',ready:true},{name:'conditional ready',opt:false,miniReady:true},{name:'string option rejected',opt:'true'},{name:'poor',poor:true},{name:'quantity',quantity:true},{name:'duplicate',duplicate:true},{name:'bad confirmation',badConfirm:true},{name:'server error',error:true},{name:'uncertain response',noIncrement:true}]){
   let requests=0, documentLoads=0;
   await page.unrouteAll();await page.route('https://reward.onstove.com/**',r=>{documentLoads++;return r.fulfill({contentType:'text/html',body:'<html><body></body></html>'});});
   await page.route('https://api.onstove.com/**',r=>{requests++;assert.equal(JSON.parse(r.request().postData()).req_cnt,1);return r.fulfill({status:o.error?500:200,contentType:'application/json',body:'{}'});});
   await page.goto('https://reward.onstove.com/ko');await page.evaluate(fixture,o);await page.evaluate(source);
   await page.waitForFunction(()=>window.stove100&&!window.stove100.running,{},{timeout:45000});
   const r=await page.evaluate(()=>({state:stove100,calls,url:location.pathname}));
   assert.equal(documentLoads,1,'the prize mission must not reload the execution page');
   assert(!r.calls.includes('prize:go'),'the prize shortcut performs a full navigation');
   assert.equal(r.url,r.state.status==='error'?'/ko':'/ko/event','failure returns to missions; successful missions precede draws');assert(!r.calls.includes('mini:go'),'never plays conditional mission');
   const success=o.name==='one entry and return';
   assert.equal(requests,success||o.error||o.noIncrement?1:0,o.name);
   assert.equal(r.state.prizeEntry.confirmed,success,o.name);
   if(success){assert.deepEqual(r.calls.filter(x=>x.startsWith('apply:')),['apply:스토브 30,000 포인트']);assert(r.calls.includes('prize:claim'));assert(r.calls.indexOf('prize:claim')<r.calls.lastIndexOf('draw-stage'));assert(r.calls.includes('next:claim'));assert.equal(r.calls.filter(x=>x==='confirm').length,1);}
   if(o.ready){assert(!r.calls.some(x=>x.startsWith('apply:')));assert(r.calls.includes('prize:claim'));}
   if(o.miniReady)assert(r.calls.includes('mini:claim'));
   if(o.poor||o.quantity||o.duplicate||o.badConfirm||o.error||o.noIncrement){assert.equal(r.state.status,'error');assert(r.state.failures.length);}
   results.push({name:o.name,requests,status:r.state.status,entry:r.state.prizeEntry});
  }
  fs.writeFileSync(__dirname+'/stove100-prize.result.json',JSON.stringify({passed:true,results},null,2));console.log('PASS: '+results.length+' ready-claim and prize scenarios');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
