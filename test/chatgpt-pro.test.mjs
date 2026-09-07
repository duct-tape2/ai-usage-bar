import { test } from "node:test";
import assert from "node:assert/strict";
import { reduceConversation } from "../src/providers/chatgpt-pro/collect.mjs";

function node(id, parent, role, extra = {}) {
  return { id, parent, message: { id, author: { role }, create_time: 1757203200 + Number(id.replace(/\D/g, "") || 0), ...extra } };
}
const pro = { metadata: { model_slug: "gpt-6-pro" } };

test("one question answered through 200 tool and thought nodes counts once", () => {
  const mapping = { u1: node("u1", null, "user") };
  let prev = "u1";
  for (let i = 0; i < 200; i++) {
    const id = `t${i}`;
    mapping[id] = node(id, prev, i % 2 ? "tool" : "assistant", i % 2 ? {} : pro);
    prev = id;
  }
  mapping.final = node("final", prev, "assistant", pro);
  const turns = reduceConversation({ mapping }, ["gpt-6-pro"]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0][0], "u1");
});

test("two questions in one conversation count twice, regenerations do not", () => {
  const mapping = {
    u1: node("u1", null, "user"),
    a1: node("a1", "u1", "assistant", pro),
    a1b: node("a1b", "u1", "assistant", pro), // regenerated answer, same question
    u2: node("u2", "a1", "user"),
    a2: node("a2", "u2", "assistant", pro),
    a3: node("a3", "u2", "assistant", { metadata: { model_slug: "gpt-5-6" } }),
  };
  const turns = reduceConversation({ mapping }, ["gpt-6-pro"]).map((t) => t[0]).sort();
  assert.deepEqual(turns, ["u1", "u2"]);
});

test("an assistant node with no user ancestor is not a request", () => {
  const mapping = { orphan: node("orphan", null, "assistant", pro) };
  assert.equal(reduceConversation({ mapping }, ["gpt-6-pro"]).length, 0);
});
