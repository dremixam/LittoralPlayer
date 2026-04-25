import { TIDAL_API_BASE, TIDAL_IMAGE_BASE } from '../../shared/constants';
import { getAccessToken, getCountryCode } from '../auth/webviewToken';
import type { AlbumRef, Artist, Track } from '../../shared/models';

export interface Album {
  id: string;
  title: string;
  coverUrl?: string;
  releaseDate?: string;
  numberOfTracks?: number;
  artists: Artist[];
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  coverUrl?: string;
  numberOfTracks?: number;
}

class TidalApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'TidalApiError';
  }
}

export class UnauthorizedError extends TidalApiError {
  constructor(message = "Non authentifié auprès de Tidal (connectez-vous dans la WebView).") {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

// Token public utilisé par listen.tidal.com. Sans ce header certains endpoints v1
// refusent silencieusement la requête (ou la laissent pendre).
const TIDAL_WEB_TOKEN = 'CzET4vdadNUFQ5JU';
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new UnauthorizedError();

  const url = new URL(TIDAL_API_BASE + path);
  if (!params || params.countryCode === undefined) {
    url.searchParams.set('countryCode', getCountryCode());
  }
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  console.log('[tidal-api] GET', url.toString());
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tidal-Token': TIDAL_WEB_TOKEN,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[tidal-api] fetch failed:', msg);
    throw new TidalApiError(0, `Tidal API request failed: ${msg}`);
  }
  console.log('[tidal-api] ->', res.status, res.statusText);

  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new TidalApiError(res.status, `Tidal API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

// --- Mapping (format JSON v1, plat) ---

interface V1Artist { id: number; name: string; picture?: string | null }
interface V1Album {
  id: number;
  title: string;
  cover?: string | null;
  releaseDate?: string;
  numberOfTracks?: number;
  artists?: V1Artist[];
  artist?: V1Artist;
}
interface V1Track {
  id: number;
  title: string;
  duration: number;
  isrc?: string;
  explicit?: boolean;
  url?: string;
  artists?: V1Artist[];
  artist?: V1Artist;
  album?: V1Album;
}
interface V1Playlist {
  uuid: string;
  title: string;
  description?: string;
  image?: string | null;
  squareImage?: string | null;
  numberOfTracks?: number;
}

function imageUrl(prefix: string | null | undefined, size = 640): string | undefined {
  if (!prefix) return undefined;
  // Format Tidal : "ab-cd-ef-12345..." -> https://resources.tidal.com/images/<slashified>/<size>x<size>.jpg
  const path = prefix.replace(/-/g, '/');
  return `${TIDAL_IMAGE_BASE}/${path}/${size}x${size}.jpg`;
}

function mapArtist(a: V1Artist): Artist {
  return { id: String(a.id), name: a.name, pictureUrl: imageUrl(a.picture, 320) };
}

function artistsOf<T extends { artists?: V1Artist[]; artist?: V1Artist }>(x: T): V1Artist[] {
  if (x.artists && x.artists.length) return x.artists;
  return x.artist ? [x.artist] : [];
}

function mapAlbumRef(a: V1Album): AlbumRef {
  return { id: String(a.id), title: a.title, coverUrl: imageUrl(a.cover) };
}

function mapAlbum(a: V1Album): Album {
  return {
    id: String(a.id),
    title: a.title,
    coverUrl: imageUrl(a.cover),
    releaseDate: a.releaseDate,
    numberOfTracks: a.numberOfTracks,
    artists: artistsOf(a).map(mapArtist),
  };
}

function mapTrack(t: V1Track): Track {
  return {
    id: String(t.id),
    title: t.title,
    durationSeconds: t.duration,
    isrc: t.isrc,
    explicit: t.explicit,
    coverUrl: t.album ? imageUrl(t.album.cover) : undefined,
    url: t.url ?? `https://listen.tidal.com/track/${t.id}`,
    artists: artistsOf(t).map(mapArtist),
    album: t.album ? mapAlbumRef(t.album) : undefined,
  };
}

