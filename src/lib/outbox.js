// Entries written while there's no connection: on the bus, in the basement of the market.
// They wait in this browser with a key made up here, and go as soon as the server answers.
// The server knows the key, so one sent twice (the answer lost on the way) is written once.

const KEY = 'expenses.outbox';

export function waiting(storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function keep(list, storage) {
  try {
    if (list.length) storage.setItem(KEY, JSON.stringify(list));
    else storage.removeItem(KEY);
  } catch {
    // storage blocked: nothing to keep it in, the entry is lost like it would be without this
  }
}

export function newKey(now = Date.now(), random = Math.random) {
  return `k-${now.toString(36)}-${random().toString(36).slice(2, 10)}`;
}

/** Sends the entry, or keeps it for later when the server can't be reached. */
export async function sendOrKeep(entry, send, storage = globalThis.localStorage) {
  const withKey = { ...entry, client_key: newKey() };
  try {
    return { sent: await send(withKey) };
  } catch (e) {
    if (e.status !== 0) throw e; // the server said no: that's for the person to fix, not to retry
    keep([...waiting(storage), withKey], storage);
    return { kept: withKey };
  }
}

/**
 * Sends what's waiting, oldest first, and stops at the first one that still can't get
 * through. One the server refuses (its category was deleted meanwhile) is dropped and
 * returned, so the page can say so.
 */
export async function sendWaiting(send, storage = globalThis.localStorage) {
  const sent = [];
  const refused = [];
  for (const entry of waiting(storage)) {
    try {
      sent.push(await send(entry));
    } catch (e) {
      if (e.status === 0) break;
      refused.push({ entry, reason: e.message });
    }
    keep(waiting(storage).filter((w) => w.client_key !== entry.client_key), storage);
  }
  return { sent, refused };
}

export function forgetWaiting(storage = globalThis.localStorage) {
  keep([], storage);
}
