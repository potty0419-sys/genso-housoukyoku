import { readFile } from 'node:fs/promises';
export const fixture = JSON.parse(await readFile(new URL('./youtube.json',import.meta.url),'utf8'));
export function fixtureFetch(data = fixture, calls = []) {
  return async value => {
    const url = new URL(value); calls.push(url);
    const endpoint = url.pathname.split('/').at(-1);
    if (endpoint === 'playlistItems') return {items:data.uploadIds.map(videoId => ({contentDetails:{videoId}}))};
    if (endpoint === 'videos') return {items:url.searchParams.get('id').split(',').map(id => data.videos.find(v => v.id === id)).filter(Boolean)};
    if (endpoint === 'search') {
      const kind = url.searchParams.get('eventType');
      const ids = kind === 'upcoming' ? data.upcomingIds : kind === 'live' ? data.liveIds : data.popularIds;
      return {items:ids.map(videoId => ({id:{videoId}}))};
    }
    throw new Error('Unexpected fixture endpoint');
  };
}
