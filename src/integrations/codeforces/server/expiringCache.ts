type CacheEntry<Value> = {
  value: Value;
  expiresAt: number;
  weight: number;
};

type Clock = () => number;

export default class ExpiringCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();

  private readonly now: Clock;

  private readonly maximumWeight: number;

  private readonly getWeight: (value: Value) => number;

  private currentWeight = 0;

  constructor(
    now: Clock = Date.now,
    options: { maximumWeight?: number; getWeight?: (value: Value) => number } = {},
  ) {
    this.now = now;
    this.maximumWeight = options.maximumWeight ?? Number.POSITIVE_INFINITY;
    this.getWeight = options.getWeight ?? (() => 1);
  }

  private delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.currentWeight -= entry.weight;
    this.entries.delete(key);
  }

  private deleteExpiredEntries() {
    const now = this.now();
    this.entries.forEach((entry, key) => {
      if (entry.expiresAt <= now) this.delete(key);
    });
  }

  get(key: string): Value | undefined {
    this.deleteExpiredEntries();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Value, durationMilliseconds: number) {
    this.deleteExpiredEntries();
    this.delete(key);
    const weight = Math.max(0, this.getWeight(value));
    if (weight > this.maximumWeight) return;
    while (this.currentWeight + weight > this.maximumWeight) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.delete(oldestKey);
    }
    this.entries.set(key, {
      value,
      expiresAt: this.now() + durationMilliseconds,
      weight,
    });
    this.currentWeight += weight;
  }

  get size() {
    this.deleteExpiredEntries();
    return this.entries.size;
  }
}
