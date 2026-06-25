import type { QuickDocument } from "@quick/shared";

export type CollectionSearchInput = {
  query?: string;
  filter?: unknown;
  page?: number;
  pageSize?: number;
};

function searchableText(value: unknown) {
  return JSON.stringify(value).toLowerCase();
}

function objectEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return Object.entries(value as Record<string, unknown>);
}

function pathValues(value: unknown, path: string): unknown[] {
  const parts = path.split(".").filter(Boolean);
  let values = [value];

  for (const part of parts) {
    values = values.flatMap((current) => {
      if (Array.isArray(current)) {
        return current.flatMap((item) => pathValues(item, part));
      }

      if (current && typeof current === "object" && part in current) {
        return [(current as Record<string, unknown>)[part]];
      }

      return [];
    });
  }

  return values;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }

  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => deepEqual(item, right[index]));
  }

  const leftEntries = Object.entries(left as Record<string, unknown>);
  const rightObject = right as Record<string, unknown>;
  const rightKeys = Object.keys(rightObject);

  return leftEntries.length === rightKeys.length
    && leftEntries.every(([key, value]) => Object.prototype.hasOwnProperty.call(rightObject, key) && deepEqual(value, rightObject[key]));
}

function valueEquals(value: unknown, expected: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => valueEquals(item, expected));
  }

  return deepEqual(value, expected);
}

function comparable(value: unknown) {
  if (typeof value === "number" || typeof value === "string") {
    return { type: typeof value, value };
  }

  if (value instanceof Date) {
    return { type: "date", value };
  }

  return undefined;
}

function compareValues(value: unknown, operand: unknown, predicate: (left: number | string | Date, right: number | string | Date) => boolean) {
  const left = comparable(value);
  const right = comparable(operand);

  return left !== undefined && right !== undefined && left.type === right.type && predicate(left.value, right.value);
}

function regexFromFilter(pattern: unknown, options: unknown) {
  if (typeof pattern !== "string") {
    throw new Error("$regex must be a string");
  }

  if (pattern.length > 256) {
    throw new Error("$regex patterns are capped at 256 characters");
  }

  if (options !== undefined && (typeof options !== "string" || /[^imsu]/.test(options))) {
    throw new Error("$options may only contain i, m, s, or u");
  }

  return new RegExp(pattern, options);
}

function matchesOperator(values: unknown[], operator: string, operand: unknown, condition: Record<string, unknown>) {
  switch (operator) {
    case "$eq": return values.some((value) => valueEquals(value, operand));
    case "$ne": return !values.some((value) => valueEquals(value, operand));
    case "$gt": return values.some((value) => compareValues(value, operand, (left, right) => left > right));
    case "$gte": return values.some((value) => compareValues(value, operand, (left, right) => left >= right));
    case "$lt": return values.some((value) => compareValues(value, operand, (left, right) => left < right));
    case "$lte": return values.some((value) => compareValues(value, operand, (left, right) => left <= right));
    case "$in": {
      if (!Array.isArray(operand)) throw new Error("$in must be an array");
      return values.some((value) => operand.some((expected) => valueEquals(value, expected)));
    }
    case "$nin": {
      if (!Array.isArray(operand)) throw new Error("$nin must be an array");
      return !values.some((value) => operand.some((expected) => valueEquals(value, expected)));
    }
    case "$exists": return operand ? values.length > 0 : values.length === 0;
    case "$regex": {
      const regex = regexFromFilter(operand, condition.$options);
      return values.some((value) => typeof value === "string" && regex.test(value));
    }
    case "$options": return true;
    default: throw new Error(`Unsupported filter operator: ${operator}`);
  }
}

function matchesFieldFilter(document: QuickDocument, path: string, condition: unknown) {
  const values = pathValues(document, path);
  const entries = objectEntries(condition);

  if (entries?.some(([key]) => key.startsWith("$"))) {
    return entries.every(([operator, operand]) => matchesOperator(values, operator, operand, condition as Record<string, unknown>));
  }

  return values.some((value) => valueEquals(value, condition));
}

function matchesMongoFilter(document: QuickDocument, filter: unknown): boolean {
  const entries = objectEntries(filter);

  if (!entries) {
    throw new Error("filter must be a JSON object");
  }

  return entries.every(([key, condition]) => {
    if (key === "$and") {
      if (!Array.isArray(condition)) throw new Error("$and must be an array of filter objects");
      return condition.every((item) => matchesMongoFilter(document, item));
    }

    if (key === "$or") {
      if (!Array.isArray(condition)) throw new Error("$or must be an array of filter objects");
      return condition.some((item) => matchesMongoFilter(document, item));
    }

    if (key.startsWith("$")) {
      throw new Error(`Unsupported top-level filter operator: ${key}`);
    }

    return matchesFieldFilter(document, key, condition);
  });
}

function pageParams(page?: number, pageSize?: number, defaults = { page: 1, pageSize: 20, maxPageSize: 100 }) {
  const normalizedPage = Math.max(1, Math.floor(page ?? defaults.page));
  const normalizedPageSize = Math.min(defaults.maxPageSize, Math.max(1, Math.floor(pageSize ?? defaults.pageSize)));
  const offset = (normalizedPage - 1) * normalizedPageSize;

  return { page: normalizedPage, pageSize: normalizedPageSize, offset };
}

function paged<T>(items: T[], page?: number, pageSize?: number) {
  const paging = pageParams(page, pageSize);
  const pageItems = items.slice(paging.offset, paging.offset + paging.pageSize);

  return {
    ...paging,
    total: items.length,
    returned: pageItems.length,
    hasMore: paging.offset + pageItems.length < items.length,
    items: pageItems,
  };
}

export function searchCollectionDocuments(documents: QuickDocument[], input: CollectionSearchInput) {
  if (!input.query && input.filter === undefined) {
    throw new Error("Document search requires query, filter, or both");
  }

  const query = input.query?.toLowerCase();
  const matches = documents.filter((document) => {
    const textMatches = query ? searchableText(document).includes(query) : true;
    const filterMatches = input.filter === undefined ? true : matchesMongoFilter(document, input.filter);
    return textMatches && filterMatches;
  });
  const { items, ...results } = paged(matches, input.page, input.pageSize);

  return {
    query: input.query ?? null,
    filter: input.filter ?? null,
    ...results,
    documents: items,
  };
}
