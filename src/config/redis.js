const { Redis } = require('@upstash/redis');
const env = require('./env');

let redis = null;

if (process.env.NODE_ENV !== 'test' && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (err) {
    console.warn('[Redis] Failed to initialize Upstash Redis client:', err.message);
    redis = null;
  }
}

const KEY_PREFIX = 'mawid:';

// ============================================================================
// Two-Tier (L1 In-Memory + L2 Upstash Redis) High-Performance Cache
// L1: Process memory Map -> sub-millisecond latency (< 1ms), zero network overhead
// L2: Upstash Cloud Redis -> cluster-wide shared state with persistent TTL
// ============================================================================
const l1Cache = new Map();

function getFromL1(key) {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    l1Cache.delete(key);
    return null;
  }
  return entry.data;
}

function setToL1(key, data, ttlSeconds) {
  l1Cache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function deleteFromL1(key) {
  l1Cache.delete(key);
}

function deletePatternFromL1(pattern) {
  const regexStr = '^' + pattern.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&').replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexStr);
  for (const k of l1Cache.keys()) {
    if (regex.test(k)) {
      l1Cache.delete(k);
    }
  }
}

function clearL1() {
  l1Cache.clear();
}

/**
 * Acquire distributed lock for a slot (10 minutes default).
 * Atomic SET NX EX ensures exactly 1 requester acquires the lock.
 * Returns true if acquired, false if already held.
 */
async function acquireSlotLock(slotId, userId, ttlSeconds = 600) {
  if (!redis) return true; // Graceful degradation if Redis is unavailable
  try {
    const key = `${KEY_PREFIX}lock:slot:${slotId}`;
    const result = await redis.set(key, userId, { nx: true, ex: ttlSeconds });
    return result === 'OK';
  } catch (err) {
    console.warn('[Redis] acquireSlotLock error, falling back to database constraint:', err.message);
    return true; // Fall back to PostgreSQL Partial Unique Index
  }
}

/**
 * Release distributed lock for a slot if caller owns it.
 */
async function releaseSlotLock(slotId, userId) {
  if (!redis) return;
  try {
    const key = `${KEY_PREFIX}lock:slot:${slotId}`;
    const currentOwner = await redis.get(key);
    if (currentOwner === userId) {
      await redis.del(key);
    }
  } catch (err) {
    console.warn('[Redis] releaseSlotLock error:', err.message);
  }
}

/**
 * Cache helper for reading data with two-tier hierarchy:
 * 1. Checks L1 in-memory cache (< 1ms)
 * 2. On L1 miss, checks L2 Upstash Redis (~300ms) and warms L1
 */
async function getCached(key) {
  // 1. Fast path: L1 local memory
  const l1Hit = getFromL1(key);
  if (l1Hit !== null && l1Hit !== undefined) {
    return l1Hit;
  }

  // 2. Slow path: L2 Upstash Redis
  if (!redis) return null;
  try {
    const raw = await redis.get(`${KEY_PREFIX}cache:${key}`);
    if (raw !== null && raw !== undefined) {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // Warm L1 memory for 60 seconds (or 10s min)
      setToL1(key, data, 60);
      return data;
    }
    return null;
  } catch (err) {
    console.warn('[Redis] getCached error:', err.message);
    return null;
  }
}

/**
 * Cache helper for writing data to both L1 memory and L2 Upstash Redis
 */
async function setCached(key, data, ttlSeconds = 60) {
  // Write to L1 in-memory immediately
  setToL1(key, data, ttlSeconds);

  // Write to L2 Upstash Redis
  if (!redis) return;
  try {
    await redis.set(`${KEY_PREFIX}cache:${key}`, data, { ex: ttlSeconds });
  } catch (err) {
    console.warn('[Redis] setCached error:', err.message);
  }
}

/**
 * Cache invalidation helper (evicts from both L1 and L2)
 */
async function invalidateCache(key) {
  deleteFromL1(key);

  if (!redis) return;
  try {
    await redis.del(`${KEY_PREFIX}cache:${key}`);
  } catch (err) {
    console.warn('[Redis] invalidateCache error:', err.message);
  }
}

/**
 * Invalidate multiple keys matching a pattern (e.g. 'slots:*', 'slots:docId:*')
 * Evicts from both L1 memory and L2 Upstash Redis
 */
async function invalidatePattern(pattern) {
  deletePatternFromL1(pattern);

  if (!redis) return;
  try {
    const fullPattern = `${KEY_PREFIX}cache:${pattern}`;
    const keys = await redis.keys(fullPattern);
    if (keys && keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    console.warn('[Redis] invalidatePattern error:', err.message);
  }
}

module.exports = {
  redis,
  acquireSlotLock,
  releaseSlotLock,
  getCached,
  setCached,
  invalidateCache,
  invalidatePattern,
  clearL1,
};
