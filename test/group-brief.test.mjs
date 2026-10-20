import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseGroupBrief,
  suggestTarget,
  describeBrief,
} from "../src/shared/group-brief.mjs";

/* ---------------- suggestTarget ---------------- */

test("suggestTarget 把岗位/名字映射成合法 ASCII target", () => {
  assert.equal(suggestTarget("审阅"), "reviewer");
  assert.equal(suggestTarget("文档"), "writer");
  assert.equal(suggestTarget("协调员"), "coordinator");
});

test("suggestTarget 对已占用 target 追加 -2/-3 去重", () => {
  assert.equal(suggestTarget("测试", []), "tester");
  assert.equal(suggestTarget("测试", ["tester"]), "tester-2");
  assert.equal(suggestTarget("测试", ["tester", "tester-2"]), "tester-3");
});

test("suggestTarget 把保留字 lead 转成 lead-role", () => {
  assert.equal(suggestTarget("负责人"), "lead-role");
});

/* ---------------- parseGroupBrief ---------------- */

test("示例：解析质检组并给全员设置模型", () => {
  const text =
    "创建一个叫「质检组」的小组：图纸审阅员（负责审图纸、出审阅意见）、缺陷记录员（负责登记缺陷）、复测验证员（负责回归验证），模型都使用 deepseek-v4-pro-0813";
  const res = parseGroupBrief(text);
  assert.equal(res.ok, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.group.name, "质检组");
  assert.equal(res.members.length, 3);

  const [m1, m2, m3] = res.members;
  assert.equal(m1.displayName, "图纸审阅员");
  assert.equal(m1.target, "reviewer");
  assert.deepEqual(m1.duties, ["审图纸", "出审阅意见"]);
  assert.equal(m1.model, "deepseek-v4-pro-0813");

  assert.equal(m2.displayName, "缺陷记录员");
  assert.equal(m2.target, "recorder");
  assert.deepEqual(m2.duties, ["登记缺陷"]);
  assert.equal(m2.model, "deepseek-v4-pro-0813");

  assert.equal(m3.displayName, "复测验证员");
  assert.equal(m3.target, "prober");
  assert.ok(m3.duties.includes("回归验证"));
  assert.equal(m3.model, "deepseek-v4-pro-0813");
});

test("缺少组名时 ok:false 并返回错误", () => {
  const res = parseGroupBrief("成员：张三、李四");
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes("缺少组名"));
  assert.equal(res.group, null);
  assert.equal(res.members.length, 0);
});

test("支持多种分隔符变体", () => {
  const res = parseGroupBrief("组A：审阅员（负责审阅），记录员; 验证员、测试员");
  assert.equal(res.ok, true);
  assert.equal(res.members.length, 4);
  const targets = res.members.map((m) => m.target);
  assert.ok(targets.includes("reviewer"));
  assert.ok(targets.includes("recorder"));
  assert.ok(targets.includes("prober"));
  assert.ok(targets.includes("tester"));
});

test("括号内职责正确提取并去重", () => {
  const res = parseGroupBrief("小组A：质检员（负责检查、负责复核、测试）");
  assert.equal(res.ok, true);
  const m = res.members[0];
  assert.ok(m.duties.includes("检查"));
  assert.ok(m.duties.includes("复核"));
});

test("点名模型只给匹配成员设置", () => {
  const res = parseGroupBrief(
    "组B：审阅员、验证员、记录员，prober 使用 qwen3.8:latest"
  );
  assert.equal(res.ok, true);
  const prober = res.members.find((m) => m.target === "prober");
  assert.equal(prober.model, "qwen3.8:latest");
  assert.ok(!res.members.find((m) => m.target === "reviewer").model);
});

test("技能子句可设置全员 skills", () => {
  const res = parseGroupBrief("组C：审阅员、记录员，技能：fastpdf-convert, office-docx");
  assert.equal(res.ok, true);
  for (const m of res.members) {
    assert.deepEqual(m.skills, ["fastpdf-convert", "office-docx"]);
  }
});

test("target 去重/保留字/非法字符处理", () => {
  // 三个测试员岗位会触发去重，负责人会转成 lead-role
  const res = parseGroupBrief("组D：测试员、测试员、负责人");
  assert.equal(res.ok, true);
  const targets = res.members.map((m) => m.target);
  assert.ok(targets.includes("tester"));
  assert.ok(targets.includes("tester-2"));
  assert.ok(targets.includes("lead-role"));
  assert.ok(!targets.includes("lead"));
});

test("成员数量上限默认 12 并给出警告", () => {
  const members = Array.from({ length: 15 }, (_, i) => `测试员${i + 1}`).join("、");
  const res = parseGroupBrief(`组E：${members}`);
  assert.equal(res.ok, true);
  assert.equal(res.members.length, 12);
  assert.ok(res.warnings.some((w) => w.includes("超过上限")));
});

test("空输入返回缺少组名", () => {
  for (const input of ["", "   ", null, undefined]) {
    const res = parseGroupBrief(input);
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes("缺少组名"));
  }
});

test("describeBrief 包含组名与人数", () => {
  const res = parseGroupBrief("组F：审阅员、记录员");
  const desc = describeBrief(res);
  assert.match(desc, /小组「组F」/);
  assert.match(desc, /共 2 人/);
  assert.match(desc, /审阅员\(reviewer\)/);
  assert.match(desc, /记录员\(recorder\)/);
});

test("英文标点分隔符也能用", () => {
  const res = parseGroupBrief("组G：reviewer(test), recorder(test2), verifier");
  assert.equal(res.ok, true);
  assert.equal(res.members.length, 3);
});

test("重复成员名通过 suggestTarget 生成不同 target", () => {
  const res = parseGroupBrief("组H：审阅员、审阅员、审阅员");
  assert.equal(res.ok, true);
  assert.deepEqual(res.members.map((m) => m.target), [
    "reviewer",
    "reviewer-2",
    "reviewer-3",
  ]);
});
