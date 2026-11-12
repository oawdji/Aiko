const ITEMS = [
  '恢复消息渲染（T0.4）',
  '发送后流式文本逐块出现',
  '状态面板先于文本更新',
  '发送含“409”的消息 → 展示错误',
  '生成中点击“停止” → 中断流',
  '多轮上下文：问“我刚才说了什么？”',
];

/**
 * Phase 0 验证清单（开发辅助 UI，M2 起逐步移除）。
 */
export function DevChecklist() {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-2 text-sm font-semibold">验证清单</h2>
      <ul className="list-inside list-disc space-y-1 text-xs text-neutral-400">
        {ITEMS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}