/**
 * 多语言字典一致性守卫（静态检查，不需要浏览器/宿主）。
 *
 * 为什么要有它：`ctx.locale.register(NS, { zh, en })` 只要键不一致，宿主切到英文时
 * 缺的那个键会 fallback 成键名本身（看到 `cpNoDept` 这种字样），而单测里的 `t:(k)=>k`
 * 桩不会暴露这个洞。所以把「两份字典必须同键同序」和「必须真的 register 两份」钉成断言。
 *
 * 另含一条「绕过字典」的守卫：面板文案里出现裸中文（不经过 t()）时，切英文不会变。
 * 这里只盯最容易复发的一类——`? "中文" :` / `|| "中文"` 形态的兜底字面量。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "lib", "client.js"), "utf8");

const lines = src.split("\n");

const blockOf = (name) => {
  const start = lines.findIndex((l) => l.trim() === `const ${name} = {`);
  assert.ok(start > -1, `找不到 const ${name} = {`);
  const end = lines.findIndex((l, i) => i > start && /^\s{0,6}\};/.test(l));
  assert.ok(end > start, `找不到 const ${name} 的收尾`);
  return lines.slice(start, end + 1);
};

const keysOf = (block) =>
  block
    .map((line) => /^\s+([A-Za-z_$][\w$]*):/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);

const zhKeys = keysOf(blockOf("zh"));
const enKeys = keysOf(blockOf("en"));

test("字典：zh 与 en 键集合完全一致", () => {
  assert.ok(zhKeys.length > 300, `键太少（${zhKeys.length}），可能解析错块`);
  const onlyZh = zhKeys.filter((k) => !enKeys.includes(k));
  const onlyEn = enKeys.filter((k) => !zhKeys.includes(k));
  assert.deepEqual(onlyZh, [], `en 缺这些键：${onlyZh.join(", ")}`);
  assert.deepEqual(onlyEn, [], `zh 缺这些键：${onlyEn.join(", ")}`);
});

test("字典：zh 与 en 键顺序一致（便于对读）", () => {
  assert.deepEqual(zhKeys, enKeys);
});

test("注册：两份字典都交给 ctx.locale.register，且以 NS 为命名空间", () => {
  assert.match(src, /ctx\.locale\.register\(\s*NS\s*,\s*\{\s*zh:\s*zh\s*,\s*en:\s*en\s*\}\s*\)/);
  assert.match(src, /\bt\s*=\s*ctx\.locale\.bind\(\s*NS\s*\)/);
});

test("跟随宿主：客户端声明依赖 @deepseek-ai/dsh-client-locale，并带 locale/zh.json + en.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
  const inject = pkg?.dsh?.client?.inject || [];
  assert.ok(
    inject.some((d) => String(d).includes("dsh-client-locale")),
    `inject 里没有 locale 依赖：${JSON.stringify(inject)}`
  );
  for (const f of ["zh.json", "en.json"]) {
    const p = path.join(here, "..", "locale", f);
    assert.ok(fs.existsSync(p), `缺 ${p}`);
    assert.ok(JSON.parse(fs.readFileSync(p, "utf8")), `${f} 不是合法 JSON`);
  }
});

test("绕过字典：没有「三目/或」兜底成裸中文的字面量", () => {
  const offenders = [];
  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (/(\?|\|\||\?\?)\s*"[^"]*[\u4e00-\u9fff][^"]*"\s*:/.test(t) || /(\?|\|\||\?\?)\s*"[^"]*[\u4e00-\u9fff][^"]*"\s*;/.test(t)) {
      offenders.push(`${i + 1}: ${t.slice(0, 100)}`);
    }
  });
  assert.deepEqual(offenders, [], `这些兜底文案没走 t()：\n${offenders.join("\n")}`);
});
