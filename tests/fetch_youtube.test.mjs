import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectYouTube, matchesKeywords, toSchedule, classifyVideo, capPerChannel, dedupe, durationSeconds, safeThumbnail, validateResult, run, redact } from '../scripts/fetch_youtube.mjs';
import { fixture, fixtureFetch } from './fixtures/youtube.mjs';
const sources = JSON.parse(await readFile(new URL('../src/data/sources.json',import.meta.url),'utf8'));
const now = Date.parse(fixture.now), apiKey = 'fixture-api-secret';
const collect = (data = fixture, extra = {}) => collectYouTube({sources,now,apiKey,fetchJson:fixtureFetch(data),...extra});

test('キーワードはタイトル・説明、大文字小文字を無視。無関係・非公開・配信中は動画に入れない',async () => {
  assert.ok(matchesKeywords({snippet:{title:'test',description:'GENSO KISHI'}},sources.keywords));
  assert.ok(!matchesKeywords({snippet:{title:'別のゲーム'}},sources.keywords));
  const {videos} = await collect();
  assert.deepEqual(videos.potty.map(v => v.id),['AAAAAAAAAA1','AAAAAAAAAA2']);
  assert.equal(videos.potty[0].views,900);
  assert.deepEqual(videos.potty[0].tags,['ドラタワ','金策']);
});

test('古いupcoming・遠すぎる予定・終了済みlive・実開始なしを除外、ポッティの非元素配信は残す',async () => {
  const {schedule} = await collect();
  assert.deepEqual(schedule.items.map(v => v.id),['CCCCCCCCCC1','AAAAAAAAAA4','BBBBBBBBBB1','AAAAAAAAAA3']);
  assert.equal(schedule.items.find(v => v.id === 'AAAAAAAAAA3').genso,false);
  assert.equal(schedule.items.find(v => v.id === 'AAAAAAAAAA4').genso,false);
  const video = structuredClone(fixture.videos.find(v => v.id === 'BBBBBBBBBB1'));
  for (const [offset,keep] of [[-3*3600000,true],[-3*3600000-1,false],[30*86400000,true],[30*86400000+1,false]]) {
    video.liveStreamingDetails.scheduledStartTime = new Date(now+offset).toISOString();
    assert.equal(Boolean(toSchedule(video,sources,now)),keep);
  }
});

test('再生数順でチャンネルごとに3本、全体上限と重複排除',async () => {
  const {videos} = await collect();
  assert.deepEqual(videos.popular.map(v => v.views),[6000,5000,4000,900,800]);
  assert.equal(videos.popular.filter(v => v.channelId === 'popular1').length,3);
  assert.deepEqual(capPerChannel([{channelId:'a',id:1},{channelId:'a',id:2},{channelId:'b',id:3}],1).map(v => v.id),[1,3]);
  assert.equal(dedupe([{id:'a'},{id:'a'}]).length,1);
  const limited = await collect(fixture,{sources:{...sources,popularMax:2,pottyMax:1}});
  assert.equal(limited.videos.popular.length,2); assert.equal(limited.videos.potty.length,1);
});

test('種別・ISO duration：アーカイブを優先、180秒以下はショート',() => {
  assert.equal(classifyVideo({contentDetails:{duration:'PT3M'}}),'ショート');
  assert.equal(classifyVideo({contentDetails:{duration:'PT3M1S'}}),'動画');
  assert.equal(classifyVideo({contentDetails:{duration:'PT1M'},liveStreamingDetails:{actualStartTime:fixture.now}}),'配信アーカイブ');
  assert.equal(durationSeconds('P1DT2H3M4S'),93784);
  assert.throws(() => durationSeconds('invalid'));
});

