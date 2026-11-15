import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const DAY = 86400000;
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const isPublic = video => !video.status?.privacyStatus || video.status.privacyStatus === 'public';
export function matchesKeywords(video, keywords, exclude = []) {
  const text = `${video.snippet?.title || ''}\n${video.snippet?.description || ''}`.toLowerCase();
  if (exclude.some(word => text.includes(word.toLowerCase()))) return false;
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}
export function safeThumbnail(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host === 'i.ytimg.com' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function durationSeconds(iso) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso || '');
  if (!match || !match.slice(1).some(v => v !== undefined)) throw new Error('動画の再生時間が不正です。');
  return Number(match[1] || 0)*86400 + Number(match[2] || 0)*3600 + Number(match[3] || 0)*60 + Number(match[4] || 0);
}
export function classifyVideo(video, durationSec = durationSeconds(video.contentDetails?.duration)) {
  return video.liveStreamingDetails?.actualStartTime ? '配信アーカイブ' : durationSec <= 180 ? 'ショート' : '動画';
}
export const dedupe = items => [...new Map(items.map(item => [item.id, item])).values()];
export function capPerChannel(items, max) {
  const counts = new Map();
  return items.filter(item => {
    const count = counts.get(item.channelId) || 0;
    if (count >= max) return false;
    counts.set(item.channelId, count + 1);
    return true;
  });
}
export const sortSchedule = items => [...items].sort((a,b) => Number(b.status === 'live') - Number(a.status === 'live') || Date.parse(a.start) - Date.parse(b.start));
function commonFields(video, sources) {
  const snippet = video.snippet;
  if (typeof snippet?.title !== 'string' || typeof snippet?.channelTitle !== 'string' || typeof snippet?.channelId !== 'string') throw new Error('動画のsnippetが不正です。');
  return {
    id: video.id, title: snippet.title.slice(0,200), channelTitle: snippet.channelTitle,
    channelId: snippet.channelId, isPotty: snippet.channelId === sources.pottyChannelId,
    thumbnail: safeThumbnail(snippet.thumbnails?.medium?.url || snippet.thumbnails?.high?.url)
  };
}
export function toVideo(video, sources) {
  const durationSec = durationSeconds(video.contentDetails?.duration);
  return {
    ...commonFields(video,sources), views: Number(video.statistics?.viewCount ?? 0),
    publishedAt: video.snippet.publishedAt, durationSec, type: classifyVideo(video,durationSec),
    tags: Object.entries(sources.tagRules).filter(([,words]) => words.some(word => video.snippet.title.toLowerCase().includes(word.toLowerCase()))).map(([tag]) => tag)
  };
}
export function toSchedule(video, sources, now) {
  if (!isPublic(video)) return null;
  const isPotty = video.snippet?.channelId === sources.pottyChannelId;
  const genso = matchesKeywords(video,sources.keywords,sources.excludeKeywords || []);
  if (!isPotty && !genso) return null;
  const status = video.snippet?.liveBroadcastContent, details = video.liveStreamingDetails || {};
  let start;
  if (status === 'upcoming') {
    start = details.scheduledStartTime;
    if (!isDate(start) || Date.parse(start) < now-3*3600000 || Date.parse(start) > now+sources.scheduleDaysAhead*DAY) return null;
  } else if (status === 'live') {
    start = details.actualStartTime;
    if (!isDate(start) || details.actualEndTime) return null;
  } else return null;
  return {...commonFields(video,sources), status, start: new Date(start).toISOString(), genso, url: `https://www.youtube.com/watch?v=${video.id}`};
}
export const isRecorded = video => isPublic(video) && !['upcoming','live'].includes(video.snippet?.liveBroadcastContent);
export function validateResult({schedule,videos}) {
  const check = (ok, name) => { if (!ok) throw new Error(`取得結果の検証に失敗しました：${name}`); };
  check(isDate(schedule.fetchedAt) && schedule.fetchedAt === videos.fetchedAt,'fetchedAt');
  for (const items of [schedule.items,videos.potty,videos.popular]) {
    check(Array.isArray(items),'配列');
    check(new Set(items.map(item => item.id)).size === items.length,'重複ID');
    for (const item of items) {
      check(typeof item.id === 'string' && VIDEO_ID.test(item.id),'ID');
      check(typeof item.title === 'string' && item.title.length <= 200,'title');
      check(typeof item.channelTitle === 'string' && typeof item.channelId === 'string' && item.channelId.length > 0,'channel');
      check(typeof item.isPotty === 'boolean','isPotty');
      check(typeof item.thumbnail === 'string' && (!item.thumbnail || safeThumbnail(item.thumbnail) === item.thumbnail),'thumbnail');
    }
  }
  for (const item of schedule.items) {
    check(['live','upcoming'].includes(item.status) && isDate(item.start),'配信日時');
    check(typeof item.genso === 'boolean' && item.url === `https://www.youtube.com/watch?v=${item.id}`,'配信URL');
  }
  for (const item of [...videos.potty,...videos.popular]) {
    check(Number.isFinite(item.views) && item.views >= 0 && Number.isFinite(item.durationSec) && item.durationSec >= 0,'数値');
    check(isDate(item.publishedAt),'公開日時');
    check(['配信アーカイブ','ショート','動画'].includes(item.type),'種別');
    check(Array.isArray(item.tags) && item.tags.every(tag => typeof tag === 'string'),'タグ');
  }
  return {schedule,videos};
}
export function validateSources(sources) {
  if (!sources || !['pottyChannelId','pottyUploadsPlaylistId','searchQuery'].every(k => typeof sources[k] === 'string' && sources[k]) ||
      !Array.isArray(sources.keywords) || !sources.keywords.length || !sources.keywords.every(k => typeof k === 'string' && k) ||
      !['popularDays','popularMax','perChannelMax','pottyMax','scheduleDaysAhead'].every(k => Number.isSafeInteger(sources[k]) && sources[k] > 0) ||
      !sources.tagRules || !Object.values(sources.tagRules).every(words => Array.isArray(words) && words.every(w => typeof w === 'string' && w))) throw new Error('sources.jsonの設定が不正です。');
}
export function redact(message, key = '') {
  let text = String(message);
  for (const secret of [key,encodeURIComponent(key)]) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/(key=)[^\s&"'<>]+/gi,'$1[REDACTED]');
}
export async function fetchJson(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`YouTube API HTTP ${response.status}`);
  return response.json();
}
export async function collectYouTube({sources,apiKey,fetchJson:request = fetchJson,now = Date.now()}) {
  validateSources(sources);
  if (!apiKey) throw new Error('YOUTUBE_API_KEYが設定されていません。');
  const api = async (resource, params) => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.search = new URLSearchParams({...params,key:apiKey});
    const result = await request(url.href);
    if (result.error || !Array.isArray(result.items)) throw new Error(`YouTube API ${resource} の応答が不正です。`);
    return result;
  };
  const details = async ids => {
    if (ids.some(id => typeof id !== 'string' || !VIDEO_ID.test(id))) throw new Error('動画IDが不正です。');
    const unique = [...new Set(ids)], items = [];
    for (let i=0; i<unique.length; i+=50) {
      const result = await api('videos',{part:'snippet,statistics,contentDetails,liveStreamingDetails,status',id:unique.slice(i,i+50).join(',')});
      items.push(...result.items);
    }
    return items;
  };
  const uploadIds = [];
  let pageToken;
  for (let page=0; page<4; page++) {
    const result = await api('playlistItems',{part:'contentDetails',playlistId:sources.pottyUploadsPlaylistId,maxResults:50,...(pageToken ? {pageToken} : {})});
    uploadIds.push(...result.items.map(item => item.contentDetails?.videoId));
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  if (uploadIds.some(id => typeof id !== 'string' || !VIDEO_ID.test(id))) throw new Error('uploadsの動画IDが不正です。');
  const own = await details(uploadIds);
  const communityIds = [];
  const searchParams = {part:'id',q:sources.searchQuery,type:'video',regionCode:'JP',relevanceLanguage:'ja',maxResults:50};
  // 検索はこの2回と人気の1回のみ（約300 units + list calls）。
  for (const eventType of ['upcoming','live']) {
    const result = await api('search',{...searchParams,eventType});
    communityIds.push(...result.items.map(item => item.id?.videoId));
  }
  const community = await details(communityIds);
  const popularSearch = await api('search',{...searchParams,order:'viewCount',publishedAfter:new Date(now-sources.popularDays*DAY).toISOString()});
  const popularDetails = await details(popularSearch.items.map(item => item.id?.videoId));
  const recorded = items => dedupe(items.filter(video => isRecorded(video) && matchesKeywords(video,sources.keywords,sources.excludeKeywords || [])).map(video => toVideo(video,sources)));
  const result = validateResult({
    schedule:{fetchedAt:new Date(now).toISOString(),items:sortSchedule(dedupe([...own,...community].map(video => toSchedule(video,sources,now)).filter(Boolean)))},
    videos:{fetchedAt:new Date(now).toISOString(),
      potty:recorded(own).sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,sources.pottyMax),
      popular:capPerChannel(recorded(popularDetails).filter(v => Date.parse(v.publishedAt) >= now-sources.popularDays*DAY).sort((a,b) => b.views-a.views),sources.perChannelMax).slice(0,sources.popularMax)}
  });
  if (JSON.stringify(result).includes(apiKey)) throw new Error('取得結果にAPIキーが含まれています。');
  return result;
}

