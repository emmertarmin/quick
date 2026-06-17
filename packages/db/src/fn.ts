import type { AppDb } from "./client";

export type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
export type AppDbOrTx = AppDb | AppTx;

function isAppDb(database: AppDbOrTx): database is AppDb {
  return "$client" in database;
}

export function fn<Args extends unknown[], Result>(
  operation: (database: AppTx, ...args: Args) => Result,
) {
  return (database: AppDbOrTx, ...args: Args): Result => {
    if (isAppDb(database)) {
      return database.transaction((tx) => operation(tx, ...args));
    }

    return operation(database, ...args);
  };
}
