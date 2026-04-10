export type MemoryCacheEntry<T> = {
  value: T;
  updatedAt: number;
  expiresAt: number;
};

export class MemoryCache<T> {
  private entry: MemoryCacheEntry<T> | null = null;

  constructor(private readonly ttlMs: number) {}

  getFresh(now = Date.now()): MemoryCacheEntry<T> | null {
    if (!this.entry || this.ttlMs <= 0) {
      return null;
    }

    if (now >= this.entry.expiresAt) {
      return null;
    }

    return this.entry;
  }

  getAny(): MemoryCacheEntry<T> | null {
    return this.entry;
  }

  set(value: T, now = Date.now()): MemoryCacheEntry<T> {
    const entry = {
      value,
      updatedAt: now,
      expiresAt: now + this.ttlMs
    };

    this.entry = entry;
    return entry;
  }

  clear(): void {
    this.entry = null;
  }
}
