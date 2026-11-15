// 元素騎士放送局 v2 — ビルドなしの単一モジュール。
// 外部から来た文字列（YouTubeのタイトル等）は必ず textContent で入れる。innerHTML は使わない。
import { LocalStore, mountBoard, keepAlive, answerInvite } from './board.js';
import { createNotifier, openFloating } from './notify.js';

/* ---------- 小さな道具 ---------- */
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
};
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const num = v => { const n = Number(String(v).replace(/[,，\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
const fmtInt = n => Math.round(n).toLocaleString('ja-JP');
const uid = () => Math.random().toString(36).slice(2, 9);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const safeThumb = url => (typeof url === 'string' && url.startsWith('https://i.ytimg.com/')) ? url : '';

const jst = (opts) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', ...opts });
const fDay = jst({ month: 'numeric', day: 'numeric', weekday: 'short' });
const fTime = jst({ hour: '2-digit', minute: '2-digit', hour12: false });
const fStamp = jst({ month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const fDayKey = jst({ year: 'numeric', month: '2-digit', day: '2-digit' });

const fmtViews = n => n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万回` : `${fmtInt(n)}回`;
const fmtDur = s => s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
const fmtAgo = iso => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(d)) return '';
  if (d <= 0) return '今日'; if (d === 1) return '昨日'; if (d < 30) return `${d}日前`;
  if (d < 365) return `${Math.floor(d / 30)}か月前`; return `${Math.floor(d / 365)}年前`;
};
const fmtLeft = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  if (d > 0) return `${d}日 ${hh}時間`;
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
};

/* ---------- 保存（このブラウザの中だけ） ---------- */
const KEY = 'ghk.v2';
const fresh = () => ({
  theme: null, rate: null,
  counters: [{ id: uid(), name: '周回', n: 0, startedAt: null }],
  timer: { endsAt: null, dur: 0, label: '', done: false },
  reminders: [], earn: { startMr: '', startAt: null, nowMr: '' }, earnLog: [], memo: '',
});
let S = fresh();
const load = () => {
  try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw && typeof raw === 'object') S = { ...fresh(), ...raw }; } catch { /* 保存が使えなくても動く */ }
  if (!Array.isArray(S.counters) || !S.counters.length) S.counters = fresh().counters;
  if (!Array.isArray(S.reminders)) S.reminders = [];
  if (!Array.isArray(S.earnLog)) S.earnLog = [];
};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* noop */ } };

/* ---------- データ ---------- */
const D = { schedule: { fetchedAt: null, items: [] }, videos: { fetchedAt: null, potty: [], popular: [] }, config: {}, apps: [], glossary: [], links: [] };
const getJson = async (name, fallback) => {
  try { const r = await fetch(`../data/${name}.json`, { cache: 'no-cache' }); if (!r.ok) throw 0; return await r.json(); } catch { return fallback; }
};
const cleanVideos = list => (Array.isArray(list) ? list : []).filter(v => v && VIDEO_ID.test(v.id) && typeof v.title === 'string');
const loadData = async () => {
  const [s, v, c, a, g, l, tw] = await Promise.all([
    getJson('schedule', D.schedule), getJson('videos', D.videos), getJson('config', {}), getJson('apps', []), getJson('glossary', []), getJson('links', []), getJson('tower', null),
  ]);
  D.schedule = { fetchedAt: s?.fetchedAt || null, items: cleanVideos(s?.items).filter(i => Number.isFinite(Date.parse(i.start))) };
  D.videos = { fetchedAt: v?.fetchedAt || null, potty: cleanVideos(v?.potty), popular: cleanVideos(v?.popular) };
  D.config = c && typeof c === 'object' ? c : {};
  D.apps = Array.isArray(a) ? a : [];
  D.glossary = Array.isArray(g) ? g : [];
  D.links = Array.isArray(l) ? l : [];
  D.tower = tw && Array.isArray(tw.towers) ? tw : null;
};
const rate = () => { const r = num(S.rate); return r > 0 ? r : (num(D.config.mrPerUsd) > 0 ? num(D.config.mrPerUsd) : 10000); };
const liveItems = () => D.schedule.items.filter(i => i.status === 'live');
const upcoming = () => D.schedule.items.filter(i => i.status === 'upcoming' && Date.parse(i.start) > Date.now() - 3 * 3600000)
  .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

/* ---------- 毎秒の更新 ---------- */
const always = new Set(); let viewTicks = new Set(); let deskTicks = new Set();
setInterval(() => { for (const set of [always, viewTicks, deskTicks]) for (const fn of set) fn(); }, 1000);

let pipWin = null;
const flash = () => {
  for (const el of [$('flash'), pipWin?.document.getElementById('flash')]) { if (!el) continue; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
};

/* ---------- 上の帯・時計・テーマ ---------- */
const applyTheme = () => {
  const t = S.theme === 'light' ? 'light' : 'dark'; // 夜の放送局が基本。明るい表示は選んだ人だけ
  document.documentElement.dataset.theme = t;
  $('themeBtn').textContent = t === 'dark' ? '明るくする' : '暗くする';
};
$('themeBtn').addEventListener('click', () => { S.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); });

const renderTicker = () => {
  const el = $('ticker'); el.replaceChildren();
  const lives = liveItems(); const mine = lives.find(i => i.isPotty);
  const next = upcoming().find(i => i.isPotty) || upcoming()[0];
  if (mine || lives.length) {
    const it = mine || lives[0];
    el.append(h('span', { class: 'pill live', text: 'ON AIR' }),
      h('a', { href: '#/', text: mine ? `ポッティが配信中：${it.title}` : `元素騎士の配信が ${lives.length}件 放送中`, onclick: () => play(it) }));
  } else if (next) {
    const left = h('b', { class: 'mono' });
    const upd = () => { left.textContent = fmtLeft(Date.parse(next.start) - Date.now()); };
    upd(); tickerTick = upd;
    el.append(h('span', { class: 'pill', text: '次の配信' }), h('span', { text: `${fDay.format(new Date(next.start))} ${fTime.format(new Date(next.start))}〜 ${next.title}` }), h('span', { class: 'muted', text: ' あと ' }), left);
  } else {
    tickerTick = null;
    el.append(h('span', { class: 'pill off', text: '放送休止中' }), h('span', { class: 'muted', text: '配信の予定が入ると、ここにカウントダウンが出ます。' }));
  }
};
let tickerTick = null;
always.add(() => { $('clock').textContent = `${fTime.format(new Date())} JST`; tickerTick?.(); });

/* ---------- モニター（ページを移っても再生が続く） ---------- */
let playing = null;      // いま再生中の動画
let featured = null;     // 再生前に映しておく1本
const isTall = v => v && v.durationSec > 0 && v.durationSec <= 180 && v.status !== 'live';
const pickFeatured = () => {
  const lives = liveItems();
  return lives.find(i => i.isPotty) || lives[0] || D.videos.popular[0] || D.videos.potty[0] || null;
};
const play = v => { playing = v; renderMonitor(); if (route() === 'home') window.scrollTo({ top: 0, behavior: 'smooth' }); };
const stop = () => { playing = null; renderMonitor(); };

const renderMonitor = () => {
  const el = $('monitor'); const v = playing || featured;
  document.body.classList.toggle('playing', !!playing);
  if (!v) { el.hidden = true; return; }
  el.hidden = false; el.replaceChildren();
  const live = v.status === 'live';
  const stage = h('div', { class: `stage${isTall(v) ? ' tall' : ''}` });
  const thumb = safeThumb(v.thumbnail);
  if (thumb) stage.style.setProperty('--thumb', `url("${thumb}")`);
  const frame = h('div', { class: 'frame' });
  if (playing) {
    frame.append(h('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1`, title: v.title,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
    }));
  } else {
    frame.append(thumb ? h('img', { src: `https://i.ytimg.com/vi/${v.id}/${isTall(v) ? 'oardefault' : 'hq720'}.jpg`, alt: '', onerror: e => { if (e.target.src !== thumb) e.target.src = thumb; } }) : null,
      h('button', { class: 'playbtn', type: 'button', 'aria-label': `再生：${v.title}`, onclick: () => play(v) }, h('span', { 'aria-hidden': 'true', text: '▶' })));
  }
  stage.append(frame);

  const badge = live ? h('span', { class: 'pill live', text: 'ON AIR' }) : h('span', { class: 'pill', text: playing ? '再生中' : 'おすすめ' });
  const info = h('div', { class: 'now' },
    h('div', { class: 'now-top' }, badge, v.isPotty ? h('span', { class: 'potty', text: 'ポッティ' }) : null,
      h('button', { class: 'ghost small close', type: 'button', text: '閉じる', onclick: stop })),
    h('h2', { class: 'now-title', text: v.title }),
    h('p', { class: 'muted', text: [v.channelTitle, v.views != null ? fmtViews(v.views) : '', v.publishedAt ? fmtAgo(v.publishedAt) : ''].filter(Boolean).join('・') }),
    !live && !playing ? h('p', { class: 'muted small', text: 'いまは配信がお休みなので、最近よく見られている動画を置いています。' }) : null,
    h('a', { class: 'link', href: `https://www.youtube.com/watch?v=${v.id}`, target: '_blank', rel: 'noopener', text: 'YouTubeで開く ↗' }));

  const rest = [...D.videos.popular, ...D.videos.potty].filter((x, i, a) => x.id !== v.id && a.findIndex(y => y.id === x.id) === i).slice(0, 5);
  const queue = h('ol', { class: 'queue' }, rest.map(x => h('li', {},
    h('button', { type: 'button', onclick: () => play(x) },
      safeThumb(x.thumbnail) ? h('img', { src: safeThumb(x.thumbnail), alt: '', loading: 'lazy' }) : null,
      h('span', {}, h('b', { text: x.title }), h('small', { text: `${x.channelTitle}・${fmtViews(x.views || 0)}` }))))));
  el.append(stage, h('div', { class: 'side' }, info, rest.length ? h('h3', { class: 'label', text: 'つづけて見る' }) : null, queue));
};

/* ---------- 部品 ---------- */
const videoCard = v => h('button', { class: 'vcard', type: 'button', onclick: () => play(v) },
  h('span', { class: 'vthumb' },
    safeThumb(v.thumbnail) ? h('img', { src: safeThumb(v.thumbnail), alt: '', loading: 'lazy' }) : null,
    v.durationSec ? h('span', { class: 'dur mono', text: fmtDur(v.durationSec) }) : null,
    h('span', { class: 'vtype', text: v.type || '動画' })),
  h('span', { class: 'vbody' },
    h('b', { class: 'vtitle', text: v.title }),
    h('span', { class: 'vmeta' }, v.isPotty ? h('span', { class: 'potty', text: 'ポッティ' }) : null, h('span', { text: v.channelTitle || '' })),
    h('span', { class: 'vmeta muted', text: `${fmtViews(v.views || 0)}・${fmtAgo(v.publishedAt)}` })));

const icsDownload = it => {
  const z = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = s => String(s).replace(/[\\;,]/g, m => `\\${m}`).replace(/\r?\n/g, ' ');
  const start = Date.parse(it.start);
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//genso-housoukyoku//JP', 'BEGIN:VEVENT', `UID:${it.id}@genso-housoukyoku`,
    `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(start)}`, `DTEND:${z(start + 7200000)}`, `SUMMARY:${esc(it.title)}`,
    `DESCRIPTION:${esc(it.channelTitle || '')}`, `URL:https://www.youtube.com/watch?v=${it.id}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/calendar' })), download: `haishin-${it.id}.ics` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

const scheduleList = () => {
  const items = [...liveItems(), ...upcoming()];
  if (!items.length) {
    return h('div', { class: 'empty' },
      h('p', { text: 'いま、予定されている元素騎士の配信はありません。' }),
      h('p', { class: 'muted small', text: 'YouTubeで配信の予約が入ると、3時間以内にここへ自動で載ります。' }),
      h('a', { class: 'btn', href: 'https://www.youtube.com/@potty0908', target: '_blank', rel: 'noopener', text: 'ポッティ チャンネルを見る ↗' }));
  }
  const groups = new Map();
  for (const it of items) { const k = it.status === 'live' ? 'いま放送中' : fDay.format(new Date(it.start)); (groups.get(k) || groups.set(k, []).get(k)).push(it); }
  return h('div', { class: 'guide' }, [...groups].map(([day, list]) => h('div', { class: 'day' },
    h('h3', { class: 'day-h', text: day }),
    h('ul', {}, list.map(it => h('li', { class: `prog${it.isPotty ? ' mine' : ''}${it.status === 'live' ? ' on' : ''}` },
      h('span', { class: 'prog-t mono', text: it.status === 'live' ? 'LIVE' : fTime.format(new Date(it.start)) }),
      h('span', { class: 'prog-b' },
        h('b', { text: it.title }),
        h('span', { class: 'vmeta' }, it.isPotty ? h('span', { class: 'potty', text: 'ポッティ' }) : null, h('span', { class: 'muted', text: it.channelTitle || '' }))),
      h('span', { class: 'prog-a' },
        it.status === 'live'
          ? h('button', { class: 'btn small', type: 'button', text: '見る', onclick: () => play(it) })
          : h('button', { class: 'ghost small', type: 'button', text: 'カレンダーに追加', onclick: () => icsDownload(it) }),
        h('a', { class: 'link small', href: `https://www.youtube.com/watch?v=${it.id}`, target: '_blank', rel: 'noopener', text: 'YouTube ↗' }))))))));
};

const section = (kicker, title, ...body) => h('section', { class: 'sec' }, h('header', { class: 'sec-h' }, h('p', { class: 'kicker', text: kicker }), h('h2', { text: title })), ...body);
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { text: label }), input, hint ? h('small', { class: 'muted', text: hint }) : null);
const numIn = (value, onInput, attrs = {}) => h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: value ?? '', oninput: e => onInput(e.target.value), ...attrs });

