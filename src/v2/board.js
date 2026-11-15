// ドラゴンタワー掲示板（募集する側／参加待ちの側）
// 登録は「このページを開いている間だけ」有効。開いているタブが30秒ごとに生存を知らせ、
// 途切れて2分たった登録は誰の画面からも消える（＝ゲームを終えてページを閉じたら自動でオフ）。

const ALIVE_MS = 30 * 1000;      // 生存の知らせの間隔
const STALE_MS = 2 * 60 * 1000;  // これだけ途切れたらオフ扱い
const MAX_MS = 4 * 3600 * 1000;  // 開きっぱなしでも4時間で自動オフ
const POST_GAP_MS = 60 * 1000;   // 新規登録は1分に1回まで

/* ---------- 保存の層（あとで共有サーバーに差し替える） ---------- */
// LocalStore はこのブラウザの中だけ。タブ同士は BroadcastChannel で同期する。
export class LocalStore {
  constructor() {
    this.key = 'ghk.board.v2';
    this.ch = 'BroadcastChannel' in window ? new BroadcastChannel('ghk-board') : null;
    this.listeners = new Set();
    this.ch?.addEventListener('message', () => this.emit());
    addEventListener('storage', e => { if (e.key === this.key) this.emit(); });
  }
  get shared() { return false; }
  read() { try { const v = JSON.parse(localStorage.getItem(this.key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  write(list) { try { localStorage.setItem(this.key, JSON.stringify(list)); } catch { /* noop */ } this.ch?.postMessage('changed'); this.emit(); }
  emit() { for (const fn of this.listeners) fn(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async list() { return this.read(); }
  async create(post) { this.write([post, ...this.read().filter(p => p.id !== post.id)]); return post; }
  async touch(id, secret, patch = {}) {
    const list = this.read(); const p = list.find(x => x.id === id && x.secret === secret); if (!p) return false;
    Object.assign(p, patch, { lastSeen: Date.now() }); this.write(list); return true;
  }
  async remove(id, secret) { this.write(this.read().filter(p => !(p.id === id && p.secret === secret))); }
  async sweep() { const now = Date.now(); const list = this.read(); const keep = list.filter(p => isAlive(p, now)); if (keep.length !== list.length) this.write(keep); }
}

export const isAlive = (p, now = Date.now()) => p && now - p.lastSeen < STALE_MS && now - p.createdAt < MAX_MS;

/* ---------- 判定 ---------- */
export const validateText = (s, ng = []) => {
  const t = String(s || '');
  if (/https?:\/\/|www\.|\.(com|net|jp|io|gg|me)\b/i.test(t)) return 'URLは書けません。';
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) return 'メールアドレスは書けません。';
  if (/0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/.test(t.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)))) return '電話番号のような数字は書けません。';
  if (/discord|line\s?id|ライン|ディスコ/i.test(t)) return '連絡はゲーム内でお願いします（外部への誘導は書けません）。';
  if (ng.some(w => w && t.includes(w))) return '使えない言葉が入っています。';
  return '';
};
// 待ち w が 募集 p の枠に入れるか。入れる枠の一覧を返す。
export const fits = (p, w) => {
  if (p.kind !== 'host' || w.kind !== 'wait') return [];
  if (!w.towers.includes(p.tower)) return [];
  return p.slots.filter(s => s.left > 0 && (s.role === 'any' || w.role === 'any' || s.role === w.role) && (!s.stat || (Number(w.stats?.[s.stat]) || 0) >= s.min));
};

/* ---------- 生存の知らせ（どのページを開いていても動く） ---------- */
const MINE_KEY = 'ghk.board.mine';
export const getMine = () => { try { return JSON.parse(localStorage.getItem(MINE_KEY) || 'null'); } catch { return null; } };
export const setMine = v => { try { v ? localStorage.setItem(MINE_KEY, JSON.stringify(v)) : localStorage.removeItem(MINE_KEY); } catch { /* noop */ } };
export function keepAlive(store) {
  const beat = async () => { const m = getMine(); if (!m) return; if (!(await store.touch(m.id, m.secret))) setMine(null); store.sweep(); };
  beat(); setInterval(beat, ALIVE_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
}

/* ---------- 画面 ---------- */
export function mountBoard(root, { h, T, ng, store, fmt }) {
  const statLabel = id => T.stats.find(s => s.id === id)?.label || id;
  const roleLabel = id => T.roles.find(r => r.id === id)?.label || id;
  const tower = id => T.towers.find(t => t.id === id) || { label: id, name: '' };
  const mine = getMine;
  const ui = { mode: null, tab: 'host', tower: '', role: '', msg: '' };
  let posts = [];
  const LAST_KEY = 'ghk.board.last';
  const lastPost = () => { try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; } };

  const timer = setInterval(() => refresh(), ALIVE_MS);
  const tick = setInterval(() => root.querySelectorAll('[data-left]').forEach(el => { el.textContent = fmt.left(Number(el.dataset.left) - Date.now()); }), 1000);
  const unsub = store.subscribe(() => refresh());
  const refresh = async () => { posts = (await store.list()).filter(p => isAlive(p)); draw(); };

  /* ---- フォーム ---- */
  const chipRow = (items, isOn, onClick, attrs = {}) => h('div', { class: 'chips', ...attrs }, items.map(it => h('button', {
    type: 'button', class: `chip${isOn(it.id) ? ' on' : ''}`, 'aria-pressed': String(isOn(it.id)), text: it.label, onclick: () => onClick(it.id),
  })));
  const commonFields = st => [
    h('label', { class: 'field' }, h('span', { text: 'ゲーム内のキャラ名' }),
      h('input', { type: 'text', maxlength: '16', required: true, value: st.char, oninput: e => { st.char = e.target.value; }, placeholder: '声をかけるときに使います' })),
    h('label', { class: 'field' }, h('span', { text: 'ひとこと（40字まで・任意）' }),
      h('input', { type: 'text', maxlength: '40', value: st.comment, oninput: e => { st.comment = e.target.value; }, placeholder: st.kind === 'host' ? '例 周回します。ゆるく' : '例 回復できます。いつでも呼んでください' })),
  ];

  const hostForm = () => {
    const st = ui.form || (ui.form = { kind: 'host', tower: 'normal', start: 'now', at: '', have: 1, place: '', char: '', comment: '', slots: [{ role: 'dps', count: 1, stat: '', min: '' }] });
    const total = () => st.slots.reduce((a, s) => a + s.count, 0);
    const slotRow = (s, i) => {
      const statDef = T.stats.find(x => x.id === s.stat);
      const hint = (T.hints?.[st.tower]?.[s.role] || T.hints?.[st.tower]?.any || []);
      return h('div', { class: 'slot' },
        h('div', { class: 'slot-top' },
          chipRow(T.roles, id => s.role === id, id => { s.role = id; redraw(); }),
          h('div', { class: 'stepper' },
            h('button', { type: 'button', class: 'ghost small', 'aria-label': '人数を減らす', text: '−', onclick: () => { if (s.count > 1) { s.count--; redraw(); } } }),
            h('b', { class: 'mono', text: `${s.count}人` }),
            h('button', { type: 'button', class: 'ghost small', 'aria-label': '人数を増やす', text: '＋', onclick: () => { if (total() + st.have < T.partySize) { s.count++; redraw(); } } })),
          st.slots.length > 1 ? h('button', { type: 'button', class: 'linkbtn', text: '消す', onclick: () => { st.slots.splice(i, 1); redraw(); } }) : null),
        h('div', { class: 'slot-cond' },
          h('span', { class: 'muted small', text: '条件' }),
          chipRow([{ id: '', label: 'なし' }, ...T.stats], id => s.stat === id, id => { s.stat = id; s.min = ''; redraw(); }),
          s.stat ? h('div', { class: 'cond-val' },
            h('input', { type: 'text', inputmode: 'numeric', class: 'num', 'aria-label': `${statLabel(s.stat)}の下限`, value: s.min, placeholder: '数値', oninput: e => { s.min = e.target.value.replace(/[^\d]/g, ''); e.target.value = s.min; } }),
            h('span', { class: 'muted small', text: '以上' }),
            h('div', { class: 'chips' }, (statDef?.steps || []).map(v => h('button', { type: 'button', class: `chip${Number(s.min) === v ? ' on' : ''}`, text: v.toLocaleString(), onclick: () => { s.min = String(v); redraw(); } })))) : null,
          !s.stat && hint.length ? h('p', { class: 'muted small', text: `目安の例：${hint.map(x => `${statLabel(x.stat)} ${x.min.toLocaleString()}以上`).join(' / ')}（攻略ブログより）` }) : null));
    };
    return h('form', { class: 'bform', onsubmit: e => { e.preventDefault(); submit(st); } },
      h('fieldset', {}, h('legend', { text: '行く塔' }), chipRow(T.towers, id => st.tower === id, id => { st.tower = id; redraw(); })),
      h('fieldset', {}, h('legend', { text: 'いつ' }),
        h('div', { class: 'chips' },
          h('button', { type: 'button', class: `chip${st.start === 'now' ? ' on' : ''}`, text: '今すぐ', onclick: () => { st.start = 'now'; redraw(); } }),
          h('button', { type: 'button', class: `chip${st.start === 'at' ? ' on' : ''}`, text: '時刻を決める', onclick: () => { st.start = 'at'; redraw(); } }),
          st.start === 'at' ? h('input', { type: 'time', class: 'tinput', value: st.at, 'aria-label': '開始時刻', oninput: e => { st.at = e.target.value; } }) : null)),
      h('fieldset', {}, h('legend', { text: `いまのメンバー（自分を含めて）` }),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', class: 'ghost small', text: '−', 'aria-label': '減らす', onclick: () => { if (st.have > 1) { st.have--; redraw(); } } }),
          h('b', { class: 'mono', text: `${st.have}人 / ${T.partySize}人` }),
          h('button', { type: 'button', class: 'ghost small', text: '＋', 'aria-label': '増やす', onclick: () => { if (st.have + total() < T.partySize) { st.have++; redraw(); } } }))),
      h('fieldset', {}, h('legend', { text: `ほしい人（あと${T.partySize - st.have}人まで）` }),
        st.slots.map(slotRow),
        total() + st.have < T.partySize ? h('button', { type: 'button', class: 'ghost small', text: '＋ 役割を追加', onclick: () => { st.slots.push({ role: 'any', count: 1, stat: '', min: '' }); redraw(); } }) : null),
      h('label', { class: 'field' }, h('span', { text: '集合場所・チャンネル（任意）' }),
        h('input', { type: 'text', maxlength: '24', value: st.place, oninput: e => { st.place = e.target.value; }, placeholder: '例 ch3 タワー広場' })),
      ...commonFields(st),
      ui.msg ? h('p', { class: 'err', role: 'alert', text: ui.msg }) : null,
      h('div', { class: 'chips' }, h('button', { class: 'btn', type: 'submit', text: 'この内容で募集する' }), h('button', { class: 'linkbtn', type: 'button', text: 'やめる', onclick: () => { ui.mode = null; ui.form = null; ui.msg = ''; draw(); } })));
  };

  const waitForm = () => {
    const st = ui.form || (ui.form = { kind: 'wait', towers: ['normal'], role: 'dps', stats: {}, char: '', comment: '' });
    return h('form', { class: 'bform', onsubmit: e => { e.preventDefault(); submit(st); } },
      h('fieldset', {}, h('legend', { text: '行きたい塔（いくつでも）' }),
        chipRow(T.towers, id => st.towers.includes(id), id => { st.towers = st.towers.includes(id) ? st.towers.filter(x => x !== id) : [...st.towers, id]; redraw(); })),
      h('fieldset', {}, h('legend', { text: 'できる役割' }), chipRow(T.roles.map(r => r.id === 'any' ? { ...r, label: 'どれでも' } : r), id => st.role === id, id => { st.role = id; redraw(); })),
      h('fieldset', {}, h('legend', { text: '自分のステータス（入れたものだけで判定します）' }),
        h('div', { class: 'statgrid' }, T.stats.map(s => h('label', { class: 'field' }, h('span', { text: s.label }),
          h('input', { type: 'text', inputmode: 'numeric', class: 'num', value: st.stats[s.id] ?? '', placeholder: '—', oninput: e => { const v = e.target.value.replace(/[^\d]/g, ''); e.target.value = v; if (v) st.stats[s.id] = v; else delete st.stats[s.id]; } }))))),
      ...commonFields(st),
      ui.msg ? h('p', { class: 'err', role: 'alert', text: ui.msg }) : null,
      h('div', { class: 'chips' }, h('button', { class: 'btn', type: 'submit', text: '参加待ちで登録する' }), h('button', { class: 'linkbtn', type: 'button', text: 'やめる', onclick: () => { ui.mode = null; ui.form = null; ui.msg = ''; draw(); } })));
  };

  const submit = async st => {
    const char = st.char.trim();
    const err = !char ? 'キャラ名を入れてください。' : validateText(char, ng) || validateText(st.comment, ng) || validateText(st.place, ng)
      || (st.kind === 'host' && st.start === 'at' && !/^\d\d:\d\d$/.test(st.at) ? '開始時刻を入れてください。' : '')
      || (st.kind === 'host' && st.slots.some(s => s.stat && !(Number(s.min) > 0)) ? '条件の数値を入れてください（なしでもOK）。' : '')
      || (st.kind === 'wait' && !st.towers.length ? '行きたい塔を1つ以上選んでください。' : '')
      || (Date.now() - lastPost() < POST_GAP_MS ? '登録は1分に1回までです。少し待ってください。' : '');
    if (err) { ui.msg = err; redraw(); return; }
    const old = mine(); if (old) await store.remove(old.id, old.secret);
    const now = Date.now(); const id = crypto.randomUUID(); const secret = crypto.randomUUID();
    let startAt = now;
    if (st.kind === 'host' && st.start === 'at') {
      const [hh, mm] = st.at.split(':').map(Number); const j = new Date(now + 9 * 3600000);
      startAt = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), hh, mm) - 9 * 3600000;
      if (startAt < now - 15 * 60000) startAt += 86400000;
    }
    const base = { id, secret, kind: st.kind, char, comment: st.comment.trim(), createdAt: now, lastSeen: now, reports: 0 };
    const post = st.kind === 'host'
      ? { ...base, tower: st.tower, startAt, have: st.have, place: st.place.trim(), slots: st.slots.map(s => ({ role: s.role, count: s.count, left: s.count, stat: s.stat || '', min: s.stat ? Number(s.min) : 0 })) }
      : { ...base, towers: [...st.towers], role: st.role, stats: Object.fromEntries(Object.entries(st.stats).map(([k, v]) => [k, Number(v)])) };
    await store.create(post); setMine({ id, secret, kind: st.kind }); try { localStorage.setItem(LAST_KEY, String(now)); } catch { /* noop */ }
    ui.mode = null; ui.form = null; ui.msg = ''; ui.tab = st.kind === 'host' ? 'wait' : 'host';
    refresh();
  };

