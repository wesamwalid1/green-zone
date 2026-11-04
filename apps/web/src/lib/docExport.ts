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
}) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الفاتورة');
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