/* ---------- ページ ---------- */
const pages = {
  home() {
    const pop = (D.videos.popular.length ? D.videos.popular : D.videos.potty).slice(0, 8);
    return [
      section('番組表', 'これからの配信', scheduleList()),
      section('よく見られている', '直近30日の人気動画',
        pop.length ? h('div', { class: 'vgrid' }, pop.map(videoCard)) : h('div', { class: 'empty' }, h('p', { text: '動画のデータを取得中です。' })),
        h('p', { class: 'more' }, h('a', { class: 'link', href: '#/videos', text: '動画をもっと見る →' }))),
      section('プレイ中に', 'おとも',
        h('div', { class: 'cards3' },
          h('a', { class: 'tile', href: '#/otomo' }, h('b', { text: 'おとも' }), h('span', { class: 'muted', text: '周回カウンター・タイマー・稼ぎメモ。ゲームの横に置いておく道具です。' })),
          h('a', { class: 'tile', href: '#/kouryaku' }, h('b', { text: '攻略' }), h('span', { class: 'muted', text: '公式情報や攻略サイトへのリンクと、mR換算・コイン計算。' })),
          h('a', { class: 'tile', href: '#/board' }, h('b', { text: 'パーティ募集' }), h('span', { class: 'muted', text: '仲間さがしの掲示板。いま準備しています。' })))),
    ];
  },

  videos() {
    const st = pages._v || (pages._v = { tab: 'popular', q: '', type: '', tag: '', sort: 'views' });
    const wrap = h('div', {});
    const draw = () => {
      const all = D.videos[st.tab] || [];
      const types = [...new Set(all.map(v => v.type).filter(Boolean))];
      const tags = [...new Set(all.flatMap(v => v.tags || []))];
      const q = st.q.trim().toLowerCase();
      const list = all.filter(v => (!st.type || v.type === st.type) && (!st.tag || (v.tags || []).includes(st.tag)) && (!q || `${v.title} ${v.channelTitle}`.toLowerCase().includes(q)))
        .sort((a, b) => st.sort === 'views' ? (b.views || 0) - (a.views || 0) : Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
      const chip = (key, val, label) => h('button', { class: `chip${st[key] === val ? ' on' : ''}`, type: 'button', 'aria-pressed': String(st[key] === val), text: label, onclick: () => { st[key] = st[key] === val && val !== '' ? '' : val; draw(); } });
      wrap.replaceChildren(
        h('div', { class: 'tabs', role: 'tablist' },
          [['popular', 'みんなの人気（直近30日）'], ['potty', 'ポッティの動画']].map(([k, l]) => h('button', { class: `tab${st.tab === k ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(st.tab === k), text: l, onclick: () => { st.tab = k; st.type = st.tag = ''; draw(); } }))),
        h('div', { class: 'filters' },
          h('input', { class: 'search', type: 'search', placeholder: 'タイトル・チャンネル名でさがす', 'aria-label': '動画をさがす', 'data-fid': 'vq', value: st.q, oninput: e => { st.q = e.target.value; draw(); wrap.querySelector('[data-fid=vq]')?.focus(); } }),
          h('div', { class: 'chips' }, chip('sort', 'views', '人気順'), chip('sort', 'new', '新しい順')),
          types.length > 1 ? h('div', { class: 'chips' }, chip('type', '', 'すべて'), types.map(t => chip('type', t, t))) : null,
          tags.length ? h('div', { class: 'chips' }, tags.map(t => chip('tag', t, `#${t}`))) : null),
        h('p', { class: 'muted small', text: `${list.length}本` }),
        list.length ? h('div', { class: 'vgrid' }, list.map(videoCard)) : h('div', { class: 'empty' }, h('p', { text: '条件に合う動画がありません。' })));
      const s = wrap.querySelector('[data-fid=vq]'); if (s && st.q) s.setSelectionRange(st.q.length, st.q.length);
    };
    draw();
    return [section('動画', '元素騎士の動画', wrap)];
  },

  kouryaku() {
    const out = () => h('output', { class: 'result' });
    // 換算
    const o1 = out(); const c = { mr: '', usd: '' };
    const mrIn = numIn('', v => { c.mr = v; const n = num(v); usdIn.value = v && n >= 0 ? (n / rate()).toFixed(2) : ''; calc1(); }, { placeholder: '例 250000' });
    const usdIn = numIn('', v => { c.usd = v; const n = num(v); mrIn.value = v && n >= 0 ? String(Math.round(n * rate())) : ''; calc1(); }, { placeholder: '例 25' });
    const rateIn = numIn(rate(), v => { const n = num(v); if (n > 0) { S.rate = n; save(); mrIn.dispatchEvent(new Event('input')); } });
    const calc1 = () => { const n = num(mrIn.value); o1.textContent = mrIn.value && n >= 0 ? `${fmtInt(n)} mR ≒ ${(n / rate()).toFixed(2)} ドル` : ''; };
    // 還元率
    const o2 = out(); const buy = numIn('', () => calc2(), { placeholder: '買った値段' }); const sell = numIn('', () => calc2(), { placeholder: '売った値段' });
    const calc2 = () => { const b = num(buy.value), s = num(sell.value); o2.textContent = b > 0 && s >= 0 ? `還元率 ${(s / b * 100).toFixed(1)}%（差額 ${s - b >= 0 ? '+' : ''}${fmtInt(s - b)}）` : ''; };
    // コイン
    const o3 = out(); const goal = numIn('1000', () => calc3()); const have = numIn('', () => calc3(), { placeholder: 'いまの枚数' });
    const per = numIn('', () => calc3(), { placeholder: '1回でもらえる枚数' }); const daily = numIn('', () => calc3(), { placeholder: '1日に回る回数（任意）' });
    const calc3 = () => {
      const g = num(goal.value), hv = num(have.value) || 0, p = num(per.value), d = num(daily.value);
      if (!(g > 0 && p > 0)) { o3.textContent = ''; return; }
      const left = Math.max(0, g - hv), runs = Math.ceil(left / p);
      o3.textContent = left === 0 ? '目標に届いています。' : `あと ${fmtInt(left)}枚・${fmtInt(runs)}回${d > 0 ? `（約${Math.ceil(runs / d)}日）` : ''}`;
    };
    const safeUrl = u => (typeof u === 'string' && /^https:\/\//.test(u)) ? u : null;
    const linkGroups = D.links.filter(g => g && Array.isArray(g.items));
    return [
      section('攻略', '攻略に役立つリンク',
        h('p', { class: 'note', text: '外部のサイトに移動します。古い情報が混ざっていることがあるので、日付も見ながら使ってください。' }),
        linkGroups.map(g => h('div', { class: 'lgroup' },
          h('h3', { class: 'lgroup-h', text: String(g.group || '') }),
          g.items.length
            ? h('ul', { class: 'links' }, g.items.filter(it => safeUrl(it.url)).map(it => h('li', {},
                h('a', { href: safeUrl(it.url), target: '_blank', rel: 'noopener' },
                  h('b', { text: String(it.name || '') }), h('span', { class: 'muted small', text: String(it.note || '') }), h('span', { class: 'arrow', 'aria-hidden': 'true', text: '↗' })))))
            : h('p', { class: 'muted small empty-line', text: 'おすすめのサイトやツールを募集中です。ポッティのXやYouTubeのコメントで教えてください。' })))),
      section('計算', '攻略に使える計算',
        h('p', { class: 'note', text: '換算レートは自分で入れる目安の数字です。実際の価格や換金を保証するものではありません。' }),
        h('div', { class: 'cards3' },
          h('div', { class: 'card' }, h('h3', { text: 'mR ⇔ ドル' }), field('mR', mrIn), field('ドル', usdIn), field('1ドルあたりのmR', rateIn, '変えると保存されます'), o1),
          h('div', { class: 'card' }, h('h3', { text: '売買の還元率' }), field('買値', buy), field('売値', sell), o2),
          h('div', { class: 'card' }, h('h3', { text: 'コインの残り回数' }), field('目標の枚数', goal), field('いまの枚数', have), field('1回あたり', per), field('1日の回数', daily), o3))),
      section('みんなの道具', 'ファンアプリ・ツール',
        h('p', { class: 'note', text: 'ここは紹介の枠です。説明は仮のもので、公開時期は決まっていません。' }),
        h('div', { class: 'cards3' }, D.apps.map(a => h(a.url ? 'a' : 'div', { class: 'tile app', href: a.url || null, target: a.url ? '_blank' : null, rel: a.url ? 'noopener' : null },
          h('span', { class: 'app-top' }, h('b', { text: String(a.name || '') }), h('span', { class: 'pill off', text: String(a.status || '') })),
          h('span', { class: 'muted small', text: String(a.author || '') }), h('span', { class: 'muted', text: String(a.description || '') }))))),
    ];
  },

  board() {
    if (boardOn() && D.tower) {
      const box = h('div', { class: 'board' });
      unmountBoard = mountBoard(box, { h, T: D.tower, ng: D.config.ngWords || [], store: boardStore, fmt: { left: fmtLeft, time: t => fTime.format(new Date(t)) } });
      return [section('ドラゴンタワー', '仲間さがし', box)];
    }
    return [section('仲間さがし', 'パーティ募集',
      h('div', { class: 'card wide' },
        h('p', { class: 'pill off', text: '準備中' }),
        h('p', { text: 'パーティ募集の掲示板は、いま準備しています。公開までもう少しお待ちください。' }),
        h('h3', { text: 'こういう掲示板にします' }),
        h('ul', { class: 'plain' },
          ['目的・募集する職業・レベル・開始時刻を選ぶだけで募集できる', '開始時刻を過ぎた募集は自動で消えるので、古い募集が残らない', '自分の職業とレベルで、入れる募集だけに絞り込める', '連絡はゲーム内で。外部への誘導や個人情報は書けないようにする',
            'ギルド紹介・今週のアンケート・相場メモも、同じ仕組みで追加していく予定'].map(t => h('li', { text: t })))))];
  },

  guide() {
    const q = h('input', { class: 'search', type: 'search', placeholder: '用語をさがす', 'aria-label': '用語をさがす', oninput: () => draw() });
    const list = h('dl', { class: 'gloss' });
    const draw = () => {
      const k = q.value.trim().toLowerCase();
      const rows = D.glossary.filter(g => !k || `${g.term}${g.definition}`.toLowerCase().includes(k));
      list.replaceChildren(...rows.flatMap(g => [h('dt', { text: String(g.term || '') }), h('dd', { text: String(g.definition || '') })]));
      if (!rows.length) list.append(h('dd', { class: 'muted', text: '見つかりませんでした。' }));
    };
    draw();
    return [
      section('はじめての人へ', 'この場所の使い方',
        h('ol', { class: 'steps' },
          h('li', {}, h('b', { text: '配信をのぞく' }), h('span', { class: 'muted', text: 'トップの番組表に、これからの元素騎士配信が自動で並びます。' })),
          h('li', {}, h('b', { text: '動画を流しておく' }), h('span', { class: 'muted', text: '動画はページを移っても再生が続きます。周回のBGMがわりに。' })),
          h('li', {}, h('b', { text: 'おともを横に置く' }), h('span', { class: 'muted', text: '「おとも」の「小窓で開く」を押すと、ゲームの横に置ける細い窓になります。' })))),
      section('ことば', '用語メモ',
        h('p', { class: 'note', text: '用語の説明は書きかけの仮の文です。正確な内容は公式の情報を確認してください。' }), q, list),
    ];
  },

  otomo() { return []; },
};

/* ---------- ながらデスク ---------- */
const nextDaily = hhmm => {
  const [hh, mm] = hhmm.split(':').map(Number);
  const now = Date.now(); const j = new Date(now + 9 * 3600000);
  let t = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), hh, mm) - 9 * 3600000;
  if (t <= now) t += 86400000;
  return t - now;
};
const baseTitle = document.title;

const deskEl = $('desk');
const renderDesk = () => {
  const el = deskEl; const fid = el.ownerDocument.activeElement?.dataset?.fid;
  deskTicks = new Set();
  const again = () => { save(); renderDesk(); };

  // 周回カウンター
  const counters = h('div', { class: 'dcard' },
    h('div', { class: 'dhead' }, h('h3', { text: '周回カウンター' }),
      h('button', { class: 'ghost small', type: 'button', text: '＋ 追加', 'data-fid': 'c-add', onclick: () => { S.counters.push({ id: uid(), name: `カウンター${S.counters.length + 1}`, n: 0, startedAt: null }); again(); } })),
    S.counters.map((c, i) => {
      const pace = h('small', { class: 'muted' });
      const upd = () => { const hrs = c.startedAt ? (Date.now() - c.startedAt) / 3600000 : 0; pace.textContent = c.n > 0 && hrs > 1 / 60 ? `1時間あたり 約${(c.n / hrs).toFixed(1)}回` : ''; };
      upd(); deskTicks.add(upd);
      return h('div', { class: 'counter' },
        h('input', { class: 'cname', type: 'text', maxlength: '16', 'aria-label': 'カウンターの名前', 'data-fid': `cn-${c.id}`, value: c.name, onchange: e => { c.name = e.target.value.trim() || '周回'; save(); } }),
        h('div', { class: 'crow' },
          h('button', { class: 'ghost', type: 'button', 'aria-label': '1減らす', 'data-fid': `cm-${c.id}`, text: '−', onclick: () => { c.n = Math.max(0, c.n - 1); again(); } }),
          h('b', { class: 'cnum mono', 'aria-live': 'polite', text: String(c.n) }),
          h('button', { class: 'btn big', type: 'button', 'data-fid': `cp-${c.id}`, text: '＋1', onclick: () => { if (!c.startedAt) c.startedAt = Date.now(); c.n += 1; again(); } })),
        h('div', { class: 'crow2' }, pace,
          h('button', { class: 'linkbtn', type: 'button', 'data-fid': `cr-${c.id}`, text: '0に戻す', onclick: () => { c.n = 0; c.startedAt = null; again(); } }),
          S.counters.length > 1 ? h('button', { class: 'linkbtn', type: 'button', text: '消す', onclick: () => { S.counters.splice(i, 1); again(); } }) : null));
    }),
    h('p', { class: 'muted small keyhint', text: 'キーボードの「+」でも、いちばん上のカウンターが増えます。' }));

  // タイマー
  const t = S.timer; const tDisp = h('b', { class: 'tnum mono' });
  const tUpd = () => {
    if (t.endsAt) {
      const left = t.endsAt - Date.now();
      if (left <= 0) { t.endsAt = null; t.done = true; save(); flash(); document.title = `⏰ おわり！ ${baseTitle}`; renderDesk(); return; }
      tDisp.textContent = fmtLeft(left); document.title = `⏱ ${fmtLeft(left)} ${baseTitle}`;
    } else { tDisp.textContent = t.done ? 'おわり！' : '--:--'; }
  };
  tUpd(); deskTicks.add(tUpd);
  const startTimer = min => { if (!(min > 0)) return; t.endsAt = Date.now() + min * 60000; t.dur = min; t.done = false; again(); };
  const custom = h('input', { type: 'text', inputmode: 'numeric', placeholder: '分', 'aria-label': '分を入力', 'data-fid': 't-min', class: 'tiny' });
  const timer = h('div', { class: `dcard${t.done ? ' done' : ''}` },
    h('div', { class: 'dhead' }, h('h3', { text: 'タイマー' }), h('small', { class: 'muted', text: '音は鳴らず、画面が光ります' })),
    tDisp,
    t.endsAt || t.done
      ? h('div', { class: 'chips' }, h('button', { class: 'ghost small', type: 'button', 'data-fid': 't-stop', text: t.done ? '閉じる' : 'やめる', onclick: () => { t.endsAt = null; t.done = false; document.title = baseTitle; again(); } }),
        t.dur ? h('button', { class: 'ghost small', type: 'button', text: `もう一度 ${t.dur}分`, onclick: () => startTimer(t.dur) }) : null)
      : h('div', { class: 'chips' }, [5, 15, 30, 60].map(m => h('button', { class: 'chip', type: 'button', text: `${m}分`, onclick: () => startTimer(m) })),
        custom, h('button', { class: 'ghost small', type: 'button', text: 'スタート', onclick: () => startTimer(num(custom.value)) })));

  // 毎日の時刻
  const rLabel = h('input', { type: 'text', maxlength: '12', placeholder: '例 防衛戦', 'aria-label': '名前', 'data-fid': 'r-label' });
  const rTime = h('input', { type: 'time', 'aria-label': '時刻（日本時間）', 'data-fid': 'r-time' });
  const rows = S.reminders.map(r => ({ r, left: nextDaily(r.time) })).sort((a, b) => a.left - b.left);
  const reminders = h('div', { class: 'dcard' },
    h('div', { class: 'dhead' }, h('h3', { text: '毎日の時刻' }), h('small', { class: 'muted', text: '日本時間' })),
    rows.length ? h('ul', { class: 'rlist' }, rows.map(({ r }) => {
      const left = h('b', { class: 'mono' }); let prev = nextDaily(r.time);
      const upd = () => { const ms = nextDaily(r.time); if (ms > prev + 60000) flash(); prev = ms; left.textContent = 86400000 - ms < 60000 ? 'いま！' : fmtLeft(ms); };
      upd(); deskTicks.add(upd);
      return h('li', {}, h('span', {}, h('b', { text: r.label }), h('small', { class: 'muted mono', text: ` ${r.time}` })), left,
        h('button', { class: 'linkbtn', type: 'button', 'aria-label': `${r.label}を消す`, text: '消す', onclick: () => { S.reminders = S.reminders.filter(x => x.id !== r.id); again(); } }));
    })) : h('p', { class: 'muted small', text: '防衛戦やイベントなど、毎日決まった時刻を入れておくと、あと何分かが出ます。' }),
    h('form', { class: 'rform', onsubmit: e => { e.preventDefault(); if (!/^\d\d:\d\d$/.test(rTime.value)) return; S.reminders.push({ id: uid(), label: rLabel.value.trim() || '予定', time: rTime.value }); again(); } },
      rLabel, rTime, h('button', { class: 'ghost small', type: 'submit', text: '追加' })));

  // 稼ぎメモ
  const e = S.earn; const eOut = h('div', { class: 'eout' });
  const eUpd = () => {
    const a = num(e.startMr), b = num(e.nowMr);
    if (!e.startAt || !Number.isFinite(a)) { eOut.textContent = ''; return; }
    const mins = (Date.now() - e.startAt) / 60000; const parts = [`経過 ${Math.floor(mins / 60)}時間${pad(Math.floor(mins % 60))}分`];
    if (e.nowMr !== '' && Number.isFinite(b)) {
      const diff = b - a; parts.unshift(`${diff >= 0 ? '+' : ''}${fmtInt(diff)} mR（≒${(diff / rate()).toFixed(2)}ドル）`);
      if (mins >= 1) parts.push(`時給 ${fmtInt(diff / (mins / 60))} mR`);
    }
    eOut.replaceChildren(...parts.map(p => h('span', { text: p })));
  };
  eUpd(); deskTicks.add(eUpd);
  const earn = h('div', { class: 'dcard' },
    h('div', { class: 'dhead' }, h('h3', { text: '稼ぎメモ' })),
    e.startAt
      ? [field('はじめの所持mR', numIn(e.startMr, v => { e.startMr = v; save(); eUpd(); }, { 'data-fid': 'e-start' })),
        field('いまの所持mR', numIn(e.nowMr, v => { e.nowMr = v; save(); eUpd(); }, { 'data-fid': 'e-now', placeholder: '入れると差額と時給が出ます' })),
        eOut,
        h('div', { class: 'chips' },
          h('button', { class: 'btn small', type: 'button', text: '記録して終わる', onclick: () => {
            const a = num(e.startMr), b = num(e.nowMr);
            if (Number.isFinite(a) && e.nowMr !== '' && Number.isFinite(b)) S.earnLog = [{ at: Date.now(), diff: b - a, mins: Math.round((Date.now() - e.startAt) / 60000) }, ...S.earnLog].slice(0, 10);
            S.earn = { startMr: '', startAt: null, nowMr: '' }; again();
          } }),
          h('button', { class: 'linkbtn', type: 'button', text: 'やめる', onclick: () => { S.earn = { startMr: '', startAt: null, nowMr: '' }; again(); } }))]
      : [field('はじめの所持mR', numIn(e.startMr, v => { e.startMr = v; save(); }, { 'data-fid': 'e-start', placeholder: '例 1200000' })),
        h('button', { class: 'btn small', type: 'button', text: 'ここから計る', onclick: () => { if (!Number.isFinite(num(e.startMr)) || e.startMr === '') return; e.startAt = Date.now(); e.nowMr = ''; again(); } })],
    S.earnLog.length ? h('details', { class: 'elog' }, h('summary', { text: `これまでの記録（${S.earnLog.length}件）` }),
      h('ul', {}, S.earnLog.map(l => h('li', { class: 'mono', text: `${fStamp.format(new Date(l.at))}　${l.diff >= 0 ? '+' : ''}${fmtInt(l.diff)} mR／${l.mins}分` }))),
      h('button', { class: 'linkbtn', type: 'button', text: '記録を全部消す', onclick: () => { S.earnLog = []; again(); } })) : null);

  // メモ
  const memo = h('div', { class: 'dcard' }, h('div', { class: 'dhead' }, h('h3', { text: 'メモ' })),
    h('textarea', { rows: '4', maxlength: '2000', placeholder: 'ドロップ、買うもの、次にやること…', 'aria-label': 'メモ', 'data-fid': 'memo', oninput: ev => { S.memo = ev.target.value; save(); } }, S.memo || ''));

  // 知らせの設定
  const perm = notifier.permission;
  const notifyCard = h('div', { class: 'dcard' },
    h('div', { class: 'dhead' }, h('h3', { text: '知らせの受け取り' }), h('small', { class: 'muted', text: '参加・勧誘が届いたとき' })),
    h('label', { class: 'toggle' }, h('input', { type: 'checkbox', ...(notifier.settings.sound ? { checked: true } : {}), onchange: e => notifier.setSound(e.target.checked) }), h('span', { text: '音を鳴らす（全画面でも気づける）' })),
    perm === 'granted' ? h('p', { class: 'small', text: '✓ パソコンの通知：オン' })
      : perm === 'denied' ? h('p', { class: 'muted small', text: 'パソコンの通知はブラウザの設定で止められています。' })
      : perm === 'unsupported' ? null
      : h('button', { class: 'ghost small', type: 'button', text: 'パソコンの通知をオンにする', onclick: () => notifier.askPermission() }),
    pipOk && !pipWin ? h('button', { class: 'btn small', type: 'button', text: '手前に出す小窓で開く', onclick: openPip }) : null,
    pipWin ? h('p', { class: 'small', text: '✓ 手前に出る小窓で表示中' }) : null,
    h('button', { class: 'linkbtn', type: 'button', text: '試しに鳴らす', onclick: () => notifier.test() }),
    h('p', { class: 'muted small', text: pipOk ? '小窓はゲームを全画面にしても手前に残ります。勧誘が来たら小窓が光って音が鳴ります。' : 'このブラウザは手前に出す小窓に対応していません（Chrome / Edge で使えます）。' }));

  el.replaceChildren(...[
    h('div', { class: 'desk-h' }, h('div', {}, h('p', { class: 'kicker', text: 'プレイ中の' }), h('h2', { text: 'おとも' })),
      mini || pipWin ? null : h('button', { class: 'ghost small', type: 'button', text: pipOk ? '手前に出す小窓 ↗' : '小窓で開く ↗', onclick: () => pipOk ? openPip() : window.open(`${location.pathname}?mini=1#/otomo`, 'gensoDesk', 'width=380,height=780') })),
    notifier.notices.length ? h('div', { class: 'inbox' }, notifier.render(noticeActions)) : null,
    h('div', { class: 'desk-grid' }, counters, timer, reminders, earn, memo, notifyCard),
  ].filter(Boolean),
    h('p', { class: 'muted small', text: '入れた内容は、このブラウザの中だけに保存されます。' }));
  if (fid) el.querySelector(`[data-fid="${fid}"]`)?.focus();
};

/* ---------- ルーター ---------- */
const NAV = [['home', 'トップ'], ['videos', '動画'], ['kouryaku', '攻略'], ['otomo', 'おとも'], ['board', '仲間さがし'], ['guide', 'はじめての人へ']];
const ALIAS = { desk: 'otomo', tools: 'kouryaku' };
const route = () => { let r = location.hash.replace(/^#\/?/, '') || 'home'; r = ALIAS[r] || r; return pages[r] ? r : 'home'; };
const mini = new URLSearchParams(location.search).has('mini');
let unmountBoard = null;
const boardStore = new LocalStore();
const boardOn = () => D.config?.features?.board === true || new URLSearchParams(location.search).has('boardtest');
const render = () => {
  unmountBoard?.(); unmountBoard = null;
  const r = mini ? 'otomo' : route();
  document.body.dataset.route = r;
  $('nav').replaceChildren(...NAV.map(([k, l]) => h('a', { href: `#/${k === 'home' ? '' : k}`, 'aria-current': k === r ? 'page' : null, text: l })));
  viewTicks = new Set();
  $('view').replaceChildren(...pages[r]());
  document.title = `${NAV.find(n => n[0] === r)[1]}｜元素騎士放送局`;
  if (typeof notifier !== 'undefined') renderToasts();
};
addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); $('view').focus({ preventScroll: true }); });
addEventListener('storage', ev => { if (ev.key === KEY) { load(); renderDesk(); } });
addEventListener('keydown', ev => {
  if ((ev.key === '+' || ev.key === ';' && ev.shiftKey) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && !ev.metaKey && !ev.ctrlKey) {
    const c = S.counters[0]; if (!c.startedAt) c.startedAt = Date.now(); c.n += 1; save(); renderDesk();
  }
});

/* ---------- 知らせ ---------- */
const pipOk = 'documentPictureInPicture' in window && !mini;
// おともが本体の画面に見えているときは、そちらの中に出すので右上には出さない
const renderToasts = () => { const deskShown = !pipWin && deskEl.isConnected && deskEl.offsetParent !== null; $('toasts').replaceChildren(...(deskShown ? [] : [notifier.render(noticeActions)])); };
addEventListener('resize', () => renderToasts());
const notifier = createNotifier({ h, onChange: (o = {}) => { renderToasts(); renderDesk(); if (o.flash) flash(); } });
const noticeActions = n => n.kind === 'invite' ? [
  h('button', { type: 'button', class: 'btn small', text: '行く', onclick: async () => { const err = await answerInvite(boardStore, n.inv, true); notifier.dismiss(n.id); if (err) notifier.push({ id: `err:${Date.now()}`, kind: 'info', title: 'うまくいきませんでした', body: err }); else notifier.push({ id: `ok:${n.id}`, kind: 'info', title: '勧誘を受けました', body: `${n.inv.place}${n.inv.ch ? `・ch${n.inv.ch}` : ''}へ。参加待ちはオフにしました。` }); if (route() === 'board') render(); } }),
  h('button', { type: 'button', class: 'ghost small', text: '見送る', onclick: async () => { await answerInvite(boardStore, n.inv, false); notifier.dismiss(n.id); if (route() === 'board') render(); } }),
] : [];
async function openPip() {
  try {
    pipWin = await openFloating({ node: deskEl, onClose: () => { pipWin = null; document.body.classList.remove('desk-out'); renderDesk(); renderToasts(); } });
    if (pipWin) { document.body.classList.add('desk-out'); renderToasts(); }
    if (pipWin) {
      pipWin.addEventListener('keydown', ev => { if (ev.key === '+' && !/INPUT|TEXTAREA|SELECT/.test(pipWin.document.activeElement?.tagName || '')) { const c = S.counters[0]; if (!c.startedAt) c.startedAt = Date.now(); c.n += 1; save(); renderDesk(); } });
      renderDesk();
    }
  } catch { pipWin = null; }
}

/* ---------- 起動 ---------- */
load(); applyTheme();
if (mini) document.body.classList.add('mini');
renderDesk(); render();
await loadData();
featured = pickFeatured();
if (boardOn()) keepAlive(boardStore, n => notifier.push(n), D.tower);
$('fetched').textContent = D.videos.fetchedAt ? `最終更新 ${fStamp.format(new Date(D.videos.fetchedAt))}` : 'データ取得前です。';
renderTicker(); renderMonitor(); render();
setInterval(async () => { await loadData(); if (!playing) { featured = pickFeatured(); renderMonitor(); } renderTicker(); if (route() === 'home' && !mini) render(); }, 15 * 60000);
