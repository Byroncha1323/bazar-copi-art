/**
 * Utilidad sin dependencias externas para generar archivos Excel reales (.xlsx multi-hoja)
 * y leer archivos .xlsx / .csv en el navegador o en Node.js.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colIndexToLetter(index) {
  let num = index + 1;
  let letters = "";
  while (num > 0) {
    const rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters;
}

function sanitizeSheetName(name, usedNames) {
  let clean = String(name || "Hoja")
    .replace(/[\\/*?:[\]]/g, " ")
    .trim()
    .slice(0, 31);
  if (!clean) clean = "Hoja";
  let candidate = clean;
  let i = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` ${i++}`;
    candidate = clean.slice(0, 31 - suffix.length) + suffix;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function buildWorksheetXml(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  let rowsXml = "";

  for (let r = 0; r < safeRows.length; r++) {
    const row = Array.isArray(safeRows[r]) ? safeRows[r] : [];
    const rowNum = r + 1;
    let cellsXml = "";

    for (let c = 0; c < row.length; c++) {
      const val = row[c];
      if (val === null || val === undefined || val === "") continue;
      const cellRef = `${colIndexToLetter(c)}${rowNum}`;
      const styleIdx = r === 0 ? ' s="1"' : "";

      if (typeof val === "number" && Number.isFinite(val)) {
        cellsXml += `<c r="${cellRef}"${styleIdx}><v>${val}</v></c>`;
      } else {
        cellsXml += `<c r="${cellRef}" t="inlineStr"${styleIdx}><is><t xml:space="preserve">${escapeXml(
          val
        )}</t></is></c>`;
      }
    }

    rowsXml += `<row r="${rowNum}">${cellsXml}</row>`;
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="20"/>` +
    `<sheetData>${rowsXml}</sheetData>` +
    `</worksheet>`
  );
}

function buildZipBuffer(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes =
      entry.data instanceof Uint8Array ? entry.data : encoder.encode(entry.data);
    const crc = crc32(dataBytes);

    // Local file header (30 bytes + name + data)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // store (sin compresión)
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central directory header (46 bytes + name)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const output = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(eocd, cursor);
  return output;
}

/**
 * Crea un archivo .xlsx multi-hoja válido como Uint8Array.
 * @param {Array<{ name: string, rows: Array<Array<string|number>> }>} sheets
 */
export function buildXlsxBytes(sheets) {
  const usedNames = new Set();
  const normalizedSheets = (sheets || []).map((s, idx) => ({
    name: sanitizeSheetName(s.name || `Hoja${idx + 1}`, usedNames),
    rows: s.rows || [],
  }));

  const contentTypesOverrides = normalizedSheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");

  const workbookSheets = normalizedSheets
    .map(
      (s, i) =>
        `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join("");

  const workbookRels = normalizedSheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join("");

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="3">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF633D52"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `</cellXfs>` +
    `</styleSheet>`;

  const entries = [
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        contentTypesOverrides +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${workbookSheets}</sheets>` +
        `</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        workbookRels +
        `<Relationship Id="rId${normalizedSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/styles.xml",
      data: stylesXml,
    },
    ...normalizedSheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: buildWorksheetXml(sheet.rows),
    })),
  ];

  return buildZipBuffer(entries);
}

export function buildCsvText(rows, delimiter = ",") {
  const escapeCell = (val) => {
    const str = String(val ?? "");
    if (str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return "\uFEFF" + (rows || []).map((r) => r.map(escapeCell).join(delimiter)).join("\r\n");
}

export function parseCsvToObjects(csvText) {
  const clean = String(csvText || "").replace(/^\uFEFF/, "").trim();
  if (!clean) return [];

  const firstLine = clean.split(/\r?\n/)[0] || "";
  const delimiter =
    (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";

  const rows = [];
  let currentRow = [];
  let currentVal = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentVal += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentVal += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some((cell) => cell !== "")) rows.push(currentRow);
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += ch;
    }
  }

  currentRow.push(currentVal.trim());
  if (currentRow.some((cell) => cell !== "")) rows.push(currentRow);

  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = r[idx] ?? "";
    });
    return obj;
  });
}

async function inflateDeflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Tu navegador no soporta descompresión .xlsx directa. Exporta como .csv.");
  }
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function unzipXmlMap(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  const files = new Map();

  // Buscar End of Central Directory (EOCD) desde el final
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Archivo .xlsx inválido (sin directorio central ZIP).");

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
    const method = view.getUint16(cdOffset + 10, true);
    const compSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localOffset = view.getUint32(cdOffset + 42, true);

    const fileName = decoder.decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    cdOffset += 46 + nameLen + extraLen + commentLen;

    if (!fileName.endsWith(".xml") && !fileName.endsWith(".rels")) continue;
    if (view.getUint32(localOffset, true) !== 0x04034b50) continue;

    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const rawSlice = bytes.subarray(dataStart, dataStart + compSize);

    let unpacked;
    if (method === 0) {
      unpacked = rawSlice;
    } else if (method === 8) {
      unpacked = await inflateDeflateRaw(rawSlice);
    } else {
      continue;
    }
    files.set(fileName, decoder.decode(unpacked));
  }

  return files;
}

