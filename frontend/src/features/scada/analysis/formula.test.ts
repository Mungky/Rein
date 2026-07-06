/** bun test — safe formula engine (the workbench's core guarantee). */

import { describe, expect, test } from "bun:test";
import { FormulaError, compileFormula, evaluateFormula } from "./formula";

function evl(src: string, vars: Record<string, number | null> = {}): number {
  return evaluateFormula(compileFormula(src), vars);
}

describe("aritmetika dasar", () => {
  test("presedensi: 2+3*4 = 14", () => expect(evl("2+3*4")).toBe(14));
  test("kurung: (2+3)*4 = 20", () => expect(evl("(2+3)*4")).toBe(20));
  test("pangkat kanan-asosiatif: 2^3^2 = 512", () => expect(evl("2^3^2")).toBe(512));
  test("unary minus ala Excel: -2^2 = 4", () => expect(evl("-2^2")).toBe(4));
  test("desimal: 0.5*4 = 2", () => expect(evl("0.5*4")).toBe(2));
  test("unary di dalam ekspresi: 3*-2 = -6", () => expect(evl("3*-2")).toBe(-6));
});

describe("fungsi", () => {
  test("ABS(-5) = 5", () => expect(evl("ABS(-5)")).toBe(5));
  test("SQRT(16) = 4", () => expect(evl("SQRT(16)")).toBe(4));
  test("ROUND satu argumen: ROUND(2.7) = 3", () => expect(evl("ROUND(2.7)")).toBe(3));
  test("ROUND dua argumen dengan ;: ROUND(2.345; 2) = 2.35", () =>
    expect(evl("ROUND(2.345; 2)")).toBe(2.35));
  test("koma juga diterima sebagai pemisah", () =>
    expect(evl("ROUND(2.345, 2)")).toBe(2.35));
  test("MIN/MAX variadik", () => {
    expect(evl("MIN(3; 1; 2)")).toBe(1);
    expect(evl("MAX(3; 1; 2)")).toBe(3);
  });
  test("fungsi bersarang: MAX(ABS(-3); SQRT(4)) = 3", () =>
    expect(evl("MAX(ABS(-3); SQRT(4))")).toBe(3));
  test("nama fungsi case-insensitive", () => expect(evl("abs(-1)")).toBe(1));
});

describe("referensi kolom", () => {
  test("[Terkini] * 24 / 1000", () =>
    expect(evl("[Terkini] * 24 / 1000", { terkini: 75 })).toBe(1.8));
  test("referensi case/spasi-insensitive", () =>
    expect(evl("[ TERKINI ]", { terkini: 5 })).toBe(5));
  test("daftar refs terkumpul dinormalisasi", () => {
    const c = compileFormula("[Maks] - [Min]");
    expect(c.refs.sort()).toEqual(["maks", "min"]);
  });
  test("referensi tak tersedia → FormulaError", () =>
    expect(() => evl("[Terkini]", {})).toThrow(FormulaError));
  test("nilai null (tag tanpa data) → FormulaError", () =>
    expect(() => evl("[Terkini]", { terkini: null })).toThrow(FormulaError));
});

describe("error rumus", () => {
  test.each([
    ["", "kosong"],
    ["2+", "berakhir di operator"],
    ["*3", "operator tanpa operan kiri"],
    ["(2+3", "kurung tidak ditutup"],
    ["2+3)", "kurung tanpa pasangan"],
    ["[Terkini", "referensi tidak ditutup"],
    ["FOO(1)", "fungsi tak dikenal"],
    ["ROUND(1; 2; 3)", "arity salah"],
    ["ROUND()", "arity nol"],
    ["2 3", "operator hilang"],
    ["1 @ 2", "karakter tak dikenal"],
    ["MIN(;2)", "argumen kosong"],
  ])("%s → FormulaError (%s)", (src: string) => {
    expect(() => evl(src, { terkini: 1 })).toThrow(FormulaError);
  });
  test("pembagian nol → FormulaError", () =>
    expect(() => evl("1/0")).toThrow(FormulaError));
  test("akar negatif → FormulaError", () =>
    expect(() => evl("SQRT(-1)")).toThrow(FormulaError));
});
