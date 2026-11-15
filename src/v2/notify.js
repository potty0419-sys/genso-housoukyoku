// 知らせの届け方。全画面でゲーム中でも気づけるように、いくつかの経路を重ねる。
// 1) 手前に出る小窓（Document Picture-in-Picture。Chrome / Edge）… 他のウィンドウより常に上に出る
// 2) 音 … 画面を見ていなくても分かる（設定で切れる）
// 3) パソコンの通知 … OSの通知センター（許可したときだけ）
// 4) タブ名の点滅と画面のフラッシュ … 放送局のタブを見ているとき

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* noop */ } },
};

export function createNotifier({ h, onChange }) {
  const settings = { sound: ls.get('ghk.notify.sound', true) };
  const notices = []; // 画面に出ている知らせ
  let ctx = null; let blink = null; const baseTitle = () => document.title.replace(/^【[^】]*】/, '');

  // 音は最初の操作のあとでないと鳴らせない（ブラウザの決まり）ので、最初のクリックで準備する
  const unlock = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } } ctx?.resume?.(); };
  addEventListener('pointerdown', unlock, { once: false, passive: true });
  addEventListener('keydown', unlock, { once: false, passive: true });

  const chime = () => {
    if (!settings.sound || !ctx) return;
    const t0 = ctx.currentTime;
    [[880, 0], [1175, 0.14], [1568, 0.28]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
      o.start(t0 + dt); o.stop(t0 + dt + 0.55);
    });
  };
  const osNotify = n => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const x = new Notification(`元素騎士放送局：${n.title}`, { body: n.body, tag: n.id, requireInteraction: n.kind === 'invite', icon: new URL('../favicon.svg', location.href).href });
      x.onclick = () => { window.focus(); x.close(); };
    } catch { /* noop */ }
  };
  const startBlink = title => {
    clearInterval(blink); let on = false;
    blink = setInterval(() => { on = !on; document.title = on ? `【${title}】${baseTitle()}` : baseTitle(); }, 900);
  };
  const stopBlink = () => { clearInterval(blink); blink = null; document.title = baseTitle(); };
  addEventListener('focus', () => { if (!notices.some(n => n.kind === 'invite')) stopBlink(); });

  const api = {
    settings,
    notices,
    setSound(v) { settings.sound = !!v; ls.set('ghk.notify.sound', settings.sound); onChange(); },
    get permission() { return 'Notification' in window ? Notification.permission : 'unsupported'; },
    async askPermission() { if ('Notification' in window) { await Notification.requestPermission(); onChange(); } },
    test() { api.push({ id: `test:${Date.now()}`, kind: 'test', title: 'テストの知らせ', body: 'こんなふうに届きます。' }); },
    push(n) {
      if (notices.some(x => x.id === n.id) || (n.silent && api.dismissed.has(n.id))) return;
      notices.unshift({ ...n, at: Date.now() }); if (notices.length > 6) notices.length = 6;
      if (!n.silent) { chime(); osNotify(n); startBlink(n.kind === 'invite' ? '勧誘が届きました' : '知らせ'); }
      onChange({ flash: !n.silent });
    },
    dismissed: new Set(),
    dismiss(id) { api.dismissed.add(id); const i = notices.findIndex(x => x.id === id); if (i >= 0) notices.splice(i, 1); if (!notices.length) stopBlink(); onChange(); },
    // 知らせの束を描く（本体の右上と、おともの中の両方で使う）
    render(actions) {
      return h('div', { class: 'toasts-in', role: 'status', 'aria-live': 'polite' }, notices.map(n => h('div', { class: `toast ${n.kind}` },
        h('b', { text: n.title }), h('p', { text: n.body }),
        h('div', { class: 'chips' }, ...(actions(n) || []),
          h('button', { type: 'button', class: 'linkbtn', text: n.kind === 'invite' ? 'あとで' : '閉じる', onclick: () => api.dismiss(n.id) })))));
    },
  };
  return api;
}

// 手前に出る小窓。開けないブラウザでは null を返す。
export async function openFloating({ node, width = 380, height = 640, onClose }) {
  if (!('documentPictureInPicture' in window)) return null;
  const pip = await window.documentPictureInPicture.requestWindow({ width, height });
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) { const c = pip.document.createElement('link'); c.rel = 'stylesheet'; c.href = l.href; pip.document.head.append(c); }
  pip.document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';
  pip.document.title = 'おとも｜元素騎士放送局';
  pip.document.body.className = 'mini pip'; pip.document.body.dataset.route = 'otomo';
  const flash = pip.document.createElement('div'); flash.className = 'flash'; flash.id = 'flash';
  const wrap = pip.document.createElement('div'); wrap.className = 'pip-wrap';
  const placeholder = document.createComment('desk');
  node.replaceWith(placeholder); wrap.append(node); pip.document.body.append(wrap, flash);
  pip.addEventListener('pagehide', () => { placeholder.replaceWith(node); onClose?.(); });
  return pip;
}
