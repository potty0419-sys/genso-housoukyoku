import { Store } from './Store.js';
import { readLocal, writeLocal } from '../utils.js';

const DB = 'genso.board.v1';
const KEYS = 'genso.hostKeys.v1';
const fresh = () => ({ posts:[], lastPostAt:0, fingerprints:[], reported:[], interested:[] });
const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2,'0')).join('');
const token = () => crypto.randomUUID();

export class LocalStore extends Store {
  constructor(config, { clock = () => Date.now() } = {}) { super(); this.config = config; this.clock = clock; }
  read() { return readLocal(DB, fresh()); }
  async mutate(action) {
    const run = async () => {
      const state = this.read();
      const result = await action(state);
      writeLocal(DB, state);
      window.dispatchEvent(new Event('genso-store-change'));
      return result;
    };
    return navigator.locks ? navigator.locks.request(DB, run) : run();
  }
  expires(post) { return post.type === 'shout' ? post.createdAt + 86400000 : post.start + post.duration * 60000; }
  publicPost(post, state) {
    const { deleteHash, ...safe } = post;
    return { ...safe, expiresAt:this.expires(post), ended:post.closed || this.expires(post) <= this.clock(), reported:state.reported.includes(post.id), interested:state.interested.includes(post.id) };
  }
  async list(filters = {}) {
    const state = this.read();
    const now = this.clock();
    return state.posts.filter(p => p.reports < 3 && p.type === (filters.type || 'party')).map(p => this.publicPost(p,state)).filter(p => {
      if ((!filters.includeEnded || p.type === 'shout') && p.ended) return false;
      if (filters.purpose && p.purpose !== filters.purpose) return false;
      if (filters.job && !p.jobs.includes(filters.job)) return false;
      if (filters.level !== undefined && filters.level !== '' && (Number(filters.level) < p.levelMin || Number(filters.level) > p.levelMax)) return false;
      const japan = time => new Date(time + 9 * 3600000).toISOString().slice(0,10);
      if (filters.time === 'now' && !(p.start <= now && p.expiresAt > now && !p.closed)) return false;
      if (filters.time === 'hour' && !(p.start <= now + 3600000 && p.expiresAt > now && !p.closed)) return false;
      if (filters.time === 'today' && japan(p.start) !== japan(now)) return false;
      if (filters.time === 'tonight' && (japan(p.start) !== japan(now) || p.start < Date.parse(`${japan(now)}T21:00:00+09:00`))) return false;
      return true;
    }).sort((a,b) => filters.type === 'shout' ? b.createdAt-a.createdAt : a.start-b.start);
  }
  validateText(text, limit, label) {
    if (typeof text !== 'string' || [...text].length > limit) throw new Error(`${label}は${limit}文字以内で入力してください。`);
    const normalized = text.normalize('NFKC');
    const compact = normalized.replace(/[\s\u200B-\u200D\uFEFF]/g,'');
    if (this.config.ngWords.some(word => normalize(text).includes(normalize(word)))) throw new Error('投稿できない語句が含まれています。内容を見直してください。');
    if (/(?:https?:|ftp:|www\.|[a-z0-9-]+\.(?:[a-z]{2,})(?:\b|\/)|@|[a-z0-9._%+-]+\s*\[at\])/i.test(compact) || /(?:\+?\d[\d()\-ー−.]{8,}\d)/.test(compact)) throw new Error('URL・電話番号・メールアドレスは入力できません。連絡はゲーム内でお願いします。');
    return text.trim();
  }
  validate(data) {
    if (!['party','shout'].includes(data.type)) throw new Error('投稿の種類が正しくありません。');
    if (data.type === 'shout') {
      const comment = this.validateText(data.comment,40,'ひとこと');
      if (!comment) throw new Error('ひとことを入力してください。');
      return { type:'shout', comment };
    }
    if (!this.config.purposes.includes(data.purpose) || !Array.isArray(data.jobs) || !data.jobs.length || data.jobs.some(j => !this.config.jobs.includes(j))) throw new Error('目的と募集する職業を選んでください。');
    const numbers = ['levelMin','levelMax','duration','current','capacity','start'];
    const p = Object.fromEntries(numbers.map(k => [k, Number(data[k] ?? (k === 'duration' ? 60 : NaN))]));
    if (numbers.some(k => !Number.isFinite(p[k])) || numbers.filter(k => k !== 'start').some(k => !Number.isInteger(p[k]))) throw new Error('数値を正しく入力してください。');
    if (p.levelMin < 1 || p.levelMax < p.levelMin || p.levelMax > 999 || p.duration < 1 || p.duration > 1440 || p.capacity < 1 || p.capacity > 100 || p.current < 1 || p.current > p.capacity || Math.abs(p.start-this.clock()) > 366*86400000) throw new Error('レベル・人数・所要時間・開始時刻の範囲を確認してください。');
    const place = this.validateText(data.place,60,'集合場所');
    const character = this.validateText(data.character,30,'キャラ名');
    const comment = this.validateText(data.comment,140,'コメント');
    if (!place || !character) throw new Error('集合場所とゲーム内キャラ名を入力してください。');
    return { type:'party', purpose:data.purpose, jobs:[...new Set(data.jobs)], ...p, place, character, comment };
  }
  async create(data) {
    const valid = this.validate(data);
    const fingerprint = normalize(JSON.stringify(valid.type === 'shout' ? [valid.type,valid.comment] : [valid.type,valid.purpose,[...valid.jobs].sort(),valid.levelMin,valid.levelMax,valid.place,valid.character,valid.comment]));
    const deleteKey = token();
    const deleteHash = await hash(deleteKey);
    return this.mutate(state => {
      const now = this.clock();
      state.fingerprints = state.fingerprints.filter(f => now-f.at < 86400000);
      if (state.fingerprints.some(f => f.value === fingerprint)) throw new Error('同じ内容は24時間以内に再投稿できません。');
      if (state.lastPostAt && now-state.lastPostAt < 180000) throw new Error(`投稿は3分に1件です。あと${Math.ceil((180000-(now-state.lastPostAt))/1000)}秒お待ちください。`);
      const post = { ...valid, id:token(), createdAt:now, reports:0, interests:0, closed:false, sample:true, deleteHash };
      // 削除キーを先に保存。保存できなければ投稿自体を作成しない。
      writeLocal(KEYS, { ...readLocal(KEYS,{}), [post.id]:deleteKey });
      state.posts.push(post);
      state.lastPostAt = now;
      state.fingerprints.push({ value:fingerprint, at:now });
      return { post:this.publicPost(post,state), deleteKey };
    });
  }
  hostKey(id) { return readLocal(KEYS,{})[id]; }
  async authorize(state,id,key) {
    const post = state.posts.find(p => p.id === id);
    if (!post) throw new Error('投稿が見つかりません。');
    if (!key || await hash(key) !== post.deleteHash) throw new Error('削除キーが一致しません。この投稿を作成したブラウザで操作してください。');
    return post;
  }
  async update(id, changes, deleteKey) {
    return this.mutate(async state => {
      const post = await this.authorize(state,id,deleteKey);
      if (post.type !== 'party') throw new Error('この投稿では人数更新はできません。');
      if ('current' in changes) {
        const n = Number(changes.current);
        if (!Number.isInteger(n) || n < 1 || n > post.capacity) throw new Error('現在人数は1〜定員の整数で入力してください。');
        post.current = n;
      }
      if (changes.closed === true) post.closed = true;
      return this.publicPost(post,state);
    });
  }
  async remove(id, deleteKey) {
    return this.mutate(async state => {
      await this.authorize(state,id,deleteKey);
      state.posts = state.posts.filter(p => p.id !== id);
      const keys = readLocal(KEYS,{}); delete keys[id]; writeLocal(KEYS,keys);
      return true;
    });
  }
  async report(id, { debug = false } = {}) {
    return this.mutate(state => {
      const post = state.posts.find(p => p.id === id);
      if (!post) throw new Error('投稿が見つかりません。');
      if (!debug && state.reported.includes(id)) throw new Error('このブラウザからは通報済みです。');
      if (!debug) state.reported.push(id);
      post.reports += 1;
      return post.reports;
    });
  }
  async interest(id) {
    return this.mutate(state => {
      const post = state.posts.find(p => p.id === id);
      if (!post || post.type !== 'party' || post.reports >= 3 || post.closed || post.current >= post.capacity || this.expires(post) <= this.clock()) throw new Error('この募集は終了・満員または非表示になりました。');
      if (state.interested.includes(id)) throw new Error('このブラウザからは参加希望を送信済みです。');
      state.interested.push(id); post.interests += 1;
      return post.interests;
    });
  }
  async seed() {
    return this.mutate(state => {
      if (state.seeded) return;
      const now = this.clock();
      const offsets = [-5,10,30,55,120,-150];
      const purposes = ['ドラタワ初級','ギルド防衛戦','金策','レベリング','ドラタワ中級','ボス討伐'];
      offsets.forEach((offset,i) => state.posts.push({
        id:`sample-${i+1}`, type:'party', purpose:purposes[i], jobs:i%2 ? ['ビショップ','クレリック','ナイト'] : ['ファイター','ウィザード','シーフ','その他'],
        levelMin:1+i*5, levelMax:50+i*5, start:now+offset*60000, duration:60, current:2, capacity:4, place:`サンプル広場 / ch.${i+1}`, character:`サンプル冒険者${i+1}`,
        comment:['のんびり周回する募集の見本です。初めての方もどうぞ。','協力して遊ぶ募集の見本です。集合後に相談しましょう。','ゲーム内で声をかける流れを試すための仮投稿です。'][i%3], createdAt:now-i*60000, reports:0, interests:i, closed:false, sample:true, deleteHash:null
      }));
      state.seeded = true;
    });
  }
}
