import { readLocal, writeLocal, remaining } from './utils.js';

// 終了時刻を保存し、別画面や再読み込み後も残り時間を復元する。
export class WorkTimer {
  constructor() {
    this.state = readLocal('genso.timer.v1',{ end:null, remaining:1800000, finished:false });
    this.minutes = 30;
  }
  save() { writeLocal('genso.timer.v1',this.state); }
  start(minutes) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('タイマーは1分〜1440分の整数で設定してください。');
    this.minutes = minutes;
    if (this.state.end) return;
    if (this.state.finished || !this.state.remaining) this.state.remaining=minutes*60000;
    this.state.end = Date.now()+this.state.remaining;
    this.state.finished = false; this.save();
  }
  pause() {
    if (this.state.end) this.state.remaining=Math.max(0,this.state.end-Date.now());
    this.state.end=null; this.save();
  }
  reset(minutes) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('タイマーは1分〜1440分の整数で設定してください。');
    this.minutes=minutes; this.state={end:null,remaining:minutes*60000,finished:false}; this.save();
    document.body.classList.remove('timer-finished');
  }
  tick() {
    if (this.state.end && this.state.end <= Date.now()) {
      this.state={end:null,remaining:0,finished:true}; this.save();
      document.body.classList.add('timer-finished');
      window.dispatchEvent(new Event('genso-timer-finished'));
    }
    const display = document.querySelector('#timer-display');
    if (display) display.textContent = remaining(this.state.end ? this.state.end-Date.now() : this.state.remaining);
    const status = document.querySelector('#timer-status');
    if (status) status.textContent = this.state.finished ? 'おつかれさま！ 設定した時間になりました。' : this.state.end ? '作業中 · 音を鳴らさず画面でお知らせします' : 'ひと息ついたら、はじめよう。';
    const start = document.querySelector('#timer-start');
    if (start) start.disabled=!!this.state.end;
    const pause = document.querySelector('#timer-pause');
    if (pause) pause.disabled=!this.state.end;
  }
}
