type Props = {
  message: string;
  hint?: string;
};

export function ErrorNotice({ message, hint }: Props) {
  return (
    <div className="rounded-xl border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
      请求失败：{message}
      {hint && <span className="text-red-400/70">（{hint}）</span>}
    </div>
  );
}