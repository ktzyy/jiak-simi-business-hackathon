import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type WebSocket from "ws";
import { closeLiveSession } from "../src/server/ai/live-close";

test("server close attaches only to owned opaque ID and requires terminal acknowledgement", async () => {
  for (const event of [{ type: "session.closed" }, { type: "error", message: "secret" }, { type: "socket-close" }]) {
    let terminated = false;
    const socket = new EventEmitter() as EventEmitter & { send: (data: string, callback: (error?: Error) => void) => void; terminate: () => void };
    socket.terminate = () => { terminated = true; };
    socket.send = (data, callback) => {
      assert.deepEqual(JSON.parse(data), { type: "session.close" });
      callback();
      if (event.type === "socket-close") socket.emit("close");
      else socket.emit("message", Buffer.from(JSON.stringify(event)));
    };
    const promise = closeLiveSession("opaque/id", "fake-key", (url, options) => {
      assert.equal(url, "wss://api.openai.com/v1/live/sessions/opaque%2Fid/attach");
      assert.deepEqual(options.headers, { Authorization: "Bearer fake-key" });
      queueMicrotask(() => socket.emit("open"));
      return socket as unknown as WebSocket;
    });
    if (event.type === "session.closed") await promise;
    else await assert.rejects(promise, error => error instanceof Error && /could not be confirmed/.test(error.message) && !error.message.includes("secret"));
    assert.equal(terminated, true);
  }
});
