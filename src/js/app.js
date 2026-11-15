import { normalizeSchedule, normalizeVideos, allVideos, stationState } from './data.js';
import { calendarText } from './calendar.js';
import { readLocal, writeLocal, toast, remaining, defenseSlot } from './utils.js';
import { LocalStore } from './store/LocalStore.js';
import { WorkTimer } from './timer.js';
import { homePage } from './pages/home.js';
import { videosPage } from './pages/videos.js';
import { boardPage } from './pages/board.js';
import { toolsPage } from './pages/tools.js';
import { loungePage } from './pages/lounge.js';
import { guidePage } from './pages/guide.js';

const root = document.querySelector('#main');
const themeButton = document.querySelector('#theme-toggle');
const nagaraButton = document.querySelector('#nagara-toggle');
const preferences = readLocal('genso.preferences.v1',{light:false,nagara:false});
function applyPreferences() {
  document.documentElement.dataset.theme=preferences.light ? 'light' : 'dark';
  document.body.classList.toggle('nagara',preferences.nagara);
  themeButton.setAttribute('aria-pressed',String(preferences.light));
  themeButton.textContent=preferences.light ? 'ダークモード' : 'ライトモード';
  nagaraButton.setAttribute('aria-pressed',String(preferences.nagara));
  nagaraButton.textContent=`ながらモード ${preferences.nagara ? '入' : '切'}`;
}
applyPreferences();
for (const [button,key] of [[themeButton,'light'],[nagaraButton,'nagara']]) button.addEventListener('click',() => {
  preferences[key]=!preferences[key]; applyPreferences();
  try { writeLocal('genso.preferences.v1',preferences); } catch (e) { toast(e.message); }
});

const dialog=document.querySelector('#video-dialog');
let previousFocus;
document.querySelector('#close-video').addEventListener('click',() => dialog.close());
dialog.addEventListener('click',event => { if (event.target === dialog) { const box=dialog.getBoundingClientRect(); if (event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom) dialog.close(); } });
dialog.addEventListener('close',() => { document.querySelector('#video-frame').replaceChildren(); document.body.classList.remove('modal-open'); previousFocus?.focus(); });

