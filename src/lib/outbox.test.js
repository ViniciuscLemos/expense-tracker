import { describe, expect, it } from 'vitest';
import { newKey, sendOrKeep, sendWaiting, waiting } from './outbox';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
};
const offline = () => Promise.reject(Object.assign(new Error('no network'), { status: 0 }));
const bus = { kind: 'expense', category_id: 1, amount_cents: 480, description: 'Bus', day: '2026-11-12' };

describe('entries written offline', () => {
  it('sends right away when it can', async () => {
    const storage = memory();
    const result = await sendOrKeep(bus, async (e) => ({ id: 1, ...e }), storage);
    expect(result.sent.description).toBe('Bus');
    expect(result.sent.client_key).toMatch(/^k-/);
    expect(waiting(storage)).toEqual([]);
  });

  it('keeps it when the server is out of reach, and sends it later once', async () => {
    const storage = memory();
    const kept = await sendOrKeep(bus, offline, storage);
    await sendOrKeep({ ...bus, description: 'Coffee' }, offline, storage);
    expect(waiting(storage).map((e) => e.description)).toEqual(['Bus', 'Coffee']);

    // still offline: nothing goes, nothing is lost
    expect((await sendWaiting(offline, storage)).sent).toEqual([]);
    expect(waiting(storage)).toHaveLength(2);

    const got = [];
    const { sent } = await sendWaiting(async (e) => { got.push(e); return e; }, storage);
    expect(sent).toHaveLength(2);
    expect(got[0].client_key).toBe(kept.kept.client_key);
    expect(waiting(storage)).toEqual([]);
  });

  it('drops one the server refuses and says why, and keeps going', async () => {
    const storage = memory();
    await sendOrKeep(bus, offline, storage);
    await sendOrKeep({ ...bus, description: 'Coffee' }, offline, storage);
    const send = async (e) => {
      if (e.description === 'Bus') throw Object.assign(new Error('No such category.'), { status: 422 });
      return e;
    };
    const { sent, refused } = await sendWaiting(send, storage);
    expect(sent.map((e) => e.description)).toEqual(['Coffee']);
    expect(refused).toEqual([{ entry: expect.objectContaining({ description: 'Bus' }), reason: 'No such category.' }]);
    expect(waiting(storage)).toEqual([]);
  });

  it("doesn't keep what the server said no to", async () => {
    const storage = memory();
    const no = () => Promise.reject(Object.assign(new Error('That category is archived.'), { status: 422 }));
    await expect(sendOrKeep(bus, no, storage)).rejects.toThrow('archived');
    expect(waiting(storage)).toEqual([]);
  });

  it('makes keys the server accepts', () => {
    expect(newKey(1762990000000, () => 0.123456789)).toMatch(/^[A-Za-z0-9-]{8,60}$/);
  });
});
