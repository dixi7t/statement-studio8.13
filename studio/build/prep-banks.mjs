// Turns Intuit's public financial-institution directory (fidir.txt, the list
// Quicken downloads from ofx-prod-filist.intuit.com) into the compact list
// Statement Studio embeds:  [[id, name, flags], ...]
//
// flags (bitmask):  1 = banking accounts, 2 = credit cards,
//                   4 = Web Connect (.qbo / .qfx file import)
//
// Usage: node prep-banks.mjs <fidir.txt> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node prep-banks.mjs <fidir.txt> <out.json>');
  process.exit(1);
}

// The file is Windows-1252 (curly apostrophes etc.).
const text = new TextDecoder('windows-1252').decode(readFileSync(src));
const lines = text.split(/\r?\n/);
if (lines[0].trim() !== 'FILIST') throw new Error('Not an Intuit FILIST file');
const declared = parseInt(lines[1], 10);

const seen = new Set();
const banks = [];
for (const line of lines.slice(2)) {
  if (!line.trim()) continue;
  const c = line.split('\t');
  if (c.length < 12) continue;
  const id = c[0].trim();
  const name = c[3].replace(/\s+/g, ' ').trim();
  const status = c[7].trim();
  const services = c[11].toUpperCase();
  if (!/^\d{1,7}$/.test(id) || !name || status !== 'ACTIVE') continue;
  const key = id + '|' + name.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  let flags = 0;
  if (/\bBANKING\b/.test(services)) flags |= 1;
  if (/\bCREDIT\b/.test(services)) flags |= 2;
  if (/EXP-WEB-CONNECT/.test(services)) flags |= 4;
  banks.push([id, name, flags]);
}

banks.sort((a, b) => a[1].localeCompare(b[1], 'en', { sensitivity: 'base' }));
writeFileSync(out, JSON.stringify(banks));
console.log(`declared ${declared}, kept ${banks.length}, web-connect ${banks.filter((b) => b[2] & 4).length}`);
