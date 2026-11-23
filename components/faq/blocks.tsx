function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*.*?\*\*|`[^`]+`)/g).map((s, i) =>
        s.startsWith("**") ? (
          <strong key={i} className="text-[#f0d38a]">
            {s.slice(2, -2)}
          </strong>
        ) : s.startsWith("`") ? (
          <code key={i} className="break-words text-[#f0d38a]">
            {s.slice(1, -1)}
          </code>
        ) : (
          s
        ),
      )}
    </>
  );
}
export function Blocks({ text }: { text: string }) {
  return (
    <div className="space-y-4 text-[15px] leading-7 text-white/80">
      {text.split(/\n\s*\n/).map((block, i) => {
        const lines = block.trim().split("\n");
        if (!block.trim() || block.trim() === "---") return null;
        if (lines[0].startsWith("|")) {
          const rows = lines
            .filter((l) => !/^\|[-:\s|]+$/.test(l))
            .map((l) =>
              l
                .split("|")
                .slice(1, -1)
                .map((c) => c.trim()),
            );
          return (
            <div
              key={i}
              className="overflow-x-auto rounded-xl border border-white/15"
            >
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {rows[0].map((c, n) => (
                      <th key={n} className="p-2 text-[#f0d38a]">
                        <Inline text={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((r, n) => (
                    <tr key={n} className="border-t border-white/10">
                      {r.map((c, m) => (
                        <td key={m} className="p-2">
                          <Inline text={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines[0].startsWith("### "))
          return (
            <article
              key={i}
              className="rounded-2xl border border-[#d7b55a]/25 bg-[#10271e] p-4"
            >
              <h3 className="mb-3 text-lg font-semibold text-[#f0d38a]">
                {lines[0].slice(4)}
              </h3>
              <Inline text={lines.slice(1).join("\n")} />
            </article>
          );
        return (
          <p key={i} className="whitespace-pre-line break-words">
            <Inline text={block} />
          </p>
        );
      })}
    </div>
  );
}
