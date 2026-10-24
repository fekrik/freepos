import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCents } from '@freshpos/shared';

interface ParsedRow {
  name: string;
  brand?: string;
  department?: string;
  price: number; // in cents
  cost?: number;
  soldBy: 'each' | 'weight';
  plu?: string;
  barcodes: string[];
  snapEligible: boolean;
  minAge?: number;
  depositCents?: number;
}

interface Props {
  onClose: () => void;
  onImportCompleted: (count: { created: number; updated: number; total: number }) => void;
}

const SAMPLE_CSV = `Name,Brand,Department,Price,SoldBy,UPC,PLU,SNAP_Eligible,Min_Age,Deposit
Honeycrisp Apples,Stemilt,Produce,2.99,weight,,3283,yes,,
Organic Whole Milk 1 Gal,Horizon Organic,Dairy,5.49,each,070000000215,,yes,,
Artisan Ciabatta Bread,Fresh Bakery,Bakery,3.99,each,070000000222,,yes,,
Sparkling Water 12pk,LaCroix,Beverages,5.99,each,070000000239,,yes,,0.60
Grass-Fed Ground Beef 1lb,Organic Prairie,Meat,7.99,each,070000000246,,yes,,
IPA Craft Ale 6pk,Sierra Nevada,Beer & Wine,11.99,each,070000000253,,no,21,0.30
Paper Towels 6pk,Bounty,Household,12.49,each,070000000260,,no,,
Almond Butter 16oz,Justin's,Pantry,6.99,each,070000000277,,yes,,`;

// RFC 4180 CSV line parser supporting quoted values with commas
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  for (const line of rawLines) {
    const row: string[] = [];
    let insideQuotes = false;
    let current = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    lines.push(row);
  }
  return lines;
}

