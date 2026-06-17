import { db } from "../client";
import { OpenAuthKv } from "./openauth-kv.sql";

export interface OpenAuthStorageAdapter {
  get(key: string[]): Promise<Record<string, unknown> | undefined>;
  remove(key: string[]): Promise<void>;
  set(key: string[], value: unknown, expiry?: Date): Promise<void>;
  scan(prefix: string[]): AsyncIterable<[string[], unknown]>;
}

const KEY_SEPARATOR = String.fromCharCode(0x1f);

function joinKey(key: string[]) {
  return key.join(KEY_SEPARATOR);
}

function splitKey(key: string) {
  return key === "" ? [] : key.split(KEY_SEPARATOR);
}

export function openAuthSqliteStorage(): OpenAuthStorageAdapter {
  return {
    async get(key) {
      const row = OpenAuthKv.get(db, joinKey(key));
      return row ? (JSON.parse(row.value) as Record<string, unknown>) : undefined;
    },

    async set(key, value, expiry) {
      OpenAuthKv.set(db, joinKey(key), JSON.stringify(value), expiry?.toISOString());
    },

    async remove(key) {
      OpenAuthKv.remove(db, joinKey(key));
    },

    async *scan(prefix) {
      const prefixKey = joinKey(prefix);
      const componentPrefix = prefix.length === 0 ? "" : `${prefixKey}${KEY_SEPARATOR}`;
      const rows = OpenAuthKv.scan(db, prefixKey);

      for (const row of rows) {
        if (row.key === prefixKey || row.key.startsWith(componentPrefix)) {
          yield [splitKey(row.key), JSON.parse(row.value)];
        }
      }
    },
  };
}
