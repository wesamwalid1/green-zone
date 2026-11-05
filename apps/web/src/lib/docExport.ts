import { loadExcel } from './excel';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function triggerPrint() {
  window.dispatchEvent(new Event('beforeprint'));
  window.setTimeout(() => window.print(), 80);
}

function defaultPdfName() {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  return `Green-Zone-${day}.pdf`;
}

function resolvePdfTarget(): HTMLElement {
  const dualPrimary = document.querySelector<HTMLElement>('.print-sheet .dual-print-primary, .dual-print-primary');
  if (dualPrimary) return dualPrimary;

  const printSheet = document.querySelector<HTMLElement>('.print-sheet');
  if (printSheet) return printSheet;

  const statement = document.querySelector<HTMLElement>('.statement-sheet');
  if (statement) return statement;

  const main = document.querySelector<HTMLElement>('main');
  if (main) return main;

  return document.body;
}

/** تنزيل PDF فعلي للشاشة القابلة للطباعة (مش نافذة الطباعة) */
export async function triggerPdfSave(fileName = defaultPdfName()) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const target = resolvePdfTarget();
  document.body.classList.add('pdf-capture');
  const prevOverflow = target.style.overflow;
  const prevMaxHeight = target.style.maxHeight;
  const prevHeight = target.style.height;
  target.style.overflow = 'visible';
  target.style.maxHeight = 'none';
  target.style.height = 'auto';

  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: document.documentElement.scrollWidth,
      onclone: (doc) => {
        doc.body.classList.add('pdf-capture');
        doc.querySelectorAll('.no-print').forEach((el) => {
          (el as HTMLElement).style.setProperty('display', 'none', 'important');
        });
        doc.querySelectorAll('.print-header, .print-only').forEach((el) => {
          const node = el as HTMLElement;
          node.style.setProperty('display', 'flex', 'important');
          node.style.setProperty('visibility', 'visible', 'important');
        });
        doc.querySelectorAll('.dual-print-clone').forEach((el) => {
          (el as HTMLElement).style.setProperty('display', 'none', 'important');
        });
        doc.querySelectorAll('aside, nav').forEach((el) => {
          (el as HTMLElement).style.setProperty('display', 'none', 'important');
        });
        const clonedTarget = doc.querySelector('.print-sheet, .statement-sheet, .dual-print-primary, main') as HTMLElement | null;
        if (clonedTarget) {
          clonedTarget.style.overflow = 'visible';
          clonedTarget.style.maxHeight = 'none';
          clonedTarget.style.height = 'auto';
          clonedTarget.style.boxShadow = 'none';
          clonedTarget.style.borderRadius = '0';
        }
      },
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imgWidth = usableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= usableHeight;

    while (heightLeft > 2) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= usableHeight;
    }

    const safeName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    pdf.save(safeName);
  } finally {
    target.style.overflow = prevOverflow;
    target.style.maxHeight = prevMaxHeight;
    target.style.height = prevHeight;
    document.body.classList.remove('pdf-capture');
  }
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

/** يضيف لوجو Green Zone أعلى الشيت (يمين في وضع RTL) */
export async function stampBrandLogo(workbook: any, sheet: any) {
  const buffer = await brandLogoBuffer();
  if (!buffer) return;
  const imageId = workbook.addImage({ buffer, extension: 'png' });
  sheet.getRow(1).height = 48;
  sheet.addImage(imageId, {
    tl: { col: 0, row: 0 },
    ext: { width: 56, height: 56 },
  });
}

/** اتجاه عربي من اليمين لليسار + محاذاة يمين */
export function applyArabicSheetLayout(sheet: any) {
  sheet.views = [{ rightToLeft: true }];
  if (sheet.properties) sheet.properties.defaultColWidth = 16;
  const colCount = Math.max(sheet.columnCount || 0, sheet.actualColumnCount || 0, 1);
  for (let i = 1; i <= colCount; i += 1) {
    const col = sheet.getColumn(i);
    if (!col.width || col.width < 12) col.width = 16;
  }
  sheet.eachRow((row: any) => {
    row.eachCell((cell: any) => {
      cell.alignment = {
        ...(cell.alignment || {}),
        horizontal: 'right',
        vertical: 'middle',
        wrapText: true,
        readingOrder: 'rtl',
      };
    });
  });
}

/** تجهيز شيت عربي: RTL + لوجو + صفوف العلامة */
export async function prepareArabicSheet(workbook: any, sheet: any, opts?: { title?: string; brandRows?: boolean }) {
  sheet.views = [{ rightToLeft: true }];
  await stampBrandLogo(workbook, sheet);
  if (opts?.brandRows !== false) {
    const brand = sheet.addRow(['Green Zone', 'للأسمدة والكيماويات']);
    brand.font = { bold: true, size: 14, color: { argb: 'FF166534' } };
    if (opts?.title) {
      const titleRow = sheet.addRow([opts.title]);
      titleRow.font = { bold: true, size: 12 };
    }
    sheet.addRow([]);
  }
}

/** تطبيق RTL + لوجو على كل شيتات الورك بوك ثم تنزيل */
export async function finalizeArabicWorkbook(workbook: any, fileName: string, title = 'تقرير Green Zone') {
  const sheets: any[] = workbook.worksheets || [];
  for (const sheet of sheets) {
    const hasImage = (sheet.getImages?.() || []).length > 0;
    if (!hasImage) {
      sheet.spliceRows(1, 0, ['Green Zone', 'للأسمدة والكيماويات'], [title], []);
      await stampBrandLogo(workbook, sheet);
    }
    applyArabicSheetLayout(sheet);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  await downloadExcelBuffer(buffer as ArrayBuffer, fileName);
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
  sheet.views = [{ rightToLeft: true }];
  if (opts.withLogo !== false) await stampBrandLogo(workbook, sheet);
  sheet.addRow(['Green Zone', 'للأسمدة والكيماويات']);
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
  applyArabicSheetLayout(sheet);
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
  sheet.views = [{ rightToLeft: true }];
  await stampBrandLogo(workbook, sheet);
  sheet.addRow(['Green Zone', 'للأسمدة والكيماويات']);
  sheet.addRow([opts.title]);
  sheet.addRow([]);
  sheet.addRow(opts.headers);
  opts.rows.forEach((row) => sheet.addRow(row.map((cell) => cell ?? '')));
  applyArabicSheetLayout(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  await downloadExcelBuffer(buffer as ArrayBuffer, opts.fileName);
}
