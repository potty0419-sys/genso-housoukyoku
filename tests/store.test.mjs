import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LocalStore } from '../src/js/store/LocalStore.js';
import { defenseSlot } from '../src/js/utils.js';

const config=JSON.parse(readFileSync(new URL('../src/data/config.json',import.meta.url)));
globalThis.window=new EventTarget();
globalThis.localStorage={ data:new Map(), getItem(key) { return this.data.get(key) ?? null; }, setItem(key,value) { this.data.set(key,String(value)); }, clear() { this.data.clear(); } };
let now=Date.parse('2026-11-15T12:00:00+09:00');
const store=new LocalStore(config,{clock:() => now});
const advance = () => { now+=180001; };
const party=(changes={}) => ({ type:'party',purpose:config.purposes[0],jobs:[config.jobs[0]],levelMin:10,levelMax:30,start:now,duration:60,current:1,capacity:4,place:'サンプル広場',character:'検証キャラ',comment:'検証用の募集です',...changes });

test('ストレージ：期限・権限・荒らし対策・フィルター',async t => {
  await t.test('初回シードは6件、期限切れは通常非表示、再シードしない',async () => {
    await store.seed(); assert.equal((await store.list()).length,5); assert.equal((await store.list({includeEnded:true})).length,6);
    await store.seed(); assert.equal((await store.list({includeEnded:true})).length,6);
    assert.equal((await store.list({time:'now'})).length,1);
    assert.equal((await store.list({time:'hour'})).length,4);
    const jobs=await store.list({job:'ビショップ'}); assert.ok(jobs.length); assert.ok(jobs.every(p => p.jobs.includes('ビショップ')));
    assert.equal((await store.list({level:999})).length,0);
    const posts=await store.list(); assert.deepEqual(posts.map(p => p.start),posts.map(p => p.start).sort((a,b) => a-b));
    assert.ok(posts.every(p => !('deleteHash' in p)));
  });
  await t.test('連絡先・URL・NG語句・不正値を全自由記入欄で拒否',async () => {
    for (const field of ['comment','place','character']) {
      for (const text of ['https://example.com','test@example.com','090-1234-5678','０９０ １２３４ ５６７８','www.example.org','example.com/path','禁止語サンプル']) {
        await assert.rejects(store.create(party({[field]:text})),/入力できません|語句/);
      }
    }
    await assert.rejects(store.create(party({current:5,capacity:4})),/範囲/);
    await assert.rejects(store.create(party({comment:'あ'.repeat(141)})),/140/);
    await assert.rejects(store.create(party({jobs:[]})),/職業/);
    assert.equal(store.read().lastPostAt,0);
  });
  let created;
  await t.test('投稿と削除キーの保存・認証・人数・参加希望',async () => {
    created=await store.create(party({duration:undefined}));
    assert.equal(created.post.duration,60);
    assert.equal(store.hostKey(created.post.id),created.deleteKey);
    await assert.rejects(store.update(created.post.id,{current:2},'wrong'),/キー/);
    await assert.rejects(store.remove(created.post.id,'wrong'),/キー/);
    await store.update(created.post.id,{current:2},created.deleteKey);
    assert.equal((await store.list()).find(p => p.id===created.post.id).current,2);
    assert.equal(await store.interest(created.post.id),1);
    await assert.rejects(store.interest(created.post.id),/送信済み/);
    await store.update(created.post.id,{current:4},created.deleteKey);
    await assert.rejects(store.interest(created.post.id),/満員/);
  });
  await t.test('掲示板・ひとこと共通180秒制限、削除後も重複拒否',async () => {
    await assert.rejects(store.create({type:'shout',comment:'今は作業中です'}),/3分/);
    await assert.rejects(store.create(party()),/同じ内容/);
    await store.remove(created.post.id,created.deleteKey);
    assert.equal(store.hostKey(created.post.id),undefined);
    advance(); await assert.rejects(store.create(party()),/同じ内容/);
    assert.equal((await store.list({includeEnded:true})).some(p => p.id===created.post.id),false);
  });
  await t.test('締切・期限の自動判定、終了表示',async () => {
    const p=await store.create(party({comment:'締切の検証'}));
    await store.update(p.post.id,{closed:true},p.deleteKey);
    assert.ok(!(await store.list()).some(x => x.id===p.post.id));
    assert.ok((await store.list({includeEnded:true})).find(x => x.id===p.post.id).ended);
    advance(); const expired=await store.create(party({comment:'過去時刻',start:now-120*60000}));
    assert.ok(!(await store.list()).some(x => x.id===expired.post.id));
    assert.ok((await store.list({includeEnded:true})).find(x => x.id===expired.post.id).ended);
  });
  await t.test('通常通報の重複排除・3件で非表示（終了表示でも出ない）',async () => {
    assert.equal(await store.report('sample-1'),1);
    await assert.rejects(store.report('sample-1'),/通報済み/);
    await store.report('sample-1',{debug:true}); await store.report('sample-1',{debug:true});
    assert.ok(!(await store.list({includeEnded:true})).some(p => p.id==='sample-1'));
  });
  await t.test('ひとこと40字・NG・24時間失効',async () => {
    advance();
    await assert.rejects(store.create({type:'shout',comment:'あ'.repeat(41)}),/40/);
    await assert.rejects(store.create({type:'shout',comment:'test@example.com'}),/入力できません/);
    const shout=await store.create({type:'shout',comment:'のんびり周回中'});
    assert.equal((await store.list({type:'shout'})).length,1);
    now+=86400001;
    assert.equal((await store.list({type:'shout',includeEnded:true})).length,0);
    await store.remove(shout.post.id,shout.deleteKey);
  });
  await t.test('日本時間の今日・21時以降と防衛戦境界',async () => {
    localStorage.clear(); now=Date.parse('2026-11-15T18:00:00+09:00');
    await store.create(party({start:Date.parse('2026-11-15T21:15:00+09:00'),comment:'夜の募集'}));
    advance(); await store.create(party({start:Date.parse('2026-11-16T01:00:00+09:00'),comment:'明日の募集'}));
    assert.equal((await store.list({time:'today'})).length,1);
    assert.equal((await store.list({time:'tonight'})).length,1);
    assert.equal((await store.list({time:'hour'})).length,0);
    const live=defenseSlot(config,Date.parse('2026-11-15T22:29:59+09:00')); assert.ok(live.live);
    const next=defenseSlot(config,Date.parse('2026-11-15T22:30:00+09:00')); assert.ok(!next.live); assert.equal(next.start,Date.parse('2026-11-16T15:00:00+09:00'));
  });
});
