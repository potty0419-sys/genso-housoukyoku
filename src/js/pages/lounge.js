import { badge, heading, esc, readLocal, writeLocal, countdowns, num, toast, errorIn } from '../utils.js';
import { currentRate } from './tools.js';
import { shoutCard, handlePostAction } from './board.js';

export async function loungePage({root, config, schedule, store, timer}) {
  const counterState = readLocal('genso.counters.v1',[{ name:'ドラタワ',count:0,memo:'' },{ name:'レベリング',count:0,memo:'' }]);
  const earnings = readLocal('genso.earnings.v1',{start:'0',end:'0',minutes:'60'});
  root.innerHTML = `${heading('ゲームの横に、小さな相棒。','ながら部屋','周回を数えて、ひとこと残して。自分のペースで過ごそう。')}<div class="notice">${badge} 記録はこのブラウザに保存されます。ゲーム情報や換算レートは仮設定です。</div>${countdowns(schedule,config)}
  <section class="section grid two lounge-grid"><article class="panel"><div class="section-heading"><h2>周回カウンター</h2>${badge}</div><p class="muted small">1周おわったら、ぽちっと。メモも自動保存。</p><div class="counters">${counterState.map((counter,i) => `<section class="counter" data-counter="${i}"><label>カウンター名<input maxlength="20" data-field="name" value="${esc(counter.name)}"></label><div class="counter-controls"><button class="quiet" data-step="-1" aria-label="${esc(counter.name)}を1回減らす">−1</button><output data-count-output>${num(counter.count)}</output><button class="primary" data-step="1" aria-label="${esc(counter.name)}を1回増やす">＋1</button></div><button class="text-button muted" data-reset>回数をリセット</button><label class="small">ドロップ・周回メモ<textarea maxlength="500" rows="2" data-field="memo" placeholder="今日は何が出た？">${esc(counter.memo)}</textarea></label></section>`).join('')}</div></article>
  <div class="stack"><article class="panel timer-panel"><div class="section-heading"><h2>作業タイマー</h2>${badge}</div><p class="muted small">終了時は画面が光ります。音は鳴りません。</p><div class="button-row timer-presets"><button class="quiet" data-minutes="30">30分</button><button class="quiet" data-minutes="60">60分</button><button class="quiet" data-minutes="10">バフ用10分（仮）</button></div><label>カスタム（分）<input id="timer-minutes" type="number" min="1" max="1440" step="1" value="${Math.max(1,Math.round(timer.state.remaining/60000))}"></label><output id="timer-display" class="timer-display">00:30:00</output><p id="timer-status" class="small muted" role="status"></p><div class="button-row"><button class="primary" id="timer-start">開始・再開</button><button class="quiet" id="timer-pause">一時停止</button><button class="text-button muted" id="timer-reset">リセット</button></div></article>
  <article class="panel earnings-panel"><div class="section-heading"><h2>今日の稼ぎメモ</h2>${badge}</div><div class="form-pair"><label>開始時のmR<input id="earn-start" type="number" min="0" step="any" value="${esc(earnings.start)}"></label><label>終了時のmR<input id="earn-end" type="number" min="0" step="any" value="${esc(earnings.end)}"></label></div><label>作業時間（分）<input id="earn-minutes" type="number" min="0.01" step="any" value="${esc(earnings.minutes)}"></label><output class="result" id="earn-result" aria-live="polite"></output><p class="small muted">仮レート：1 USD = ${num(currentRate(config))} mR。<a href="#/tools">ツールで変更</a></p></article></div></section>
  ${config.features?.hitokoto !== false ? `<section class="section panel"><div class="section-heading"><div><p class="eyebrow">いま、なにしてる？</p><h2>ひとことボード</h2></div>${badge}</div><form id="shout-form"><label>ひとこと（40字以内）<textarea name="comment" rows="2" maxlength="40" placeholder="ドラタワ周回中。今日はのんびり。" required></textarea></label><div class="section-heading"><p class="small muted">24時間で自動終了。投稿は掲示板と共通で3分に1件。<br>URL・連絡先は書けません。このブラウザだけの試作です。</p><button class="primary" type="submit">ひとこと残す →</button></div><p class="form-error" role="alert" tabindex="-1" hidden></p></form><div id="shout-list" class="grid two"></div></section>` : ''}`;
  const safeSave = (key,value) => { try { writeLocal(key,value); } catch (error) { toast(error.message); } };
  root.querySelectorAll('[data-counter]').forEach(element => {
    const index=Number(element.dataset.counter), counter=counterState[index];
    element.addEventListener('click',event => {
      const button=event.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-reset')) counter.count=0;
      else if (button.dataset.step) counter.count=Math.max(0,counter.count+Number(button.dataset.step));
      element.querySelector('[data-count-output]').textContent=num(counter.count);
      safeSave('genso.counters.v1',counterState);
    });
    element.addEventListener('input',event => {
      const field=event.target.dataset.field;
      if (field) { counter[field]=event.target.value; safeSave('genso.counters.v1',counterState); }
    });
  });
  const minutes = () => Number(root.querySelector('#timer-minutes').value);
  const timerAction = action => { try { action(); timer.tick(); } catch (e) { toast(e.message); } };
  root.querySelectorAll('[data-minutes]').forEach(button => button.addEventListener('click',() => {
    root.querySelector('#timer-minutes').value=button.dataset.minutes;
    timerAction(() => timer.reset(Number(button.dataset.minutes)));
  }));
  root.querySelector('#timer-minutes').addEventListener('change',() => timerAction(() => timer.reset(minutes())));
  root.querySelector('#timer-start').addEventListener('click',() => timerAction(() => timer.start(minutes())));
  root.querySelector('#timer-pause').addEventListener('click',() => timerAction(() => timer.pause()));
  root.querySelector('#timer-reset').addEventListener('click',() => timerAction(() => timer.reset(minutes())));
  timer.tick();
  const calculate = () => {
    const raw = { start:root.querySelector('#earn-start').value, end:root.querySelector('#earn-end').value, minutes:root.querySelector('#earn-minutes').value };
    safeSave('genso.earnings.v1',raw);
    const start=Number(raw.start), end=Number(raw.end), minutes=Number(raw.minutes);
    const difference=end-start, hourly=difference/(minutes/60);
    root.querySelector('#earn-result').textContent = Object.values(raw).every(s => s.trim() !== '') && start>=0 && end>=0 && minutes>0 && Number.isFinite(hourly) ? `差分 ${num(difference)} mR ／ 時給 ${num(hourly)} mR（約${num(hourly/currentRate(config))} USD）` : '所持mRは0以上、作業時間は0より大きく入力してください。';
  };
  root.querySelector('.earnings-panel').addEventListener('input',calculate); calculate();
  if (config.features?.hitokoto === false) return;
  let alive=true, snapshot='';
  const refresh = async () => {
    const posts=await store.list({type:'shout'});
    const html=posts.map(p => shoutCard(p,store)).join('') || '<p class="empty span-all">まだひとことはありません。いまの気分を残してみよう。</p>';
    if (alive && html !== snapshot) { root.querySelector('#shout-list').innerHTML=html; snapshot=html; }
  };
  root.querySelector('#shout-list').addEventListener('click',e => handlePostAction(e,store));
  const form=root.querySelector('#shout-form');
  form.addEventListener('submit',async event => {
    event.preventDefault(); const button=form.querySelector('button'); button.disabled=true;
    try { await store.create({type:'shout',comment:form.elements.comment.value}); form.reset(); form.querySelector('.form-error').hidden=true; toast('ひとことを残しました。'); }
    catch (error) { errorIn(form,error.message); }
    finally { button.disabled=false; }
  });
  window.addEventListener('genso-store-change',refresh);
  const interval=setInterval(refresh,1000); await refresh();
  return () => { alive=false; clearInterval(interval); window.removeEventListener('genso-store-change',refresh); };
}
