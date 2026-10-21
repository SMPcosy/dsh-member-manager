/* ------------------------------------------------------------------ *
 * 公司大亨（dsh-member-manager 内置小游戏）· 纯逻辑引擎
 *
 * 设计约束：
 * 1) 纯函数、无 I/O、无宿主依赖 —— 便于在 node --test 里直接跑；
 * 2) 确定性：所有随机都走注入的 RNG（由 game.rngSeed 派生的 xorshift32），
 *    同一 seed 同一操作序列必须得到同一结果（测试与回放依赖这一点）；
 * 3) 存档兼容：serializeGame/deserializeGame 负责版本与字段兜底；
 *    deserialize 遇到不认识的版本返回 null，由调用方重新开局。
 * 游戏数据与真实公司数据完全隔离：只从 company view 读取一次作为开局种子。
 * ------------------------------------------------------------------ */

export const GAME_VERSION = 1;
export const TURN_LIMIT = 30;
export const ORDER_SLOTS = 3;
export const START_COINS = 800;
export const HIRE_COST = 300;
export const DEPT_UPKEEP = 10;
export const LOG_LIMIT = 40;
export const DEPT_BASE_CAPACITY = 4;
export const MUL_STEP = 0.15;
export const MUL_MAX = 2.2;

const OUTPUT_BY_CHANNEL = {
  P: [10, 16, 24, 34, 46, 60],
  M: [18, 28, 40, 54, 70],
};

const NEW_HIRE_NAMES = [
  "陈默", "林小满", "赵一鸣", "周可欣", "吴桐", "郑嘉树", "冯橙", "许诺",
  "何夕", "沈知远", "秦朗", "苏念", "顾泊舟", "陆则", "白露", "江晚",
];

const CUSTOMERS = [
  "远山文创", "青禾科技", "拾光书店", "北斗物流", "橙子咖啡", "北岸设计",
  "微光教育", "长风制造", "云图数据", "小时光花店", "木言家具", "一线传媒",
];

const ORDER_KINDS = [
  "品牌视觉升级", "官网改版", "新品海报", "宣传册设计", "短视频剪辑", "数据看板",
  "门店物料", "活动策划", "包装设计", "内容代运营", "产品摄影", "年度报告",
];

/** 员工产出（按通道/等级）。未知等级按 1 级处理。 */
export function employeeOutput(channel, level) {
  const table = OUTPUT_BY_CHANNEL[channel] || OUTPUT_BY_CHANNEL.P;
  const idx = Math.max(0, Math.min(table.length - 1, Number(level || 1) - 1));
  return table[idx];
}

/** 员工每回合工资 = 产出 × 0.45（四舍五入）。 */
export function employeeSalary(channel, level) {
  return Math.round(employeeOutput(channel, level) * 0.45);
}

export function departmentUpgradeCost(dept) {
  return 300 + 150 * (Number(dept?.upgrades) || 0);
}

export function employeeUpgradeCost(emp) {
  return 120 + 80 * (Number(emp?.level) || 1);
}

export function departmentMaxLevel(emp) {
  const channel = emp?.channel === "M" ? "M" : "P";
  return (OUTPUT_BY_CHANNEL[channel] || OUTPUT_BY_CHANNEL.P).length;
}

/* --------------------------------- RNG --------------------------------- */

