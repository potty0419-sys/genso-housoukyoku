import { badge, esc, dateTime, options, localInput, toast, errorIn, heading } from '../utils.js';

export function partyCard(post, store, preview = false) {
  const hostKey = store.hostKey(post.id);
  const full = post.current >= post.capacity;
  return `<article class="party-card ${post.ended ? 'ended' : ''}" data-post-id="${esc(post.id)}">
    <div class="card-top"><span class="purpose">${esc(post.purpose)}</span>${badge}<span class="state ${post.ended ? '' : 'open'}">${post.ended ? '終了' : full ? '満員' : '募集中'}</span></div>
    <h3>${dateTime(post.start)} <span class="muted">から</span></h3><p class="party-facts">約${post.duration}分 <span>·</span> Lv.${post.levelMin}〜${post.levelMax} <span>·</span> <strong>${post.current}/${post.capacity}人</strong></p>
    <div class="chips">${post.jobs.map(j => `<span class="chip">${esc(j)}</span>`).join('')}</div>
    <p class="party-comment">${esc(post.comment || 'コメントはありません。')}</p><p class="muted small">集合：${esc(post.place)}<br>キャラ名：${esc(post.character)}</p>
    ${preview ? '<a class="text-link" href="#/board">募集をみる →</a>' : `<div class="card-actions"><button class="quiet" data-action="interest" data-id="${esc(post.id)}" ${post.ended || full || post.interested ? 'disabled' : ''}>${post.interested ? '希望済み' : '参加したい'} <span>${post.interests}</span></button><button class="text-button muted" data-action="report" data-id="${esc(post.id)}" ${post.reported ? 'disabled' : ''}>${post.reported ? '通報済み' : '通報'}</button></div>${hostKey ? `<details class="host-actions"><summary>投稿者の操作</summary><p class="small">削除キーはこのブラウザに保存済みです。</p><label>現在の人数<input type="number" min="1" max="${post.capacity}" value="${post.current}" data-count="${esc(post.id)}"></label><div class="button-row"><button class="quiet" data-action="count" data-id="${esc(post.id)}">人数更新</button><button class="quiet" data-action="close" data-id="${esc(post.id)}" ${post.ended ? 'disabled' : ''}>締切</button><button class="danger" data-action="delete" data-id="${esc(post.id)}">削除</button></div><details><summary>削除キーを確認</summary><code class="key">${esc(hostKey)}</code></details></details>` : ''}`}
  </article>`;
}

export function shoutCard(post, store) {
  return `<article class="shout-card" data-post-id="${esc(post.id)}"><div class="card-top">${badge}<time class="muted small">${dateTime(post.createdAt)}</time></div><p>${esc(post.comment)}</p><div class="card-actions"><small class="muted">24時間で自動終了</small><button class="text-button muted" data-action="report" data-id="${esc(post.id)}" ${post.reported ? 'disabled' : ''}>${post.reported ? '通報済み' : '通報'}</button>${store.hostKey(post.id) ? `<button class="text-button danger-text" data-action="delete" data-id="${esc(post.id)}">削除</button>` : ''}</div></article>`;
}

export async function handlePostAction(event, store) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (!id) return;
  button.disabled = true;
  try {
    if (action === 'interest') { await store.interest(id); toast('参加希望を記録しました。参加の相談はゲーム内でお願いします。'); }
    if (action === 'report') { await store.report(id); toast('通報を受け付けました。3件で非表示になります。'); }
    if (action === 'close') { await store.update(id,{closed:true},store.hostKey(id)); toast('募集を締め切りました。'); }
    if (action === 'count') {
      const current = button.closest('article').querySelector('[data-count]').value;
      await store.update(id,{current},store.hostKey(id)); toast('人数を更新しました。');
    }
    if (action === 'delete') {
      if (window.confirm('この投稿を削除しますか？')) { await store.remove(id,store.hostKey(id)); toast('投稿を削除しました。'); }
    }
  } catch (error) { toast(error.message); }
  finally { if (button.isConnected) button.disabled = false; }
}

