// 古い配列形式と、初回取得前・欠損ファイルを同じ形で扱う。
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function safeThumbnail(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host === 'i.ytimg.com' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
const fetchedAt = value => validDate(value) ? value : null;
function videoItem(item, legacy = false) {
  if (!item || !validId(item.id) || typeof item.title !== 'string') return null;
  return {...item,title:item.title.slice(0,200),channelTitle:typeof item.channelTitle === 'string' ? item.channelTitle : legacy ? 'ポッティ' : '',
    isPotty:legacy || item.isPotty === true,views:Number.isFinite(item.views) ? item.views : 0,
    publishedAt:validDate(item.publishedAt) ? item.publishedAt : '',
    type:typeof item.type === 'string' ? item.type : '動画',tags:Array.isArray(item.tags) ? item.tags.filter(t => typeof t === 'string') : [],
    thumbnail:safeThumbnail(item.thumbnail ?? (legacy ? `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` : ''))};
}
export function normalizeVideos(value) {
  const legacy = Array.isArray(value);
  const list = items => (Array.isArray(items) ? items : []).map(item => videoItem(item,legacy)).filter(Boolean);
  return {fetchedAt:fetchedAt(value?.fetchedAt),potty:list(legacy ? value : value?.potty),popular:list(legacy ? [] : value?.popular)};
}
export function normalizeSchedule(value) {
  const legacy = Array.isArray(value);
  const items = legacy ? value : Array.isArray(value?.items) ? value.items : [];
  return {fetchedAt:fetchedAt(value?.fetchedAt),items:items.flatMap(item => {
    if (!item) return [];
    const id = legacy ? item.videoId || item.id : item.id;
    if (!validId(id) || !validDate(item.start) || typeof item.title !== 'string' || (!legacy && !['live','upcoming'].includes(item.status))) return [];
    return [{...item,id,title:item.title.slice(0,200),status:legacy ? 'upcoming' : item.status,
      channelTitle:typeof item.channelTitle === 'string' ? item.channelTitle : legacy ? 'ポッティ' : '',
      isPotty:legacy || item.isPotty === true,genso:legacy || item.genso === true,
      thumbnail:safeThumbnail(item.thumbnail ?? (legacy ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '')),
      url:`https://www.youtube.com/watch?v=${id}`}];
  })};
}
export const allVideos = videos => [...videos.potty,...videos.popular];
export const activeSchedule = (schedule,now = Date.now()) => schedule.items.filter(item => item.status === 'live' || Date.parse(item.start) >= now-3*3600000).sort((a,b) => Number(b.status === 'live')-Number(a.status === 'live') || Date.parse(a.start)-Date.parse(b.start));
export function stationState(schedule,now = Date.now()) {
  const items = activeSchedule(schedule,now);
  const live = items.find(item => item.isPotty && item.status === 'live');
  const next = items.find(item => item.isPotty && item.status === 'upcoming');
  const community = items.filter(item => !item.isPotty && item.genso && item.status === 'live');
  return live ? {kind:'live',item:live} : next ? {kind:'upcoming',item:next} : community.length ? {kind:'community',count:community.length} : {kind:'empty'};
}
export function updatedLabel(value) {
  if (!validDate(value)) return 'データ取得前です';
  const parts = new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const part = type => parts.find(p => p.type === type).value;
  return `最終更新 ${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}
