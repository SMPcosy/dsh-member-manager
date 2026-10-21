# dsh-plugin-member-manager（兼容转发包）

> **已弃用**：本包已更名为 [`dsh-member-manager`](https://www.npmjs.com/package/dsh-member-manager)。
> 本包只是旧包名的转发壳，不含任何插件实现。

## 为什么还有这个包

npm 不支持「包名重定向」。为了让仍在执行
`dsh plugin --profile desktop add dsh-plugin-member-manager` 的用户能拿到新插件，
旧包名继续发布本转发包：它依赖 `dsh-member-manager@^0.3.0`，并把加载入口原样转发过去。

## 安装

老用户无需改命令；新用户请直接安装新包：

```bash
dsh plugin --profile desktop add dsh-member-manager
```

## 数据

数据目录仍为 `~/.dsh/storages/member-manager/`，升级不迁移、不丢数据；
旧包名升级后如需把名册转成公司化组织，可运行新包仓库里的：

```bash
node scripts/migrate-old-plugin.mjs --data-only --apply
```

## 许可证

MIT
