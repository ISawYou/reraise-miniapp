import { describe, expect, it, vi } from "vitest";
import { RebuyWriteQueue, type RebuyStateValue } from "@/lib/rebuy-write-queue";

// Same shape and coverage as attendance-write-queue.test.ts, generalized to
// a two-number value -- see rebuy-write-queue.ts's doc comment for why this
// is a separate class rather than a reuse of AttendanceWriteQueue.
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type Result = RebuyStateValue;

describe("RebuyWriteQueue", () => {
  it("sends the pushed value once and settles it", async () => {
    const send = vi.fn(async (_key: string, value: RebuyStateValue): Promise<Result> => value);
    const onSettled = vi.fn();
    const onError = vi.fn();
    const queue = new RebuyWriteQueue(send, onSettled, onError);

    queue.push("p1", { rebuys: 2, addons: 1 });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("p1", { rebuys: 2, addons: 1 });
    expect(onSettled).toHaveBeenCalledWith("p1", { rebuys: 2, addons: 1 });
    expect(onError).not.toHaveBeenCalled();
    expect(queue.isActive("p1")).toBe(false);
  });

  it("synchronous burst: only the final desired value is ever sent when it matches what's already in flight", async () => {
    const send = vi.fn(async (_key: string, value: RebuyStateValue): Promise<Result> => value);
    const onSettled = vi.fn();
    const queue = new RebuyWriteQueue(send, onSettled, vi.fn());

    queue.push("p1", { rebuys: 1, addons: 0 });
    queue.push("p1", { rebuys: 2, addons: 0 });
    queue.push("p1", { rebuys: 1, addons: 0 });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("p1", { rebuys: 1, addons: 0 });
    expect(onSettled).toHaveBeenLastCalledWith("p1", { rebuys: 1, addons: 0 });
  });

  it("artificially delayed first request: values pushed while in flight coalesce into exactly one follow-up reflecting the latest desired pair", async () => {
    const firstCall = deferred<Result>();
    const send = vi
      .fn<(key: string, value: RebuyStateValue) => Promise<Result>>()
      .mockImplementationOnce(() => firstCall.promise)
      .mockImplementation(async (_key, value) => value);
    const onSettled = vi.fn();
    const queue = new RebuyWriteQueue(send, onSettled, vi.fn());

    queue.push("p1", { rebuys: 1, addons: 0 });
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(1);

    queue.push("p1", { rebuys: 2, addons: 0 });
    queue.push("p1", { rebuys: 2, addons: 1 });
    expect(send).toHaveBeenCalledTimes(1);

    firstCall.resolve({ rebuys: 1, addons: 0 });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, "p1", { rebuys: 2, addons: 1 });
    expect(onSettled).toHaveBeenLastCalledWith("p1", { rebuys: 2, addons: 1 });
    // Never flashes the intermediate/stale value to the caller.
    expect(onSettled).not.toHaveBeenCalledWith("p1", { rebuys: 1, addons: 0 });
  });

  it("on send failure, aborts the chain, reports the error, and leaves the queue idle", async () => {
    const failure = new Error("network down");
    const send = vi.fn().mockRejectedValueOnce(failure);
    const onSettled = vi.fn();
    const onError = vi.fn();
    const queue = new RebuyWriteQueue(send, onSettled, onError);

    queue.push("p1", { rebuys: 1, addons: 0 });
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith("p1", failure);
    expect(onSettled).not.toHaveBeenCalled();
    expect(queue.isActive("p1")).toBe(false);
  });

  it("a value queued during a failed request is dropped, not silently retried", async () => {
    const failure = new Error("network down");
    const firstCall = deferred<Result>();
    const send = vi
      .fn<(key: string, value: RebuyStateValue) => Promise<Result>>()
      .mockImplementationOnce(() => firstCall.promise);
    const onError = vi.fn();
    const queue = new RebuyWriteQueue(send, vi.fn(), onError);

    queue.push("p1", { rebuys: 1, addons: 0 });
    await flushMicrotasks();
    queue.push("p1", { rebuys: 2, addons: 0 });

    firstCall.reject(failure);
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith("p1", failure);
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.isActive("p1")).toBe(false);
  });

  it("different players are fully independent", async () => {
    const send = vi.fn(async (_key: string, value: RebuyStateValue): Promise<Result> => value);
    const onSettled = vi.fn();
    const queue = new RebuyWriteQueue(send, onSettled, vi.fn());

    queue.push("p1", { rebuys: 1, addons: 0 });
    queue.push("p2", { rebuys: 3, addons: 1 });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith("p1", { rebuys: 1, addons: 0 });
    expect(send).toHaveBeenCalledWith("p2", { rebuys: 3, addons: 1 });
    expect(onSettled).toHaveBeenCalledWith("p1", { rebuys: 1, addons: 0 });
    expect(onSettled).toHaveBeenCalledWith("p2", { rebuys: 3, addons: 1 });
  });

  it("isActive() reflects in-flight and pending state correctly", async () => {
    const firstCall = deferred<Result>();
    const send = vi.fn().mockReturnValueOnce(firstCall.promise);
    const queue = new RebuyWriteQueue(send, vi.fn(), vi.fn());

    expect(queue.isActive("p1")).toBe(false);
    queue.push("p1", { rebuys: 1, addons: 0 });
    await flushMicrotasks();
    expect(queue.isActive("p1")).toBe(true);

    firstCall.resolve({ rebuys: 1, addons: 0 });
    await flushMicrotasks();
    expect(queue.isActive("p1")).toBe(false);
  });
});