test('検索は3回のみ。uploadsは最大4ページ、videosは50件で分割',async () => {
  const calls = [];
  await collect(fixture,{fetchJson:fixtureFetch(fixture,calls)});
  const searches = calls.filter(url => url.pathname.endsWith('/search'));
  assert.equal(searches.length,3);
  assert.deepEqual(searches.map(url => url.searchParams.get('eventType')),['upcoming','live',null]);
  for (const url of searches) {
    assert.equal(url.searchParams.get('regionCode'),'JP'); assert.equal(url.searchParams.get('relevanceLanguage'),'ja');
    assert.equal(url.searchParams.get('type'),'video'); assert.equal(url.searchParams.get('maxResults'),'50');
  }
  assert.equal(searches[2].searchParams.get('publishedAfter'),new Date(now-30*86400000).toISOString());
  const batches = [], pages = [];
  await collect(fixture,{fetchJson:async value => {
    const url = new URL(value), resource = url.pathname.split('/').at(-1);
    if (resource === 'playlistItems') {
      const page = pages.length; pages.push(url.searchParams.get('pageToken'));
      return {nextPageToken:`page${page+1}`,items:Array.from({length:50},(_,i) => ({contentDetails:{videoId:String(page*50+i).padStart(11,'0')}}))};
    }
    if (resource === 'videos') { batches.push(url.searchParams.get('id').split(',').length); return {items:[]}; }
    return {items:[]};
  }});
  assert.deepEqual(pages,[null,'page1','page2','page3']); assert.deepEqual(batches,[50,50,50,50]);
});

test('タイトルを200字に切り詰め、数値・IDを検証、サムネイルのホストを制限',async () => {
  const data = structuredClone(fixture);
  data.videos[0].snippet.title = '元素騎士'+'あ'.repeat(210);
  data.videos[0].snippet.thumbnails.medium.url = 'https://evil.example/test.jpg';
  const result = await collect(data);
  assert.equal(result.videos.potty[0].title.length,200); assert.equal(result.videos.potty[0].thumbnail,'');
  for (const value of ['http://i.ytimg.com/a','https://i.ytimg.com.evil.test/a','https://i.ytimg.com@evil.test/a','https://evil.test/a','javascript:alert(1)']) assert.equal(safeThumbnail(value),'');
  assert.equal(safeThumbnail('https://i.ytimg.com/vi/test.jpg'),'https://i.ytimg.com/vi/test.jpg');
  const invalid = structuredClone(result); invalid.videos.potty[0].views = Infinity;
  assert.throws(() => validateResult(invalid),/数値/);
  invalid.videos.potty[0].views = 1; invalid.videos.potty[0].id = '../invalid';
  assert.throws(() => validateResult(invalid),/ID/);
});

async function withSnapshot(t) {
  const dataDir = await mkdtemp(join(tmpdir(),'genso-youtube-'));
  t.after(() => rm(dataDir,{recursive:true,force:true}));
  await writeFile(join(dataDir,'sources.json'),JSON.stringify(sources));
  await writeFile(join(dataDir,'schedule.json'),'old schedule\n');
  await writeFile(join(dataDir,'videos.json'),'old videos\n');
  return dataDir;
}

test('全工程成功後のみ更新し、dry-runは何も書かない',async t => {
  const dataDir = await withSnapshot(t), logs = [];
  const options = {dataDir,apiKey,now,fetchJson:fixtureFetch(),log:s => logs.push(s)};
  await run({...options,dryRun:true});
  assert.equal(await readFile(join(dataDir,'schedule.json'),'utf8'),'old schedule\n');
  assert.equal(await readFile(join(dataDir,'videos.json'),'utf8'),'old videos\n');
  assert.match(logs[0],/DRY RUN/);
  await run(options);
  assert.equal(JSON.parse(await readFile(join(dataDir,'schedule.json'),'utf8')).items.length,4);
  assert.equal(JSON.parse(await readFile(join(dataDir,'videos.json'),'utf8')).potty.length,2);
  assert.equal((await readdir(dataDir)).length,3);
});

test('最後のAPI失敗・不正応答・不正数値でも古い両ファイルを保持し、キーを伏せる',async t => {
  const dataDir = await withSnapshot(t);
  const scenarios = [async value => {
    if (new URL(value).searchParams.get('order') === 'viewCount') throw new Error(`failed ${value} ${apiKey}`);
    return fixtureFetch()(value);
  },async () => ({error:{message:apiKey}}),fixtureFetch({...fixture,videos:fixture.videos.map(v => v.id === 'AAAAAAAAAA1' ? {...v,statistics:{viewCount:'NaN'}} : v)})];
  for (const fetchJson of scenarios) {
    await assert.rejects(run({dataDir,apiKey,now,fetchJson}),error => !error.message.includes(apiKey));
    assert.equal(await readFile(join(dataDir,'schedule.json'),'utf8'),'old schedule\n');
    assert.equal(await readFile(join(dataDir,'videos.json'),'utf8'),'old videos\n');
  }
  assert.equal(redact('https://example.test?key=hidden&x=1'),'https://example.test?key=[REDACTED]&x=1');
});
