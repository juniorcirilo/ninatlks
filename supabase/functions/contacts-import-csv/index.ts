// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// RFC 4180 parser — handles quoted fields with escaped quotes ("")
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const KNOWN_COLS = new Set([
  "name",
  "email",
  "phone_number",
  "phone",
  "phonenumber",
  "location",
  "company",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: au } = await supabase
      .from("account_users")
      .select("account_id")
      .eq("user_id", userData.user.id)
      .limit(1)
      .maybeSingle();

    if (!au?.account_id) {
      return new Response(JSON.stringify({ error: "No account" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const accountId = au.account_id;

    const body = await req.json();
    const csv = String(body?.csv ?? "");
    if (!csv.trim()) {
      return new Response(JSON.stringify({ error: "Empty CSV" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = parseCSV(csv);
    if (rows.length < 2) {
      return new Response(
        JSON.stringify({ error: "CSV must have header + at least one row" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf("name");
    if (nameIdx < 0) {
      return new Response(
        JSON.stringify({ error: "Missing required 'name' column" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const dataRows = rows.slice(1);
    const totalRows = dataRows.length;

    // Pre-fetch existing emails for dedupe
    const { data: existing } = await supabase
      .from("contacts")
      .select("email")
      .eq("account_id", accountId)
      .not("email", "is", null);
    const existingEmails = new Set(
      (existing ?? []).map((e: any) => String(e.email).toLowerCase()),
    );

    let imported = 0;
    let skipped = 0;
    const errors: { row: number; message: string }[] = [];
    const seenInBatch = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // header is row 1
      try {
        const get = (col: string) => {
          const idx = header.indexOf(col);
          if (idx < 0) return null;
          const v = row[idx]?.trim();
          return v && v.length > 0 ? v : null;
        };

        const name = get("name");
        if (!name) {
          errors.push({ row: rowNum, message: "Missing name" });
          continue;
        }

        const email = get("email")?.toLowerCase() ?? null;
        const phone =
          get("phone_number") ?? get("phone") ?? get("phonenumber") ?? null;
        const location = get("location");
        const company = get("company");

        // Dedupe by email
        if (email) {
          if (existingEmails.has(email) || seenInBatch.has(email)) {
            skipped++;
            continue;
          }
          seenInBatch.add(email);
        }

        const customAttrs: Record<string, string> = {};
        if (company) customAttrs.company = company;
        for (let c = 0; c < header.length; c++) {
          const col = header[c];
          if (KNOWN_COLS.has(col)) continue;
          const v = row[c]?.trim();
          if (v) customAttrs[col] = v;
        }

        const { error: insErr } = await supabase.from("contacts").insert({
          account_id: accountId,
          name,
          email,
          phone_number: phone,
          location,
          custom_attributes: customAttrs,
        });

        if (insErr) {
          errors.push({ row: rowNum, message: insErr.message });
        } else {
          imported++;
        }
      } catch (e: any) {
        errors.push({ row: rowNum, message: e?.message ?? "Unknown error" });
      }
    }

    return new Response(
      JSON.stringify({ imported, skipped, errors: errors.slice(0, 50), totalRows }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[contacts-import-csv]", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
