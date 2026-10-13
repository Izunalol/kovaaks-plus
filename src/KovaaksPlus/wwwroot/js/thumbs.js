// Scenario thumbnails: own image → tag default thumbnails (split diagonally when several) → generated tile.
import { h, thumb, mediaUrl, isVideo, keyWord } from './ui.js';
import { state, primaryTagColor, displayName } from './state.js';

/** Media file names of tag thumbnails that apply to a scenario, in tag-list order. */
export function tagThumbs(s) {
  if (!s || !s.tags || !s.tags.length) return [];
  return state.tags.filter((t) => t.thumbnail && s.tags.includes(t.id)).map((t) => t.thumbnail);
}

export function scenarioThumb(s, extraClass = '') {
  if (!s) return thumb('?', null, null, extraClass);
  if (s.thumbnail) return thumb(s.name, s.thumbnail, null, extraClass);
  const media = tagThumbs(s).slice(0, 4);
  if (!media.length) return thumb(s.name, null, primaryTagColor(s), extraClass);
  return splitThumb(media, state.config.tagThumbNames !== false ? keyWord(displayName(s)) : null, extraClass);
}

export function splitThumb(media, label, extraClass = '') {
  const n = media.length;
  const skew = n > 1 ? 7 : 0;
  const el = h('div', { class: 'thumb tagthumb ' + extraClass });
  media.forEach((m, i) => {
    const l = (i / n) * 100, r = ((i + 1) / n) * 100;
    // Diagonal slices; the outer edges stay square.
    const tl = i === 0 ? 0 : l + skew, tr = i === n - 1 ? 100 : r + skew;
    const bl = i === 0 ? 0 : l - skew, br = i === n - 1 ? 100 : r - skew;
    const clip = n > 1 ? `polygon(${tl}% 0, ${tr}% 0, ${br}% 100%, ${bl}% 100%)` : null;
    const url = mediaUrl(m);
    const props = { class: 'slice', style: clip ? { clipPath: clip } : null };
    el.append(isVideo(m) ? h('video', { ...props, src: url, muted: true, loop: true, autoplay: true, playsinline: true }) : h('img', { ...props, src: url, loading: 'lazy', alt: '' }));
  });
  if (label) el.append(h('div', { class: 'thumb-label' }, label));
  return el;
}
