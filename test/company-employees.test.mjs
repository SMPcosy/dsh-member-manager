import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmployeeSessionManager } from "../src/host/company-employees.mjs";
import { emptyCompany, createDepartment, createEmployee, EMPLOYEE_STATE, EMPLOYEE_ROLE, EMPLOYEE_KIND, SESSION_POLICY } from "../src/shared/company-org.mjs";

function makeCtx() {
  let childId = 0;
  return {
    get(name) {
      if (name === "subagents") {
        return {
          async startActivation({ request }) {
            childId += 1;
            return { childId: `session-${childId}`, cancel() {}, dispose() {} };
          },
        };
      }
      return undefined;
    },
  };
}

function makeRuntime(ctx) {
  return { ctx, ownerAgent: { id: "owner" }, provider: "fake", config: {} };
}

test("per_task 员工每次派单创建新会话", async () => {
  const ctx = makeCtx();
  const runtime = makeRuntime(ctx);
  const manager = createEmployeeSessionManager({ runtime, logger: console });
  const company = emptyCompany();
  const company2 = createDepartment(company, { id: "A", name: "工程部" });
  const company3 = createEmployee(company2, { id: "e1", displayName: "员工1", department: "A", kind: "permanent", role: "staff", sessionPolicy: "per_task" });
  const emp = company3.employees[0];
  const s1 = await manager.ensureSession({ employee: emp, parentAgent: runtime.ownerAgent, provider: "fake" });
  const s2 = await manager.ensureSession({ employee: emp, parentAgent: runtime.ownerAgent, provider: "fake" });
  assert.notEqual(s1.sessionId, s2.sessionId);
});

test("resident 经理复用同一会话", async () => {
  const ctx = makeCtx();
  const runtime = makeRuntime(ctx);
  const manager = createEmployeeSessionManager({ runtime, logger: console });
  const company = emptyCompany();
  const company2 = createDepartment(company, { id: "A", name: "工程部" });
  const company3 = createEmployee(company2, { id: "m1", displayName: "经理", department: "A", role: "manager", sessionPolicy: "resident" });
  const emp = company3.employees[0];
  const s1 = await manager.ensureSession({ employee: emp, parentAgent: runtime.ownerAgent, provider: "fake" });
  const s2 = await manager.ensureSession({ employee: emp, parentAgent: runtime.ownerAgent, provider: "fake" });
  assert.equal(s1.sessionId, s2.sessionId);
});
