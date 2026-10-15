/**
 * 名册持久化层。
 *
 * 设计目标（见 docs/02-验证计划.md §2）：
 *  - 原子写：临时文件 + rename，避免半截文件
 *  - 自动备份：每次写覆盖前保留一份 .bak
 *  - 损坏自愈：非法 JSON / 结构损坏时隔离坏文件并回退，绝不抛错弄崩宿主
 *  - 版本迁移钩子：为将来 schema 升级留位置
 */

import fs from "node:fs";
import path from "node:path";

import {
  REGISTRY_VERSION,
  RegistryError,
  emptyRegistry,
  normalizeRegistry,
  validateRegistry,
} from "./registry-core.mjs";

export class RegistryStore {
  /**
   * @param {object} opts
   * @param {string} opts.file        名册 JSON 文件绝对路径
   * @param {string} [opts.quarantineDir] 损坏文件隔离目录，默认与 file 同级的 quarantine\
   * @param {() => string} [opts.now]  时间源（便于测试注入）
   */
  constructor({ file, quarantineDir, now = () => new Date().toISOString() }) {
    if (!file || typeof file !== "string") {
      throw new RegistryError("INVALID_STORE_PATH", "RegistryStore 需要 file 绝对路径");
    }
    this.file = path.resolve(file);
    this.dir = path.dirname(this.file);
    this.quarantineDir = quarantineDir ? path.resolve(quarantineDir) : path.join(this.dir, "quarantine");
    this.now = now;
  }

  get backupFile() {
    return `${this.file}.bak`;
  }

  /** 读取名册；文件不存在返回空名册；损坏则隔离并回退 */
  load() {
    const warnings = [];
    if (!fs.existsSync(this.file)) {
      warnings.push(`名册文件不存在，已初始化为空名册：${this.file}`);
      return { registry: emptyRegistry(this.now()), warnings, recovered: false, created: true };
    }

    let raw;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      warnings.push(`名册文件读取失败（${err.code || err.message}），回退到空名册`);
      return { registry: emptyRegistry(this.now()), warnings, recovered: false, created: false };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const kept = this.#quarantine(raw, "invalid-json");
      warnings.push(`名册文件不是合法 JSON，已隔离到 ${kept}，回退到空名册`);
      return { registry: emptyRegistry(this.now()), warnings, recovered: true, quarantine: kept, created: false };
    }

    parsed = this.#migrate(parsed, warnings);
    const { registry, warnings: normWarnings } = normalizeRegistry(parsed, this.now());
    const check = validateRegistry(registry);
    if (!check.ok) {
      // normalize 后仍不合法：隔离原始内容，保留归一化结果（尽量不丢数据）
      const kept = this.#quarantine(raw, "invalid-structure");
      warnings.push(`名册结构校验未通过（${check.errors.join("；")}），原始文件已隔离到 ${kept}`);
      warnings.push(...normWarnings);
      return { registry, warnings, recovered: true, quarantine: kept, created: false };
    }
    warnings.push(...normWarnings);
    return { registry, warnings, recovered: normWarnings.length > 0, created: false };
  }

  /** 原子保存：先备份旧文件，再写临时文件并 rename */
  save(registry) {
    const check = validateRegistry(registry);
    if (!check.ok) {
      throw new RegistryError("INVALID_REGISTRY", `拒绝写入不合法名册：${check.errors.join("；")}`, { errors: check.errors });
    }
    fs.mkdirSync(this.dir, { recursive: true });

    if (fs.existsSync(this.file)) {
      try {
        fs.copyFileSync(this.file, this.backupFile);
      } catch (err) {
        // 备份失败不阻断主流程，只记录在 store 上（绝不污染名册数据本身）
        this.lastWarning = `${this.now()} 备份失败：${err.code || err.message}`;
      }
    }

    const tmp = path.join(this.dir, `.${path.basename(this.file)}.${process.pid}.${Date.now()}.tmp`);
    const payload = `${JSON.stringify(registry, null, 2)}\n`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, payload, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
    return { file: this.file, bytes: Buffer.byteLength(payload, "utf8") };
  }

  /**
   * 读-改-写。mutator 接收名册，返回新名册（registry-core 的函数都是纯函数，直接传即可）。
   * mutator 抛出的 RegistryError 会向上冒泡，且**不会写盘**。
   */
  update(mutator) {
    const { registry, warnings, recovered } = this.load();
    const next = mutator(registry);
    if (!next || typeof next !== "object") {
      throw new RegistryError("INVALID_MUTATION", "mutator 必须返回新的名册对象");
    }
    this.save(next);
    return { registry: next, warnings, recovered };
  }

  /** 隔离损坏文件，返回隔离后的路径 */
  #quarantine(raw, reason) {
    try {
      fs.mkdirSync(this.quarantineDir, { recursive: true });
      const stamp = this.now().replace(/[:.]/g, "-");
      const dest = path.join(this.quarantineDir, `${path.basename(this.file)}.${reason}.${stamp}`);
      fs.writeFileSync(dest, raw, "utf8");
      return dest;
    } catch (err) {
      return `<隔离失败：${err.code || err.message}>`;
    }
  }

  /** 版本迁移钩子：目前只有 v1 */
  #migrate(data, warnings) {
    if (!data || typeof data !== "object") return data;
    const v = data.version;
    if (v === REGISTRY_VERSION) return data;
    if (v === undefined) {
      warnings.push(`名册缺少 version 字段，按 v${REGISTRY_VERSION} 处理`);
      return { ...data, version: REGISTRY_VERSION };
    }
    if (typeof v === "number" && v < REGISTRY_VERSION) {
      warnings.push(`名册版本 v${v} 低于当前 v${REGISTRY_VERSION}，已按当前结构归一化（尚无破坏性迁移）`);
      return { ...data, version: REGISTRY_VERSION };
    }
    if (typeof v === "number" && v > REGISTRY_VERSION) {
      warnings.push(`名册版本 v${v} 高于插件支持的 v${REGISTRY_VERSION}，可能存在字段丢失风险`);
      return data;
    }
    warnings.push(`名册 version 字段非法：${JSON.stringify(v)}`);
    return { ...data, version: REGISTRY_VERSION };
  }
}
