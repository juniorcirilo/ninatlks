// Geração de PDF de orçamento (Bruno) + upload no bucket `quote-pdfs`.
// Roda apenas em server functions (nome *.server.ts bloqueia bundle client).

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { insert } from "@/lib/db";

export interface QuoteItemForPdf {
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  kind: string;
}

export interface QuoteForPdf {
  accountId: string;
  customerName?: string;
  projectDescription?: string;
  items: QuoteItemForPdf[];
  subtotal: number;
  marginPct: number;
  total: number;
  validityDays?: number;
  nbrNotes?: string[];
}

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function generateQuotePdfBuffer(q: QuoteForPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 40;
  let y = 802;

  // Cabeçalho
  page.drawText("UBVA — Orçamento de Vidros", { x: margin, y, size: 18, font: bold, color: rgb(0.08, 0.12, 0.35) });
  y -= 22;
  page.drawText(`Emitido em ${new Date().toLocaleDateString("pt-BR")}`, { x: margin, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  y -= 24;

  if (q.customerName) {
    page.drawText(`Cliente: ${q.customerName}`, { x: margin, y, size: 11, font: bold });
    y -= 14;
  }
  if (q.projectDescription) {
    const desc = q.projectDescription.slice(0, 180);
    page.drawText(`Projeto: ${desc}`, { x: margin, y, size: 10, font });
    y -= 18;
  }

  // Tabela
  y -= 6;
  page.drawText("Item", { x: margin, y, size: 10, font: bold });
  page.drawText("Qtd", { x: 320, y, size: 10, font: bold });
  page.drawText("Unit.", { x: 380, y, size: 10, font: bold });
  page.drawText("Subtotal", { x: 470, y, size: 10, font: bold });
  y -= 4;
  page.drawLine({ start: { x: margin, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 12;

  for (const it of q.items) {
    if (y < 120) { y = 802; doc.addPage([595, 842]); }
    const name = `${it.name} (${it.sku})`.slice(0, 55);
    page.drawText(name, { x: margin, y, size: 9, font });
    page.drawText(it.qty.toFixed(2), { x: 320, y, size: 9, font });
    page.drawText(BRL(it.unit_price), { x: 380, y, size: 9, font });
    page.drawText(BRL(it.subtotal), { x: 470, y, size: 9, font });
    y -= 14;
  }

  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 16;

  // Totais
  page.drawText("Subtotal", { x: 380, y, size: 10, font });
  page.drawText(BRL(q.subtotal), { x: 470, y, size: 10, font });
  y -= 14;
  page.drawText(`Margem (${q.marginPct.toFixed(0)}%)`, { x: 380, y, size: 10, font });
  page.drawText(BRL(q.total - q.subtotal), { x: 470, y, size: 10, font });
  y -= 16;
  page.drawText("TOTAL", { x: 380, y, size: 12, font: bold });
  page.drawText(BRL(q.total), { x: 470, y, size: 12, font: bold, color: rgb(0.08, 0.12, 0.35) });
  y -= 26;

  // NBR / observações
  if (q.nbrNotes && q.nbrNotes.length > 0) {
    page.drawText("Conformidade técnica (NBR 7199 / NBR 14207):", { x: margin, y, size: 10, font: bold });
    y -= 14;
    for (const n of q.nbrNotes) {
      page.drawText(`• ${n}`.slice(0, 110), { x: margin, y, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
      y -= 12;
    }
    y -= 6;
  }

  page.drawText(`Validade: ${q.validityDays ?? 7} dias. Valores sujeitos a confirmação de medidas no local.`, {
    x: margin, y, size: 8, font, color: rgb(0.4, 0.4, 0.4),
  });

  return doc.save();
}

/** Persiste o orçamento (linhas, valores, PDF) em `public.quotes` — é essa
 * linha que alimenta a tela /orcamentos. */
export async function saveQuote(q: QuoteForPdf & {
  personaId: string | null;
  conversationId: string | null;
  usageType?: string;
  pdf: Uint8Array;
}): Promise<{ id: string }> {
  const [row] = await insert<{ id: string }>("quotes", {
    account_id: q.accountId,
    persona_id: q.personaId,
    conversation_id: q.conversationId,
    customer_name: q.customerName ?? null,
    project_description: q.projectDescription ?? null,
    usage_type: q.usageType ?? null,
    items: JSON.stringify(q.items),
    subtotal: q.subtotal,
    margin_pct: q.marginPct,
    total: q.total,
    nbr_notes: JSON.stringify(q.nbrNotes ?? []),
    validity_days: q.validityDays ?? 7,
    pdf_bytes: Buffer.from(q.pdf),
  });
  if (!row) throw new Error("falha ao salvar orçamento");
  return { id: row.id };
}

// ============== NBR 7199 / 14207 enforcement helpers ==============

export type GlassUsage =
  | "box"
  | "divisoria_interna"
  | "mesa"
  | "espelho"
  | "fachada"
  | "sacada"
  | "guarda_corpo"
  | "cobertura"
  | "outro";

export interface NbrCheck {
  ok: boolean;
  warnings: string[];
  blockers: string[];
}

/** Aplica regras da NBR 7199 (vidros na construção civil) + NBR 14207 (box). */
export function validateNbr(args: {
  usage: GlassUsage;
  glasses: Array<{ category?: string; thickness_mm?: number; sku: string }>;
}): NbrCheck {
  const warnings: string[] = [];
  const blockers: string[] = [];

  const requiresLaminated: GlassUsage[] = ["fachada", "sacada", "guarda_corpo", "cobertura"];
  if (requiresLaminated.includes(args.usage)) {
    const allLaminated = args.glasses.every((g) => (g.category ?? "").toLowerCase() === "laminado");
    if (!allLaminated) {
      blockers.push(
        `NBR 7199: ${args.usage.replace("_", " ")} exige vidro LAMINADO de segurança. Substitua os itens não laminados.`,
      );
    }
  }

  if (args.usage === "box") {
    const allTempered = args.glasses.every((g) => (g.category ?? "").toLowerCase() === "temperado");
    if (!allTempered) warnings.push("NBR 14207: recomenda-se vidro temperado para box.");
    const tooThin = args.glasses.some((g) => (g.thickness_mm ?? 0) < 8);
    if (tooThin) blockers.push("NBR 14207: espessura mínima de 8 mm em box.");
  }

  if (args.usage === "divisoria_interna") {
    const tooThin = args.glasses.some((g) => (g.thickness_mm ?? 0) < 10);
    if (tooThin) warnings.push("Recomendação UBVA: divisória interna ≥ 10 mm.");
  }

  if (args.usage === "fachada" || args.usage === "sacada") {
    const tooThin = args.glasses.some((g) => (g.thickness_mm ?? 0) < 8);
    if (tooThin) warnings.push("Para fachada/sacada, espessura mínima usual é 4+4 mm laminado (≥ 8 mm).");
  }

  return { ok: blockers.length === 0, warnings, blockers };
}
