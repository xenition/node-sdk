import { HttpClient } from '../../core/http-client';
import { API_ENDPOINTS } from '../../constants';
import { MIGRATIONS_LEDGER_TABLE, MigrationsClient } from '../../migrations';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { ModulesClient } from '../modules-client';
import { MediaClient, MEDIA_TABLES } from './media-client';

/**
 * Module clients run over a real QueryClient with the http layer mocked
 * (same seam as the cms suite), so every assertion here is against the
 * actual IR that would hit `/app-platform/query`.
 */
const makeMedia = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, media: new MediaClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

/** Respond to the slug-lookup SELECT with these rows, then succeed the write. */
const primeSlugLookup = (post: jest.Mock, slugs: string[]) => {
  post
    .mockResolvedValueOnce({ data: slugs.map((slug) => ({ slug })) })
    .mockResolvedValueOnce({ data: [] });
};

describe('albums: create + slug generation', () => {
  it('creates an album with a kebab slug from the title and sane defaults', async () => {
    const { post, media } = makeMedia();
    primeSlugLookup(post, []);
    const album = await media.createAlbum({ title: 'Béach Trip 2026!' });

    expect(album.slug).toBe('beach-trip-2026');
    expect(album.description).toBe('');
    expect(album.cover_url).toBeNull();
    expect(album.data).toEqual({});
    expect(album.published).toBe(true); // published DEFAULTs to true for media
    expect(album.sort).toBe(0);
    expect(album.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(album.created_at).toEqual(expect.any(String));

    // Call 0: slug lookup. Call 1: the INSERT.
    const lookup = payloadOf(post, 0);
    expect(lookup).toEqual(
      expect.objectContaining({
        type: 'SELECT',
        table: MEDIA_TABLES.ALBUMS,
        columns: ['slug'],
        where: [{ column: 'slug', operator: 'LIKE', value: 'beach-trip-2026%', type: 'AND' }],
      }),
    );
    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(MEDIA_TABLES.ALBUMS);
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.EXECUTE, expect.anything());
  });

  it('omits created_at from the wire insert (DB default owns it)', async () => {
    const { post, media } = makeMedia();
    primeSlugLookup(post, []);
    const album = await media.createAlbum({ title: 'Gallery' });
    const insert = payloadOf(post, 1);
    const data = insert.data as Record<string, unknown>;
    expect(data).not.toHaveProperty('created_at');
    // but the returned object still carries it for the caller
    expect(album.created_at).toEqual(expect.any(String));
  });

  it('omits cover_url from the insert when unset (column takes NULL)', async () => {
    const { post, media } = makeMedia();
    primeSlugLookup(post, []);
    await media.createAlbum({ title: 'No Cover' });
    const data = payloadOf(post, 1).data as Record<string, unknown>;
    expect(data).not.toHaveProperty('cover_url');
  });

  it('includes cover_url in the insert when provided', async () => {
    const { post, media } = makeMedia();
    primeSlugLookup(post, []);
    const album = await media.createAlbum({ title: 'Cover', cover_url: 'https://cdn/x.jpg' });
    expect(album.cover_url).toBe('https://cdn/x.jpg');
    const data = payloadOf(post, 1).data as Record<string, unknown>;
    expect(data.cover_url).toBe('https://cdn/x.jpg');
  });

  it('dedupes a taken slug with a -2 suffix', async () => {
    const { post, media } = makeMedia();
    primeSlugLookup(post, ['portraits']);
    const album = await media.createAlbum({ title: 'Portraits' });
    expect(album.slug).toBe('portraits-2');
  });

  it('keeps counting past existing suffixes (-2 taken → -3)', async () => {
    const { post, media } = makeMedia();
    primeSlugLookup(post, ['portraits', 'portraits-2', 'portraits-holiday']);
    const album = await media.createAlbum({ title: 'Portraits' });
    expect(album.slug).toBe('portraits-3');
  });

  it('respects an explicit slug and skips the lookup query entirely', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValueOnce({ data: [] });
    const album = await media.createAlbum({ title: 'Portraits', slug: 'my-portraits' });
    expect(album.slug).toBe('my-portraits');
    expect(post).toHaveBeenCalledTimes(1); // just the INSERT
    expect(payloadOf(post, 0).type).toBe('INSERT');
  });

  it('validates createAlbum input with clear errors', async () => {
    const { media } = makeMedia();
    await expect(media.createAlbum({ title: '' })).rejects.toThrow(
      'MediaClient.createAlbum: "title" must be a non-empty string',
    );
    await expect(
      media.createAlbum({ title: 'x', data: 'nope' as unknown as Record<string, unknown> }),
    ).rejects.toThrow(/"data" must be a plain object/);
    await expect(
      media.createAlbum({ title: 'x', sort: 'high' as unknown as number }),
    ).rejects.toThrow(/"sort" must be a finite number/);
    await expect(
      media.createAlbum({ title: 'x', published: 1 as unknown as boolean }),
    ).rejects.toThrow(/"published" must be a boolean/);
    await expect(
      media.createAlbum({ title: 'x', cover_url: '' }),
    ).rejects.toThrow(/"cover_url" must be a non-empty string/);
  });
});

