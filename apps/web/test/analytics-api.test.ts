import { describe, expect, it, vi } from 'vitest';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiGet:get }));
import { ApiAnalyticsService } from '../src/lib/services/analytics-api';
describe('live analytics fidelity', () => {
  it('preserves missing engagement/comparisons and uses delivery delta for the delivery card', async () => {
    const date=new Date().toISOString().slice(0,10);
    get.mockResolvedValue({overview:{impressions:null,engagements:null,followers:0,clicks:null},deltas:{impressions:91,engagements:null,followers:null,clicks:null,published:25},series:[{date,published:2,engagements:null}],byNetwork:[],topPosts:[]});
    const data=await new ApiAnalyticsService().overview('7d');
    expect(data.deltas).toEqual({impressions:25,engagements:null,followers:null,clicks:null});
    expect(data.series.at(-1)).toEqual({date,impressions:2,engagements:null});
    expect(data.series.every(p=>p.engagements===null)).toBe(true);
  });
});