function mapPlaylist(p: V1Playlist): Playlist {
  return {
    id: p.uuid,
    title: p.title,
    description: p.description,
    coverUrl: imageUrl(p.squareImage ?? p.image),
    numberOfTracks: p.numberOfTracks,
  };
}

// --- API publique ---

export interface SearchResults {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

const TYPE_MAP: Record<string, string> = {
  tracks: 'TRACKS',
  albums: 'ALBUMS',
  artists: 'ARTISTS',
  playlists: 'PLAYLISTS',
};

export async function search(args: { q: string; types: string[]; limit: number; countryCode?: string }): Promise<SearchResults> {
  const wantedV1 = args.types
    .map(t => TYPE_MAP[t])
    .filter((t): t is string => !!t)
    .join(',');

  const resp = await request<{
    tracks?: { items: V1Track[] };
    albums?: { items: V1Album[] };
    artists?: { items: V1Artist[] };
    playlists?: { items: V1Playlist[] };
  }>(`/search`, {
    query: args.q,
    types: wantedV1 || 'TRACKS,ALBUMS,ARTISTS,PLAYLISTS',
    limit: args.limit,
    countryCode: args.countryCode,
  });

  return {
    tracks: (resp.tracks?.items ?? []).map(mapTrack),
    albums: (resp.albums?.items ?? []).map(mapAlbum),
    artists: (resp.artists?.items ?? []).map(mapArtist),
    playlists: (resp.playlists?.items ?? []).map(mapPlaylist),
  };
}

export async function getTrack(trackId: string, countryCode?: string): Promise<Track | null> {
  try {
    const t = await request<V1Track>(`/tracks/${encodeURIComponent(trackId)}`, { countryCode });
    return mapTrack(t);
  } catch (err) {
    if (err instanceof TidalApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Préfetch du "mix" d'une piste : `GET /v1/tracks/{id}/mix`.
 * C'est le préalable indispensable au dispatch
 * `playQueue/ADD_MEDIA_ITEMS_TO_QUEUE` côté lecteur Tidal — sans cette
 * réponse, le reducer accepte l'ajout mais Tidal ne sait pas comment
 * lire la piste ("Aucun titre demandé n'est disponible à la lecture").
 *
 * On le fait depuis le main process car la WebView se prend des 401 sur
 * `tidal.com` (cookies pas toujours valides) et du CORS sur `api.tidal.com`.
 * Ici on a déjà le Bearer + `X-Tidal-Token`.
 */
export async function prefetchTrackMix(trackId: string): Promise<boolean> {
  try {
    await request<unknown>(`/tracks/${encodeURIComponent(trackId)}/mix`, {
      deviceType: 'BROWSER',
      locale: 'fr_FR',
    });
    return true;
  } catch (err) {
    console.warn('[tidal-api] prefetchTrackMix failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Récupère une track au format JSON:API v2 (openapi.tidal.com), tel que stocké
 * par Tidal dans `entities.tracks.entities[id]`. Permet d'hydrater le store
 * Redux du lecteur web pour des tracks que la SPA n'a jamais chargées.
 */
export async function fetchTrackEntityV2(trackId: string): Promise<unknown | null> {
  const token = getAccessToken();
  if (!token) throw new UnauthorizedError();
  const url = new URL(`https://openapi.tidal.com/v2/tracks/${encodeURIComponent(trackId)}`);
  url.searchParams.set('countryCode', getCountryCode());
  url.searchParams.set('include', 'albums.coverArt,lyrics,artists.profileArt,artists.biography');
  console.log('[tidal-api] GET', url.toString());
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.api+json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[tidal-api] fetchTrackEntityV2 fetch failed:', err);
    return null;
  }
  console.log('[tidal-api] ->', res.status, res.statusText);
  if (!res.ok) return null;
  try {
    const json = (await res.json()) as { data?: unknown };
    return json && json.data ? json.data : null;
  } catch {
    return null;
  }
}
