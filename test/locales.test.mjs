import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const WEB_DIR = new URL("../web", import.meta.url).pathname;

test("every key in en.json exists in ko.json", async () => {
  const en = JSON.parse(await readFile(join(WEB_DIR, "locales", "en.json"), "utf8"));
  const ko = JSON.parse(await readFile(join(WEB_DIR, "locales", "ko.json"), "utf8"));

  for (const key of Object.keys(en)) {
    assert.ok(Object.hasOwn(ko, key), `ko.json missing key: ${key}`);
  }
});

test("no extra keys in ko.json beyond en.json", async () => {
  const en = JSON.parse(await readFile(join(WEB_DIR, "locales", "en.json"), "utf8"));
  const ko = JSON.parse(await readFile(join(WEB_DIR, "locales", "ko.json"), "utf8"));

  for (const key of Object.keys(ko)) {
    assert.ok(Object.hasOwn(en, key), `ko.json has extra key not in en.json: ${key}`);
  }
});
