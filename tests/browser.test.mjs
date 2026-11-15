// npm不要のChrome DevTools Protocol検証。ブラウザの外部リクエストは送信前に遮断する。
import test from 'node:test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { collectYouTube } from '../scripts/fetch_youtube.mjs';
import { fixture, fixtureFetch } from './fixtures/youtube.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const chromePath=[process.env.CHROME_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(path => path && existsSync(path));
test('ブラウザ：配信・動画・機能フラグと既存機能の回帰', {skip:!chromePath,timeout:120000}, async () => {
const project=resolve(new URL('..',import.meta.url).pathname);
const artifacts=resolve(project,'logs/poc-check');
const profile=resolve(project,`tests/.chrome-${process.pid}`);
await mkdir(artifacts,{recursive:true});
const sources=JSON.parse(await readFile(resolve(project,'src/data/sources.json'),'utf8'));
const snapshot=await collectYouTube({sources,now:Date.parse(fixture.now),apiKey:'browser-fixture-key',fetchJson:fixtureFetch()});
let mode='empty', overrides={};
const server=createServer(async (request,response) => {
  const path=new URL(request.url,'http://localhost').pathname;
  try {
    if (path.startsWith('/data/') && mode !== 'empty') {
      const name=path.split('/').at(-1).replace('.json','');
      let data=overrides[name] ?? snapshot[name];
      if (name === 'config') data={...JSON.parse(await readFile(resolve(project,'src/data/config.json'),'utf8')),features:{board:true,hitokoto:true},...overrides.config};
      if (data === 'missing') { response.writeHead(404); response.end(); return; }
      if (data !== undefined) { response.writeHead(200,{'Content-Type':'application/json'}); response.end(JSON.stringify(data)); return; }
    }
    const relative=path === '/' ? 'index.html' : path.slice(1);
    const file=resolve(project,'src',relative);
    if (!file.startsWith(resolve(project,'src')+'/')) throw new Error('Invalid path');
    const content=await readFile(file);
    response.writeHead(200,{'Content-Type':file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'});
    response.end(content);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(8000,'127.0.0.1',resolve); });
const delay=ms => new Promise(resolve => setTimeout(resolve,ms));
const waitFor=async (check,label) => { const until=Date.now()+12000; while (Date.now()<until) { if (await check()) return; await delay(60); } throw new Error(`タイムアウト：${label}`); };
let chrome, connection, session;
let sequence=0, buffer='';
const pending=new Map(), errors=[], blocked=[], localFailures=[], checks=[];
const record=message => { checks.push(message); process.stdout.write(`✓ ${message}\n`); };

try {
  chrome=spawn(chromePath,[
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--disable-extensions','--disable-breakpad','--disable-crash-reporter','--no-pings','--metrics-recording-only','--safebrowsing-disable-auto-update',
    '--disable-features=OptimizationHints,MediaRouter,AutofillServerCommunication',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost','about:blank'
  ],{cwd:project,stdio:['ignore','ignore','pipe','pipe','pipe']});
  let chromeLog=''; chrome.stderr.on('data',data => { chromeLog+=data; });
  const send=(method,params={},sessionId) => new Promise((resolve,reject) => {
    const id=++sequence;
    const timeout=setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}\n${chromeLog.slice(-1200)}`)); },15000);
    pending.set(id,{resolve:value => { clearTimeout(timeout); resolve(value); },reject:error => { clearTimeout(timeout); reject(error); }});
    chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})})+'\0');
  });
  chrome.stdio[4].on('data',chunk => {
    buffer+=chunk.toString();
    let separator;
    while ((separator=buffer.indexOf('\0'))>=0) {
      const raw=buffer.slice(0,separator); buffer=buffer.slice(separator+1); if (!raw) continue;
      const message=JSON.parse(raw);
      if (message.id) {
        const handler=pending.get(message.id); pending.delete(message.id);
        if (message.error) handler?.reject(new Error(JSON.stringify(message.error))); else handler?.resolve(message.result);
      } else {
        const {method,params,sessionId}=message;
        if (method==='Runtime.exceptionThrown') errors.push(params.exceptionDetails.text+': '+(params.exceptionDetails.exception?.description||''));
        if (method==='Log.entryAdded' && params.entry.level==='error' && !params.entry.text.includes('ERR_BLOCKED_BY_CLIENT')) errors.push(params.entry.text);
        if (method==='Network.responseReceived' && params.response.url.startsWith('http://127.0.0.1:8000') && params.response.status>=400) localFailures.push(params.response.url);
        if (method==='Fetch.requestPaused') {
          const url=params.request.url;
          const allowed=url.startsWith('http://127.0.0.1:8000/') || /^(?:data:|blob:|about:)/.test(url);
          if (!allowed) blocked.push(url);
          send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',{requestId:params.requestId,...(!allowed ? {errorReason:'BlockedByClient'} : {})},sessionId).catch(e => errors.push(e.message));
        }
      }
    }
  });
  connection=send;
  await send('Browser.getVersion');
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  ({sessionId:session}=await send('Target.attachToTarget',{targetId,flatten:true}));
  const call=(method,params={}) => send(method,params,session);
  await call('Page.enable'); await call('Runtime.enable'); await call('Log.enable'); await call('Network.enable');
  await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`{
    const NativeDate=Date;
    window.__testOffset=NativeDate.parse('2026-11-15T12:00:00+09:00')-NativeDate.now();
    window.Date=class extends NativeDate { constructor(...args) { super(...(args.length ? args : [NativeDate.now()+window.__testOffset])); } static now() { return NativeDate.now()+window.__testOffset; } };
  }`});
  const evaluate=async expression => {
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const ready=() => waitFor(() => evaluate(`!!window.__gensoDebug && !!document.querySelector('main h1')`),'アプリ起動');
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:8000/'}); await ready();
  assert.ok((await evaluate(`document.querySelector('main').textContent`)).includes('データ取得前です'));
  assert.equal(await evaluate(`document.querySelectorAll('.schedule-item, .video-card, #home-posts, .news-list').length`),0);
  await evaluate(`location.hash='#/board'`);
  await waitFor(() => evaluate(`document.querySelector('main').textContent.includes('パーティ募集掲示板は準備中です。公開までもう少しお待ちください。')`),'掲示板の保留');
  assert.equal(await evaluate(`document.querySelector('#party-form')`),null);
  await evaluate(`location.hash='#/lounge'`);
  await waitFor(() => evaluate(`!!document.querySelector('#timer-start')`),'ながら部屋');
  assert.equal(await evaluate(`document.querySelector('#shout-form')`),null);
  record('初回取得前の空表示・お知らせ非表示・掲示板とひとことの保留');
  mode='full';
  await call('Page.navigate',{url:'http://127.0.0.1:8000/'}); await ready();
  assert.equal(await evaluate(`document.querySelectorAll('.schedule-item').length`),4);
  assert.equal(await evaluate(`document.querySelectorAll('#home-posts .party-card').length`),3);
  assert.equal(await evaluate(`document.querySelectorAll('.video-card').length`),4);
  const screenshot=async name => { const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); await writeFile(resolve(artifacts,name),Buffer.from(shot.data,'base64')); };
  await screenshot('desktop-home.png');
  record('トップの予定4件・新着募集3件・人気動画4本');
  await evaluate(`document.querySelector('[data-ics="AAAAAAAAAA3"]').click()`);
  await waitFor(async () => (await readdir(artifacts)).includes('genso-AAAAAAAAAA3.ics'),'ICSダウンロード');
  const calendar=await readFile(resolve(artifacts,'genso-AAAAAAAAAA3.ics'),'utf8');
  assert.ok(calendar.includes('DTSTART:20261116T120000Z')); assert.ok(!calendar.includes('サンプル')); assert.ok(calendar.includes('DTEND:20261116T140000Z'));
  record('ICSファイルのダウンロード・実タイトル・2時間の予定');
  const paths=['/','/videos','/board','/tools','/lounge','/guide'];
  const headings={'/':'ゲームのそばに、','/videos':'動画をみる','/board':'パーティ募集','/tools':'ファンアプリ','/lounge':'ながら部屋','/guide':'はじめての人へ'};
  const route=async path => {
    await evaluate(`location.hash=${JSON.stringify('#'+path)}`);
    await waitFor(() => evaluate(`document.querySelector('main h1')?.textContent.includes(${JSON.stringify(headings[path])})`),path);
  };
  for (const width of [1366,375,420]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    for (const path of paths) {
      await route(path);
      const layout=await evaluate(`({width:innerWidth, scroll:document.documentElement.scrollWidth, current:document.querySelectorAll('.main-nav [aria-current="page"]').length, badges:document.querySelectorAll('main .badge').length})`);
      assert.ok(layout.scroll<=layout.width,`${width} ${path} 横スクロール ${JSON.stringify(layout)}`); assert.equal(layout.current,1);
    }
    record(`${width}px：6ルート表示・横スクロールなし・ナビ`);
  }
  await route('/'); await call('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:false}); await screenshot('mobile-home.png');
  await route('/videos');
  assert.equal(await evaluate(`document.querySelector('.video-card [data-video]').dataset.video`),'DDDDDDDDDD1');
  await evaluate(`document.querySelector('#video-sort').value='new'; document.querySelector('#video-sort').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('.video-card [data-video]').dataset.video`),'AAAAAAAAAA1');
  await evaluate(`document.querySelector('[data-tab=potty]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.video-card').length`),2);
  assert.ok(await evaluate(`document.querySelector('[data-tab=potty]').getAttribute('aria-pressed')==='true'`));
  assert.ok((await evaluate(`document.querySelector('.video-body').textContent`)).includes('ポッティ'));
  await evaluate(`document.querySelector('[data-tab=popular]').click(); document.querySelector('#video-tag').value='金策'; document.querySelector('#video-tag').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelectorAll('.video-card').length`),1);
  await evaluate(`document.querySelector('#video-tag').value=''; document.querySelector('#video-tag').dispatchEvent(new Event('change',{bubbles:true}))`);
  await evaluate(`document.querySelector('#video-type').value='配信アーカイブ'; document.querySelector('#video-type').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelectorAll('.video-card').length`),1);
  await evaluate(`document.querySelector('[data-video]').click()`);
  assert.ok((await evaluate(`document.querySelector('#video-frame iframe').src`)).startsWith('https://www.youtube-nocookie.com/embed/'));
  await evaluate(`document.querySelector('#close-video').click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('iframe').length===0`),'モーダルの破棄');
  record('動画の2タブ・新着/人気・種別/タグ・チャンネル表示・プライバシー強化埋め込み');

  await route('/board');
  assert.equal(await evaluate(`document.querySelectorAll('#board-list .party-card').length`),5);
  const submitParty=async comment => {
    await evaluate(`{
      const f=document.querySelector('#party-form');
      f.elements.purpose.value='ドラタワ初級'; f.querySelector('[name=jobs]').checked=true;
      f.elements.place.value='テスト広場'; f.elements.character.value='確認キャラ'; f.elements.comment.value=${JSON.stringify(comment)};
      f.requestSubmit();
    }`);
    await delay(180);
  };
  await submitParty('https://example.com');
  assert.ok((await evaluate(`document.querySelector('.form-error').textContent`)).includes('入力できません'));
  await submitParty('ブラウザでの募集検証');
  await waitFor(() => evaluate(`document.querySelectorAll('#board-list .party-card').length===6`),'投稿表示');
  const id=await evaluate(`Object.keys(JSON.parse(localStorage.getItem('genso.hostKeys.v1')))[0]`);
  await evaluate(`{
    const card=document.querySelector('[data-post-id="${id}"]'); card.querySelector('details').open=true;
    card.querySelector('[data-count]').value='3'; card.querySelector('[data-action=count]').click();
  }`);
  await waitFor(() => evaluate(`document.querySelector('[data-post-id="${id}"] .party-facts').textContent.includes('3/4人')`),'人数更新');
  await submitParty('別の募集テスト');
  assert.ok((await evaluate(`document.querySelector('.form-error').textContent`)).includes('3分'));
  await evaluate(`document.querySelector('#filter-purpose').value='金策';document.querySelector('#filter-purpose').dispatchEvent(new Event('input',{bubbles:true}))`);
  await waitFor(() => evaluate(`document.querySelectorAll('#board-list .party-card').length===1`),'目的フィルター');
  await evaluate(`document.querySelector('#filter-purpose').value='';document.querySelector('#filter-purpose').dispatchEvent(new Event('input',{bubbles:true}))`);
  await waitFor(() => evaluate(`document.querySelector('[data-post-id="${id}"]')!==null`),'フィルター解除');
  await evaluate(`document.querySelector('[data-id="${id}"][data-action=close]').click()`);
  await waitFor(() => evaluate(`!document.querySelector('[data-post-id="${id}"]')`),'締切非表示');
  await evaluate(`document.querySelector('#filter-ended').checked=true; document.querySelector('#filter-ended').dispatchEvent(new Event('input',{bubbles:true}))`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-post-id="${id}"]') && document.querySelectorAll('#board-list .party-card').length===7`),'終了表示');
  const dialogListener=new Promise(resolve => {
    // 確認ダイアログはテスト内でのみ置き換え、削除操作を検証する。
    resolve(evaluate(`window.confirm=() => true; document.querySelector('[data-id="${id}"][data-action=delete]').click()`));
  });
  await dialogListener;
  await waitFor(() => evaluate(`!document.querySelector('[data-post-id="${id}"]')`),'削除');
  await evaluate(`document.querySelector('[data-id="sample-2"][data-action=report]').click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-id="sample-2"][data-action=report]').textContent==='通報済み'`),'通報');
  await evaluate(`window.__gensoDebug.reportTimes('sample-2',2)`);
  await waitFor(() => evaluate(`!document.querySelector('[data-post-id="sample-2"]')`),'通報3件非表示');
  record('掲示板：URL拒否→投稿→人数更新→連投拒否→絞込→締切→終了表示→削除→通報3件');
  await evaluate(`window.__testOffset+=4*60000`);
  await submitParty('期限切れの検証');
  const expiringId=await evaluate(`Object.keys(JSON.parse(localStorage.getItem('genso.hostKeys.v1')))[0]`);
  await evaluate(`document.querySelector('#filter-ended').checked=false; document.querySelector('#filter-ended').dispatchEvent(new Event('input',{bubbles:true})); window.__testOffset+=61*60000`);
  await waitFor(() => evaluate(`!document.querySelector('[data-post-id="${expiringId}"]')`),'自動失効');
  record('時刻進行による自動失効（再読み込みなし）');

  await route('/tools');
  assert.ok((await evaluate(`document.querySelector('#convert-result').textContent`)).includes('10,000 mR ＝ 1 USD'));
  await evaluate(`document.querySelector('#convert-usd').value='2';document.querySelector('#convert-usd').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('#convert-mr').value`),'20000');
  assert.ok((await evaluate(`document.querySelector('#return-result').textContent`)).includes('80%'));
  assert.ok((await evaluate(`document.querySelector('#coin-result').textContent`)).includes('34回 ／ 約7日'));
  await evaluate(`document.querySelector('#exchange-rate').value='5000';document.querySelector('#exchange-rate').dispatchEvent(new Event('input',{bubbles:true}))`);
  record('双方向換算・レート保存・還元率80%・コイン34回/7日');

  await route('/lounge');
  await evaluate(`document.querySelector('[data-counter="0"] [data-step="1"]').click(); document.querySelector('[data-counter="0"] [data-field=memo]').value='サンプルのドロップ記録'; document.querySelector('[data-counter="0"] [data-field=memo]').dispatchEvent(new Event('input',{bubbles:true}));`);
  await evaluate(`document.querySelector('#earn-start').value='10000';document.querySelector('#earn-end').value='15000';document.querySelector('#earn-minutes').value='30';document.querySelector('#earn-end').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.ok((await evaluate(`document.querySelector('#earn-result').textContent`)).includes('時給 10,000 mR（約2 USD）'));
  await evaluate(`document.querySelector('[data-minutes="30"]').click();document.querySelector('#timer-start').click()`);
  const end=await evaluate(`JSON.parse(localStorage.getItem('genso.timer.v1')).end`); assert.ok(end);
  await route('/guide'); await route('/lounge');
  assert.equal(await evaluate(`document.querySelector('[data-count-output]').textContent`),'1');
  assert.equal(await evaluate(`document.querySelector('[data-field=memo]').value`),'サンプルのドロップ記録');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('genso.timer.v1')).end`),end);
  await evaluate(`window.__testOffset+=31*60000`);
  await waitFor(() => evaluate(`document.body.classList.contains('timer-finished')`),'タイマー終了');
  assert.ok((await evaluate(`document.querySelector('#timer-status').textContent`)).includes('おつかれさま'));
  await evaluate(`document.querySelector('#timer-reset').click()`);
  assert.equal(await evaluate(`document.body.classList.contains('timer-finished')`),false);
  await evaluate(`document.querySelector('#shout-form [name=comment]').value='ブラウザ検証、周回中';document.querySelector('#shout-form').requestSubmit()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.shout-card').length===1`),'ひとこと作成');
  await evaluate(`window.__testOffset+=24*3600000+1000`);
  await waitFor(() => evaluate(`document.querySelectorAll('.shout-card').length===0`),'ひとこと失効');
  record('周回とメモ保存・稼ぎ/時給・タイマー画面移動/終了/リセット・ひとこと24時間失効');
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('#nagara-toggle').click();document.querySelector('#theme-toggle').click()`);
  assert.ok(await evaluate(`document.body.getBoundingClientRect().width<=420`));
  for (const path of paths) {
    await route(path);
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('main .grid')).every(e => getComputedStyle(e).gridTemplateColumns.split(' ').length===1)`));
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.body.scrollWidth<=420`));
  }
  await route('/lounge'); await screenshot('nagara-light-lounge.png');
  await call('Page.reload'); await ready();
  assert.ok(await evaluate(`document.body.classList.contains('nagara') && document.documentElement.dataset.theme==='light'`));
  assert.equal(await evaluate(`document.querySelector('[data-count-output]').textContent`),'1');
  record('ながらモード最大420px/全6画面1列・ライトモード・再読み込み保存');
  const reload=async () => { await call('Page.navigate',{url:'http://127.0.0.1:8000/'}); await ready(); };
  assert.equal(await evaluate(`document.querySelector('#station-status a')?.textContent`),'雑談ライブ');
  assert.ok(await evaluate(`!document.querySelector('#station-live').hidden`));
  overrides.schedule={...snapshot.schedule,items:snapshot.schedule.items.filter(v => v.id !== 'AAAAAAAAAA4')};
  await reload();
  assert.ok((await evaluate(`document.querySelector('#station-status').textContent`)).startsWith('次の配信まで'));
  overrides.schedule={...snapshot.schedule,items:snapshot.schedule.items.filter(v => !v.isPotty)};
  await reload();
  assert.equal(await evaluate(`document.querySelector('#station-status').textContent`),'LIVE中の元素騎士配信 1件');
  overrides.schedule={fetchedAt:null,items:[]};
  await reload();
  assert.equal(await evaluate(`document.querySelector('#station-status').textContent`),'配信予定はまだありません');
  record('ON AIR：ポッティLIVE→ポッティ予定→コミュニティLIVE→予定なしの優先順');
  overrides.schedule=[{id:'old',videoId:'AAAAAAAAAA3',start:'2026-11-16T12:00:00Z',title:'旧形式の予定'}];
  overrides.videos=[{...snapshot.videos.potty[0],title:'<img src=x onerror=alert(1)>',thumbnail:'https://evil.example/test.jpg'}];
  await reload();
  assert.equal(await evaluate(`document.querySelectorAll('.schedule-item').length`),1);
  assert.equal(await evaluate(`document.querySelectorAll('.video-card').length`),1);
  assert.equal(await evaluate(`document.querySelector('.video-title').textContent`),'<img src=x onerror=alert(1)>');
  assert.equal(await evaluate(`document.querySelector('.video-card img')`),null);
  overrides.schedule='missing'; overrides.videos='missing';
  await reload();
  assert.equal(await evaluate(`document.querySelectorAll('.schedule-item, .video-card').length`),0);
  assert.ok((await evaluate(`document.querySelector('main').textContent`)).includes('データ取得前です'));
  assert.ok(localFailures.every(url => /data\/(schedule|videos)\.json$/.test(url)));
  localFailures.length=0;
  // 欠損ファイルの404はこのシナリオで期待される。
  for (let i=errors.length-1;i>=0;i--) if (errors[i].includes('404')) errors.splice(i,1);
  record('旧配列の互換表示・第三者タイトルのエスケープ・不正画像URL拒否・JSON欠損時の空表示');
  assert.equal(localFailures.length,0,localFailures.join('\n'));
  assert.equal(errors.length,0,errors.join('\n'));
  assert.ok(blocked.every(url => url.startsWith('https://i.ytimg.com/') || url.startsWith('https://www.youtube-nocookie.com/')),blocked.join('\n'));
  record('ローカルHTTPエラー・JavaScript例外なし、外部リクエストは送信前に全遮断');
  await writeFile(resolve(artifacts,'result.json'),JSON.stringify({checks,errors,localFailures,blockedExternalRequests:[...new Set(blocked)]},null,2));
} finally {
  if (connection) await connection('Browser.close').catch(() => {});
  chrome?.kill(); await new Promise(resolve => server.close(resolve));
  await delay(300); await rm(profile,{recursive:true,force:true});
}

});
