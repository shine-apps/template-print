/** 类型声明：notes.mjs 是供 CI 脚本直接用 node 运行的纯 JS ESM，这里补类型供 TS 测试导入 */
export declare function extractReleaseNotes(markdown: string, version: string): string | null
