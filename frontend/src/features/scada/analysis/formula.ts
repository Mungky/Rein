/** Safe arithmetic formula engine for the Analisis workbench.
 *
 *  Deliberately NOT a scripting language (no eval, no mathjs) — a shunting-
 *  yard parser over a closed grammar, per the security decision (IEC 62443
 *  minimal attack surface). Grammar:
 *
 *    referensi : [Terkini] [Min] [Rata] [Maks] [Nama Kolom Custom]
 *    operator  : + - * / ^ ( )   ·   pemisah argumen: ; (atau ,)
 *    fungsi    : ABS(x) ROUND(x; n) SQRT(x) MIN(a; b; …) MAX(a; b; …)
 *
 *  Any problem (parse error, unknown reference, null input, ÷0, √negatif)
 *  throws FormulaError — cells render it as #RUMUS!, never a crash. */

export class FormulaError extends Error {}

type Token =
  | { kind: "num"; value: number }
  | { kind: "ref"; name: string }
  | { kind: "op"; op: string }
  | { kind: "fn"; name: string; arity: number };

interface OpInfo {
  prec: number;
  rightAssoc: boolean;
}

// Excel semantics: unary minus binds tighter than ^ (so -2^2 = 4)
const OPS: Record<string, OpInfo> = {
  "+": { prec: 1, rightAssoc: false },
  "-": { prec: 1, rightAssoc: false },
  "*": { prec: 2, rightAssoc: false },
  "/": { prec: 2, rightAssoc: false },
  "^": { prec: 3, rightAssoc: true },
  "neg": { prec: 4, rightAssoc: true },
};

const FUNCTIONS: Record<string, { minArity: number; maxArity: number }> = {
  ABS: { minArity: 1, maxArity: 1 },
  SQRT: { minArity: 1, maxArity: 1 },
  ROUND: { minArity: 1, maxArity: 2 },
  MIN: { minArity: 1, maxArity: 16 },
  MAX: { minArity: 1, maxArity: 16 },
};

export function normalizeRef(name: string): string {
  return name.trim().toLowerCase();
}

interface RawToken {
  kind: "num" | "ref" | "op" | "fnname" | "lparen" | "rparen" | "sep";
  text: string;
  value?: number;
}

function tokenize(src: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
    } else if (ch === "[") {
      const end = src.indexOf("]", i);
      if (end === -1) throw new FormulaError("Referensi tidak ditutup dengan ]");
      const name = src.slice(i + 1, end);
      if (!name.trim()) throw new FormulaError("Referensi kosong []");
      tokens.push({ kind: "ref", text: name });
      i = end + 1;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new FormulaError(`Angka tidak valid di "${src.slice(i, i + 8)}"`);
      tokens.push({ kind: "num", text: m[0], value: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      const name = m[0].toUpperCase();
      if (!(name in FUNCTIONS)) {
        throw new FormulaError(
          `Fungsi "${m[0]}" tidak dikenal (yang tersedia: ${Object.keys(FUNCTIONS).join(", ")})`
        );
      }
      tokens.push({ kind: "fnname", text: name });
      i += m[0].length;
    } else if ("+-*/^".includes(ch)) {
      tokens.push({ kind: "op", text: ch });
      i++;
    } else if (ch === "(") {
      tokens.push({ kind: "lparen", text: ch });
      i++;
    } else if (ch === ")") {
      tokens.push({ kind: "rparen", text: ch });
      i++;
    } else if (ch === ";" || ch === ",") {
      tokens.push({ kind: "sep", text: ch });
      i++;
    } else {
      throw new FormulaError(`Karakter tidak dikenal: "${ch}"`);
    }
  }
  return tokens;
}

export interface CompiledFormula {
  rpn: Token[];
  /** Normalized reference names the formula depends on. */
  refs: string[];
}