  /* ---- 一覧 ---- */
  const condText = s => `${roleLabel(s.role)}×${s.left}${s.stat ? `（${statLabel(s.stat)} ${s.min.toLocaleString()}以上）` : ''}`;
  const copyBtn = name => h('button', { type: 'button', class: 'ghost small', text: '名前をコピー', onclick: e => { navigator.clipboard?.writeText(name).then(() => { e.target.textContent = 'コピーしました'; }); } });
  const offAt = p => Math.min(p.lastSeen + STALE_MS, p.createdAt + MAX_MS);

  const hostCard = (p, me) => {
    const match = me?.kind === 'wait' ? fits(p, me) : [];
    const left = p.slots.reduce((a, s) => a + s.left, 0);
    return h('li', { class: `bcard${match.length ? ' match' : ''}` },
      h('div', { class: 'bcard-top' },
        h('span', { class: 'tower', text: tower(p.tower).label }),
        h('span', { class: 'muted small', text: tower(p.tower).name }),
        match.length ? h('span', { class: 'pill', text: 'あなたが入れる' }) : null,
        h('span', { class: 'when mono', text: p.startAt <= Date.now() + 60000 ? '今すぐ' : `${fmt.time(p.startAt)}〜` })),
      h('ul', { class: 'need' }, p.slots.filter(s => s.left > 0).map(s => h('li', { class: match.includes(s) ? 'ok' : '', text: condText(s) }))),
      h('p', { class: 'muted small', text: `${p.have + (p.slots.reduce((a, s) => a + s.count - s.left, 0))}人 / ${T.partySize}人・あと${left}人${p.place ? `・${p.place}` : ''}` }),
      p.comment ? h('p', { class: 'say', text: p.comment }) : null,
      h('div', { class: 'bcard-foot' }, h('b', { class: 'char', text: p.char }), copyBtn(p.char),
        h('span', { class: 'muted small live-dot', text: 'オンライン' })));
  };
  const waitCard = (w, me) => {
    const callable = me?.kind === 'host' ? fits(me, w) : [];
    return h('li', { class: `bcard${callable.length ? ' match' : ''}` },
      h('div', { class: 'bcard-top' },
        h('span', { class: 'tower role', text: w.role === 'any' ? 'どれでも' : roleLabel(w.role) }),
        callable.length ? h('span', { class: 'pill', text: '呼べる人' }) : null,
        h('span', { class: 'muted small', text: w.towers.map(t => tower(t).label).join('・') })),
      Object.keys(w.stats).length ? h('dl', { class: 'stats' }, T.stats.filter(s => w.stats[s.id] != null).flatMap(s => [h('dt', { text: s.label }), h('dd', { class: 'mono', text: Number(w.stats[s.id]).toLocaleString() })])) : h('p', { class: 'muted small', text: 'ステータスの登録なし' }),
      w.comment ? h('p', { class: 'say', text: w.comment }) : null,
      h('div', { class: 'bcard-foot' }, h('b', { class: 'char', text: w.char }), copyBtn(w.char), h('span', { class: 'muted small live-dot', text: 'オンライン' })));
  };

