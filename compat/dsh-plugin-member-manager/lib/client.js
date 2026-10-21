// 兼容转发包（旧名 -> 新包）的 Web 客户端入口。
// platform/inject 元数据在本包 package.json 的 dsh.client 中声明，
// 实际 UI 实现由 dsh-member-manager 提供。
export * from "dsh-member-manager/client";
