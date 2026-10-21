import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_VERSION,
  TURN_LIMIT,
  ORDER_SLOTS,
  START_COINS,
  HIRE_COST,
  DEPT_BASE_CAPACITY,
  employeeOutput,
  employeeSalary,
  departmentUpgradeCost,
  employeeUpgradeCost,
  departmentMaxLevel,
  seedFromCompanyView,
  createGame,
  assignOrder,
  hireEmployee,
  upgradeEmployee,
  upgradeDepartment,
  stepGame,
  ratingOf,
  viewGame,
  serializeGame,
  deserializeGame,
} from "../src/host/company-game.mjs";

const SEED = {
  companyName: "测试公司",
  departments: [
    { id: "d1", name: "业务部" },
    { id: "d2", name: "技术部" },
  ],
  employees: [
    { id: "e1", name: "张三", code: "E0001", channel: "P", level: 3, deptId: "d1" },
    { id: "e2", name: "李四", code: "E0002", channel: "M", level: 2, deptId: "d2" },
  ],
};

function fresh(opts = {}) {
  return createGame(SEED, { seed: 42, ...opts });
}

test("createGame：从种子建部门/员工，金币与回合初始正确", () => {
  const g = fresh();
  assert.equal(g.version, GAME_VERSION);
  assert.equal(g.turn, 1);
  assert.equal(g.turnLimit, TURN_LIMIT);
  assert.equal(g.coins, START_COINS);
  assert.equal(g.status, "playing");
  assert.equal(g.departments.length, 2);
  assert.equal(g.employees.length, 2);
  assert.equal(g.employees[0].output, employeeOutput("P", 3));
  assert.equal(g.employees[0].salary, employeeSalary("P", 3));
  assert.ok(g.orders.length >= 1, "开局应有一张订单");
  assert.ok(g.log.length >= 1);
});

test("createGame：公司为空时补默认部门与两名 P1 员工", () => {
  const g = createGame({ companyName: "空公司" }, { seed: 7 });
  assert.equal(g.departments.length, 1);
  assert.equal(g.employees.length, 2);
  assert.equal(g.employees[0].channel, "P");
  assert.equal(g.employees[0].level, 1);
});

test("seedFromCompanyView：读取 view 的部门/通道/等级并兜底", () => {
  const seed = seedFromCompanyView({
    companyName: "大傻蛋",
    org: {
      departments: [{ id: "dept-a", name: "内容部" }],
      employees: [
        { id: "emp-1", displayName: "平面设计", code: "E0001", channels: [{ channel: "M", level: 2 }, { channel: "P", level: 4 }], department: "dept-a" },
        { id: "emp-2", displayName: "文案", code: "E0002", channel: "P", level: 1, department: "dept-a" },
      ],
    },
  });
  assert.equal(seed.companyName, "大傻蛋");
  assert.equal(seed.departments[0].id, "dept-a");
  assert.deepEqual(seed.employees.map((e) => [e.name, e.channel, e.level]), [
    ["平面设计", "M", 2],
    ["文案", "P", 1],
  ]);
});

test("产出/工资/升级费用表：随等级单调递增", () => {
  for (let lv = 1; lv < 6; lv += 1) {
    assert.ok(employeeOutput("P", lv + 1) > employeeOutput("P", lv), `P${lv} 应低于 P${lv + 1}`);
    if (lv < 5) assert.ok(employeeOutput("M", lv + 1) > employeeOutput("M", lv), `M${lv} 应低于 M${lv + 1}`);
    assert.ok(employeeSalary("P", lv) >= 1);
  }
  const g = fresh();
  const dept = g.departments[0];
  assert.equal(departmentUpgradeCost(dept), 300);
  dept.upgrades = 2;
  assert.equal(departmentUpgradeCost(dept), 600);
  assert.equal(employeeUpgradeCost(g.employees[0]), 120 + 80 * 3);
  assert.equal(departmentMaxLevel({ channel: "P" }), 6);
  assert.equal(departmentMaxLevel({ channel: "M" }), 5);
});

test("assignOrder：派单成功 + 未知订单/部门报错", () => {
  const g = fresh();
  const order = g.orders[0];
  const r1 = assignOrder(g, { orderId: order.id, departmentId: "d1" });
  assert.equal(r1.ok, true);
  assert.equal(order.deptId, "d1");
  assert.equal(order.status, "active");

  const r2 = assignOrder(g, { orderId: "nope", departmentId: "d1" });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "E_ORDER_NOT_FOUND");

  const r3 = assignOrder(g, { orderId: order.id, departmentId: "nope" });
  assert.equal(r3.ok, false);
  assert.equal(r3.code, "E_DEPT_NOT_FOUND");

  order.status = "done";
  const r4 = assignOrder(g, { orderId: order.id, departmentId: "d1" });
  assert.equal(r4.ok, false);
  assert.equal(r4.code, "E_ORDER_DONE");
});

test("stepGame：结算工资/部门开销，回合 +1，订单产能推进", () => {
  const g = fresh();
  const order = g.orders[0];
  assignOrder(g, { orderId: order.id, departmentId: "d1" });
  const beforeCoins = g.coins;
  const beforeProgress = order.progress;
  const r = stepGame(g);
  assert.equal(r.ok, true);
  assert.equal(g.turn, 2);
  // d1 只有张三（P3=24 产出），订单进度应前进；d2 的员工按 40% 摸鱼产出
  assert.ok(order.progress > beforeProgress);
  const payroll = g.employees.reduce((s, e) => s + e.salary, 0);
  const upkeep = payroll + 10 * g.departments.length;
  const idle = Math.round(employeeOutput("M", 2) * 0.4);
  assert.equal(g.coins, beforeCoins + idle - upkeep);
  assert.ok(g.log.some((l) => l.text.includes("本回合支出")));
});