  const myCard = () => {
    const m = mine(); if (!m) return null;
    const p = posts.find(x => x.id === m.id); if (!p) return null;
    const ctl = p.kind === 'host'
      ? h('div', { class: 'chips' }, p.slots.map((s, i) => h('span', { class: 'mini-step' }, h('span', { class: 'small', text: roleLabel(s.role) }),
          h('button', { type: 'button', class: 'ghost small', text: '−', 'aria-label': `${roleLabel(s.role)}の残りを減らす`, onclick: async () => { if (s.left > 0) { const slots = p.slots.map((x, j) => j === i ? { ...x, left: x.left - 1 } : x); await store.touch(p.id, m.secret, { slots }); refresh(); } } }),
          h('b', { class: 'mono', text: `あと${s.left}` }),
          h('button', { type: 'button', class: 'ghost small', text: '＋', 'aria-label': `${roleLabel(s.role)}の残りを増やす`, onclick: async () => { if (s.left < s.count) { const slots = p.slots.map((x, j) => j === i ? { ...x, left: x.left + 1 } : x); await store.touch(p.id, m.secret, { slots }); refresh(); } } }))))
      : null;
    const full = p.kind === 'host' && p.slots.every(s => s.left === 0);
    return h('div', { class: 'mine' },
      h('div', { class: 'mine-top' },
        h('span', { class: 'pill live', text: '登録中' }),
        h('b', { text: p.kind === 'host' ? `${tower(p.tower).label}のメンバーを募集中` : '参加待ちで登録中' }),
        h('span', { class: 'muted small' }, '放送局を閉じると自動でオフ（ほかのページを見ていても続きます。あと ', h('span', { class: 'mono', 'data-left': String(p.createdAt + MAX_MS), text: fmt.left(p.createdAt + MAX_MS - Date.now()) }), ' で自動終了）')),
      ctl, full ? h('p', { class: 'small', text: '全員そろいました。オフにしておきましょう。' }) : null,
      h('div', { class: 'chips' }, h('button', { type: 'button', class: 'btn small', text: 'オフにする', onclick: async () => { await store.remove(p.id, m.secret); setMine(null); refresh(); } })));
  };

