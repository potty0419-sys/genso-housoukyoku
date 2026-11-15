import { badge, esc, heading, readLocal, writeLocal, num, toast } from '../utils.js';

export function currentRate(config) {
  const saved = Number(readLocal('genso.rate.v1',config.mrPerUsd));
  return Number.isFinite(saved) && saved > 0 ? saved : config.mrPerUsd;
}
export function toolsPage({root,apps,config}) {
  root.innerHTML = `${heading('冒険に、小さな便利を。','ファンアプリ・ツール','ポッティの制作メモと、すぐ使えるミニツール。')}<div class="notice">${badge} アプリ紹介・換算レート・必要コイン数は仮設定です。公式の価格・仕様や収益を示すものではありません。</div>
  <section class="grid three">${apps.map(a => `<article class="panel app-card"><div class="card-top"><span class="app-symbol">${esc(a.symbol)}</span><span class="chip">${esc(a.status)}</span>${badge}</div><p class="eyebrow">${esc(a.author)}</p><h2>${esc(a.name)}</h2><p class="muted">${esc(a.description)}</p><span class="small muted">${a.url ? 'リンクの確認待ち' : '公開リンクは準備中'}</span></article>`).join('')}</section>
  <section class="section"><div class="section-heading"><div><p class="eyebrow">さっと計算、すぐ冒険。</p><h2>ミニツール</h2></div>${badge}</div><div class="grid two tools-grid">
  <article class="panel calculator"><span class="tool-number">01 / 換算</span><h2>mR ⇄ USD 換算メモ</h2><p class="muted small">仮のレートを自由に変更できます。実際の取引価格ではありません。</p><label>1 USD あたりのmR<input id="exchange-rate" type="number" min="0.000001" step="any" value="${currentRate(config)}"></label><div class="form-pair"><label>mR<input id="convert-mr" type="number" min="0" step="any" value="10000"></label><label>USD<input id="convert-usd" type="number" min="0" step="any" value="1"></label></div><output id="convert-result" class="result" aria-live="polite"></output></article>
  <article class="panel calculator"><span class="tool-number">02 / 売買</span><h2>売買の還元率</h2><p class="muted small">還元率＝売値÷買値×100。手数料は含みません。</p><label>買値（mR）<input id="buy-price" type="number" min="0" step="any" value="10000"></label><label>売値（mR）<input id="sell-price" type="number" min="0" step="any" value="8000"></label><output id="return-result" class="result" aria-live="polite"></output></article>
  <article class="panel calculator span-all"><div class="section-heading"><div><span class="tool-number">03 / 周回</span><h2>ドラタワ コイン計算</h2></div><span class="coin-symbol" aria-hidden="true">◈</span></div><p class="muted small">目標は仮の1,000枚。1回のコイン数は自分で設定してください。</p><div class="form-grid three-fields"><label>1回あたりのコイン数<input id="coins-per-run" type="number" min="1" step="1" value="30"></label><label>現在のコイン数<input id="current-coins" type="number" min="0" step="1" value="0"></label><label>1日あたりの周回数<input id="runs-per-day" type="number" min="1" step="1" value="5"></label></div><output id="coin-result" class="result" aria-live="polite"></output></article>
  </div></section>`;
  const value = id => {
    const element = root.querySelector(`#${id}`);
    return element.value.trim() === '' ? NaN : Number(element.value);
  };
  let source = 'mr';
  const convert = () => {
    const rate = value('exchange-rate'), amount = value(`convert-${source}`);
    const output = root.querySelector('#convert-result');
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(amount) || amount < 0) { output.textContent = '正のレートと0以上の金額を入力してください。'; return; }
    const converted = source === 'mr' ? amount/rate : amount*rate;
    if (!Number.isFinite(converted)) { output.textContent = '計算できる範囲の金額を入力してください。'; return; }
    const other = root.querySelector(`#convert-${source === 'mr' ? 'usd' : 'mr'}`);
    other.value = String(Number(converted.toFixed(8)));
    output.textContent = `${num(value('convert-mr'))} mR ＝ ${num(value('convert-usd'))} USD`;
    try { writeLocal('genso.rate.v1',rate); } catch (e) { toast(e.message); }
  };
  root.querySelector('#convert-mr').addEventListener('input',() => { source='mr'; convert(); });
  root.querySelector('#convert-usd').addEventListener('input',() => { source='usd'; convert(); });
  root.querySelector('#exchange-rate').addEventListener('input',convert);
  const returns = () => {
    const buy=value('buy-price'), sell=value('sell-price');
    const rate = sell/buy*100;
    root.querySelector('#return-result').textContent = buy > 0 && sell >= 0 && Number.isFinite(rate) ? `還元率 ${num(rate)}% ／ 差額 ${num(sell-buy)} mR` : '買値は0より大きく、売値は0以上で入力してください。';
  };
  ['buy-price','sell-price'].forEach(id => root.querySelector(`#${id}`).addEventListener('input',returns));
  const coins = () => {
    const per=value('coins-per-run'), current=value('current-coins'), daily=value('runs-per-day');
    const valid = [per,current,daily].every(Number.isSafeInteger) && per > 0 && current >= 0 && daily > 0;
    const runs = Math.ceil(Math.max(0,1000-current)/per);
    root.querySelector('#coin-result').textContent = valid ? (runs === 0 ? '目標の1,000枚に到達しています！' : `あと ${num(Math.max(0,1000-current))}枚 ／ ${num(runs)}回 ／ 約${num(Math.ceil(runs/daily))}日`) : 'コイン数と周回数を正しく入力してください（1回・1日は1以上の整数）。';
  };
  ['coins-per-run','current-coins','runs-per-day'].forEach(id => root.querySelector(`#${id}`).addEventListener('input',coins));
  convert(); returns(); coins();
}
