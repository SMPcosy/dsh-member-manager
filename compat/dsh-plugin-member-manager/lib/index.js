// 兼容转发包（旧名 -> 新包）。
// 旧包名 dsh-plugin-member-manager 已更名为 dsh-member-manager；
// 本包不包含任何实现，只把旧名的加载入口转发到新包，避免老用户安装命令失效。
export * from "dsh-member-manager";