function unescapeXml(str) {
  return String(str || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const items = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(xml))) {
    const tMatches = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    items.push(tMatches.map((tm) => unescapeXml(tm[1])).join(""));
  }
  return items;
}

function parseSheetXmlToRows(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;

  while ((rm = rowRegex.exec(xml))) {
    const rowArr = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;

    while ((cm = cellRegex.exec(rm[1]))) {
      const attrs = cm[1] || "";
      const body = cm[2] || "";
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : rowArr.length;
      const cellType = typeMatch ? typeMatch[1] : "";

      let value = "";
      if (cellType === "inlineStr") {
        const tm = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        value = tm ? unescapeXml(tm[1]) : "";
      } else {
        const vm = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const rawVal = vm ? vm[1] : "";
        if (cellType === "s") {
          value = sharedStrings[Number(rawVal)] ?? "";
        } else if (cellType === "str") {
          value = unescapeXml(rawVal);
        } else {
          value = rawVal;
        }
      }

      rowArr[colIdx] = value;
    }

    if (rowArr.some((v) => v !== undefined && v !== "")) {
      rows.push(rowArr.map((v) => v ?? ""));
    }
  }

  return rows;
}

function excelSerialToIsoDate(serialVal) {
  const num = Number(serialVal);
  if (!Number.isFinite(num) || num < 30000 || num > 70000) return String(serialVal ?? "");
  const ms = Math.round((num - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  // Detectar la fila real de encabezados (ej. fila 4 en libros con banner de título)
  let headerIdx = rows.findIndex((r) => r.filter((c) => String(c ?? "").trim() !== "").length >= 4);
  if (headerIdx < 0 || headerIdx >= rows.length - 1) headerIdx = 0;

  const headers = rows[headerIdx].map((h) => String(h ?? "").trim());
  return rows
    .slice(headerIdx + 1)
    .map((r) => {
      const obj = {};
      let nonEmpty = 0;
      headers.forEach((h, idx) => {
        if (!h) return;
        let val = r[idx] ?? "";
        if (val !== "") nonEmpty++;
        const hl = h.toLowerCase();
        if ((hl.includes("fecha") || hl.includes("compra") || hl.includes("registro")) && /^\d{5}(\.\d+)?$/.test(String(val))) {
          val = excelSerialToIsoDate(val);
        }
        obj[h] = val;
      });
      return nonEmpty > 0 ? obj : null;
    })
    .filter(Boolean);
}

export async function parseAllXlsxSheets(arrayBuffer) {
  const xmlMap = await unzipXmlMap(arrayBuffer);
  const sharedStrings = parseSharedStrings(xmlMap.get("xl/sharedStrings.xml"));
  const wbXml = xmlMap.get("xl/workbook.xml") || "";
  const relsXml = xmlMap.get("xl/_rels/workbook.xml.rels") || "";

  const relTargetById = new Map();
  for (const rm of relsXml.matchAll(/<Relationship\b([^>]+)\/>/g)) {
    const attrs = rm[1];
    const id = (attrs.match(/\bId="([^"]+)"/) || [])[1];
    const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) {
      const cleanPath = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`;
      relTargetById.set(id, cleanPath);
    }
  }

  const sheets = {};
  const sheetOrder = [];
  for (const sm of wbXml.matchAll(/<sheet\b([^>]+?)\/?\s*>/g)) {
    const attrs = sm[1];
    const name = unescapeXml((attrs.match(/\bname="([^"]+)"/) || [])[1] || "");
    const rId = (attrs.match(/\br:id="([^"]+)"/) || [])[1];
    const targetPath = relTargetById.get(rId);
    const xml = targetPath ? xmlMap.get(targetPath) : null;
    if (!name || !xml) continue;
    const rows = parseSheetXmlToRows(xml, sharedStrings);
    sheets[name] = rowsToObjects(rows);
    sheetOrder.push(name);
  }

  // Respaldo por si el libro no tuviera relaciones estándar
  if (sheetOrder.length === 0 && xmlMap.get("xl/worksheets/sheet1.xml")) {
    const rows = parseSheetXmlToRows(xmlMap.get("xl/worksheets/sheet1.xml"), sharedStrings);
    sheets.Hoja1 = rowsToObjects(rows);
    sheetOrder.push("Hoja1");
  }

  return { sheets, sheetOrder };
}

export async function parseXlsxToObjects(arrayBuffer, preferredSheets = []) {
  const { sheets, sheetOrder } = await parseAllXlsxSheets(arrayBuffer);
  if (sheetOrder.length === 0) throw new Error("No se encontraron hojas válidas en el archivo Excel.");

  for (const pref of preferredSheets) {
    const foundName = sheetOrder.find((n) => n.toLowerCase() === pref.toLowerCase());
    if (foundName && sheets[foundName]?.length > 0) {
      return sheets[foundName];
    }
  }

  const firstWithRows = sheetOrder.find((n) => sheets[n]?.length > 0) || sheetOrder[0];
  return sheets[firstWithRows] || [];
}
