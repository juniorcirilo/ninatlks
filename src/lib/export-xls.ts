// Exporta uma lista de objetos como .xls, sem depender de nenhuma lib de
// planilha: Excel abre uma tabela HTML salva com extensão .xls (e mime
// application/vnd.ms-excel) normalmente — é o mesmo truque usado por vários
// exports "Baixar em Excel" simples. Suficiente para os relatórios pequenos
// (dezenas/centenas de linhas) que este app baixa, sem puxar uma dependência
// nova só pra isso.

function escapeHtml(value: unknown): string {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function downloadXls(
  filename: string,
  columns: { key: string; label: string }[],
  rows: Array<Record<string, unknown> | object>,
) {
  const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => `<td>${escapeHtml((row as Record<string, unknown>)[c.key])}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;

  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