export async function boardPage(ctx) {
  const { root, config, store } = ctx;
  if (config.features?.board === false) {
    root.innerHTML = `${heading('仲間を見つける','パーティ募集','')}<section class="panel"><h2>準備中</h2><p class="muted">パーティ募集掲示板は準備中です。公開までもう少しお待ちください。</p></section>`;
    return;
  }
  root.innerHTML = `${heading('仲間を見つける', 'パーティ募集', 'ふらっと集まって、一緒に冒険。連絡はゲーム内で。', '<button class="primary" id="jump-to-form">＋ 募集する</button>')}
    <div class="notice">${badge} すべて試作用の募集です。投稿はこのブラウザだけに保存され、ほかの人には届きません。</div>
    <section class="panel filters" aria-label="募集の絞り込み"><label>目的<select id="filter-purpose">${options(config.purposes)}</select></label><label>自分の職業<select id="filter-job">${options(config.jobs)}</select></label><label>自分のレベル<input id="filter-level" type="number" min="1" max="999" placeholder="指定なし"></label><label>時間帯<select id="filter-time"><option value="">すべて</option value="now">今すぐ</option><option value="hour">1時間以内</option><option value="today">今日</option><option value="tonight">今夜21時〜</option></select></label><label class="check"><input id="filter-ended" type="checkbox">終了も表示</label></section>
    <div class="section-heading"><p id="board-count" class="muted" role="status"></p><span class="small muted">開始が近い順 · 時刻は日本時間</span></div><div id="board-list" class="grid three"></div>
    <section id="new-post" class="panel post-panel"><div class="section-heading"><div><p class="eyebrow">一緒に遊ぼう</p><h2>パーティを募集する</h2></div>${badge}</div>
    <p class="muted">投稿は掲示板・ひとこと共通で3分に1件。同じ内容は24時間再投稿できません。外部リンク・連絡先は入力できません。</p>
    <form id="party-form"><div class="form-grid"><label>目的<select name="purpose" required>${options(config.purposes,'選択してください')}</select></label><div><fieldset class="jobs"><legend>募集する職業（複数選択）</legend><div class="job-options">${config.jobs.map(j => `<label class="check"><input type="checkbox" name="jobs" value="${esc(j)}">${esc(j)}</label>`).join('')}</div></fieldset></div>
    <div class="form-pair"><label>推奨レベル 下限<input name="levelMin" type="number" min="1" max="999" value="1" required></label><label>上限<input name="levelMax" type="number" min="1" max="999" value="50" required></label></div>
    <div class="form-pair"><label>開始<select name="startMode"><option value="now">今すぐ</option><option value="scheduled">時刻指定</option></select></label><label id="start-field" hidden>開始日時（端末の現地時間）<input name="startTime" type="datetime-local" value="${localInput()}" disabled></label></div>
    <label>所要時間の目安（分）<input name="duration" type="number" min="1" max="1440" value="60" required></label><div class="form-pair"><label>現在の人数<input name="current" type="number" min="1" max="100" value="1" required></label><label>定員<input name="capacity" type="number" min="1" max="100" value="4" required></label></div>
    <label>集合場所・チャンネル<input name="place" maxlength="60" placeholder="例：サンプル広場 / ch.1" required></label><label>ゲーム内キャラ名<input name="character" maxlength="30" autocomplete="off" required></label><label class="span-all">コメント（140字まで）<textarea name="comment" maxlength="140" rows="3" placeholder="募集の方針や、ひとことをどうぞ。"></textarea></label></div>
    <p class="small muted">開始＋所要時間で自動終了します。投稿後の締切・人数更新・削除には、このブラウザに自動保存する削除キーを使います。個人情報を書かず、試作用の内容で投稿してください。</p><p class="form-error" role="alert" tabindex="-1" hidden></p><button class="primary" type="submit">サンプルの募集を投稿する →</button></form></section>`;
  let alive = true, revision = 0;
  const refresh = async () => {
    const r = ++revision;
    const posts = await store.list({ purpose:root.querySelector('#filter-purpose').value, job:root.querySelector('#filter-job').value, level:root.querySelector('#filter-level').value, time:root.querySelector('#filter-time').value, includeEnded:root.querySelector('#filter-ended').checked });
    if (!alive || r !== revision) return;
    const html = posts.map(p => partyCard(p,store)).join('') || '<p class="empty span-all">条件に合う募集はありません。条件を変えるか、最初の募集を作ってみましょう。</p>';
    // 毎秒の期限判定で、操作中の人数入力や詳細表示を壊さない。
    if (root.querySelector('#board-list').dataset.snapshot !== html) { root.querySelector('#board-list').innerHTML = html; root.querySelector('#board-list').dataset.snapshot = html; }
    root.querySelector('#board-count').textContent = `${posts.length}件の募集`;
  };
  root.querySelector('.filters').addEventListener('input',refresh);
  root.querySelector('#board-list').addEventListener('click',e => handlePostAction(e,store));
  const form = root.querySelector('#party-form');
  root.querySelector('#jump-to-form').addEventListener('click',() => { root.querySelector('#new-post').scrollIntoView({behavior:'smooth'}); form.elements.purpose.focus({preventScroll:true}); });
  form.elements.startMode.addEventListener('change',() => {
    const scheduled = form.elements.startMode.value === 'scheduled';
    root.querySelector('#start-field').hidden = !scheduled;
    form.elements.startTime.disabled = !scheduled;
    form.elements.startTime.required = scheduled;
  });
  form.addEventListener('submit',async event => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      const values = new FormData(form);
      await store.create({ ...Object.fromEntries(values), type:'party', jobs:values.getAll('jobs'), start:values.get('startMode') === 'now' ? Date.now() : Date.parse(values.get('startTime')) });
      form.reset(); root.querySelector('#start-field').hidden = true; form.elements.startTime.disabled = true;
      form.querySelector('.form-error').hidden = true;
      toast('募集を投稿しました。削除キーをこのブラウザに保存しました。');
      await refresh();
    } catch (error) { errorIn(form,error.message); }
    finally { button.disabled = false; }
  });
  window.addEventListener('genso-store-change',refresh);
  const interval = setInterval(refresh,1000);
  await refresh();
  return () => { alive = false; clearInterval(interval); window.removeEventListener('genso-store-change',refresh); };
}