describe('albums: read / list / update / delete IR', () => {
  it('getAlbum selects by slug with limit 1', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [{ id: 'a1', slug: 'beach' }] });
    await expect(media.getAlbum('beach')).resolves.toEqual({ id: 'a1', slug: 'beach' });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: MEDIA_TABLES.ALBUMS,
        where: [{ column: 'slug', operator: '=', value: 'beach', type: 'AND' }],
        limit: 1,
      }),
    );
  });

  it('getAlbum resolves null for a missing album', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await expect(media.getAlbum('nope')).resolves.toBeNull();
  });

  it('listAlbums filters on published and orders by a whitelisted column', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await media.listAlbums({ published: true, orderBy: 'created_at', direction: 'DESC', limit: 10 });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: MEDIA_TABLES.ALBUMS,
        where: [{ column: 'published', operator: '=', value: true, type: 'AND' }],
        orderBy: [{ column: 'created_at', direction: 'DESC' }],
        limit: 10,
      }),
    );
  });

  it('listAlbums defaults to ordering by sort ASC with no filter', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await media.listAlbums();
    const payload = payloadOf(post, 0);
    expect(payload.orderBy).toEqual([{ column: 'sort', direction: 'ASC' }]);
    expect(payload.where).toBeUndefined();
  });

  it('listAlbums rejects a non-whitelisted orderBy column', async () => {
    const { media } = makeMedia();
    await expect(media.listAlbums({ orderBy: 'title; DROP TABLE' })).rejects.toThrow(
      /"orderBy" must be one of/,
    );
  });

  it('updateAlbum emits a validated UPDATE (no updated_at column on media)', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await media.updateAlbum('a1', { title: 'New title', published: false });
    const payload = payloadOf(post, 0);
    expect(payload.type).toBe('UPDATE');
    expect(payload.where).toEqual([{ column: 'id', operator: '=', value: 'a1', type: 'AND' }]);
    expect(payload.data).toEqual({ title: 'New title', published: false });
    expect(payload.data).not.toHaveProperty('updated_at');
  });

  it('updateAlbum rejects an empty patch and invalid patch values', async () => {
    const { media } = makeMedia();
    await expect(media.updateAlbum('a1', {})).rejects.toThrow(/at least one field/);
    await expect(media.updateAlbum('a1', { title: '' })).rejects.toThrow(/"title"/);
    await expect(media.updateAlbum('', { title: 'x' })).rejects.toThrow(/"id"/);
    await expect(
      media.updateAlbum('a1', { data: [1, 2] as unknown as Record<string, unknown> }),
    ).rejects.toThrow(/"data" must be a plain object/);
  });

  it('deleteAlbum issues a hard DELETE by id', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await media.deleteAlbum('a1');
    expect(payloadOf(post, 0)).toEqual({
      type: 'DELETE',
      table: MEDIA_TABLES.ALBUMS,
      where: [{ column: 'id', operator: '=', value: 'a1', type: 'AND' }],
    });
  });
});