// 全取得・検証後に両ファイルをステージング。置換の失敗時には元の内容へ戻す。
export async function writeSnapshot(dataDir, result) {
  validateResult(result);
  const files = ['schedule','videos'].map(name => ({path:resolve(dataDir,`${name}.json`),temp:resolve(dataDir,`.${name}-${process.pid}.tmp`),body:JSON.stringify(result[name],null,2)+'\n'}));
  for (const file of files) file.original = await readFile(file.path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const replaced = [];
  try {
    for (const file of files) await writeFile(file.temp,file.body,{flag:'wx'});
    for (const file of files) { await rename(file.temp,file.path); replaced.push(file); }
  } catch (error) {
    for (const file of replaced) {
      if (file.original === null) await rm(file.path,{force:true});
      else await writeFile(file.path,file.original);
    }
    throw error;
  } finally { await Promise.all(files.map(file => rm(file.temp,{force:true}))); }
}
export async function run({dataDir = fileURLToPath(new URL('../src/data/',import.meta.url)),apiKey = process.env.YOUTUBE_API_KEY,dryRun = false,fetchJson:request = fetchJson,now = Date.now(),log = console.log} = {}) {
  try {
    const sources = JSON.parse(await readFile(resolve(dataDir,'sources.json'),'utf8'));
    const result = await collectYouTube({sources,apiKey,fetchJson:request,now});
    if (!dryRun) await writeSnapshot(dataDir,result);
    log(`${dryRun ? 'DRY RUN: ' : ''}配信 ${result.schedule.items.length}件 / ポッティ ${result.videos.potty.length}本 / 人気 ${result.videos.popular.length}本`);
    return result;
  } catch (error) { throw new Error(redact(error.message,apiKey)); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run({dryRun:process.argv.includes('--dry-run')}).catch(error => { console.error(error.message); process.exitCode = 1; });
}
