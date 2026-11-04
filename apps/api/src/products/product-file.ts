import { BadRequestException } from '@nestjs/common';
async function loadExcel() {
  return import('exceljs');
}
import mammoth from 'mammoth';

function ensurePdfGlobals() {
  const globals = globalThis as unknown as Record<string, unknown>;
  if (!globals.DOMMatrix) globals.DOMMatrix = class DOMMatrix {};
  if (!globals.ImageData) globals.ImageData = class ImageData {};
  if (!globals.Path2D) globals.Path2D = class Path2D {};
}

export type ImportRow = {
  sku?: string;
  name?: string;
  unit?: string;
  salePrice?: number;
  minStock?: number;
  barcode?: string;
};

const FIELDS = ['sku', 'name', 'unit', 'salePrice', 'minStock', 'barcode'] as const;
type Field = (typeof FIELDS)[number];

const ALIASES: Record<Field, string[]> = {
  sku: ['sku', 'code', 'كود', 'الكود', 'كود الصنف', 'رمز'],
  name: ['name', 'الاسم', 'اسم', 'اسم الصنف', 'الصنف', 'المنتج', 'product'],
  unit: ['unit', 'الوحدة', 'وحدة'],
  salePrice: ['saleprice', 'price', 'سعر', 'سعر البيع', 'السعر'],
  minStock: ['minstock', 'الحد', 'حد الطلب', 'الحد الأدنى', 'الحد الادنى'],
  barcode: ['barcode', 'الباركود', 'باركود'],
};

function norm(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s_\-./]+/g, '');
}

function fieldFor(header: string): Field | null {
  const key = norm(header);
  if (!key) return null;
  return FIELDS.find((field) => ALIASES[field].some((alias) => norm(alias) === key)) || null;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(record.richText)) return record.richText.map((part) => part.text).join('').trim();
    if (record.result != null) return cellText(record.result);
    if (record.text) return String(record.text).trim();
  }
  return String(value).trim();
}

function toNumber(value: string) {
  const digits = value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const cleaned = digits.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  if (cleaned.includes(',') && !cleaned.includes('.')) return Number(cleaned.replace(',', '.')) || 0;
  return Number(cleaned.replace(/,/g, '')) || 0;
}

function gridToRows(grid: string[][]): ImportRow[] {
  const cleaned = grid
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  if (!cleaned.length) return [];
  const headerMap = cleaned[0].map(fieldFor);
  const hasHeader = headerMap.includes('sku') && headerMap.includes('name');
  const body = hasHeader ? cleaned.slice(1) : cleaned.filter((row) => row.filter(Boolean).length >= 2);
  return body.map((cells) => {
    const pick = (field: Field, position: number) => {
      if (!hasHeader) return cells[position] || '';
      const index = headerMap.indexOf(field);
      return index >= 0 ? cells[index] || '' : '';
    };
    return {
      sku: pick('sku', 0),
      name: pick('name', 1),
      unit: pick('unit', 2),
      salePrice: toNumber(pick('salePrice', 3)),
      minStock: toNumber(pick('minStock', 4)),
      barcode: pick('barcode', 5),
    };
  }).filter((row) => row.sku || row.name).slice(0, 2000);
}

function parseCsv(text: string) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) {
        cells.push(current.trim());
        current = '';
      } else current += char;
    }
    cells.push(current.trim());
    return cells;
  });
}

function splitLine(line: string) {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  if (line.includes('|')) return line.split('|').map((cell) => cell.trim()).filter(Boolean);
  if (line.includes(';')) return line.split(';').map((cell) => cell.trim());
  if (line.includes(',')) return line.split(',').map((cell) => cell.trim());
  const wide = line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
  return wide.length >= 2 ? wide : [line.trim()];
}

function linesToRows(text: string) {
  const grid = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(splitLine);
  return gridToRows(grid);
}

function tablesFromHtml(html: string) {
  const tables: string[][][] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const rows: string[][] = [];
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) =>
        match[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
      );
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

async function rowsFromExcel(buffer: Buffer) {
  const ExcelJS = await loadExcel();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    throw new BadRequestException('تعذر قراءة ملف الإكسل');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const table: string[][] = [];
  sheet.eachRow((row) => {
    const values = row.values as unknown[];
    table.push(values.slice(1).map(cellText));
  });
  return gridToRows(table);
}

async function rowsFromDocx(buffer: Buffer) {
  let html: { value: string };
  try {
    html = await mammoth.convertToHtml({ buffer });
  } catch {
    throw new BadRequestException('تعذر قراءة ملف الوورد. احفظه بصيغة docx');
  }
  const tables = tablesFromHtml(html.value).flatMap(gridToRows);
  if (tables.length) return tables.slice(0, 2000);
  const text = await mammoth.extractRawText({ buffer });
  return linesToRows(text.value || '');
}

async function rowsFromPdf(buffer: Buffer) {
  ensurePdfGlobals();
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const tables = await parser.getTable();
    const fromTables = tables.mergedTables.flatMap((table) => gridToRows(table));
    if (fromTables.some((row) => row.sku?.trim() && row.name?.trim())) return fromTables.slice(0, 2000);
    const text = await parser.getText();
    return linesToRows(text.text || '');
  } catch {
    throw new BadRequestException('تعذر قراءة ملف PDF. الملف لازم يحتوي نصًا قابلًا للتحديد، مش صورة ممسوحة.');
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export async function rowsFromProductFile(buffer: Buffer, filename: string) {
  const name = filename.toLowerCase();
  let rows: ImportRow[] = [];
  if (name.endsWith('.csv')) rows = gridToRows(parseCsv(buffer.toString('utf8')));
  else if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) rows = await rowsFromExcel(buffer);
  else if (name.endsWith('.xls')) throw new BadRequestException('احفظ ملف الإكسل بصيغة xlsx ثم أعد رفعه');
  else if (name.endsWith('.docx')) rows = await rowsFromDocx(buffer);
  else if (name.endsWith('.doc')) throw new BadRequestException('احفظ ملف الوورد بصيغة docx ثم أعد رفعه');
  else if (name.endsWith('.pdf')) rows = await rowsFromPdf(buffer);
  else throw new BadRequestException('الملف لازم يكون إكسل أو وورد أو PDF');
  if (!rows.some((row) => row.sku?.trim() && row.name?.trim())) {
    throw new BadRequestException('لم أجد أصنافًا في الملف. لازم يكون فيه كود واسم داخل جدول أو صفوف.');
  }
  return rows;
}