describe('items: add / list / order IR', () => {
  it('addItem inserts a fully-defaulted image item scoped to the album', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    const item = await media.addItem('a1', { url: 'https://cdn/1.jpg' });

    expect(item.album_id).toBe('a1');
    expect(item.url).toBe('https://cdn/1.jpg');
    expect(item.kind).toBe('image');
    expect(item.caption).toBe('');
    expect(item.alt).toBe('');
    expect(item.width).toBeNull();
    expect(item.height).toBeNull();
    expect(item.sort).toBe(0);
    expect(item.data).toEqual({});
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);

    const insert = payloadOf(post, 0);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(MEDIA_TABLES.ITEMS);
    const data = insert.data as Record<string, unknown>;
    expect(data.album_id).toBe('a1');
    // created_at omitted; null width/height omitted
    expect(data).not.toHaveProperty('created_at');
    expect(data).not.toHaveProperty('width');
    expect(data).not.toHaveProperty('height');
  });

  it('addItem carries kind/caption/alt/width/height/sort/data through', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    const item = await media.addItem('a1', {
      url: 'https://cdn/clip.mp4',
      kind: 'video',
      caption: 'A clip',
      alt: 'moving image',
      width: 1920,
      height: 1080,
      sort: 3,
      data: { duration: 12 },
    });
    expect(item.kind).toBe('video');
    expect(item.width).toBe(1920);
    expect(item.height).toBe(1080);
    const data = payloadOf(post, 0).data as Record<string, unknown>;
    expect(data).toEqual(
      expect.objectContaining({
        url: 'https://cdn/clip.mp4',
        kind: 'video',
        caption: 'A clip',
        alt: 'moving image',
        width: 1920,
        height: 1080,
        sort: 3,
        data: { duration: 12 },
      }),
    );
  });

  it('listItems scopes to the album and orders by sort ASC by default', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await media.listItems('a1');
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: MEDIA_TABLES.ITEMS,
        where: [{ column: 'album_id', operator: '=', value: 'a1', type: 'AND' }],
        orderBy: [{ column: 'sort', direction: 'ASC' }],
      }),
    );
  });

  it('listItems honors a whitelisted orderBy + direction/limit/offset', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await media.listItems('a1', { orderBy: 'created_at', direction: 'DESC', limit: 5, offset: 2 });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        orderBy: [{ column: 'created_at', direction: 'DESC' }],
        limit: 5,
        offset: 2,
      }),
    );
  });

  it('listItems rejects a non-whitelisted orderBy column', async () => {
    const { media } = makeMedia();
    await expect(media.listItems('a1', { orderBy: 'url; DROP TABLE' })).rejects.toThrow(
      /"orderBy" must be one of/,
    );
  });

  it('listItems requires a non-empty albumId', async () => {
    const { media } = makeMedia();
    await expect(media.listItems('')).rejects.toThrow(/"albumId"/);
  });

  it('updateItem emits a validated UPDATE by id', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await media.updateItem('i1', { caption: 'Updated', sort: 7 });
    const payload = payloadOf(post, 0);
    expect(payload.type).toBe('UPDATE');
    expect(payload.where).toEqual([{ column: 'id', operator: '=', value: 'i1', type: 'AND' }]);
    expect(payload.data).toEqual({ caption: 'Updated', sort: 7 });
  });

  it('updateItem rejects an empty patch and invalid values', async () => {
    const { media } = makeMedia();
    await expect(media.updateItem('i1', {})).rejects.toThrow(/at least one field/);
    await expect(media.updateItem('i1', { url: '' })).rejects.toThrow(/"url"/);
    await expect(media.updateItem('', { url: 'x' })).rejects.toThrow(/"id"/);
  });

  it('removeItem issues a hard DELETE by id', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValue({ data: [] });
    await media.removeItem('i1');
    expect(payloadOf(post, 0)).toEqual({
      type: 'DELETE',
      table: MEDIA_TABLES.ITEMS,
      where: [{ column: 'id', operator: '=', value: 'i1', type: 'AND' }],
    });
  });
});

