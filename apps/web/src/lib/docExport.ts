import { loadExcel } from './excel';

export function triggerPrint() {
  window.setTimeout(() => window.print(), 50);
}

/** Opens the browser print dialog so the user can choose «Save as PDF». */
export function triggerPdfSave() {
  const previous = document.title;
  window.setTimeout(() => {
    window.print();
    document.title = previous;
  }, 50);
}

export async function downloadExcelBuffer(buffer: ArrayBuffer | Blob, fileName: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([buffer]));
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function brandLogoBuffer() {
  const res = await fetch('/green-zone-mark.png');
  if (!res.ok) return null;
  return res.arrayBuffer();
}

/** يضيف لوجو Green Zone أعلى الشيت */
export async function stampBrandLogo(
  workbook: { addImage: (img: { buffer: ArrayBuffer; extension: 'png' }) => number },
  sheet: {
    addImage: (id: number, range: { tl: { col: number; row: number }; ext: { width: number; height: number } }) => void;
    getRow: (n: number) => { height: number };
  },
) {
  const buffer = await brandLogoBuffer();
  if (!buffer) return;
  const imageId = workbook.addImage({ buffer, extension: 'png' });
  sheet.getRow(1).height = 48;
  sheet.addImage(imageId, {
    tl: { col: 0, row: 0 },
    ext: { width: 56, height: 56 },
  });
}

export type InvoiceExportLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  extra?: (string | number)[];
};

export async function exportInvoiceExcel(opts: {
  fileName: string;
  title: string;
  meta: [string, string | number][];
  lineHeaders?: string[];
  lines: InvoiceExportLine[];
  totals?: [string, string | number][];
  withLogo?: boolean;
}) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الفاتورة');
  if (opts.withLogo !== false) await stampBrandLogo(workbook, sheet);
  sheet.addRow(['Green Zone']);
  sheet.addRow([opts.title]);
  sheet.addRow([]);
  opts.meta.forEach(([label, value]) => sheet.addRow([label, value]));
  sheet.addRow([]);
  const headers = opts.lineHeaders || ['الصنف', 'الكمية', 'السعر', 'الإجمالي'];
  sheet.addRow(headers);
  opts.lines.forEach((line) => {
    sheet.addRow([line.name, line.quantity, line.unitPrice, line.total, ...(line.extra || [])]);
  });
  if (opts.totals?.length) {
    sheet.addRow([]);
    opts.totals.forEach(([label, value]) => sheet.addRow([label, value]));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  await downloadExcelBuffer(buffer as ArrayBuffer, opts.fileName);
}

export async function exportTableExcel(opts: {
  fileName: string;
  sheetName: string;
  title: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(opts.sheetName);
  await stampBrandLogo(workbook, sheet);
  sheet.addRow(['Green Zone']);
  sheet.addRow([opts.title]);
  sheet.addRow([]);
  sheet.addRow(opts.headers);
  opts.rows.forEach((row) => sheet.addRow(row.map((cell) => cell ?? '')));
  const buffer = await workbook.xlsx.writeBuffer();
  await downloadExcelBuffer(buffer as ArrayBuffer, opts.fileName);
}