  const draw = () => {
    const me = (() => { const m = mine(); return m ? posts.find(p => p.id === m.id) : null; })();
    const hosts = posts.filter(p => p.kind === 'host' && (!ui.tower || p.tower === ui.tower) && (!ui.role || p.slots.some(s => s.left > 0 && (s.role === ui.role || s.role === 'any'))) && p.slots.some(s => s.left > 0));
    const waits = posts.filter(p => p.kind === 'wait' && (!ui.tower || p.towers.includes(ui.tower)) && (!ui.role || p.role === ui.role || p.role === 'any'));
    const score = p => me ? (p.kind === 'host' ? fits(p, me).length : fits(me, p).length) : 0;
    const sortHosts = [...hosts].sort((a, b) => score(b) - score(a) || a.startAt - b.startAt);
    const sortWaits = [...waits].sort((a, b) => score(b) - score(a) || b.createdAt - a.createdAt);

    root.replaceChildren(...[
      !store.shared ? h('p', { class: 'note warn', text: '試験中：いまはこのブラウザの中だけで動いています。ほかの人の登録はまだ見えません。' }) : null,
      h('div', { class: 'howto' },
        h('p', {}, 'ドラゴンタワーの仲間さがし。登録は', h('b', { text: '放送局を開いている間だけ' }), '表示され、閉じると2分以内に自動でオフになります。ゲームを終えたら、放送局のタブ（または「おとも」の小窓）を閉じるだけでOKです。'),
        h('p', { class: 'muted small', text: '連絡はゲーム内で。キャラ名をコピーして声をかけてください。URL・連絡先は書けません。' })),
      myCard(),
      ui.mode ? h('div', { class: 'card wide' }, h('h3', { text: ui.mode === 'host' ? 'メンバーを募集する' : '参加待ちで登録する' }), ui.mode === 'host' ? hostForm() : waitForm())
        : h('div', { class: 'cta' },
          h('button', { type: 'button', class: 'cta-btn', onclick: () => { ui.mode = 'host'; ui.form = null; draw(); } }, h('b', { text: 'メンバーを募集する' }), h('span', { class: 'muted small', text: '塔・役割・ステータス条件を選ぶだけ' })),
          h('button', { type: 'button', class: 'cta-btn', onclick: () => { ui.mode = 'wait'; ui.form = null; draw(); } }, h('b', { text: '参加待ちで登録する' }), h('span', { class: 'muted small', text: '自分のステータスを入れて、声がかかるのを待つ' }))),
      h('div', { class: 'tabs', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', class: `tab${ui.tab === 'host' ? ' on' : ''}`, 'aria-selected': String(ui.tab === 'host'), text: `募集中（${hosts.length}）`, onclick: () => { ui.tab = 'host'; draw(); } }),
        h('button', { type: 'button', role: 'tab', class: `tab${ui.tab === 'wait' ? ' on' : ''}`, 'aria-selected': String(ui.tab === 'wait'), text: `参加待ち（${waits.length}）`, onclick: () => { ui.tab = 'wait'; draw(); } })),
      h('div', { class: 'filters' },
        chipRow([{ id: '', label: 'すべての塔' }, ...T.towers], id => ui.tower === id, id => { ui.tower = id; draw(); }),
        chipRow([{ id: '', label: 'すべての役割' }, ...T.roles.filter(r => r.id !== 'any')], id => ui.role === id, id => { ui.role = id; draw(); })),
      (ui.tab === 'host' ? sortHosts : sortWaits).length
        ? h('ul', { class: 'blist' }, ui.tab === 'host' ? sortHosts.map(p => hostCard(p, me)) : sortWaits.map(w => waitCard(w, me)))
        : h('div', { class: 'empty' }, h('p', { text: ui.tab === 'host' ? 'いま募集はありません。' : 'いま参加待ちの人はいません。' }), h('p', { class: 'muted small', text: ui.tab === 'host' ? '自分から募集してみませんか？' : '参加待ちで登録しておくと、募集する人から見つけてもらえます。' })),
      h('p', { class: 'muted small', text: T.note })].filter(x => x != null));
  };
  // フォーム入力中に全体を描き直すと入力が飛ぶので、フォームだけ差し替える
  const redraw = () => {
    const box = root.querySelector('.bform'); if (!box) return draw();
    const y = window.scrollY; box.replaceWith(ui.mode === 'host' ? hostForm() : waitForm()); window.scrollTo(0, y);
  };

  refresh();
  return () => { clearInterval(timer); clearInterval(tick); unsub(); };
}