describe('items: validation matrix', () => {
  it('requires url on addItem', async () => {
    const { media } = makeMedia();
    await expect(media.addItem('a1', { url: '' })).rejects.toThrow(/"url" must be a non-empty string/);
    await expect(
      media.addItem('a1', { url: undefined as unknown as string }),
    ).rejects.toThrow(/"url" must be a non-empty string/);
  });

  it('requires a non-empty albumId on addItem', async () => {
    const { media } = makeMedia();
    await expect(media.addItem('', { url: 'https://cdn/1.jpg' })).rejects.toThrow(/"albumId"/);
  });

  it('rejects an out-of-enum kind on add and update', async () => {
    const { media } = makeMedia();
    await expect(
      media.addItem('a1', { url: 'x', kind: 'audio' as unknown as 'image' }),
    ).rejects.toThrow(/"kind" must be one of image, video/);
    await expect(
      media.updateItem('i1', { kind: 'gif' as unknown as 'image' }),
    ).rejects.toThrow(/"kind" must be one of image, video/);
  });

  it('rejects non-numeric / negative / non-integer dimensions', async () => {
    const { media } = makeMedia();
    await expect(
      media.addItem('a1', { url: 'x', width: 'wide' as unknown as number }),
    ).rejects.toThrow(/"width" must be a finite number/);
    await expect(media.addItem('a1', { url: 'x', height: -5 })).rejects.toThrow(
      /"height" must be a non-negative integer/,
    );
    await expect(media.addItem('a1', { url: 'x', width: 12.5 })).rejects.toThrow(
      /"width" must be a non-negative integer/,
    );
  });

  it('rejects a non-object data payload', async () => {
    const { media } = makeMedia();
    await expect(
      media.addItem('a1', { url: 'x', data: [1] as unknown as Record<string, unknown> }),
    ).rejects.toThrow(/"data" must be a plain object/);
  });
});

describe('getAlbumWithItems: 2-query composition', () => {
  it('returns the album merged with its ordered items (album, then items)', async () => {
    const { post, media } = makeMedia();
    const album = { id: 'a1', slug: 'beach', title: 'Beach', published: true };
    const items = [
      { id: 'i1', album_id: 'a1', url: 'https://cdn/1.jpg', sort: 0 },
      { id: 'i2', album_id: 'a1', url: 'https://cdn/2.jpg', sort: 1 },
    ];
    post
      .mockResolvedValueOnce({ data: [album] }) // getAlbum
      .mockResolvedValueOnce({ data: items }); // listItems
    const result = await media.getAlbumWithItems('beach');

    expect(result).toEqual({ ...album, items });
    expect(post).toHaveBeenCalledTimes(2);
    // Query 0: album by slug. Query 1: items scoped to the album id, sort ASC.
    expect(payloadOf(post, 0).where).toEqual([
      { column: 'slug', operator: '=', value: 'beach', type: 'AND' },
    ]);
    expect(payloadOf(post, 1)).toEqual(
      expect.objectContaining({
        table: MEDIA_TABLES.ITEMS,
        where: [{ column: 'album_id', operator: '=', value: 'a1', type: 'AND' }],
        orderBy: [{ column: 'sort', direction: 'ASC' }],
      }),
    );
  });

  it('resolves null (and skips the items query) for an unknown album', async () => {
    const { post, media } = makeMedia();
    post.mockResolvedValueOnce({ data: [] });
    await expect(media.getAlbumWithItems('ghost')).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(1); // stopped after the album lookup
  });

  it('requires a non-empty slug', async () => {
    const { media } = makeMedia();
    await expect(media.getAlbumWithItems('')).rejects.toThrow(/"slug"/);
  });
});

describe('media module lifecycle (via ModulesClient)', () => {
  const makeModules = () => {
    const post = jest.fn(
      (_url: string, _body: { sql?: string; params?: unknown[] }): Promise<{ data: unknown[] }> =>
        Promise.resolve({ data: [] }),
    );
    const http = { post } as unknown as HttpClient;
    return { post, modules: new ModulesClient(http, new MigrationsClient(http)) };
  };

  it('is registered and accessing it before enable()/use() throws', () => {
    const { modules } = makeModules();
    expect(() => modules.media).toThrow(/not enabled/);
    expect(() => modules.media).toThrow(/enable\('media'\)/);
  });

  it("enable('media') runs the album + item migrations through the ledger", async () => {
    const { modules, post } = makeModules();
    await modules.enable('media');
    const sqls = post.mock.calls.map((call) => (call[1] as { sql: string }).sql);
    expect(sqls[0]).toContain(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls.some((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${MEDIA_TABLES.ALBUMS}`))).toBe(true);
    expect(sqls.some((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${MEDIA_TABLES.ITEMS}`))).toBe(true);
    expect(sqls.some((sql) => sql.includes('media__items_album_sort_idx'))).toBe(true);
    expect(modules.isEnabled('media')).toBe(true);
  });

  it('after use(), the accessor returns a MediaClient without touching the network', () => {
    const { modules, post } = makeModules();
    modules.use('media');
    expect(modules.media).toBeInstanceOf(MediaClient);
    expect(post).not.toHaveBeenCalled();
  });
});
