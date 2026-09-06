import type { Db } from "@tacit/db";

export type FakeResult = { data?: unknown; error?: unknown; count?: number | null };

export type RecordedCall = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "rpc";
  /** select columns / insert row / update patch / upsert rows / rpc args */
  args?: unknown;
  /** upsert options ({ onConflict, ignoreDuplicates }) */
  options?: unknown;
  filters: Array<{
    method: "eq" | "ilike" | "like" | "in" | "is" | "gt" | "gte" | "not";
    column: string;
    /** for `not`: { operator, value } */
    value: unknown;
  }>;
  modifiers: Array<{
    method: "order" | "limit" | "range";
    column?: string;
    options?: unknown;
    /** limit: the row count; range: [from, to] */
    value?: number | [number, number];
  }>;
  terminal?: "single" | "maybeSingle" | "await";
};

/**
 * Hand-rolled scripted+recording fake covering exactly the query chains this
 * codebase uses (see packages/db/CLAUDE.md): select…eq/ilike…maybeSingle/single,
 * select…eq…order…range (awaited, paged), select(…, {count, head}) (awaited,
 * reads `count`), insert…select…single, update…eq (awaited directly), the
 * guarded consume update…eq…is…gt…select, and rpc(fn, args) (awaited
 * directly, not chained). Responses are consumed in order, one per terminal
 * operation; every chain is recorded on `calls` for assertions. Not a
 * PostgREST emulation -- if production code grows a new chain shape, add it
 * here deliberately.
 */
export class FakeSupabase {
  calls: RecordedCall[] = [];
  private responses: FakeResult[];

  constructor(responses: FakeResult[] = []) {
    this.responses = [...responses];
  }

  respond(...results: FakeResult[]): this {
    this.responses.push(...results);
    return this;
  }

  private next(): { data: unknown; error: unknown; count: number | null } {
    const r = this.responses.shift();
    if (r === undefined) {
      throw new Error(
        `FakeSupabase: query executed but no scripted response left (call #${this.calls.length})`,
      );
    }
    return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
  }

  from(table: string) {
    const call: RecordedCall = { table, op: "select", filters: [], modifiers: [] };
    this.calls.push(call);
    const next = () => this.next();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const builder: any = {
      select(columns?: string) {
        if (call.op === "select") call.args = columns;
        return builder;
      },
      insert(row: unknown) {
        call.op = "insert";
        call.args = row;
        return builder;
      },
      upsert(rows: unknown, options?: unknown) {
        call.op = "upsert";
        call.args = rows;
        call.options = options;
        return builder;
      },
      update(patch: unknown) {
        call.op = "update";
        call.args = patch;
        return builder;
      },
      order(column: string, options?: unknown) {
        call.modifiers.push({ method: "order", column, options });
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push({ method: "eq", column, value });
        return builder;
      },
      ilike(column: string, value: unknown) {
        call.filters.push({ method: "ilike", column, value });
        return builder;
      },
      like(column: string, value: unknown) {
        call.filters.push({ method: "like", column, value });
        return builder;
      },
      in(column: string, value: unknown[]) {
        call.filters.push({ method: "in", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        call.filters.push({ method: "is", column, value });
        return builder;
      },
      gt(column: string, value: unknown) {
        call.filters.push({ method: "gt", column, value });
        return builder;
      },
      gte(column: string, value: unknown) {
        call.filters.push({ method: "gte", column, value });
        return builder;
      },
      not(column: string, operator: string, value: unknown) {
        call.filters.push({ method: "not", column, value: { operator, value } });
        return builder;
      },
      limit(value: number) {
        call.modifiers.push({ method: "limit", value });
        return builder;
      },
      range(from: number, to: number) {
        call.modifiers.push({ method: "range", value: [from, to] });
        return builder;
      },
      maybeSingle() {
        call.terminal = "maybeSingle";
        return Promise.resolve(next());
      },
      single() {
        call.terminal = "single";
        return Promise.resolve(next());
      },
      // update chains are awaited directly, so the builder is thenable
      then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        call.terminal = "await";
        return Promise.resolve(next()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  rpc(fn: string, args?: object) {
    const call: RecordedCall = { table: fn, op: "rpc", args, filters: [], modifiers: [], terminal: "await" };
    this.calls.push(call);
    return Promise.resolve(this.next());
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}
