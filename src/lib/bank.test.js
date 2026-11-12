import { describe, expect, it } from 'vitest';
import { guessCategory, readAmount, readDate, readStatement, splitLine } from './bank';

describe('reading a bank statement', () => {
  it('reads the Nubank account CSV', () => {
    const { entries, skipped } = readStatement([
      'Data,Valor,Identificador,Descrição',
      '05/11/2026,-32.90,a1,Compra no débito - iFood',
      '05/11/2026,5200.00,a2,Transferência recebida - Pagamento de salário',
      '06/11/2026,-1450.00,a3,Pagamento de boleto - Aluguel Apto 12',
      '07/11/2026,-800.00,a4,Aplicação RDB',
    ].join('\n'));
    expect(skipped).toBe(1);
    expect(entries.map((e) => [e.type, e.amount, e.category, e.date])).toEqual([
      ['expense', 3290, 'Food', '2026-11-05'],
      ['income', 520000, 'Salary', '2026-11-05'],
      ['expense', 145000, 'Housing', '2026-11-06'],
    ]);
  });

  it('reads the Nubank card CSV, where spending is positive', () => {
    const { entries, skipped } = readStatement([
      'date,title,amount',
      '2026-11-02,Uber *Trip,23.45',
      '2026-11-03,Netflix.com,55.90',
      '2026-11-04,Pagamento recebido,-1200.00',
      '2026-11-05,Estorno Amazon,-40.00',
    ].join('\n'));
    expect(skipped).toBe(1);
    expect(entries.map((e) => [e.type, e.amount, e.category])).toEqual([
      ['expense', 2345, 'Transport'],
      ['expense', 5590, 'Fun'],
      ['income', 4000, 'Other'],
    ]);
  });

  it('reads Inter, with semicolons, Brazilian numbers and lines before the header', () => {
    const { entries } = readStatement([
      'Extrato Conta Corrente',
      'Conta ;12345-6',
      'Período ;01/11/2026 a 10/11/2026',
      '',
      'Data Lançamento;Descrição;Valor;Saldo',
      '08/11/2026;Pix enviado: "Drogasil 123";-1.234,56;3.000,00',
      '09/11/2026;Pix recebido: Cliente X;2.500,00;5.500,00',
    ].join('\r\n'));
    expect(entries.map((e) => [e.type, e.amount, e.category, e.description])).toEqual([
      ['expense', 123456, 'Health', 'Pix enviado: Drogasil 123'],
      ['income', 250000, 'Other', 'Pix recebido: Cliente X'],
    ]);
  });

  it('gives the same ids to the same file, and two equal coffees two ids', () => {
    const text = 'date,title,amount\n2026-11-02,Cafe Lua,8.00\n2026-11-02,Cafe Lua,8.00\n';
    const first = readStatement(text).entries.map((e) => e.id);
    expect(new Set(first).size).toBe(2);
    expect(readStatement(text).entries.map((e) => e.id)).toEqual(first);
  });

  it('says so when the file is not a statement', () => {
    expect(() => readStatement('name,email\nAna,ana@example.com')).toThrow(/date and amount/);
  });

  it('reads the pieces', () => {
    expect(splitLine('a,"b, c",d', ',')).toEqual(['a', 'b, c', 'd']);
    expect(readDate('31/10/2026')).toBe('2026-10-31');
    expect(readDate('2026-10-31T00:00')).toBe('2026-10-31');
    expect(readDate('ontem')).toBeNull();
    expect(readAmount('R$ -12,00')).toBe(-1200);
    expect(readAmount('1,234.56')).toBe(123456);
    expect(readAmount('abc')).toBeNull();
    expect(guessCategory('MERCADO LIVRE*LOJA', 'expense')).toBe('Shopping');
    expect(guessCategory('Padaria São João', 'expense')).toBe('Food');
  });
});
