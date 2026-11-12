const ITEMS = [
  '刷新页面 → bootstrap 恢复历史消息与状态面板',
  '发送消息 → 流式文本逐块出现',
  '状态面板先于文本更新（data part 顺序）',
  '重复提交同一消息 → 409 → 会话自动刷新',
  '生成中点击“停止” → 中断流（CLIENT_ABORTED）',
  '多轮上下文：问“我刚才说了什么？”',
];

/**
 * 开发辅助清单（联调用）。
 */
export function DevChecklist() {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-2 text-sm font-semibold">联调清单</h2>
      <ul className="list-inside list-disc space-y-1 text-xs text-neutral-400">
        {ITEMS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}