function xorshift32(seed) {
  let x = seed | 0;
  if (x === 0) x = 0x9e3779b9;
  return function next() {
    x ^= x << 13;
    x |= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x |= 0;
    // 映射到 [0,1)
    return (x >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/* ------------------------------- helpers ------------------------------- */

function log(game, text) {
  game.log.push({ turn: game.turn, text: String(text) });
  if (game.log.length > LOG_LIMIT) game.log = game.log.slice(-LOG_LIMIT);
}

function nextId(game, prefix) {
  game.seq = (Number(game.seq) || 0) + 1;
  return `${prefix}-${game.seq}`;
}

function deptEmployees(game, departmentId) {
  return game.employees.filter((e) => e.deptId === departmentId);
}

function findDept(game, departmentId) {
  return game.departments.find((d) => d.id === departmentId) || null;
}

function findEmployee(game, employeeId) {
  return game.employees.find((e) => e.id === employeeId) || null;
}

function findOrder(game, orderId) {
  return game.orders.find((o) => o.id === orderId) || null;
}

function isPlaying(game) {
  return game && game.status === "playing";
}

/** 统一错误返回：{ok:false, code, message}。 */
function fail(code, message) {
  return { ok: false, code, message: message || code };
}

/** 统一成功返回：{ok:true, game}。 */
function ok(game) {
  return { ok: true, game };
}

/* ----------------------------- create/seed ----------------------------- */

/**
 * 从公司快照生成开局种子（只读、单次）。
 * @param {object} companyView  /company/overview 的 view（取 org.departments / org.employees）
 */
export function seedFromCompanyView(companyView) {
  const org = companyView && companyView.org ? companyView.org : {};
  const departments = Array.isArray(org.departments) ? org.departments : [];
  const employees = Array.isArray(org.employees) ? org.employees : [];
  const depts = departments.slice(0, 4).map((d) => ({
    id: String(d.id || d.name || "dept"),
    name: String(d.name || "部门"),
  }));
  const emps = [];
  for (const e of employees.slice(0, 12)) {
    const channels = Array.isArray(e.channels) && e.channels.length ? e.channels : null;
    const channel = String((channels ? channels[0].channel : e.channel) || "P").toUpperCase() === "M" ? "M" : "P";
    const rawLevel = channels ? channels[0].level : e.level;
    const level = Math.max(1, Math.min(6, Number(rawLevel) || 1));
    const deptId = String(e.department || e.departmentId || (depts[0] && depts[0].id) || "dept");
    emps.push({
      id: String(e.id || e.code || `emp-${emps.length + 1}`),
      name: String(e.displayName || e.name || e.code || "员工"),
      code: String(e.code || ""),
      channel,
      level,
      deptId: depts.some((d) => d.id === deptId) ? deptId : (depts[0] && depts[0].id) || "dept",
      fromCompany: true,
    });
  }
  return {
    companyName: String(companyView?.companyName || companyView?.name || "我的公司"),
    departments: depts,
    employees: emps,
  };
}

/**
 * 新开局。
 * @param {object} seed  seedFromCompanyView() 的产物
 * @param {{ seed?: number, turnLimit?: number }} [opts]
 */
export function createGame(seed = {}, opts = {}) {
  const game = {
    version: GAME_VERSION,
    companyName: String(seed.companyName || "我的公司"),
    turn: 1,
    turnLimit: Math.max(6, Math.min(60, Number(opts.turnLimit) || TURN_LIMIT)),
    coins: START_COINS,
    reputation: 0,
    status: "playing",
    rating: null,
    departments: [],
    employees: [],
    orders: [],
    log: [],
    seq: 0,
    rngSeed: Number(opts.seed) || ((Date.now() % 0xffffffff) || 1),
  };

  const depts = Array.isArray(seed.departments) && seed.departments.length
    ? seed.departments.slice(0, 4)
    : [{ id: "dept-1", name: "业务部" }];
  for (const d of depts) {
    game.departments.push({
      id: String(d.id),
      name: String(d.name || "部门"),
      mul: 1,
      upgrades: 0,
      capacity: DEPT_BASE_CAPACITY,
    });
  }

  const emps = Array.isArray(seed.employees) ? seed.employees.slice(0, 12) : [];
  for (const e of emps) {
    const deptId = game.departments.some((d) => d.id === String(e.deptId)) ? String(e.deptId) : game.departments[0].id;
    const channel = e.channel === "M" ? "M" : "P";
    const level = Math.max(1, Math.min(6, Number(e.level) || 1));
    game.employees.push({
      id: String(e.id || nextId(game, "g-emp")),
      name: String(e.name || "员工"),
      code: String(e.code || ""),
      channel,
      level,
      deptId,
      output: employeeOutput(channel, level),
      salary: employeeSalary(channel, level),
      fromCompany: Boolean(e.fromCompany),
    });
  }
  // 公司没员工时送两名 P1 起步，保证能玩
  if (!game.employees.length) {
    for (let i = 0; i < 2; i += 1) {
      game.employees.push({
        id: nextId(game, "emp"),
        name: NEW_HIRE_NAMES[i % NEW_HIRE_NAMES.length],
        code: "",
        channel: "P",
        level: 1,
        deptId: game.departments[0].id,
        output: employeeOutput("P", 1),
        salary: employeeSalary("P", 1),
        fromCompany: false,
      });
    }
  }

  // 开局给一张订单，玩家立刻有事可做
  const rng = xorshift32(game.rngSeed);
  spawnOrder(game, rng);
  log(game, `开局：${game.companyName} 拿到 ${START_COINS} 金币启动资金，${game.employees.length} 名员工待命。`);
  return game;
}

/* ------------------------------- orders -------------------------------- */

function spawnOrder(game, rng) {
  const need = Math.round((60 + rng() * 140) / 10) * 10;
  const reward = Math.round((need * (2.2 + rng() * 0.6)) / 10) * 10;
  const reputation = 1 + Math.floor(need / 90);
  const order = {
    id: nextId(game, "g-ord"),
    title: `${pick(rng, CUSTOMERS)} · ${pick(rng, ORDER_KINDS)}`,
    need,
    progress: 0,
    reward,
    reputation,
    deptId: null,
    status: "open",
  };
  game.orders.push(order);
  return order;
}

/* ------------------------------- actions ------------------------------- */

export function assignOrder(game, args = {}) {
  if (!isPlaying(game)) return fail("E_GAME_NOT_PLAYING", "游戏已结束");
  const order = findOrder(game, String(args.orderId || ""));
  if (!order) return fail("E_ORDER_NOT_FOUND", "订单不存在");
  if (order.status === "done") return fail("E_ORDER_DONE", "订单已完成");
  const dept = findDept(game, String(args.departmentId || ""));
  if (!dept) return fail("E_DEPT_NOT_FOUND", "部门不存在");
  order.deptId = dept.id;
  order.status = "active";
  log(game, `「${order.title}」交给 ${dept.name} 跟进（需求产能 ${order.need}）。`);
  return ok(game);
}

export function hireEmployee(game, args = {}) {
  if (!isPlaying(game)) return fail("E_GAME_NOT_PLAYING", "游戏已结束");
  const dept = findDept(game, String(args.departmentId || ""));
  if (!dept) return fail("E_DEPT_NOT_FOUND", "部门不存在");
  if (game.coins < HIRE_COST) return fail("E_NO_COINS", `金币不足（招聘需要 ${HIRE_COST}）`);
  if (deptEmployees(game, dept.id).length >= dept.capacity * 3) {
    return fail("E_DEPT_FULL", `${dept.name} 人手已满，请先升级部门`);
  }
  game.coins -= HIRE_COST;
  const rng = xorshift32((game.rngSeed ^ (game.seq + 1) * 2654435761) >>> 0);
  const emp = {
    id: nextId(game, "g-emp"),
    name: pick(rng, NEW_HIRE_NAMES),
    code: "",
    channel: "P",
    level: 1,
    deptId: dept.id,
    output: employeeOutput("P", 1),
    salary: employeeSalary("P", 1),
    fromCompany: false,
  };
  game.employees.push(emp);
  log(game, `招聘 ${emp.name}（P1）加入 ${dept.name}，花费 ${HIRE_COST} 金币。`);
  return ok(game);
}

export function upgradeEmployee(game, args = {}) {
  if (!isPlaying(game)) return fail("E_GAME_NOT_PLAYING", "游戏已结束");
  const emp = findEmployee(game, String(args.employeeId || ""));
  if (!emp) return fail("E_EMP_NOT_FOUND", "员工不存在");
  const cost = employeeUpgradeCost(emp);
  if (game.coins < cost) return fail("E_NO_COINS", `金币不足（晋升需要 ${cost}）`);
  if (emp.level >= departmentMaxLevel(emp)) return fail("E_LEVEL_MAX", "该通道已达最高等级");
  game.coins -= cost;
  emp.level += 1;
  emp.output = employeeOutput(emp.channel, emp.level);
  emp.salary = employeeSalary(emp.channel, emp.level);
  log(game, `${emp.name} 晋升到 ${emp.channel}${emp.level}（产出 ${emp.output}），花费 ${cost} 金币。`);
  return ok(game);
}

export function upgradeDepartment(game, args = {}) {
  if (!isPlaying(game)) return fail("E_GAME_NOT_PLAYING", "游戏已结束");
  const dept = findDept(game, String(args.departmentId || ""));
  if (!dept) return fail("E_DEPT_NOT_FOUND", "部门不存在");
  const cost = departmentUpgradeCost(dept);
  if (game.coins < cost) return fail("E_NO_COINS", `金币不足（升级部门需要 ${cost}）`);
  if (dept.mul >= MUL_MAX - 1e-9) return fail("E_DEPT_MAX", "部门产能已达到上限");
  game.coins -= cost;
  dept.upgrades += 1;
  dept.mul = Math.min(MUL_MAX, Number((dept.mul + MUL_STEP).toFixed(2)));
  dept.capacity = DEPT_BASE_CAPACITY + dept.upgrades;
  log(game, `${dept.name} 升级：产能 ×${dept.mul}，编制 ${dept.capacity}，花费 ${cost} 金币。`);
  return ok(game);
}

/**
 * 结束本回合。返回 {ok, game, events:[...]}，events 供 UI 高亮本回合变化。
 */
export function stepGame(game, opts = {}) {
  if (!isPlaying(game)) return fail("E_GAME_NOT_PLAYING", "游戏已结束");
  const rng = opts.rng || xorshift32(((game.rngSeed + game.turn * 2654435761) >>> 0) || 1);
  const events = [];

  // 1) 生产：有在跟进订单的部门把产能投入订单，其余员工摸鱼产出 40%
  let income = 0;
  for (const dept of game.departments) {
    const staff = deptEmployees(game, dept.id);
    const active = game.orders.filter((o) => o.deptId === dept.id && o.status === "active");
    if (active.length) {
      // 平均分给该部门在跟进的订单
      const cap = staff.reduce((sum, e) => sum + e.output, 0) * dept.mul;
      const share = cap / active.length;
      for (const order of active) {
        order.progress = Math.min(order.need, Math.round((order.progress + share) * 10) / 10);
        if (order.progress >= order.need) {
          order.status = "done";
          game.coins += order.reward;
          game.reputation += order.reputation;
          events.push({ type: "order_done", orderId: order.id, title: order.title, reward: order.reward });
          log(game, `✅ 完成「${order.title}」：+${order.reward} 金币，声望 +${order.reputation}。`);
        }
      }
    } else if (staff.length) {
      income += Math.round(staff.reduce((sum, e) => sum + e.output, 0) * dept.mul * 0.4);
    }
  }
  if (income > 0) {
    game.coins += income;
    log(game, `空闲员工接零活：+${income} 金币。`);
  }

  // 2) 固定成本
  const payroll = game.employees.reduce((sum, e) => sum + e.salary, 0);
  const upkeep = payroll + DEPT_UPKEEP * game.departments.length;
  game.coins -= upkeep;
  events.push({ type: "cost", payroll, upkeep });
  log(game, `💸 本回合支出 ${upkeep} 金币（工资 ${payroll} + 部门开销 ${DEPT_UPKEEP * game.departments.length}）。`);

  // 3) 补新订单
  const open = game.orders.filter((o) => o.status === "open" || o.status === "active").length;
  let added = 0;
  while (open + added < ORDER_SLOTS) {
    const order = spawnOrder(game, rng);
    added += 1;
    events.push({ type: "order_new", orderId: order.id, title: order.title });
    log(game, `📌 新订单「${order.title}」发布（需求 ${order.need}，奖励 ${order.reward}）。`);
  }

  // 4) 推进回合 / 结算
  game.turn += 1;
  if (game.coins < 0) {
    game.status = "lost";
    game.rating = "D";
    log(game, `💥 资金链断裂，${game.companyName} 破产了。`);
    events.push({ type: "lost", reason: "bankruptcy" });
  } else if (game.turn > game.turnLimit) {
    game.status = "won";
    game.rating = ratingOf(game);
    log(game, `🏁 ${game.turnLimit} 回合结束：金币 ${game.coins}，声望 ${game.reputation}，评级 ${game.rating}。`);
    events.push({ type: "settled", rating: game.rating });
  }
  return { ok: true, game, events };
}

export function ratingOf(game) {
  const score = game.coins + game.reputation * 40;
  if (score >= 3000) return "S";
  if (score >= 2000) return "A";
  if (score >= 1200) return "B";
  return "C";
}

/* ----------------------------- view/serialize --------------------------- */

/** 给前端的最小视图（隐藏 rngSeed 等内部字段）。 */
export function viewGame(game) {
  if (!game) return null;
  return {
    version: game.version,
    companyName: game.companyName,
    turn: game.turn,
    turnLimit: game.turnLimit,
    coins: game.coins,
    reputation: game.reputation,
    status: game.status,
    rating: game.rating,
    departments: game.departments.map((d) => ({
      id: d.id,
      name: d.name,
      mul: d.mul,
      upgrades: d.upgrades,
      capacity: d.capacity,
      employees: game.employees.filter((e) => e.deptId === d.id).map((e) => e.id),
    })),
    employees: game.employees.map((e) => ({
      id: e.id,
      name: e.name,
      code: e.code,
      channel: e.channel,
      level: e.level,
      deptId: e.deptId,
      output: e.output,
      salary: e.salary,
      fromCompany: e.fromCompany,
    })),
    orders: game.orders.map((o) => ({ ...o })),
    log: game.log.slice(-20),
    nextCosts: {
      hire: HIRE_COST,
      upgradeDepartment: Object.fromEntries(game.departments.map((d) => [d.id, departmentUpgradeCost(d)])),
      upgradeEmployee: Object.fromEntries(game.employees.map((e) => [e.id, employeeUpgradeCost(e)])),
    },
  };
}

export function serializeGame(game) {
  return JSON.stringify(game);
}

export function deserializeGame(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  if (Number(data.version) !== GAME_VERSION) return null;
  if (!Array.isArray(data.departments) || !Array.isArray(data.employees) || !Array.isArray(data.orders)) return null;
  return data;
}
