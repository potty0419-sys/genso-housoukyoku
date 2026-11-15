// ドラゴンタワー掲示板（募集する側／参加待ちの側）
// - 募集には「参加」ボタン。押すと枠がその人のキャラ名で埋まる。
// - 参加待ちには「勧誘」ボタン。集合時間・場所・chを決めて送ると、相手に通知が届く。
// - 登録は「放送局を開いている間だけ」有効（30秒ごとに生存を知らせ、2分途切れたらオフ）。

const ALIVE_MS = 30 * 1000;
const STALE_MS = 2 * 60 * 1000;
const MAX_MS = 4 * 3600 * 1000;
const POST_GAP_MS = 60 * 1000;
const INVITE_GAP_MS = 15 * 1000;
const INVITE_TTL_MS = 10 * 60 * 1000; // 返事のない勧誘は10分で消える

/* ---------- 自分 ---------- */
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* noop */ } },
};
export const getMine = () => ls.get('ghk.board.mine');
export const setMine = v => ls.set('ghk.board.mine', v);
export const getMe = () => { let me = ls.get('ghk.me'); if (!me?.token) { me = { token: crypto.randomUUID(), name: me?.name || '' }; ls.set('ghk.me', me); } return me; };
export const setMyName = name => ls.set('ghk.me', { ...getMe(), name });

