import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from '@lib/cache';

describe('TtlCache', () => {
  describe('get / set', () => {
    it('returns undefined for missing keys', () => {
      const cache = new TtlCache();
      expect(cache.get('nope')).toBeUndefined();
    });

    it('stores and retrieves values', () => {
      const cache = new TtlCache();
      cache.set('a', 42);
      cache.set('b', { nested: true });
      expect(cache.get('a')).toBe(42);
      expect(cache.get('b')).toEqual({ nested: true });
    });

    it('overwrites existing key', () => {
      const cache = new TtlCache();
      cache.set('k', 'old');
      cache.set('k', 'new');
      expect(cache.get('k')).toBe('new');
      expect(cache.size).toBe(1);
    });

    it('stores falsy values (0, empty string, false, null)', () => {
      const cache = new TtlCache();
      cache.set('zero', 0);
      cache.set('empty', '');
      cache.set('false', false);
      cache.set('null', null);
      // get returns undefined for missing AND expired; falsy values are valid hits
      expect(cache.get('zero')).toBe(0);
      expect(cache.get('empty')).toBe('');
      expect(cache.get('false')).toBe(false);
      expect(cache.get('null')).toBeNull();
    });
  });

  describe('TTL expiry', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('expires entries after TTL', () => {
      const cache = new TtlCache(1000); // 1 s TTL
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');

      vi.advanceTimersByTime(999);
      expect(cache.get('key')).toBe('value'); // still alive

      vi.advanceTimersByTime(2); // now past expiry
      expect(cache.get('key')).toBeUndefined();
    });

    it('expired entry is deleted from store', () => {
      const cache = new TtlCache(500);
      cache.set('x', 1);
      expect(cache.size).toBe(1);

      vi.advanceTimersByTime(600);
      cache.get('x'); // triggers lazy deletion
      expect(cache.size).toBe(0);
    });

    it('default TTL is 60 seconds', () => {
      const cache = new TtlCache(); // default
      cache.set('k', 'v');

      vi.advanceTimersByTime(59_999);
      expect(cache.get('k')).toBe('v');

      vi.advanceTimersByTime(2);
      expect(cache.get('k')).toBeUndefined();
    });
  });

  describe('orFetch', () => {
    it('caches the result', async () => {
      const cache = new TtlCache();
      const result = await cache.orFetch('k', async () => 'computed');
      expect(result).toBe('computed');
      expect(cache.get('k')).toBe('computed');
    });

    it('returns cached value without calling fn again', async () => {
      const cache = new TtlCache();
      const fn = vi.fn(async () => 'value');

      await cache.orFetch('k', fn);
      await cache.orFetch('k', fn);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent calls (single-flight)', async () => {
      const cache = new TtlCache();
      let resolve!: (v: string) => void;
      const fn = vi.fn(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      );

      const p1 = cache.orFetch('k', fn);
      const p2 = cache.orFetch('k', fn);

      resolve('shared');
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe('shared');
      expect(r2).toBe('shared');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('removes inflight entry on error', async () => {
      const cache = new TtlCache();
      let callCount = 0;
      const fn = () => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve('recovered');
      };

      await expect(cache.orFetch('k', fn)).rejects.toThrow('boom');
      // After error the inflight entry is gone, so a retry calls fn again
      const result = await cache.orFetch('k', fn);
      expect(result).toBe('recovered');
      expect(callCount).toBe(2);
    });

    it('does not cache on error', async () => {
      const cache = new TtlCache();
      await expect(
        cache.orFetch('k', () => Promise.reject(new Error('fail'))),
      ).rejects.toThrow('fail');
      expect(cache.get('k')).toBeUndefined();
      expect(cache.size).toBe(0);
    });
  });

  describe('invalidatePrefix', () => {
    it('removes matching keys', () => {
      const cache = new TtlCache();
      cache.set('summary:2026-07-22', { a: 1 });
      cache.set('summary:2026-07-23', { a: 2 });
      cache.set('history:steps', [1, 2]);

      cache.invalidatePrefix('summary:');

      expect(cache.get('summary:2026-07-22')).toBeUndefined();
      expect(cache.get('summary:2026-07-23')).toBeUndefined();
      expect(cache.get('history:steps')).toEqual([1, 2]);
    });

    it('returns count of removed entries', () => {
      const cache = new TtlCache();
      cache.set('list:steps', 1);
      cache.set('list:hr', 2);
      cache.set('list:sleep', 3);
      cache.set('other', 4);

      expect(cache.invalidatePrefix('list:')).toBe(3);
      expect(cache.invalidatePrefix('list:')).toBe(0); // already gone
    });

    it('does not remove non-matching keys', () => {
      const cache = new TtlCache();
      cache.set('samples:hr', 10);
      cache.set('analytics:week', 20);

      cache.invalidatePrefix('samples:');

      expect(cache.get('analytics:week')).toBe(20);
      expect(cache.size).toBe(1);
    });

    it('returns 0 when nothing matches', () => {
      const cache = new TtlCache();
      cache.set('a', 1);
      expect(cache.invalidatePrefix('zzz')).toBe(0);
      expect(cache.size).toBe(1);
    });
  });

  describe('size cap', () => {
    it('evicts oldest entry when maxSize exceeded', () => {
      const cache = new TtlCache();
      // maxSize is 500 (private); insert 501 entries
      for (let i = 0; i < 501; i++) {
        cache.set(`key-${i}`, i);
      }
      expect(cache.size).toBe(500);
      // The very first key should have been evicted
      expect(cache.get('key-0')).toBeUndefined();
      // The last key should still be present
      expect(cache.get('key-500')).toBe(500);
    });

    it('updating an existing key does not trigger eviction', () => {
      const cache = new TtlCache();
      for (let i = 0; i < 500; i++) {
        cache.set(`key-${i}`, i);
      }
      expect(cache.size).toBe(500);

      // Overwrite an existing key — no eviction should happen
      cache.set('key-250', 'updated');
      expect(cache.size).toBe(500);
      expect(cache.get('key-0')).toBe(0); // still present
      expect(cache.get('key-250')).toBe('updated');
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new TtlCache();
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.size).toBe(3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('reflects the number of stored entries', () => {
      const cache = new TtlCache();
      expect(cache.size).toBe(0);
      cache.set('a', 1);
      expect(cache.size).toBe(1);
      cache.set('b', 2);
      expect(cache.size).toBe(2);
      cache.set('a', 99); // overwrite, not a new entry
      expect(cache.size).toBe(2);
    });
  });
});
