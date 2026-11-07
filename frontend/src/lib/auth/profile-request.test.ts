import { afterEach, expect, test } from "bun:test";
import { clearProfileRequest, requestProfile } from "./profile-request";

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;clearProfileRequest();});
test("profile reads coalesce for one session and each consumer has a readable body",async()=>{
  let calls=0;
  globalThis.fetch=(async()=>{calls++;return Response.json({id:"user-a"});}) as unknown as typeof fetch;
  const responses=await Promise.all([requestProfile("http://local","token-a"),requestProfile("http://local","token-a")]);
  expect(calls).toBe(1);
  expect(await responses[0].json()).toEqual({id:"user-a"});
  expect(await responses[1].json()).toEqual({id:"user-a"});
  await requestProfile("http://local","token-b");expect(calls).toBe(2);
});
test("failed profile requests are retried and logout clears a successful response",async()=>{
  let calls=0;
  globalThis.fetch=(async()=>{calls++;return calls===1?new Response(null,{status:503}):Response.json({id:"user"});}) as unknown as typeof fetch;
  expect((await requestProfile("http://local","token")).status).toBe(503);
  expect((await requestProfile("http://local","token")).status).toBe(200);
  clearProfileRequest();await requestProfile("http://local","token");expect(calls).toBe(3);
});