test("stepGame：订单进度达标后完成并给钱给声望", () => {
  const g = fresh();
  const order = g.orders[0];
  order.need = 20;
  assignOrder(g, { orderId: order.id, departmentId: "d1" });
  const coinsBefore = g.coins;
  const repBefore = g.reputation;
  const r = stepGame(g);
  assert.equal(order.status, "done");
  assert.ok(g.coins > coinsBefore - 500, "完成订单后金币应包含奖励");
  assert.equal(g.reputation, repBefore + order.reputation);
  assert.ok(r.events.some((e) => e.type === "order_done"));
});

test("stepGame：新回合自动补订单，最多 ORDER_SLOTS 张进行中", () => {
  const g = fresh();
  for (let i = 0; i < 6; i += 1) stepGame(g);
  const open = g.orders.filter((o) => o.status === "open" || o.status === "active");
  assert.ok(open.length <= ORDER_SLOTS, `进行中订单不应超过 ${ORDER_SLOTS}`);
  assert.ok(g.orders.length >= ORDER_SLOTS);
});

test("stepGame：资金链断裂 -> lost + 评级 D，且后续操作被拒", () => {
  const g = fresh();
  g.coins = 1;
  stepGame(g);
  assert.equal(g.status, "lost");
  assert.equal(g.rating, "D");
  const r = stepGame(g);
  assert.equal(r.ok, false);
  assert.equal(r.code, "E_GAME_NOT_PLAYING");
  const h = hireEmployee(g, { departmentId: "d1" });
  assert.equal(h.code, "E_GAME_NOT_PLAYING");
});

test("stepGame：到达回合上限 -> won 且按分数评级", () => {
  const g = fresh({ turnLimit: 6 });
  g.coins = 5000;
  g.reputation = 10;
  for (let i = 0; i < 6; i += 1) stepGame(g);
  assert.equal(g.status, "won");
  assert.ok(["S", "A", "B", "C"].includes(g.rating));
  assert.equal(g.rating, ratingOf(g));
  assert.ok(g.log.some((l) => l.text.includes("回合结束")));
});

test("hireEmployee：扣费、加人；金币不足报 E_NO_COINS", () => {
  const g = fresh();
  const before = g.coins;
  const r = hireEmployee(g, { departmentId: "d2" });
  assert.equal(r.ok, true);
  assert.equal(g.coins, before - HIRE_COST);
  assert.equal(g.employees.filter((e) => e.deptId === "d2").length, 2);

  g.coins = 0;
  const r2 = hireEmployee(g, { departmentId: "d2" });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "E_NO_COINS");
});

test("upgradeEmployee：升级到下一级并重算产出；满级/没钱报错", () => {
  const g = fresh();
  const emp = g.employees[0];
  const beforeLevel = emp.level;
  const beforeCoins = g.coins;
  const r = upgradeEmployee(g, { employeeId: emp.id });
  assert.equal(r.ok, true);
  assert.equal(emp.level, beforeLevel + 1);
  assert.equal(emp.output, employeeOutput(emp.channel, emp.level));
  assert.equal(g.coins, beforeCoins - employeeUpgradeCost({ level: beforeLevel }));

  emp.level = departmentMaxLevel(emp);
  g.coins = 5000;
  const r2 = upgradeEmployee(g, { employeeId: emp.id });
  assert.equal(r2.code, "E_LEVEL_MAX");
});

test("upgradeDepartment：产能与编制提升，上限后报 E_DEPT_MAX", () => {
  const g = fresh();
  const dept = g.departments[0];
  const r = upgradeDepartment(g, { departmentId: dept.id });
  assert.equal(r.ok, true);
  assert.equal(dept.mul, 1.15);
  assert.equal(dept.capacity, DEPT_BASE_CAPACITY + 1);

  g.coins = 100000;
  while (dept.mul < 2.19) upgradeDepartment(g, { departmentId: dept.id });
  const r2 = upgradeDepartment(g, { departmentId: dept.id });
  assert.equal(r2.code, "E_DEPT_MAX");
});

test("确定性：同 seed 同操作序列结果完全一致", () => {
  const run = () => {
    const g = createGame(SEED, { seed: 99 });
    assignOrder(g, { orderId: g.orders[0].id, departmentId: "d1" });
    stepGame(g);
    stepGame(g);
    return serializeGame(g);
  };
  assert.equal(run(), run());
});

test("存档：serialize/deserialize 往返一致，版本不符返回 null", () => {
  const g = fresh();
  stepGame(g);
  const round = deserializeGame(serializeGame(g));
  assert.deepEqual(round, g);
  assert.equal(deserializeGame('{"version":999}'), null);
  assert.equal(deserializeGame("not json"), null);
});

test("viewGame：不暴露 rngSeed/seq，提供升级花费索引", () => {
  const g = fresh();
  const v = viewGame(g);
  assert.equal(v.rngSeed, undefined);
  assert.equal(v.seq, undefined);
  assert.equal(v.departments.length, 2);
  assert.equal(typeof v.nextCosts.hire, "number");
  assert.equal(v.nextCosts.upgradeDepartment.d1, 300);
  assert.ok(v.nextCosts.upgradeEmployee[g.employees[0].id] > 0);
  assert.equal(viewGame(null), null);
});

test("log：最多保留 LOG_LIMIT 条，不无限增长", () => {
  const g = fresh();
  for (let i = 0; i < 40; i += 1) stepGame(g);
  assert.ok(g.log.length <= 40);
});
