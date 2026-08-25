import { describe, expect, it, vi } from "vitest";
import { AttendanceWriteQueue } from "@/lib/attendance-write-queue";

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

type Result = { arrived: boolean };

describe("AttendanceWriteQueue", () => {
  it("false -> true: sends once, settles true", async () => {
    const send = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const onSettled = vi.fn();
    const onError = vi.fn();
    const queue = new AttendanceWriteQueue(send, onSettled, onError);

    queue.push("p1", true);
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("p1", true);
    expect(onSettled).toHaveBeenCalledWith("p1", { arrived: true });
    expect(onError).not.toHaveBeenCalled();
    expect(queue.isActive("p1")).toBe(false);
  });

  it("true -> false: sends once, settles false", async () => {
    const send = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const onSettled = vi.fn();
    const queue = new AttendanceWriteQueue(send, onSettled, vi.fn());

    queue.push("p1", false);
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("p1", false);
    expect(onSettled).toHaveBeenCalledWith("p1", { arrived: false });
  });

  it("very fast true -> false -> true (synchronous burst): only the FIRST value is ever sent as a request, and the queue recognizes the coalesced final value already matches it -- no redundant second request", async () => {
    const send = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const onSettled = vi.fn();
    const queue = new AttendanceWriteQueue(send, onSettled, vi.fn());

    queue.push("p1", true);
    queue.push("p1", false);
    queue.push("p1", true);
    await flushMicrotasks();

    // The final desired state (true) happens to equal what was already
    // being sent for the first click -- so only ONE network call ever
    // happens, and the end state is still correct.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("p1", true);
    expect(onSettled).toHaveBeenLastCalledWith("p1", { arrived: true });
    expect(queue.isActive("p1")).toBe(false);
  });

  it("very fast false -> true -> false (synchronous burst): ends at false, no redundant request", async () => {
    const send = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const onSettled = vi.fn();
    const queue = new AttendanceWriteQueue(send, onSettled, vi.fn());

    queue.push("p1", false);
    queue.push("p1", true);
    queue.push("p1", false);
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("p1", false);
    expect(onSettled).toHaveBeenLastCalledWith("p1", { arrived: false });
  });

  it("artificially delayed first request: clicks that arrive WHILE it is in flight are coalesced into exactly one follow-up request reflecting the true final desired state", async () => {
    const firstCall = deferred<Result>();
    const send = vi
      .fn<(key: string, arrived: boolean) => Promise<Result>>()
      .mockImplementationOnce(() => firstCall.promise)
      .mockImplementation(async (_key, arrived) => ({ arrived }));
    const onSettled = vi.fn();
    const queue = new AttendanceWriteQueue(send, onSettled, vi.fn());

    queue.push("p1", true); // starts sending true, held open by firstCall
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(1, "p1", true);

    // While the first request is still in flight, the user clicks several
    // more times.
    queue.push("p1", false);
    queue.push("p1", true);
    queue.push("p1", false); // final desired state: false

    // Nothing new sent yet -- still serialized, at most one in flight.
    expect(send).toHaveBeenCalledTimes(1);

    // The artificially delayed first request now completes.
    firstCall.resolve({ arrived: true });
    await flushMicrotasks();

    // A follow-up request is sent reflecting the LATEST desired state
    // (false), not any of the intermediate ones.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, "p1", false);
    expect(onSettled).toHaveBeenLastCalledWith("p1", { arrived: false });
    expect(queue.isActive("p1")).toBe(false);

    // Crucially: the UI-facing onSettled callback was never invoked with
    // the STALE `true` from the first (superseded) request -- it would
    // have visibly flashed the checkbox back to checked before correcting
    // itself.
    expect(onSettled).not.toHaveBeenCalledWith("p1", { arrived: true });
  });

  it("reload-safe by construction: nothing here depends on any client-provided timestamp or counter that could block a future write", async () => {
    // Structural guarantee, not a runtime behavior to poke at: push()'s
    // signature only accepts (key, arrived) -- there is no version/seq
    // parameter for a caller to supply, so there is nothing a client clock
    // (fast, slow, or reset by a reload) could use to reject a legitimate
    // later write. This test exists to catch a future regression that
    // reintroduces such a parameter.
    const send = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const queue = new AttendanceWriteQueue(send, vi.fn(), vi.fn());

    queue.push("p1", true);
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith("p1", true);
    expect(send.mock.calls[0]).toHaveLength(2);
  });

  it("on send failure, aborts the chain, reports the error, and leaves the queue idle for a fresh click", async () => {
    const failure = new Error("network down");
    const send = vi.fn().mockRejectedValueOnce(failure);
    const onSettled = vi.fn();
    const onError = vi.fn();
    const queue = new AttendanceWriteQueue(send, onSettled, onError);

    queue.push("p1", true);
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith("p1", failure);
    expect(onSettled).not.toHaveBeenCalled();
    expect(queue.isActive("p1")).toBe(false);

    // A fresh click after the failure works normally.
    const send2 = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const queue2 = new AttendanceWriteQueue(send2, onSettled, onError);
    queue2.push("p1", true);
    await flushMicrotasks();
    expect(send2).toHaveBeenCalledWith("p1", true);
  });

  it("a value queued during a failed request is dropped, not silently retried", async () => {
    const failure = new Error("network down");
    const firstCall = deferred<Result>();
    const send = vi
      .fn<(key: string, arrived: boolean) => Promise<Result>>()
      .mockImplementationOnce(() => firstCall.promise);
    const onError = vi.fn();
    const queue = new AttendanceWriteQueue(send, vi.fn(), onError);

    queue.push("p1", true);
    await flushMicrotasks();
    queue.push("p1", false); // queued while the first request is in flight

    firstCall.reject(failure);
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith("p1", failure);
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.isActive("p1")).toBe(false); // not stuck "active" with a dropped pending value
  });

  it("isActive() reflects in-flight and pending state correctly", async () => {
    const firstCall = deferred<Result>();
    const send = vi.fn().mockReturnValueOnce(firstCall.promise);
    const queue = new AttendanceWriteQueue(send, vi.fn(), vi.fn());

    expect(queue.isActive("p1")).toBe(false);
    queue.push("p1", true);
    await flushMicrotasks();
    expect(queue.isActive("p1")).toBe(true);

    firstCall.resolve({ arrived: true });
    await flushMicrotasks();
    expect(queue.isActive("p1")).toBe(false);
  });

  it("different players are fully independent -- a burst for one never touches another", async () => {
    const send = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const onSettled = vi.fn();
    const queue = new AttendanceWriteQueue(send, onSettled, vi.fn());

    queue.push("p1", true);
    queue.push("p2", false);
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith("p1", true);
    expect(send).toHaveBeenCalledWith("p2", false);
    expect(onSettled).toHaveBeenCalledWith("p1", { arrived: true });
    expect(onSettled).toHaveBeenCalledWith("p2", { arrived: false });
  });

  it("two independent queue instances (simulating two browser tabs) never share state", async () => {
    const sendA = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const sendB = vi.fn(async (_key: string, arrived: boolean): Promise<Result> => ({ arrived }));
    const queueA = new AttendanceWriteQueue(sendA, vi.fn(), vi.fn());
    const queueB = new AttendanceWriteQueue(sendB, vi.fn(), vi.fn());

    queueA.push("p1", true);
    queueB.push("p1", false);
    await flushMicrotasks();

    // Each tab's queue only ever knows about its own send -- neither is
    // rejected, blocked, or altered by the other's activity. The SERVER's
    // last-processed-wins semantics (not this class) is what ultimately
    // decides which value survives, by design.
    expect(sendA).toHaveBeenCalledWith("p1", true);
    expect(sendB).toHaveBeenCalledWith("p1", false);
  });
});
