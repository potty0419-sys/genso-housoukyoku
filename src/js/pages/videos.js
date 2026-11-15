import { heading, options, videoCard, esc } from '../utils.js';
import { updatedLabel } from '../data.js';
export function videosPage({root,videos}) {
  let tab = 'popular';
  const all = [...videos.popular,...videos.potty];
  root.innerHTML = `${heading('みんなの元素騎士チャンネル', '動画をみる', '冒険のヒントも、いつもの雑談も。気になる一本をどうぞ。')}<p class="small muted">${esc(updatedLabel(videos.fetchedAt))}</p><div class="button-row video-tabs" role="group" aria-label="動画の一覧"><button class="primary" data-tab="popular" aria-pressed="true">みんなの人気（直近30日）</button><button class="quiet" data-tab="potty" aria-pressed="false">ポッティの動画</button></div><section class="panel filters" aria-label="動画の絞り込み"><label>種別<select id="video-type">${options([...new Set(['配信アーカイブ','ショート','動画',...all.map(v => v.type)])])}</select></label><label>タグ<select id="video-tag">${options([...new Set(all.flatMap(v => v.tags))])}</select></label><label>並べ替え<select id="video-sort"><option value="popular">人気順</option><option value="new">新着順</option></select></label><span id="video-count" class="muted" role="status"></span></section><div id="video-list" class="grid three"></div>`;
  const refresh = () => {
    const type = root.querySelector('#video-type').value, tag = root.querySelector('#video-tag').value;
    const filtered = videos[tab].filter(v => (!type || v.type === type) && (!tag || v.tags.includes(tag))).sort((a,b) => root.querySelector('#video-sort').value === 'popular' ? b.views-a.views : (Date.parse(b.publishedAt) || 0)-(Date.parse(a.publishedAt) || 0));
    root.querySelector('#video-list').innerHTML = filtered.map(videoCard).join('') || '<p class="empty span-all">条件に合う動画がありません。</p>';
    root.querySelector('#video-count').textContent = `${filtered.length}本の動画`;
  };
  root.querySelector('.filters').addEventListener('change',refresh);
  root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click',() => {
    tab = button.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(item => {
      const selected = item === button;
      item.setAttribute('aria-pressed',String(selected)); item.className = selected ? 'primary' : 'quiet';
    });
    refresh();
  }));
  refresh();
}
