// Writes made-up test files: a one-page text PDF statement and a bank CSV.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'files');
mkdirSync(dir, { recursive: true });

// ---- PDF ----
const lines = [];   // [x, y, size, text]
const T = (x, y, s, t) => lines.push([x, y, s, t]);
T(50, 750, 16, 'Chase');
T(50, 732, 9, 'JPMorgan Chase Bank, N.A.  P O Box 182051  Columbus, OH 43218');
T(50, 700, 10, 'SAMPLE TEST COMPANY LLC');
T(350, 700, 10, 'Account Number: 000123456789');
T(350, 686, 10, 'January 1, 2026 through January 31, 2026');
T(50, 650, 12, 'CHECKING SUMMARY');
T(50, 632, 10, 'Beginning Balance');      T(400, 632, 10, '$5,000.00');
T(50, 618, 10, 'Deposits and Additions');  T(400, 618, 10, '3,250.00');
T(50, 604, 10, 'Electronic Withdrawals');  T(400, 604, 10, '-587.32');
T(50, 590, 10, 'Ending Balance');          T(400, 590, 10, '$7,662.68');
T(50, 555, 12, 'TRANSACTION DETAIL');
T(50, 537, 9, 'DATE'); T(95, 537, 9, 'DESCRIPTION'); T(430, 537, 9, 'AMOUNT'); T(500, 537, 9, 'BALANCE');
T(95, 522, 9, 'Beginning Balance'); T(500, 522, 9, '$5,000.00');
const rows = [
  ['01/03', 'Card Purchase 01/02 Amazon Mktp US*2K4AB1C23 Amzn.com/bill WA Card 1234', '-45.67', '4,954.33'],
  ['01/05', 'Payroll Direct Deposit ACME CORP PPD ID: 1234567890', '2,500.00', '7,454.33'],
  ['01/09', 'Card Purchase 01/08 Starbucks Store 12345 Seattle WA Card 1234', '-6.25', '7,448.08'],
  ['01/12', 'Zelle Payment To John Smith 123456789', '-200.00', '7,248.08'],
  ['01/15', 'Check # 1001', '-300.00', '6,948.08'],
  ['01/20', 'Card Purchase 01/19 Amazon Mktp US*9XY12Z3 Amzn.com/bill WA Card 1234', '-23.40', '6,924.68'],
  ['01/25', 'Deposit 4471', '750.00', '7,674.68'],
  ['01/28', 'Monthly Service Fee', '-12.00', '7,662.68'],
];
let y = 507;
for (const [d, desc, amt, bal] of rows) {
  T(50, y, 9, d); T(95, y, 9, desc);
  T(470 - amt.length * 4.6, y, 9, amt); T(500, y, 9, bal);
  y -= 15;
}
T(95, y, 9, 'Ending Balance'); T(500, y, 9, '$7,662.68');

const escPdf = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const content = lines.map(([x, yy, s, t]) => `BT /F1 ${s} Tf ${x} ${yy} Td (${escPdf(t)}) Tj ET`).join('\n');
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
];
let pdf = '%PDF-1.4\n';
const offs = [];
objs.forEach((o, i) => { offs.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(join(dir, 'test-chase-jan2026.pdf'), pdf, 'latin1');

// ---- CSV with headers the automatic mapper gets wrong ----
// "Posting Date" is a date, but "Details" is DEBIT/CREDIT and "Description" is the text;
// the automatic mapper reads "Details" as the description.
const csv = [
  'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
  'DEBIT,01/03/2026,"AMAZON MKTP US*2K4AB1C23 AMZN.COM/BILL WA",-45.67,DEBIT_CARD,4954.33,',
  'CREDIT,01/05/2026,"ACME CORP PAYROLL PPD ID: 1234567890",2500.00,ACH_CREDIT,7454.33,',
  'DEBIT,01/09/2026,"STARBUCKS STORE 12345 SEATTLE WA",-6.25,DEBIT_CARD,7448.08,',
  'CHECK,01/15/2026,"CHECK 1001",-300.00,CHECK_PAID,7148.08,1001',
].join('\r\n') + '\r\n';
writeFileSync(join(dir, 'test-bank-export.csv'), csv);
console.log('written to', dir);
