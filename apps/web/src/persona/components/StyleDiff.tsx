/** 结构化 diff 展示：渲染服务端生成的 diff_summary（每行一个字段变化）。 */
export function StyleDiff({ summary }: { summary: string }) {
  const lines = summary.split('\n').filter((l) => l.length > 0);
  return (
    <ul aria-label="变更内容" className="space-y-1 text-xs text-neutral-300">
      {lines.map((line, i) => (
        <li key={i}>{line.startsWith('-') ? line.slice(1).trim() : line}</li>
      ))}
    </ul>
  );
}
