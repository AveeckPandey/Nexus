import type { Message } from './types';

export function isImageTile(m: Message): boolean {
  return Boolean(m.mediaUrl) &&
    (m.mediaType === 'image' ||
      /\.(jpe?g|png|gif|webp|svg|bmp)(\?.*)?$/i.test(m.mediaUrl || '') ||
      (m.mediaUrl!.includes('/api/media/') &&
        m.mediaType !== 'video' &&
        m.mediaType !== 'audio' &&
        m.mediaType !== 'file'));
}

export function placeholderOf(m: Message): string {
  return `📎 ${m.mediaUrl?.split('/').pop()}`;
}

/** Image with no real caption/reply — eligible for album grouping. */
export function isBareTile(m: Message): boolean {
  if (!isImageTile(m) || m.replyTo) return false;
  const c = (m.content || '').trim();
  return c === '' || c === '📎 image' || c === placeholderOf(m);
}

export const ALBUM_GAP_MS = 3 * 60 * 1000;

export interface Album {
  /** All tiles (caption-carrier last, if any). */
  msgs: Message[];
  caption: string;
}

/**
 * Group consecutive same-sender images into WhatsApp-style albums.
 * Returns run starts (first id → album) plus the set of grouped ids.
 * A captioned image immediately after bare tiles joins as the last tile.
 */
export function buildAlbumIndex(list: Message[]): { starts: Map<string, Album>; members: Set<string> } {
  const starts = new Map<string, Album>();
  const members = new Set<string>();
  let i = 0;
  while (i < list.length) {
    const m = list[i];
    if (isBareTile(m)) {
      const run: Message[] = [m];
      let j = i + 1;
      while (j < list.length) {
        const n = list[j];
        const prev = run[run.length - 1];
        if (n.senderId !== m.senderId) break;
        if (+new Date(n.createdAt) - +new Date(prev.createdAt) > ALBUM_GAP_MS) break;
        if (isBareTile(n)) {
          run.push(n);
          j++;
          continue;
        }
        if (isImageTile(n) && !n.replyTo) {
          run.push(n);
          j++;
        }
        break;
      }
      if (run.length >= 2) {
        const last = run[run.length - 1];
        const lc = (last.content || '').trim();
        const caption =
          lc !== '' && lc !== '📎 image' && lc !== placeholderOf(last) ? last.content : '';
        starts.set(m.id, { msgs: run, caption });
        run.forEach((r) => members.add(r.id));
        i = j;
        continue;
      }
    }
    i++;
  }
  return { starts, members };
}