export function CsvImportModal({ onClose, onImportCompleted }: Props) {
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importedStats, setImportedStats] = useState<{ created: number; updated: number; total: number } | null>(null);

  function processCsv(raw: string) {
    setError('');
    const grid = parseCSV(raw);
    if (grid.length < 2) {
      setError('CSV must contain a header row and at least one product row.');
      setParsedRows([]);
      return;
    }

    const headers = grid[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const rows: ParsedRow[] = [];

    const nameIdx = headers.findIndex((h) => h.includes('name') || h.includes('title') || h.includes('desc'));
    const brandIdx = headers.findIndex((h) => h.includes('brand'));
    const deptIdx = headers.findIndex((h) => h.includes('dept') || h.includes('category'));
    const priceIdx = headers.findIndex((h) => h.includes('price') || h.includes('msrp') || h.includes('srp') || h.includes('retail'));
    const costIdx = headers.findIndex((h) => h.includes('cost'));
    const soldByIdx = headers.findIndex((h) => h.includes('soldby') || h.includes('unit'));
    const upcIdx = headers.findIndex((h) => h.includes('upc') || h.includes('barcode') || h.includes('gtin'));
    const pluIdx = headers.findIndex((h) => h.includes('plu'));
    const snapIdx = headers.findIndex((h) => h.includes('snap') || h.includes('ebt'));
    const ageIdx = headers.findIndex((h) => h.includes('age'));
    const depIdx = headers.findIndex((h) => h.includes('deposit') || h.includes('crv'));

    if (nameIdx === -1 || priceIdx === -1) {
      setError('CSV must contain at least "Name" and "Price" columns.');
      setParsedRows([]);
      return;
    }

    for (let i = 1; i < grid.length; i++) {
      const col = grid[i];
      const name = nameIdx !== -1 && col[nameIdx] ? col[nameIdx] : '';
      if (!name) continue;

      const rawPrice = (priceIdx !== -1 && col[priceIdx] ? col[priceIdx] : '0').replace(/[^0-9.]/g, '') || '0';
      const priceCents = Math.round(parseFloat(rawPrice) * 100);

      const rawCost = costIdx !== -1 && col[costIdx] ? col[costIdx].replace(/[^0-9.]/g, '') : null;
      const costCents = rawCost ? Math.round(parseFloat(rawCost) * 100) : undefined;

      const rawSoldBy = (soldByIdx !== -1 && col[soldByIdx] ? col[soldByIdx] : '').toLowerCase();
      const soldBy: 'each' | 'weight' = rawSoldBy.includes('lb') || rawSoldBy.includes('weight') ? 'weight' : 'each';

      const rawBarcodes = upcIdx !== -1 && col[upcIdx] ? col[upcIdx].split(/[;|\s]+/).map((b) => b.trim()).filter(Boolean) : [];
      const plu = pluIdx !== -1 && col[pluIdx] ? col[pluIdx].trim() : undefined;

      const rawSnap = (snapIdx !== -1 && col[snapIdx] ? col[snapIdx] : '').toLowerCase();
      const snapEligible = rawSnap === 'yes' || rawSnap === 'true' || rawSnap === '1' || rawSnap === 'y';

      const rawAge = ageIdx !== -1 && col[ageIdx] ? parseInt(col[ageIdx], 10) : undefined;
      const minAge = rawAge && rawAge >= 18 ? rawAge : undefined;

      const rawDep = depIdx !== -1 && col[depIdx] ? col[depIdx].replace(/[^0-9.]/g, '') : null;
      const depositCents = rawDep ? Math.round(parseFloat(rawDep) * 100) : undefined;

      rows.push({
        name,
        brand: brandIdx !== -1 && col[brandIdx] ? col[brandIdx] : undefined,
        department: deptIdx !== -1 && col[deptIdx] ? col[deptIdx] : undefined,
        price: priceCents,
        cost: costCents,
        soldBy,
        barcodes: rawBarcodes,
        plu,
        snapEligible,
        minAge,
        depositCents,
      });
    }

    setParsedRows(rows);
  }

  // Parse initial template on mount
  useEffect(() => {
    processCsv(csvText);
  }, []);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      processCsv(text);
    };
    reader.readAsText(file);
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'freshpos_sample_supermarket_catalog.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    if (parsedRows.length === 0) {
      setError('No valid product rows to import.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await api<{ created: number; updated: number; total: number }>(
        '/products/bulk-import',
        {
          method: 'POST',
          json: { items: parsedRows },
        },
      );
      setImportedStats(res);
      setTimeout(() => {
        onImportCompleted(res);
      }, 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass modal animate-in"
        style={{ width: 'min(840px, 96vw)', maxHeight: '92vh', overflowY: 'auto', padding: '1.75rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.35rem', margin: 0 }}>📥 Bulk Product CSV Import</h2>
            <div className="muted" style={{ fontSize: '.85rem', marginTop: '.25rem' }}>
              Upload or paste distributor spreadsheets with prices, barcodes, PLUs, and SNAP flags
            </div>
          </div>
          <button className="btn" style={{ padding: '.3rem .6rem' }} onClick={onClose} disabled={submitting}>✕</button>
        </div>

        {/* Action bar: Upload File or Download Template */}
        <div style={{ display: 'flex', gap: '.8rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.4rem' }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer', margin: 0, fontSize: '.85rem' }}>
            📁 Select CSV File
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFileUpload} />
          </label>
          <button type="button" className="btn" style={{ fontSize: '.85rem' }} onClick={downloadSample}>
            📄 Download CSV Template
          </button>
          <button
            type="button"
            className="btn"
            style={{ fontSize: '.85rem' }}
            onClick={() => { setCsvText(SAMPLE_CSV); processCsv(SAMPLE_CSV); }}
          >
            Load Sample Catalog
          </button>
        </div>

        {/* CSV Text Area */}
        <div>
          <label style={{ fontSize: '.85rem', fontWeight: 600 }}>
            CSV Data (Edit or Paste directly from Excel / Sheets):
          </label>
          <textarea
            className="input mono"
            style={{ height: 110, width: '100%', fontSize: '.8rem', resize: 'vertical', marginTop: '.3rem' }}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              processCsv(e.target.value);
            }}
          />
        </div>

        {/* Live Preview Table */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
            <div style={{ fontSize: '.9rem', fontWeight: 700 }}>
              Preview: <span style={{ color: 'var(--brand)' }}>{parsedRows.length} Products Ready to Import</span>
            </div>
            <div className="muted" style={{ fontSize: '.8rem' }}>
              Existing barcodes/PLUs will be updated; new items will be created
            </div>
          </div>

          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
            <table style={{ fontSize: '.82rem', width: '100%' }}>
              <thead>
                <tr style={{ background: 'hsla(160, 10%, 15%, 0.8)' }}>
                  <th>Name</th>
                  <th>Dept</th>
                  <th>Sold By</th>
                  <th>Price</th>
                  <th>Barcode / PLU</th>
                  <th>SNAP</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <b>{r.name}</b>
                      {r.brand && <span className="muted" style={{ marginLeft: '.4rem' }}>({r.brand})</span>}
                    </td>
                    <td className="muted">{r.department || 'Grocery'}</td>
                    <td><span className="badge badge-muted">{r.soldBy}</span></td>
                    <td className="mono">{formatCents(r.price)}</td>
                    <td className="mono muted">
                      {r.plu ? `PLU ${r.plu}` : r.barcodes[0] ? `UPC ${r.barcodes[0]}` : '—'}
                    </td>
                    <td>{r.snapEligible ? <span className="badge badge-snap">SNAP</span> : '—'}</td>
                    <td>{r.minAge ? <span className="badge badge-age">{r.minAge}+</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}

        {importedStats && (
          <div
            style={{
              background: 'hsla(160, 60%, 45%, 0.2)',
              border: '1px solid var(--brand)',
              padding: '.75rem',
              borderRadius: 8,
              textAlign: 'center',
              color: 'var(--brand)',
              fontWeight: 700,
            }}
          >
            ✓ Successfully imported {importedStats.total} products ({importedStats.created} created, {importedStats.updated} updated)!
          </div>
        )}

        {/* Footer Buttons */}
        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', marginTop: '.4rem' }}>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            id="confirm-import-btn"
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleImport}
            disabled={submitting || parsedRows.length === 0}
          >
            {submitting ? 'Importing Products...' : `Import ${parsedRows.length} Products`}
          </button>
        </div>
      </div>
    </div>
  );
}
