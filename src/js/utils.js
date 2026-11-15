import { stationState, safeThumbnail } from './data.js';
export const badge = '<span class="badge">サンプル</span>';
export const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const num = value => new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value);
export const dateTime = value => new Intl.DateTimeFormat('ja-JP', { month:'short', day:'numeric', weekday:'short', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' }).format(new Date(value));
export const localInput = (value = Date.now()) => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
};
export function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error('ブラウザの保存領域を利用できません。保存設定や空き容量を確認してください。'); }
}
let toastTimeout;
export function toast(message) {
  const box = document.querySelector('#toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { box.hidden = true; }, 5000);
}
export function remaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(seconds / 86400);
  return `${days ? `${days}日 ` : ''}${String(Math.floor(seconds % 86400 / 3600)).padStart(2,'0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
}
export function nextStream(schedule, now = Date.now()) {
  return stationState(schedule,now).item;
}
// 防衛戦は日本時間の仮設定。端末のタイムゾーンによらず同じ枠を表示する。
export function defenseSlot(config, now = Date.now()) {
  const day = new Date(now + 9 * 3600000).toISOString().slice(0,10);
  const slots = [0,1].flatMap(offset => config.guildDefenseTimes.map(time => Date.parse(`${day}T${time}:00+09:00`) + offset * 86400000));
  const duration = config.guildDefenseDurationMinutes * 60000;
  const start = slots.sort((a,b) => a-b).find(time => time + duration > now);
  return { start, end:start + duration, live:start <= now };
}
export function countdowns(schedule, config) {
  const stream = nextStream(schedule);
  const defense = defenseSlot(config);
  return `<div class="countdown-grid"><div class="mini-count"><span>ポッティの配信</span><strong data-countdown="stream">${stream ? stream.status === 'live' ? 'LIVE' : remaining(Date.parse(stream.start)-Date.now()) : '配信予定はまだありません'}</strong><small>${esc(stream?.title || '次回の予定をお待ちください')}</small></div><div class="mini-count"><span>ギルド防衛戦 ${badge}</span><strong data-countdown="defense">${defense.live ? '開催枠の時間です' : remaining(defense.start-Date.now())}</strong><small>日本時間 ${esc(config.guildDefenseTimes.join(' / '))} · 各30分（仮）</small></div></div>`;
}
export const options = (items, first = 'すべて') => `${first ? `<option value="">${esc(first)}</option>` : ''}${items.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
export function videoCard(v) {
  const thumbnail = safeThumbnail(v.thumbnail);
  return `<article class="video-card"><button class="thumb" data-video="${esc(v.id)}" aria-label="${esc(v.title)}を再生">${thumbnail ? `<img src="${esc(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="video-type">${esc(v.type)}</span><span class="play" aria-hidden="true">▶</span></button><div class="video-body"><div class="meta"><span>${num(v.views)}回視聴</span></div><button class="text-button video-title" data-video="${esc(v.id)}">${esc(v.title)}</button><p class="muted">${esc(v.channelTitle)}<br>${esc(v.tags.join(' · '))} <span class="date">${esc(v.publishedAt ? dateTime(v.publishedAt) : '')}</span></p></div></article>`;
}
export function heading(kicker, title, description, action = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1><p class="muted">${esc(description)}</p></div>${action}</div>`;
}
export function errorIn(form, message) {
  const error = form.querySelector('.form-error');
  if (error) { error.textContent = message; error.hidden = false; error.focus(); }
  else toast(message);
}
