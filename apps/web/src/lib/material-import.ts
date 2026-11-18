import { materialFieldsSchema, type MaterialInput, type MaterialStatus } from '@rein/shared';

type Cell = string | number | boolean | Date | DateConstructor | null;
export interface MaterialSheet {
  sheet: string;
  data: Cell[][];
}
export interface MaterialPreview {
  rows: MaterialInput[];
  errors: string[];
  sheets: string[];
}
const text = (v: Cell | undefined) => (v == null ? '' : String(v).trim());
const heading = (v: Cell | undefined) =>
  text(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function materialPreview(sheets: MaterialSheet[]): MaterialPreview {
  const result: MaterialPreview = { rows: [], errors: [], sheets: [] };
  for (const sheet of sheets) {
    const headerAt = sheet.data.findIndex(
      (r) =>
        r.some((v) => heading(v) === 'description') &&
        r.some((v) => ['qty', 'quantity'].includes(heading(v))),
    );
    if (headerAt < 0) continue;
    result.sheets.push(sheet.sheet);
    const header = sheet.data[headerAt]!.map(heading);
    const column = (...names: string[]) => header.findIndex((v) => names.includes(v));
    const qty = column('qty', 'quantity');
    const description = column('description');
    const partNo =
      header.lastIndexOf('partno') >= 0 ? header.lastIndexOf('partno') : column('partnumber');
    const material = column('material');
    const specification = column(
      'sizeorspecification',
      'sizeorspesification',
      'specification',
      'spesifikasi',
      'size',
    );
    const unit = column('unit', 'satuan');
    const status = column('status');
    const stock = column('stock', 'instock');
    const po = column('po');
    const received = column('received', 'recieved', 'recived', 'receivedat', 'tanggalditerima');
    const note = column('note', 'notes', 'catatan');
    for (let i = headerAt + 1; i < sheet.data.length; i++) {
      const r = sheet.data[i]!;
      // Group headings and blank template rows have neither description nor QTY.
      if (!text(r[description]) && !text(r[qty])) continue;
      const at = `${sheet.sheet}, baris ${i + 1}`;
      const rawQty = text(r[qty]).replace(',', '.');
      const combined = /^(\d+(?:\.\d+)?)(?:\s+(.+))?$/.exec(rawQty);
      const quantity = combined ? Number(combined[1]) : NaN;
      const unitCell = text(r[unit >= 0 ? unit : qty + 1]);
      if (unitCell && combined?.[2] && unitCell.toLowerCase() !== combined[2].toLowerCase()) {
        result.errors.push(`${at}: satuan di QTY berbeda dari kolom satuan`);
        continue;
      }
      const rawStatus = heading(r[status]);
      let materialStatus: MaterialStatus = 'not_available';
      if (rawStatus) {
        if (['instock', 'stock', 'tersedia'].includes(rawStatus)) materialStatus = 'in_stock';
        else if (['notavailable', 'tidaktersedia'].includes(rawStatus))
          materialStatus = 'not_available';
        else if (rawStatus === 'po') materialStatus = 'po';
        else {
          result.errors.push(`${at}: status material tidak dikenal (${text(r[status])})`);
          continue;
        }
      } else if (Number(r[stock]) > 0 || ['yes', 'ada', 'instock'].includes(heading(r[stock])))
        materialStatus = 'in_stock';
      else if (text(r[po])) materialStatus = 'po';
      let receivedAt: string | null = null;
      const rawReceived = r[received];
      if (rawReceived != null && text(rawReceived)) {
        if (rawReceived instanceof Date && !Number.isNaN(rawReceived.getTime()))
          receivedAt = rawReceived.toISOString().slice(0, 10);
        else {
          const raw = text(rawReceived);
          const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
          receivedAt = dmy
            ? `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`
            : raw;
        }
      }
      const parsed = materialFieldsSchema.safeParse({
        partNo: text(r[partNo]),
        description: text(r[description]),
        material: text(r[material]),
        specification: text(r[specification]),
        quantity,
        unit: unitCell || combined?.[2] || '',
        status: materialStatus,
        receivedAt,
        note: text(r[note]),
      });
      if (!parsed.success)
        result.errors.push(
          `${at}: ${parsed.error.issues.map((v) => `${v.path.join('.')}: ${v.message}`).join('; ')}`,
        );
      else result.rows.push(parsed.data);
      if (result.rows.length > 500) {
        result.errors.push('Maksimal 500 material per impor. Pisahkan file terlebih dahulu.');
        return result;
      }
    }
  }
  if (!result.sheets.length)
    result.errors.push(
      'Header Description dan QTY tidak ditemukan. Gunakan format material list contoh.',
    );
  else if (!result.rows.length && !result.errors.length)
    result.errors.push('Tidak ada baris material yang dapat diimpor.');
  return result;
}
