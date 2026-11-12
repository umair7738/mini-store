import test from "node:test";
import assert from "node:assert/strict";
import { singleFlight } from "../app/singleFlight.js";

test("ignores overlapping calls and allows retries after completion or failure", async () => {
  let release;
  let calls = 0;
  const run = singleFlight(async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
  });
  const first = run();
  await run();
  assert.equal(calls, 1);
  release();
  await first;
  const second = run();
  assert.equal(calls, 2);
  release();
  await second;
  const fail = singleFlight(async () => { throw new Error("failure"); });
  await assert.rejects(fail(), /failure/);
  await assert.rejects(fail(), /failure/);
});