/* ---------- 保存の層（あとで共有サーバーに差し替える） ---------- */
export class LocalStore {
  constructor() {
    this.pk = 'ghk.board.v3'; this.ik = 'ghk.board.inv.v3';
    this.ch = 'BroadcastChannel' in window ? new BroadcastChannel('ghk-board') : null;
    this.listeners = new Set();
    this.ch?.addEventListener('message', () => this.emit());
    addEventListener('storage', e => { if (e.key === this.pk || e.key === this.ik) this.emit(); });
  }
  get shared() { return false; }
  rp() { const v = ls.get(this.pk, []); return Array.isArray(v) ? v : []; }
  ri() { const v = ls.get(this.ik, []); return Array.isArray(v) ? v : []; }
  wp(list) { ls.set(this.pk, list); this.ping(); }
  wi(list) { ls.set(this.ik, list); this.ping(); }
  ping() { this.ch?.postMessage('changed'); this.emit(); }
  emit() { for (const fn of this.listeners) fn(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async list() { return this.rp(); }
  async create(post) { this.wp([post, ...this.rp().filter(p => p.id !== post.id)]); return post; }
  async touch(id, secret, patch = {}) {
    const list = this.rp(); const p = list.find(x => x.id === id && x.secret === secret); if (!p) return false;
    Object.assign(p, patch, { lastSeen: Date.now() }); this.wp(list); return true;
  }
  async remove(id, secret) { this.wp(this.rp().filter(p => !(p.id === id && p.secret === secret))); }
  async join(id, member) {
    const list = this.rp(); const p = list.find(x => x.id === id && x.kind === 'host'); if (!p) return 'この募集はもう終わっています。';
    if ((p.members || []).some(m => m.token === member.token)) return '';
    if (leftOf(p, member.slot) <= 0) return 'その枠はもう埋まりました。';
    p.members = [...(p.members || []), { ...member, at: Date.now() }]; this.wp(list); return '';
  }
  async leave(id, token) { const list = this.rp(); const p = list.find(x => x.id === id); if (!p) return; p.members = (p.members || []).filter(m => m.token !== token); this.wp(list); }
  async kick(id, secret, token) { const list = this.rp(); const p = list.find(x => x.id === id && x.secret === secret); if (!p) return; p.members = (p.members || []).filter(m => m.token !== token); this.wp(list); }
  async invites() { return this.ri(); }
  async invite(inv) { this.wi([inv, ...this.ri()]); }
  async respond(invId, toSecret, status) {
    const posts = this.rp(); const list = this.ri(); const inv = list.find(i => i.id === invId); if (!inv) return false;
    if (!posts.some(p => p.id === inv.toPostId && p.secret === toSecret)) return false;
    inv.status = status; inv.answeredAt = Date.now(); this.wi(list); return true;
  }
  async sweep() {
    const now = Date.now();
    const posts = this.rp(); const keep = posts.filter(p => isAlive(p, now)); if (keep.length !== posts.length) this.wp(keep);
    const inv = this.ri(); const ik = inv.filter(i => now - i.createdAt < INVITE_TTL_MS + 5 * 60000); if (ik.length !== inv.length) this.wi(ik);
  }
}

export const isAlive = (p, now = Date.now()) => p && now - p.lastSeen < STALE_MS && now - p.createdAt < MAX_MS;
export const leftOf = (p, i) => { const s = p.slots[i]; if (!s) return 0; return s.count - (s.manual || 0) - (p.members || []).filter(m => m.slot === i).length; };
const totalLeft = p => p.slots.reduce((a, _, i) => a + Math.max(0, leftOf(p, i)), 0);

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
// 待ち w が 募集 p のどの枠に入れるか（枠の番号の一覧）
export const fits = (p, w) => {
  if (p?.kind !== 'host' || w?.kind !== 'wait' || !w.towers.includes(p.tower)) return [];
  return p.slots.map((s, i) => i).filter(i => {
    const s = p.slots[i];
    return leftOf(p, i) > 0 && (s.role === 'any' || w.role === 'any' || s.role === w.role) && (!s.stat || (Number(w.stats?.[s.stat]) || 0) >= s.min);
  });
};

/* ---------- 生存の知らせ・届いたものの見張り（どのページでも動く） ---------- */
export function keepAlive(store, notify, T) {
  const tower = id => T?.towers.find(t => t.id === id)?.label || id;
  const roleLabel = id => T?.roles.find(r => r.id === id)?.label || id;
  const seen = new Set(ls.get('ghk.seen', []));
  const mark = k => { seen.add(k); ls.set('ghk.seen', [...seen].slice(-300)); };
  let first = true; let busy = false;

  const check = async () => {
    if (busy) return; busy = true;
    try {
      const m = getMine(); const me = getMe();
      if (m && !(await store.touch(m.id, m.secret))) setMine(null);
      await store.sweep();
      const posts = (await store.list()).filter(p => isAlive(p)); const invites = await store.invites(); const now = Date.now();
      const mine = getMine(); const myPost = mine && posts.find(p => p.id === mine.id);
      const events = [];
      if (myPost?.kind === 'host') for (const mb of myPost.members || []) {
        const k = `join:${myPost.id}:${mb.token}`; if (seen.has(k)) continue; mark(k);
        if (!first) events.push({ id: k, kind: 'join', title: `${mb.name}さんが参加しました`, body: `${tower(myPost.tower)}・${roleLabel(myPost.slots[mb.slot]?.role)}の枠。ゲーム内で合流しましょう。` });
      }
      if (myPost?.kind === 'wait') for (const inv of invites) {
        if (inv.toPostId !== myPost.id || inv.status !== 'pending' || now - inv.createdAt > INVITE_TTL_MS) continue;
        const k = `inv:${inv.id}`; const silent = seen.has(k); mark(k); // 返事するまでは出しつづける（2回目以降は音なし）
        events.push({ id: k, kind: 'invite', inv, silent, title: `${inv.fromName}さんから勧誘`, body: `${tower(inv.tower)}・${inv.meetLabel}（${new Date(inv.meetAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}）・${inv.place}${inv.ch ? `・ch${inv.ch}` : ''}${inv.comment ? `「${inv.comment}」` : ''}` });
      }
      for (const inv of invites) {
        if (inv.fromToken !== me.token || inv.status === 'pending') continue;
        const k = `ans:${inv.id}`; if (seen.has(k)) continue; mark(k);
        events.push({ id: k, kind: 'answer', title: inv.status === 'accepted' ? `${inv.toName}さんが勧誘を受けました` : `${inv.toName}さんは今回は見送りです`, body: inv.status === 'accepted' ? `${inv.place}${inv.ch ? `・ch${inv.ch}` : ''}で待ち合わせです。` : 'また別の人を探しましょう。' });
      }
      first = false;
      for (const e of events) notify(e);
    } finally { busy = false; }
  };
  check(); setInterval(check, 5000);
  store.subscribe(() => check());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  return check;
}

// 勧誘への返事（通知の「行く」「見送る」から呼ぶ）
export async function answerInvite(store, inv, accept) {
  const mine = getMine(); if (!mine) return '参加待ちの登録が切れています。';
  const posts = await store.list(); const me = getMe(); const myWait = posts.find(p => p.id === mine.id);
  const ok = await store.respond(inv.id, mine.secret, accept ? 'accepted' : 'declined'); if (!ok) return 'この勧誘はもう使えません。';
  if (accept) {
    const host = inv.fromPostId && posts.find(p => p.id === inv.fromPostId);
    if (host) { const slot = fits(host, myWait)[0] ?? host.slots.findIndex((_, i) => leftOf(host, i) > 0); if (slot >= 0) await store.join(host.id, { token: me.token, name: myWait?.char || me.name, slot }); }
    await store.remove(mine.id, mine.secret); setMine(null); // 行き先が決まったので参加待ちはオフ
  }
  return '';
}

/* ---------- 画面 ---------- */
export function mountBoard(root, { h, T, ng, store, fmt }) {
  const statLabel = id => T.stats.find(s => s.id === id)?.label || id;
  const roleLabel = id => T.roles.find(r => r.id === id)?.label || id;
  const tower = id => T.towers.find(t => t.id === id) || { label: id, name: '' };
  const channels = T.channels || [];
  const mine = getMine;
  const ui = { mode: null, tab: 'host', tower: '', role: '', msg: '', open: null };
  let posts = []; let invites = [];
  const lastAt = k => Number(ls.get(k, 0)) || 0;

  const refresh = async () => { posts = (await store.list()).filter(p => isAlive(p)); invites = await store.invites(); draw(); };
  const timer = setInterval(refresh, ALIVE_MS);
  const tick = setInterval(() => root.querySelectorAll('[data-left]').forEach(el => { el.textContent = fmt.left(Number(el.dataset.left) - Date.now()); }), 1000);
  const unsub = store.subscribe(() => { if (!root.contains(document.activeElement) || !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) refresh(); });

  /* ---- 小物 ---- */
  const chipRow = (items, isOn, onClick) => h('div', { class: 'chips' }, items.map(it => h('button', {
    type: 'button', class: `chip${isOn(it.id) ? ' on' : ''}`, 'aria-pressed': String(isOn(it.id)), text: it.label, onclick: () => onClick(it.id),
  })));
  const placePicker = (st, again) => [
    h('fieldset', {}, h('legend', { text: '集合場所' }),
      h('div', { class: 'chips' },
        chipRow([{ id: 'tower', label: 'タワー内' }, { id: 'free', label: 'その他（自由に書く）' }], id => st.placeKind === id, id => { st.placeKind = id; again(); }),
        st.placeKind === 'free' ? h('input', { type: 'text', maxlength: '20', class: 'grow', value: st.placeText, placeholder: '例 エルロンド商店街の美術館前', 'aria-label': '集合場所', oninput: e => { st.placeText = e.target.value; } }) : null)),
    h('label', { class: 'field inline' }, h('span', { text: 'チャンネル' }),
      h('select', { onchange: e => { st.ch = e.target.value; } },
        h('option', { value: '', text: 'どこでも／未定' }), channels.map(c => h('option', { value: String(c), text: `ch${c}`, ...(String(st.ch) === String(c) ? { selected: true } : {}) })))),
  ];
  const placeText = st => st.placeKind === 'free' ? st.placeText.trim() : 'タワー内';
  const nameField = st => h('label', { class: 'field' }, h('span', { text: 'ゲーム内のキャラ名' }),
    h('input', { type: 'text', maxlength: '16', value: st.char, oninput: e => { st.char = e.target.value; }, placeholder: '声をかけるときに使います' }));
  const commentField = (st, ph) => h('label', { class: 'field' }, h('span', { text: 'ひとこと（40字まで・任意）' }),
    h('input', { type: 'text', maxlength: '40', value: st.comment, oninput: e => { st.comment = e.target.value; }, placeholder: ph }));
  const actions = (label, cancel) => h('div', { class: 'chips' }, h('button', { class: 'btn', type: 'submit', text: label }), h('button', { class: 'linkbtn', type: 'button', text: 'やめる', onclick: cancel }));
  const closeForm = () => { ui.mode = null; ui.form = null; ui.msg = ''; draw(); };

  /* ---- 募集のフォーム ---- */
  const hostForm = () => {
    const st = ui.form || (ui.form = { kind: 'host', tower: 'normal', start: 'now', at: '', have: 1, placeKind: 'tower', placeText: '', ch: '', char: getMe().name, comment: '', slots: [{ role: 'dps', count: 1, stat: '', min: '' }] });
    const total = () => st.slots.reduce((a, s) => a + s.count, 0);
    const slotRow = (s, i) => {
      const statDef = T.stats.find(x => x.id === s.stat);
      const hint = T.hints?.[st.tower]?.[s.role] || T.hints?.[st.tower]?.any || [];
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
    return h('form', { class: 'bform', onsubmit: e => { e.preventDefault(); submitPost(st); } },
      h('fieldset', {}, h('legend', { text: '行く塔' }), chipRow(T.towers, id => st.tower === id, id => { st.tower = id; redraw(); })),
      h('fieldset', {}, h('legend', { text: 'いつ' }),
        h('div', { class: 'chips' },
          chipRow([{ id: 'now', label: '今すぐ' }, { id: 'at', label: '時刻を決める' }], id => st.start === id, id => { st.start = id; redraw(); }),
          st.start === 'at' ? h('input', { type: 'time', class: 'tinput', value: st.at, 'aria-label': '開始時刻', oninput: e => { st.at = e.target.value; } }) : null)),
      ...placePicker(st, redraw),
      h('fieldset', {}, h('legend', { text: 'いまのメンバー（自分を含めて）' }),
        h('div', { class: 'stepper' },
          h('button', { type: 'button', class: 'ghost small', text: '−', 'aria-label': '減らす', onclick: () => { if (st.have > 1) { st.have--; redraw(); } } }),
          h('b', { class: 'mono', text: `${st.have}人 / ${T.partySize}人` }),
          h('button', { type: 'button', class: 'ghost small', text: '＋', 'aria-label': '増やす', onclick: () => { if (st.have + total() < T.partySize) { st.have++; redraw(); } } }))),
      h('fieldset', {}, h('legend', { text: `ほしい人（あと${T.partySize - st.have}人まで）` }),
        st.slots.map(slotRow),
        total() + st.have < T.partySize ? h('button', { type: 'button', class: 'ghost small', text: '＋ 役割を追加', onclick: () => { st.slots.push({ role: 'any', count: 1, stat: '', min: '' }); redraw(); } }) : null),
      nameField(st), commentField(st, '例 周回します。ゆるく'),
      ui.msg ? h('p', { class: 'err', role: 'alert', text: ui.msg }) : null,
      actions('この内容で募集する', closeForm));
  };

  /* ---- 参加待ちのフォーム ---- */
  const waitForm = () => {
    const st = ui.form || (ui.form = { kind: 'wait', towers: ['normal'], role: 'dps', stats: {}, char: getMe().name, comment: '' });
    return h('form', { class: 'bform', onsubmit: e => { e.preventDefault(); submitPost(st); } },
      h('fieldset', {}, h('legend', { text: '行きたい塔（いくつでも）' }),
        chipRow(T.towers, id => st.towers.includes(id), id => { st.towers = st.towers.includes(id) ? st.towers.filter(x => x !== id) : [...st.towers, id]; redraw(); })),
      h('fieldset', {}, h('legend', { text: 'できる役割' }), chipRow(T.roles.map(r => r.id === 'any' ? { ...r, label: 'どれでも' } : r), id => st.role === id, id => { st.role = id; redraw(); })),
      h('fieldset', {}, h('legend', { text: '自分のステータス（入れたものだけで判定します）' }),
        h('div', { class: 'statgrid' }, T.stats.map(s => h('label', { class: 'field' }, h('span', { text: s.label }),
          h('input', { type: 'text', inputmode: 'numeric', class: 'num', value: st.stats[s.id] ?? '', placeholder: '—', oninput: e => { const v = e.target.value.replace(/[^\d]/g, ''); e.target.value = v; if (v) st.stats[s.id] = v; else delete st.stats[s.id]; } }))))),
      nameField(st), commentField(st, '例 回復できます。いつでも呼んでください'),
      ui.msg ? h('p', { class: 'err', role: 'alert', text: ui.msg }) : null,
      actions('参加待ちで登録する', closeForm));
  };

  const submitPost = async st => {
    const char = st.char.trim();
    const err = !char ? 'キャラ名を入れてください。' : validateText(char, ng) || validateText(st.comment, ng)
      || (st.kind === 'host' && st.placeKind === 'free' && !st.placeText.trim() ? '集合場所を書いてください。' : '')
      || (st.kind === 'host' ? validateText(st.placeText, ng) : '')
      || (st.kind === 'host' && st.start === 'at' && !/^\d\d:\d\d$/.test(st.at) ? '開始時刻を入れてください。' : '')
      || (st.kind === 'host' && st.slots.some(s => s.stat && !(Number(s.min) > 0)) ? '条件の数値を入れてください（なしでもOK）。' : '')
      || (st.kind === 'wait' && !st.towers.length ? '行きたい塔を1つ以上選んでください。' : '')
      || (Date.now() - lastAt('ghk.board.last') < POST_GAP_MS ? '登録は1分に1回までです。少し待ってください。' : '');
    if (err) { ui.msg = err; redraw(); return; }
    setMyName(char);
    const old = mine(); if (old) await store.remove(old.id, old.secret);
    const now = Date.now(); const id = crypto.randomUUID(); const secret = crypto.randomUUID();
    let startAt = now;
    if (st.kind === 'host' && st.start === 'at') {
      const [hh, mm] = st.at.split(':').map(Number); const j = new Date(now + 9 * 3600000);
      startAt = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), hh, mm) - 9 * 3600000;
      if (startAt < now - 15 * 60000) startAt += 86400000;
    }
    const base = { id, secret, kind: st.kind, char, ownerToken: getMe().token, comment: st.comment.trim(), createdAt: now, lastSeen: now };
    const post = st.kind === 'host'
      ? { ...base, tower: st.tower, startAt, have: st.have, place: placeText(st), ch: st.ch, members: [], slots: st.slots.map(s => ({ role: s.role, count: s.count, manual: 0, stat: s.stat || '', min: s.stat ? Number(s.min) : 0 })) }
      : { ...base, towers: [...st.towers], role: st.role, stats: Object.fromEntries(Object.entries(st.stats).map(([k, v]) => [k, Number(v)])) };
    await store.create(post); setMine({ id, secret, kind: st.kind }); ls.set('ghk.board.last', now);
    ui.mode = null; ui.form = null; ui.msg = ''; ui.tab = st.kind === 'host' ? 'wait' : 'host';
    refresh();
  };

  /* ---- 参加（募集カード） ---- */
  const askName = () => {
    const me = getMe(); if (me.name) return me.name;
    ui.msg = '先に上の「あなたのキャラ名」を入れてください。'; draw(); root.querySelector('[data-fid=myname]')?.focus(); return '';
  };
  const joinSlot = async (p, i) => {
    const name = askName(); if (!name) return;
    const me = getMe();
    const err = await store.join(p.id, { token: me.token, name, slot: i }); if (err) { ui.msg = err; draw(); return; }
    const m = mine(); if (m?.kind === 'wait') { await store.remove(m.id, m.secret); setMine(null); }
    ui.msg = ''; refresh();
  };
  const leaveSlot = async p => { await store.leave(p.id, getMe().token); refresh(); };

  /* ---- 勧誘（参加待ちカード） ---- */
  const meets = [{ id: 0, label: '今すぐ' }, { id: 5, label: '5分後' }, { id: 10, label: '10分後' }, { id: 15, label: '15分後' }, { id: 30, label: '30分後' }];
  const inviteForm = w => {
    const myHost = (() => { const m = mine(); return m ? posts.find(p => p.id === m.id && p.kind === 'host') : null; })();
    const st = ui.inv?.to === w.id ? ui.inv : (ui.inv = { to: w.id, meet: 0, tower: myHost?.tower && w.towers.includes(myHost.tower) ? myHost.tower : w.towers[0], placeKind: myHost && myHost.place !== 'タワー内' ? 'free' : 'tower', placeText: myHost && myHost.place !== 'タワー内' ? myHost.place : '', ch: myHost?.ch || '', comment: '', msg: '' });
    const again = () => redrawInv(w);
    return h('form', { class: 'invform', onsubmit: async e => {
      e.preventDefault();
      const name = askName(); if (!name) return;
      const err = (st.placeKind === 'free' && !st.placeText.trim() ? '集合場所を書いてください。' : '') || validateText(st.placeText, ng) || validateText(st.comment, ng)
        || (Date.now() - lastAt('ghk.inv.last') < INVITE_GAP_MS ? '勧誘は15秒に1回までです。' : '')
        || (invites.some(i => i.toPostId === w.id && i.fromToken === getMe().token && i.status === 'pending' && Date.now() - i.createdAt < INVITE_TTL_MS) ? 'この人には返事待ちの勧誘があります。' : '');
      if (err) { st.msg = err; again(); return; }
      const now = Date.now(); const me = getMe();
      await store.invite({ id: crypto.randomUUID(), toPostId: w.id, toName: w.char, fromToken: me.token, fromName: name, fromPostId: myHost?.id || null,
        tower: st.tower, meetAt: now + st.meet * 60000, meetLabel: meets.find(x => x.id === st.meet).label, place: placeText(st), ch: st.ch, comment: st.comment.trim(), status: 'pending', createdAt: now });
      ls.set('ghk.inv.last', now); ui.open = null; ui.inv = null; refresh();
    } },
      h('p', { class: 'small' }, h('b', { text: `${w.char}さん` }), 'を勧誘する'),
      w.towers.length > 1 ? h('fieldset', {}, h('legend', { text: '塔' }), chipRow(w.towers.map(id => ({ id, label: tower(id).label })), id => st.tower === id, id => { st.tower = id; again(); })) : null,
      h('fieldset', {}, h('legend', { text: '集合時間' }), chipRow(meets, id => st.meet === id, id => { st.meet = id; again(); })),
      ...placePicker(st, again),
      commentField(st, '例 中級いっしょにどうですか'),
      st.msg ? h('p', { class: 'err', role: 'alert', text: st.msg }) : null,
      actions('勧誘を送る', () => { ui.open = null; ui.inv = null; draw(); }));
  };
  const redrawInv = w => { const box = root.querySelector(`[data-inv="${w.id}"]`); if (box) box.replaceChildren(inviteForm(w)); };

  /* ---- 一覧 ---- */
  const copyBtn = name => h('button', { type: 'button', class: 'ghost small', text: '名前をコピー', onclick: e => { navigator.clipboard?.writeText(name).then(() => { e.target.textContent = 'コピーしました'; }); } });
  const placeLine = p => [p.place, p.ch ? `ch${p.ch}` : ''].filter(Boolean).join('・');

  const hostCard = (p, me) => {
    const myToken = getMe().token; const isOwner = mine()?.id === p.id;
    const joinedHere = (p.members || []).find(m => m.token === myToken);
    const okSlots = me?.kind === 'wait' ? fits(p, me) : [];
    const seats = p.slots.flatMap((s, i) => {
      const ms = (p.members || []).filter(m => m.slot === i);
      const cond = s.stat ? `${statLabel(s.stat)} ${s.min.toLocaleString()}以上` : '';
      return [
        ...ms.map(m => h('li', { class: `seat filled${m.token === myToken ? ' me' : ''}` }, h('span', { class: 'role-tag', text: roleLabel(s.role) }), h('b', { text: m.name }),
          isOwner ? h('button', { type: 'button', class: 'linkbtn', text: '外す', onclick: async () => { await store.kick(p.id, mine().secret, m.token); refresh(); } }) : null)),
        ...Array.from({ length: s.manual || 0 }, () => h('li', { class: 'seat filled' }, h('span', { class: 'role-tag', text: roleLabel(s.role) }), h('span', { class: 'muted small', text: 'ゲーム内で決定' }))),
        ...Array.from({ length: Math.max(0, leftOf(p, i)) }, () => h('li', { class: `seat open${okSlots.includes(i) ? ' ok' : ''}` },
          h('span', { class: 'role-tag', text: roleLabel(s.role) }), h('span', { class: 'muted small', text: cond || '条件なし' }),
          !isOwner && !joinedHere ? h('button', { type: 'button', class: 'btn small', text: '参加', onclick: () => joinSlot(p, i) }) : null)),
      ];
    });
    const count = p.have + (p.members || []).length + p.slots.reduce((a, s) => a + (s.manual || 0), 0);
    return h('li', { class: `bcard${okSlots.length && !joinedHere ? ' match' : ''}${joinedHere ? ' joined' : ''}` },
      h('div', { class: 'bcard-top' },
        h('span', { class: 'tower', text: tower(p.tower).label }),
        h('span', { class: 'muted small', text: tower(p.tower).name }),
        okSlots.length && !joinedHere ? h('span', { class: 'pill', text: 'あなたが入れる' }) : null,
        joinedHere ? h('span', { class: 'pill live', text: '参加中' }) : null,
        h('span', { class: 'when mono', text: p.startAt <= Date.now() + 60000 ? '今すぐ' : `${fmt.time(p.startAt)}〜` })),
      h('p', { class: 'small' }, h('b', { text: placeLine(p) || 'タワー内' }), h('span', { class: 'muted', text: `　${count}人 / ${T.partySize}人` })),
      h('ul', { class: 'seats' }, h('li', { class: 'seat filled host' }, h('span', { class: 'role-tag', text: '募集者' }), h('b', { text: p.char }), p.have > 1 ? h('span', { class: 'muted small', text: `ほか${p.have - 1}人` }) : null), seats),
      p.comment ? h('p', { class: 'say', text: p.comment }) : null,
      h('div', { class: 'bcard-foot' }, copyBtn(p.char),
        joinedHere ? h('button', { type: 'button', class: 'linkbtn', text: '参加をやめる', onclick: () => leaveSlot(p) }) : null,
        h('span', { class: 'muted small live-dot', text: 'オンライン' })));
  };

  const waitCard = (w, me) => {
    const callable = me?.kind === 'host' ? fits(me, w) : [];
    const isOwner = mine()?.id === w.id;
    const sent = invites.find(i => i.toPostId === w.id && i.fromToken === getMe().token && Date.now() - i.createdAt < INVITE_TTL_MS);
    return h('li', { class: `bcard${callable.length ? ' match' : ''}` },
      h('div', { class: 'bcard-top' },
        h('span', { class: 'tower role', text: w.role === 'any' ? 'どれでも' : roleLabel(w.role) }),
        callable.length ? h('span', { class: 'pill', text: '呼べる人' }) : null,
        h('span', { class: 'muted small', text: w.towers.map(t => tower(t).label).join('・') })),
      Object.keys(w.stats).length ? h('dl', { class: 'stats' }, T.stats.filter(s => w.stats[s.id] != null).flatMap(s => [h('dt', { text: s.label }), h('dd', { class: 'mono', text: Number(w.stats[s.id]).toLocaleString() })])) : h('p', { class: 'muted small', text: 'ステータスの登録なし' }),
      w.comment ? h('p', { class: 'say', text: w.comment }) : null,
      ui.open === w.id ? h('div', { class: 'invbox', 'data-inv': w.id }, inviteForm(w)) : null,
      h('div', { class: 'bcard-foot' }, h('b', { class: 'char', text: w.char }), copyBtn(w.char),
        !isOwner && ui.open !== w.id ? (sent
          ? h('span', { class: 'small sent', text: sent.status === 'pending' ? '勧誘を送りました（返事待ち）' : sent.status === 'accepted' ? '勧誘を受けてくれました' : '今回は見送りでした' })
          : h('button', { type: 'button', class: 'btn small', text: '勧誘', onclick: () => { ui.open = w.id; ui.inv = null; draw(); } })) : null,
        h('span', { class: 'muted small live-dot', text: 'オンライン' })));
  };

  const myCard = () => {
    const m = mine(); const p = m && posts.find(x => x.id === m.id); if (!p) return null;
    const ctl = p.kind === 'host'
      ? h('div', { class: 'chips' }, p.slots.map((s, i) => h('span', { class: 'mini-step' }, h('span', { class: 'small', text: `${roleLabel(s.role)}：ゲーム内で決まった人` }),
          h('button', { type: 'button', class: 'ghost small', text: '−', 'aria-label': '減らす', onclick: async () => { if ((s.manual || 0) > 0) { await store.touch(p.id, m.secret, { slots: p.slots.map((x, j) => j === i ? { ...x, manual: x.manual - 1 } : x) }); refresh(); } } }),
          h('b', { class: 'mono', text: String(s.manual || 0) }),
          h('button', { type: 'button', class: 'ghost small', text: '＋', 'aria-label': '増やす', onclick: async () => { if (leftOf(p, i) > 0) { await store.touch(p.id, m.secret, { slots: p.slots.map((x, j) => j === i ? { ...x, manual: (x.manual || 0) + 1 } : x) }); refresh(); } } }))))
      : null;
    const myInv = p.kind === 'wait' ? invites.filter(i => i.toPostId === p.id && i.status === 'pending' && Date.now() - i.createdAt < INVITE_TTL_MS) : [];
    return h('div', { class: 'mine' },
      h('div', { class: 'mine-top' },
        h('span', { class: 'pill live', text: '登録中' }),
        h('b', { text: p.kind === 'host' ? `${tower(p.tower).label}のメンバーを募集中（あと${totalLeft(p)}人）` : '参加待ちで登録中' }),
        h('span', { class: 'muted small' }, '放送局を閉じると自動でオフ（あと ', h('span', { class: 'mono', 'data-left': String(p.createdAt + MAX_MS), text: fmt.left(p.createdAt + MAX_MS - Date.now()) }), ' で自動終了）')),
      p.kind === 'host' && (p.members || []).length ? h('p', { class: 'small' }, '参加した人：', h('b', { text: p.members.map(x => x.name).join('、') })) : null,
      ctl, p.kind === 'host' && totalLeft(p) <= 0 ? h('p', { class: 'small', text: '全員そろいました。出発したらオフにしておきましょう。' }) : null,
      myInv.length ? h('p', { class: 'small', text: `勧誘が${myInv.length}件届いています。画面の通知から返事ができます。` }) : null,
      h('div', { class: 'chips' }, h('button', { type: 'button', class: 'btn small', text: 'オフにする', onclick: async () => { await store.remove(p.id, m.secret); setMine(null); refresh(); } })));
  };

  const draw = () => {
    const me = (() => { const m = mine(); return m ? posts.find(p => p.id === m.id) : null; })();
    const hosts = posts.filter(p => p.kind === 'host' && (!ui.tower || p.tower === ui.tower) && (!ui.role || p.slots.some((s, i) => leftOf(p, i) > 0 && (s.role === ui.role || s.role === 'any'))));
    const waits = posts.filter(p => p.kind === 'wait' && (!ui.tower || p.towers.includes(ui.tower)) && (!ui.role || p.role === ui.role || p.role === 'any'));
    const score = p => me ? (p.kind === 'host' ? fits(p, me).length : fits(me, p).length) : 0;
    const sortHosts = [...hosts].sort((a, b) => (totalLeft(b) > 0) - (totalLeft(a) > 0) || score(b) - score(a) || a.startAt - b.startAt);
    const sortWaits = [...waits].sort((a, b) => score(b) - score(a) || b.createdAt - a.createdAt);

    root.replaceChildren(...[
      !store.shared ? h('p', { class: 'note warn', text: '試験中：いまはこのブラウザの中だけで動いています。ほかの人の登録はまだ見えません。' }) : null,
      h('div', { class: 'howto' },
        h('p', {}, 'ドラゴンタワーの仲間さがし。登録は', h('b', { text: '放送局を開いている間だけ' }), '表示され、閉じると2分以内に自動でオフになります。'),
        h('p', { class: 'muted small', text: '参加・勧誘の知らせは、音・パソコンの通知・「おとも」の手前に出る小窓で届きます（設定は「おとも」の通知から）。連絡はゲーム内で。URL・連絡先は書けません。' })),
      h('label', { class: 'field inline myname' }, h('span', { text: 'あなたのキャラ名' }),
        h('input', { type: 'text', maxlength: '16', 'data-fid': 'myname', value: getMe().name, placeholder: '参加・勧誘のときに相手に表示されます', onchange: e => { setMyName(e.target.value.trim()); ui.msg = ''; } })),
      ui.msg && !ui.mode ? h('p', { class: 'err', role: 'alert', text: ui.msg }) : null,
      myCard(),
      ui.mode ? h('div', { class: 'card wide' }, h('h3', { text: ui.mode === 'host' ? 'メンバーを募集する' : '参加待ちで登録する' }), ui.mode === 'host' ? hostForm() : waitForm())
        : h('div', { class: 'cta' },
          h('button', { type: 'button', class: 'cta-btn', onclick: () => { ui.mode = 'host'; ui.form = null; ui.msg = ''; draw(); } }, h('b', { text: 'メンバーを募集する' }), h('span', { class: 'muted small', text: '塔・役割・ステータス条件を選ぶだけ' })),
          h('button', { type: 'button', class: 'cta-btn', onclick: () => { ui.mode = 'wait'; ui.form = null; ui.msg = ''; draw(); } }, h('b', { text: '参加待ちで登録する' }), h('span', { class: 'muted small', text: '自分のステータスを入れて、勧誘を待つ' }))),
      h('div', { class: 'tabs', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', class: `tab${ui.tab === 'host' ? ' on' : ''}`, 'aria-selected': String(ui.tab === 'host'), text: `募集中（${hosts.length}）`, onclick: () => { ui.tab = 'host'; draw(); } }),
        h('button', { type: 'button', role: 'tab', class: `tab${ui.tab === 'wait' ? ' on' : ''}`, 'aria-selected': String(ui.tab === 'wait'), text: `参加待ち（${waits.length}）`, onclick: () => { ui.tab = 'wait'; draw(); } })),
      h('div', { class: 'filters' },
        chipRow([{ id: '', label: 'すべての塔' }, ...T.towers], id => ui.tower === id, id => { ui.tower = id; draw(); }),
        chipRow([{ id: '', label: 'すべての役割' }, ...T.roles.filter(r => r.id !== 'any')], id => ui.role === id, id => { ui.role = id; draw(); })),
      (ui.tab === 'host' ? sortHosts : sortWaits).length
        ? h('ul', { class: 'blist' }, ui.tab === 'host' ? sortHosts.map(p => hostCard(p, me)) : sortWaits.map(w => waitCard(w, me)))
        : h('div', { class: 'empty' }, h('p', { text: ui.tab === 'host' ? 'いま募集はありません。' : 'いま参加待ちの人はいません。' }), h('p', { class: 'muted small', text: ui.tab === 'host' ? '自分から募集してみませんか？' : '参加待ちで登録しておくと、募集する人から勧誘が届きます。' })),
      h('p', { class: 'muted small', text: T.note }),
    ].filter(x => x != null));
  };
  const redraw = () => {
    const box = root.querySelector('.bform'); if (!box) return draw();
    const y = window.scrollY; box.replaceWith(ui.mode === 'host' ? hostForm() : waitForm()); window.scrollTo(0, y);
  };

  refresh();
  return () => { clearInterval(timer); clearInterval(tick); unsub(); };
}
