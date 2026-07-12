import { XenitionError } from '../core/errors';
import type { XenitionClient } from '../xenition-client';
import { mediaRouter } from './media-router';

const makeClient = () => {
  const media = {
    listAlbums: jest.fn(),
    getAlbum: jest.fn(),
    getAlbumWithItems: jest.fn(),
    listItems: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, media } } as unknown as XenitionClient;
  return { client, media, use };
};

const snakeAlbum = {
  id: 'a1',
  slug: 'beach',
  title: 'Beach',
  description: 'Sun',
  cover_url: 'https://cdn/cover.jpg',
  data: { theme_color: '#fff' },
  published: true,
  sort: 0,
  created_at: 't0',
};

const snakeItem = {
  id: 'i1',
  album_id: 'a1',
  url: 'https://cdn/1.jpg',
  kind: 'image',
  caption: 'One',
  alt: 'first',
  width: 800,
  height: 600,
  sort: 0,
  data: { camera_model: 'X100' },
  created_at: 't0',
};

describe('GET /media/albums', () => {
  it('lists albums published-only by default, normalized to camelCase', async () => {
    const { client, media, use } = makeClient();
    media.listAlbums.mockResolvedValue([snakeAlbum]);
    const res = await mediaRouter({ client }).request('/media/albums');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.albums).toEqual([
      {
        id: 'a1',
        slug: 'beach',
        title: 'Beach',
        description: 'Sun',
        coverUrl: 'https://cdn/cover.jpg',
        data: { theme_color: '#fff' }, // jsonb inner keys untouched
        published: true,
        sort: 0,
        createdAt: 't0',
      },
    ]);
    expect(media.listAlbums).toHaveBeenCalledWith(expect.objectContaining({ published: true }));
    expect(use).toHaveBeenCalledWith('media');
  });

  it('forwards published=0, orderBy, direction, limit and offset', async () => {
    const { client, media } = makeClient();
    media.listAlbums.mockResolvedValue([]);
    const res = await mediaRouter({ client }).request(
      '/media/albums?published=0&orderBy=created_at&direction=desc&limit=5&offset=10',
    );
    expect(res.status).toBe(200);
    expect(media.listAlbums).toHaveBeenCalledWith({
      published: false,
      orderBy: 'created_at',
      direction: 'DESC',
      limit: 5,
      offset: 10,
    });
  });

  it('published=all removes the filter', async () => {
    const { client, media } = makeClient();
    media.listAlbums.mockResolvedValue([]);
    await mediaRouter({ client }).request('/media/albums?published=all');
    expect(media.listAlbums).toHaveBeenCalledWith(
      expect.objectContaining({ published: undefined }),
    );
  });

  it('400s an invalid limit', async () => {
    const { client } = makeClient();
    const res = await mediaRouter({ client }).request('/media/albums?limit=abc');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('400s an invalid direction', async () => {
    const { client } = makeClient();
    const res = await mediaRouter({ client }).request('/media/albums?direction=up');
    expect(res.status).toBe(400);
  });
});

describe('GET /media/albums/:slug (album + items)', () => {
  it('returns the published album merged with its normalized items', async () => {
    const { client, media } = makeClient();
    media.getAlbumWithItems.mockResolvedValue({ ...snakeAlbum, items: [snakeItem] });
    const res = await mediaRouter({ client }).request('/media/albums/beach');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.slug).toBe('beach');
    expect(body.coverUrl).toBe('https://cdn/cover.jpg');
    expect(body.createdAt).toBe('t0');
    expect(body).not.toHaveProperty('cover_url');
    expect(body.items).toEqual([
      {
        id: 'i1',
        albumId: 'a1',
        url: 'https://cdn/1.jpg',
        kind: 'image',
        caption: 'One',
        alt: 'first',
        width: 800,
        height: 600,
        sort: 0,
        data: { camera_model: 'X100' },
        createdAt: 't0',
      },
    ]);
    expect(media.getAlbumWithItems).toHaveBeenCalledWith('beach');
  });

  it('404s a missing album', async () => {
    const { client, media } = makeClient();
    media.getAlbumWithItems.mockResolvedValue(null);
    const res = await mediaRouter({ client }).request('/media/albums/nope');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });

  it('404s an unpublished album (service key must not leak drafts by default)', async () => {
    const { client, media } = makeClient();
    media.getAlbumWithItems.mockResolvedValue({ ...snakeAlbum, published: false, items: [] });
    const res = await mediaRouter({ client }).request('/media/albums/beach');
    expect(res.status).toBe(404);
  });
});

describe('GET /media/albums/:slug/items', () => {
  it('returns the album items normalized', async () => {
    const { client, media } = makeClient();
    media.getAlbum.mockResolvedValue(snakeAlbum);
    media.listItems.mockResolvedValue([snakeItem]);
    const res = await mediaRouter({ client }).request('/media/albums/beach/items');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items[0].albumId).toBe('a1');
    expect(body.items[0].createdAt).toBe('t0');
    expect(media.getAlbum).toHaveBeenCalledWith('beach');
    expect(media.listItems).toHaveBeenCalledWith('a1');
  });

  it('404s (and skips the items query) for a missing album', async () => {
    const { client, media } = makeClient();
    media.getAlbum.mockResolvedValue(null);
    const res = await mediaRouter({ client }).request('/media/albums/nope/items');
    expect(res.status).toBe(404);
    expect(media.listItems).not.toHaveBeenCalled();
  });

  it('404s an unpublished album', async () => {
    const { client, media } = makeClient();
    media.getAlbum.mockResolvedValue({ ...snakeAlbum, published: false });
    const res = await mediaRouter({ client }).request('/media/albums/beach/items');
    expect(res.status).toBe(404);
    expect(media.listItems).not.toHaveBeenCalled();
  });
});

describe('error mapping', () => {
  it('turns an upstream SERVER_ERROR into a generic 502 (no URL / key leak)', async () => {
    const { client, media } = makeClient();
    media.listAlbums.mockRejectedValue(
      new XenitionError(
        'SERVER_ERROR',
        'POST https://api-dev.xenition.com/v1/app-platform/query failed with key xen_service_abc123',
        { status: 500 },
      ),
    );
    const res = await mediaRouter({ client }).request('/media/albums');
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('SERVER_ERROR');
    expect(JSON.stringify(body)).not.toContain('xen_service_');
    expect(JSON.stringify(body)).not.toContain('http');
  });

  it('hides unexpected internal errors behind a generic 500', async () => {
    const { client, media } = makeClient();
    media.getAlbumWithItems.mockRejectedValue(new TypeError('x is not a function'));
    const res = await mediaRouter({ client }).request('/media/albums/beach');
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('x is not a function');
  });
});
