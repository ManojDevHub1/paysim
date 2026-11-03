/**
 * True immutable map wrapper implementing ReadonlyMap<K, V>.
 * In JavaScript/V8, Object.freeze(new Map()) DOES NOT prevent Map.prototype.set() or delete().
 * ReadonlyStateMap encapsulates an internal Map and strictly omits set(), delete(), and clear(),
 * guaranteeing that committed RootState snapshots cannot be mutated in place.
 */
export class ReadonlyStateMap<K, V> implements ReadonlyMap<K, V> {
  private readonly _inner: Map<K, V>;

  constructor(entries?: Iterable<readonly [K, V]> | Map<K, V>) {
    this._inner = entries instanceof Map ? new Map(entries) : new Map(entries ?? []);
    Object.freeze(this);
  }

  public get size(): number {
    return this._inner.size;
  }

  public get(key: K): V | undefined {
    return this._inner.get(key);
  }

  public has(key: K): boolean {
    return this._inner.has(key);
  }

  public entries(): IterableIterator<[K, V]> {
    return this._inner.entries();
  }

  public keys(): IterableIterator<K> {
    return this._inner.keys();
  }

  public values(): IterableIterator<V> {
    return this._inner.values();
  }

  public forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown
  ): void {
    this._inner.forEach((val, key) => callbackfn.call(thisArg, val, key, this));
  }

  public [Symbol.iterator](): IterableIterator<[K, V]> {
    return this._inner[Symbol.iterator]();
  }

  /**
   * Returns a mutable shallow clone Map for copy-on-write candidate updates.
   */
  public toMutableMap(): Map<K, V> {
    return new Map(this._inner);
  }
}
