// Reading a bank statement exported as CSV (Nubank account or card, Inter, or any file with
// a date, a description and an amount column) into entries the import endpoint takes.
// Everything happens in the browser: the file itself never goes to the server.

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// splits one CSV line, respecting "quoted, fields"
export function splitLine(line, sep) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cell);
      cell = '';
    } else cell += c;
  }
  out.push(cell);
  return out.map((v) => v.trim());
}

const DATE = ['data', 'date', 'data lancamento', 'data da transacao', 'data movimento'];
const TEXT = ['descricao', 'title', 'historico', 'description', 'lancamento', 'estabelecimento'];
const AMOUNT = ['valor', 'amount', 'valor (r$)', 'value'];

// "31/10/2026" or "2026-10-31" -> "2026-10-31"
export function readDate(text) {
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// "-1.234,56", "1234.56", "R$ -12,00" -> signed cents
export function readAmount(text) {
  let clean = text.replace(/R\$|\s/g, '');
  const negative = /^-|^\(.*\)$|-$/.test(clean);
  clean = clean.replace(/[-()]/g, '');
  const lastDot = clean.lastIndexOf('.');
  const lastComma = clean.lastIndexOf(',');
  if (lastComma > lastDot) clean = clean.replace(/\./g, '').replace(',', '.');
  else clean = clean.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return negative ? -cents : cents;
}

// words in a description that say which category it is
// shops first: "mercado livre" is a shop, not a market
const GUESS = [
  ['Shopping', ['amazon', 'mercado livre', 'mercadolivre', 'shopee', 'magalu', 'americanas', 'renner', 'riachuelo', 'zara', 'shein', 'aliexpress']],
  ['Food', ['ifood', 'restaurante', 'padaria', 'mercado', 'supermercado', 'pao de acucar', 'carrefour', 'assai', 'atacadao', 'lanche', 'pizza', 'burger', 'cafe', 'acougue', 'hortifruti', 'rappi']],
  ['Transport', ['uber', '99app', '99 ', 'posto', 'combustivel', 'shell', 'ipiranga', 'metro', 'bilhete unico', 'estacionamento', 'sem parar', 'pedagio', 'onibus']],
  ['Housing', ['aluguel', 'condominio', 'enel', 'sabesp', 'light', 'comgas', 'internet', 'vivo', 'claro', 'tim ', 'net ', 'iptu', 'agua', 'energia']],
  ['Health', ['farmacia', 'drogasil', 'droga raia', 'pague menos', 'unimed', 'amil', 'consulta', 'clinica', 'laboratorio', 'dentista', 'academia', 'smartfit']],
  ['Fun', ['netflix', 'spotify', 'cinema', 'ingresso', 'steam', 'playstation', 'xbox', 'disney', 'prime video', 'hbo', 'show', 'bar ']],
  ['Education', ['curso', 'udemy', 'alura', 'livraria', 'escola', 'faculdade', 'mensalidade']],
];
const INCOME = [['Salary', ['salario', 'folha', 'pagamento de salario', 'proventos']]];

export function guessCategory(description, kind) {
  const text = ` ${strip(description)} `;
  for (const [name, words] of kind === 'income' ? INCOME : GUESS) {
    if (words.some((w) => text.includes(w))) return name;
  }
  return 'Other';
}

// money moving between your own accounts or paying the card bill isn't spending
const SKIP = ['pagamento de fatura', 'pagamento recebido', 'saldo anterior', 'saldo do dia', 'resgate rdb', 'aplicacao rdb', 'transferencia entre contas'];

function columnOf(header, names) {
  return header.findIndex((h) => names.includes(strip(h)));
}

// same day, amount and description twice is two real purchases (two coffees), so the
// occurrence number goes into the id; importing the same file again finds the same ids
function idFor(day, cents, text, seen) {
  const key = `${day}|${cents}|${strip(text)}`;
  const n = (seen.get(key) || 0) + 1;
  seen.set(key, n);
  let h = 2166136261;
  for (const ch of `${key}|${n}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `bank:${day}:${h.toString(36)}`;
}

/**
 * Turns the text of a statement into { entries, skipped }. A card statement (Nubank's
 * date,title,amount) lists spending as positive numbers; an account statement as negative.
 */
export function readStatement(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  // the header is the first line that has a date column and an amount column (Inter puts
  // a few lines about the account before it)
  for (let start = 0; start < Math.min(lines.length, 15); start++) {
    const sep = (lines[start].match(/;/g) || []).length > (lines[start].match(/,/g) || []).length ? ';' : ',';
    const header = splitLine(lines[start], sep);
    const d = columnOf(header, DATE);
    const a = columnOf(header, AMOUNT);
    const t = columnOf(header, TEXT);
    if (d < 0 || a < 0) continue;

    const card = strip(header[d]) === 'date' && strip(header[t] || '') === 'title';
    const entries = [];
    let skipped = 0;
    const seen = new Map();
    for (const line of lines.slice(start + 1)) {
      const cells = splitLine(line, sep);
      const day = readDate(cells[d] || '');
      let cents = readAmount(cells[a] || '');
      const description = (t >= 0 ? cells[t] : '') || 'From the bank';
      if (!day || !cents || SKIP.some((w) => strip(description).includes(w))) { skipped++; continue; }
      if (card) cents = -cents;
      const kind = cents < 0 ? 'expense' : 'income';
      entries.push({
        id: idFor(day, cents, description, seen),
        type: kind,
        description: description.replace(/\s+/g, ' ').slice(0, 120),
        category: guessCategory(description, kind),
        amount: Math.abs(cents),
        date: day,
      });
    }
    return { entries, skipped };
  }
  throw new Error("Couldn't find the date and amount columns in that file. Is it the CSV from the bank?");
}
