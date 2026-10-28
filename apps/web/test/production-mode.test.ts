import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe('production data safety', () => {
  it('defaults to real same-origin API when a production build omits public settings', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', undefined);
    vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
    const client = await import('../src/lib/api/client');
    expect(client.DATA_MODE).toBe('api');
    expect(client.API_URL).toBe('');
  });
  it('allows an explicitly selected standalone demo', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
    expect((await import('../src/lib/api/client')).DATA_MODE).toBe('mock');
  });
  it('turns proxy HTML into a useful API error without pretending the request succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('<html>unavailable</html>', {status:502})));
    const {apiGet, ApiError} = await import('../src/lib/api/client');
    await expect(apiGet('/v1/example')).rejects.toBeInstanceOf(ApiError);
    await expect(apiGet('/v1/example')).rejects.toMatchObject({status:502,code:'invalid_response'});
  });
});