function downloadCalendar(item) {
  const url=URL.createObjectURL(new Blob([calendarText(item)],{type:'text/calendar;charset=utf-8'}));
  const anchor=document.createElement('a'); anchor.href=url; anchor.download=`genso-${item.id}.ics`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

async function boot() {
  const names=['config','schedule','videos','news','apps','glossary'];
  const values=await Promise.all(names.map(async name => {
    try {
      const response=await fetch(`data/${name}.json`);
      if (!response.ok) throw new Error(`${name}.jsonを読み込めませんでした。`);
      return await response.json();
    } catch (error) {
      if (['schedule','videos','news'].includes(name)) return null;
      throw error;
    }
  }));
  const data=Object.fromEntries(names.map((name,index) => [name,values[index]]));
  data.schedule=normalizeSchedule(data.schedule);
  data.videos=normalizeVideos(data.videos);
  data.news=Array.isArray(data.news) ? data.news : [];
  const store=new LocalStore(data.config);
  if (data.config.features?.board !== false || data.config.features?.hitokoto !== false) await store.seed();
  const timer=new WorkTimer();
  const ctx={root,...data,store,timer};
  // 通常の通報は1ブラウザ1件。POC検証時だけ複数件を再現する。
  Object.defineProperty(window,'__gensoDebug',{value:Object.freeze({async reportTimes(id,n) {
    if (!Number.isInteger(n) || n<1 || n>100) throw new Error('nは1〜100の整数を指定してください。');
    for (let i=0;i<n;i++) await store.report(id,{debug:true});
  }}),enumerable:false});
  root.addEventListener('click',event => {
    const video=event.target.closest('[data-video]');
    if (video) {
      const item=allVideos(data.videos).find(v => v.id === video.dataset.video);
      if (!item) return;
      previousFocus=video;
      document.querySelector('#video-dialog-title').textContent=item.title;
      const iframe=document.createElement('iframe');
      iframe.src=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.id)}`;
      iframe.title=item.title; iframe.allow='encrypted-media; picture-in-picture; fullscreen'; iframe.allowFullscreen=true; iframe.referrerPolicy='strict-origin-when-cross-origin';
      document.querySelector('#video-frame').replaceChildren(iframe); dialog.showModal(); document.body.classList.add('modal-open');
    }
    const calendar=event.target.closest('[data-ics]');
    if (calendar) { const item=data.schedule.items.find(s => s.id === calendar.dataset.ics); if (item) downloadCalendar(item); }
  });
  const pages={'/':homePage,'/videos':videosPage,'/board':boardPage,'/tools':toolsPage,'/lounge':loungePage,'/guide':guidePage};
  let cleanup, navigating=false, reroute=false;
  async function render() {
    if (location.hash === '#main') return;
    if (navigating) { reroute=true; return; }
    navigating=true;
    try {
      cleanup?.(); cleanup=null;
      const path=location.hash.slice(1) || '/';
      if (!pages[path]) { location.replace('#/'); return; }
      document.querySelectorAll('.main-nav a').forEach(a => { if (a.hash === `#${path}`) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
      document.title=`${{'/':'トップ','/videos':'動画','/board':'パーティ募集','/tools':'ツール','/lounge':'ながら部屋','/guide':'はじめての人へ'}[path]} | 元素騎士放送局`;
      if (dialog.open) dialog.close();
      cleanup=await pages[path](ctx);
      window.scrollTo(0,0); root.focus({preventScroll:true}); tick();
    } catch (error) { root.replaceChildren(); const p=document.createElement('p'); p.className='empty'; p.textContent=`表示できませんでした：${error.message}`; root.append(p); }
    finally { navigating=false; if (reroute) { reroute=false; render(); } }
  }
  function tick() {
    const now=Date.now(), state=stationState(data.schedule,now), defense=defenseSlot(data.config,now);
    const streamText=state.kind === 'live' ? 'LIVE' : state.kind === 'upcoming' ? remaining(Date.parse(state.item.start)-now) : state.kind === 'community' ? `LIVE中の元素騎士配信 ${state.count}件` : '配信予定はまだありません';
    document.querySelector('#station-live').hidden=state.kind !== 'live';
    const status=document.querySelector('#station-status');
    if (state.kind === 'live') {
      // 毎秒の更新でリンクを作り直さず、キーボードのフォーカスを保つ。
      let link=status.querySelector('a');
      if (!link) { link=document.createElement('a'); status.replaceChildren(link); }
      link.href=state.item.url; link.target='_blank'; link.rel='noopener noreferrer'; link.textContent=state.item.title;
    } else status.textContent=state.kind === 'upcoming' ? `次の配信まで ${streamText}` : streamText;
    document.querySelectorAll('[data-countdown="stream"]').forEach(el => { el.textContent=streamText; });
    document.querySelectorAll('[data-countdown="defense"]').forEach(el => { el.textContent=defense.live ? `開催枠の時間です · 残り${remaining(defense.end-now)}` : remaining(defense.start-now); });
    try { timer.tick(); } catch (e) { toast(e.message); }
  }
  window.addEventListener('hashchange',render);
  window.addEventListener('storage',event => { if (event.key === 'genso.board.v1') window.dispatchEvent(new Event('genso-store-change')); });
  window.addEventListener('genso-timer-finished',() => toast('おつかれさま！ タイマーが終了しました。ながら部屋でリセットできます。'));
  await render(); setInterval(tick,1000);
}
boot().catch(error => {
  root.replaceChildren();
  const p=document.createElement('p'); p.className='empty';
  p.textContent=`読み込みに失敗しました。srcで「python3 -m http.server 8000」を実行し、http://localhost:8000 を開いてください。${error.message}`;
  root.append(p);
});