/** Shunting-yard: raw tokens → RPN. Throws FormulaError on any malformation. */
export function compileFormula(src: string): CompiledFormula {
  if (!src.trim()) throw new FormulaError("Rumus kosong");
  const raw = tokenize(src);

  const out: Token[] = [];
  // Op stack entries: operators, "(" markers, or function frames
  const stack: (
    | { kind: "op"; op: string }
    | { kind: "lparen"; fn: string | null; args: number }
  )[] = [];
  const refs = new Set<string>();
  let prev: RawToken["kind"] | "start" = "start";

  const popOpsTo = (prec: number, rightAssoc: boolean) => {
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.kind !== "op") break;
      const info = OPS[top.op];
      if (info.prec > prec || (info.prec === prec && !rightAssoc)) {
        out.push({ kind: "op", op: top.op });
        stack.pop();
      } else break;
    }
  };

  for (let idx = 0; idx < raw.length; idx++) {
    const t = raw[idx];
    switch (t.kind) {
      case "num":
        if (prev === "num" || prev === "ref" || prev === "rparen")
          throw new FormulaError("Operator hilang sebelum angka");
        out.push({ kind: "num", value: t.value! });
        break;
      case "ref": {
        if (prev === "num" || prev === "ref" || prev === "rparen")
          throw new FormulaError("Operator hilang sebelum referensi");
        const name = normalizeRef(t.text);
        refs.add(name);
        out.push({ kind: "ref", name });
        break;
      }
      case "fnname": {
        const next = raw[idx + 1];
        if (!next || next.kind !== "lparen")
          throw new FormulaError(`Fungsi ${t.text} harus diikuti tanda kurung (`);
        stack.push({ kind: "lparen", fn: t.text, args: 1 });
        idx++; // consume the "("
        prev = "lparen";
        continue;
      }
      case "lparen":
        if (prev === "num" || prev === "ref" || prev === "rparen")
          throw new FormulaError("Operator hilang sebelum tanda kurung");
        stack.push({ kind: "lparen", fn: null, args: 1 });
        break;
      case "op": {
        const isUnary =
          t.text === "-" &&
          (prev === "start" || prev === "op" || prev === "lparen" || prev === "sep");
        if (t.text === "+" && (prev === "start" || prev === "op" || prev === "lparen" || prev === "sep")) {
          break; // unary plus is a no-op
        }
        if (isUnary) {
          stack.push({ kind: "op", op: "neg" });
        } else {
          if (prev === "start" || prev === "op" || prev === "lparen" || prev === "sep")
            throw new FormulaError(`Operator "${t.text}" tanpa operan kiri`);
          const info = OPS[t.text];
          popOpsTo(info.prec, info.rightAssoc);
          stack.push({ kind: "op", op: t.text });
        }
        break;
      }
      case "sep": {
        if (prev === "op" || prev === "lparen" || prev === "sep" || prev === "start")
          throw new FormulaError("Argumen kosong sebelum pemisah ;");
        while (stack.length > 0 && stack[stack.length - 1].kind === "op") {
          out.push({ kind: "op", op: (stack.pop() as { op: string }).op });
        }
        const frame = stack[stack.length - 1];
        if (!frame || frame.kind !== "lparen" || frame.fn === null)
          throw new FormulaError("Pemisah ; hanya berlaku di dalam fungsi");
        frame.args++;
        break;
      }
      case "rparen": {
        if (prev === "op" || prev === "sep")
          throw new FormulaError("Ekspresi belum selesai sebelum )");
        while (stack.length > 0 && stack[stack.length - 1].kind === "op") {
          out.push({ kind: "op", op: (stack.pop() as { op: string }).op });
        }
        const frame = stack.pop();
        if (!frame || frame.kind !== "lparen")
          throw new FormulaError("Tanda kurung ) tanpa pasangan");
        if (frame.fn !== null) {
          const arity = prev === "lparen" ? 0 : frame.args;
          const spec = FUNCTIONS[frame.fn];
          if (arity < spec.minArity || arity > spec.maxArity)
            throw new FormulaError(
              `Jumlah argumen ${frame.fn} salah (${arity}; harus ${spec.minArity}${spec.maxArity !== spec.minArity ? `–${spec.maxArity}` : ""})`
            );
          out.push({ kind: "fn", name: frame.fn, arity });
        }
        break;
      }
    }
    prev = t.kind;
  }

  if (prev === "op" || prev === "sep" || prev === "start")
    throw new FormulaError("Rumus berakhir di tengah ekspresi");
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.kind === "lparen") throw new FormulaError("Tanda kurung ( tidak ditutup");
    out.push({ kind: "op", op: top.op });
  }

  return { rpn: out, refs: [...refs] };
}

/** Evaluate a compiled formula. `vars` is keyed by normalized ref name;
 *  null/undefined values (tag has no data) throw FormulaError → #RUMUS!. */
export function evaluateFormula(
  compiled: CompiledFormula,
  vars: Record<string, number | null | undefined>
): number {
  const st: number[] = [];
  const pop = (): number => {
    const v = st.pop();
    if (v === undefined) throw new FormulaError("Ekspresi tidak lengkap");
    return v;
  };

  for (const t of compiled.rpn) {
    if (t.kind === "num") {
      st.push(t.value);
    } else if (t.kind === "ref") {
      const v = vars[t.name];
      if (v === null || v === undefined || Number.isNaN(v))
        throw new FormulaError(`Nilai [${t.name}] tidak tersedia`);
      st.push(v);
    } else if (t.kind === "op") {
      if (t.op === "neg") {
        st.push(-pop());
      } else {
        const b = pop();
        const a = pop();
        switch (t.op) {
          case "+": st.push(a + b); break;
          case "-": st.push(a - b); break;
          case "*": st.push(a * b); break;
          case "/":
            if (b === 0) throw new FormulaError("Pembagian dengan nol");
            st.push(a / b);
            break;
          case "^": st.push(Math.pow(a, b)); break;
        }
      }
    } else {
      const args: number[] = [];
      for (let i = 0; i < t.arity; i++) args.unshift(pop());
      switch (t.name) {
        case "ABS": st.push(Math.abs(args[0])); break;
        case "SQRT":
          if (args[0] < 0) throw new FormulaError("Akar dari bilangan negatif");
          st.push(Math.sqrt(args[0]));
          break;
        case "ROUND": {
          const n = args.length === 2 ? Math.trunc(args[1]) : 0;
          const f = Math.pow(10, n);
          st.push(Math.round(args[0] * f) / f);
          break;
        }
        case "MIN": st.push(Math.min(...args)); break;
        case "MAX": st.push(Math.max(...args)); break;
      }
    }
  }

  if (st.length !== 1) throw new FormulaError("Ekspresi tidak lengkap");
  const result = st[0];
  if (!Number.isFinite(result)) throw new FormulaError("Hasil bukan angka valid");
  return result;
}
