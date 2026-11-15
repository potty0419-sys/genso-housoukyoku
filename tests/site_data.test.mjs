import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule, normalizeVideos, stationState, updatedLabel } from '../src/js/data.js';
import { calendarText } from '../src/js/calendar.js';
import { homePage } from '../src/js/pages/home.js';
import { boardPage } from '../src/js/pages/board.js';
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../src/data/config.json',import.meta.url),'utf8'));
const now = Date.parse('2026-11-15T03:00:00Z');
const item = (changes = {}) => ({id:'AAAAAAAAAA1',start:'2026-11-15T04:00:00Z',status:'upcoming',title:'元素騎士',channelTitle:'ポッティ',isPotty:true,genso:true,...changes});

test('新旧JSON・null・壊れた項目を安全に読み込む',() => {
  assert.deepEqual(normalizeSchedule(null),{fetchedAt:null,items:[]});
  assert.deepEqual(normalizeVideos(undefined),{fetchedAt:null,potty:[],popular:[]});
  const schedule = normalizeSchedule([{id:'s1',videoId:'AAAAAAAAAA1',title:'旧形式',start:'2026-11-15T04:00:00Z'}]);
  assert.equal(schedule.items[0].id,'AAAAAAAAAA1'); assert.equal(schedule.items[0].isPotty,true);
  const videos = normalizeVideos([{id:'AAAAAAAAAA1',title:'旧動画',tags:['金策'],publishedAt:'2026-11-14'}]);
  assert.equal(videos.potty.length,1); assert.equal(videos.popular.length,0);
  assert.equal(normalizeVideos({potty:[null,{id:'invalid',title:'x'}],popular:'bad'}).potty.length,0);
  assert.equal(normalizeSchedule({items:[null,{...item(),start:'bad'}]}).items.length,0);
});

test('ON AIRはポッティLIVE→ポッティ予定→元素騎士LIVE→空の優先順',() => {
  const ownLive = item({status:'live',start:'2026-11-15T02:00:00Z'});
  const ownNext = item({id:'AAAAAAAAAA2'});
  const communityLive = item({id:'AAAAAAAAAA3',isPotty:false,status:'live'});
  assert.equal(stationState({items:[communityLive,ownNext,ownLive]},now).item.id,ownLive.id);
  assert.equal(stationState({items:[communityLive,ownNext]},now).kind,'upcoming');
  assert.deepEqual(stationState({items:[communityLive]},now),{kind:'community',count:1});
  assert.equal(stationState({items:[{...communityLive,genso:false}]},now).kind,'empty');
  assert.equal(stationState({items:[item({start:'2021-01-01T00:00:00Z'})]},now).kind,'empty');
});

test('更新日はJSTで表示、取得前は日付を出さない',() => {
  assert.equal(updatedLabel(null),'データ取得前です');
  assert.equal(updatedLabel('invalid'),'データ取得前です');
  assert.equal(updatedLabel('2026-11-14T15:07:00Z'),'最終更新 11/15 00:07');
});

test('ICSは2時間、改行をエスケープしUTF-8を75 octetsで折り返す',() => {
  const calendar = calendarText({...item(),title:'元素騎士'.repeat(40)+'\r\nURL:evil',channelTitle:'a,b;c'},now);
  assert.ok(calendar.includes('DTSTART:20261115T040000Z'));
  assert.ok(calendar.includes('DTEND:20261115T060000Z'));
  assert.ok(!calendar.includes('\r\nURL:evil'));
  assert.ok(calendar.replace(/\r\n /g,'').includes('\\nURL:evil'));
  assert.ok(calendar.includes('DESCRIPTION:a\\,b\\;c'));
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
});

test('保留中はストアに触れず、サンプルニュースは出さず、人気はポッティへfallback',async () => {
  const root = {innerHTML:''};
  const store = {list() { throw new Error('保留中にストアへアクセス'); }};
  await boardPage({root,config,store});
  assert.ok(root.innerHTML.includes('パーティ募集掲示板は準備中です。公開までもう少しお待ちください。'));
  const video = normalizeVideos([{id:'AAAAAAAAAA1',title:'<script>alert(1)</script>',views:1}]);
  await homePage({root,config,store,schedule:normalizeSchedule(null),videos:video,news:[{sample:true,title:'仮のお知らせ'}]});
  assert.ok(!root.innerHTML.includes('新着パーティ募集'));
  assert.ok(!root.innerHTML.includes('news-list'));
  assert.ok(root.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(root.innerHTML.includes('データ取得前です'));
});
