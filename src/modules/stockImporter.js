import { read, utils } from 'xlsx';
import { GlobalWorkerOptions, getDocument as getDocumentFromPdfjs } from 'pdfjs-dist';
import pdfjsPackage from 'pdfjs-dist/package.json';

let pdfWorkerSrc = null;

const resolveWorkerConstructor = () => {
    if (typeof Worker === 'function') {
        return Worker;
    }
    if (typeof window !== 'undefined' && typeof window.Worker === 'function') {
        return window.Worker;
    }
    if (typeof global !== 'undefined' && typeof global.Worker === 'function') {
        return global.Worker;
    }
    return null;
};

try {
    pdfWorkerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsPackage.version}/build/pdf.worker.mjs`;
} catch (error) {
    console.warn('Não foi possível resolver o worker do PDF.', error);
}

let cachedPdfWorkerPort = null;
let attemptedPdfWorkerCreation = false;

const terminateCachedPdfWorker = () => {
    if (cachedPdfWorkerPort && typeof cachedPdfWorkerPort.terminate === 'function') {
        try {
            cachedPdfWorkerPort.terminate();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn('Não foi possível finalizar o worker do PDF.', error);
        }
    }
    cachedPdfWorkerPort = null;
    attemptedPdfWorkerCreation = false;

    if (GlobalWorkerOptions) {
        GlobalWorkerOptions.workerPort = null;
    }
};

const getPdfWorkerPort = () => {
    if (cachedPdfWorkerPort) {
        return cachedPdfWorkerPort;
    }

    if (attemptedPdfWorkerCreation) {
        return null;
    }

    attemptedPdfWorkerCreation = true;

    const WorkerConstructor = resolveWorkerConstructor();
    if (!WorkerConstructor || !pdfWorkerSrc) {
        return null;
    }

    try {
        cachedPdfWorkerPort = new WorkerConstructor(pdfWorkerSrc, { type: 'module' });
    } catch (error) {
        cachedPdfWorkerPort = null;
        // eslint-disable-next-line no-console
        console.warn('Não foi possível instanciar o worker do PDF.', error);
    }

    return cachedPdfWorkerPort;
};

const REF_REGEX = /^(\d{3,4}\.[A-Z0-9]{2,})/i;
const REF_REGEX_STRICT = /^\d{3,4}\.[A-Z0-9]{2,}$/;
const NUMERIC_ONLY_REGEX = /^-?\d+(?:[.,]\d+)?$/;
const PRODUCE_LABEL_REGEX = /a produzir/i;
const TOTAL_LABELS = new Set(['TOTAL', 'TOTAIS', 'TOTALGERAL', 'TOTALGERAL:', 'TOTALGERAL.', 'TOTALG', 'TOT', 'TOTALPRODUZIR', 'TOTALPRODUÇÃO']);
const SIZE_TOKEN_REGEX = /^(PP|P|M|G|GG|XG|EG|[0-9]{1,3})$/;

const LABEL_COLUMN_INDEX = 0;

export const PDF_LIBRARY_UNAVAILABLE_ERROR = 'PDF_LIBRARY_UNAVAILABLE';
export const PDF_EXTRACTION_FAILED_ERROR = 'PDF_EXTRACTION_FAILED';
export const NO_VARIATIONS_FOUND_ERROR = 'NO_VARIATIONS_FOUND';

const cleanToken = (t) => {
    return t
        .replace(/[,:;]/g, '')
        .replace(/\s+/g, '')
        .toUpperCase();
};

const isRefToken = (token) => {
    return REF_REGEX.test(cleanToken(token));
};

const isPdfGradeRow = (tokens) => {
    const cleaned = tokens.map(cleanToken).filter(Boolean);
    if (!cleaned.length) return false;
    const joined = cleaned.join(' ');
    if (/(PRODUZIR|TOTAL|ESTOQUE|LOTE|SALDO|SOBRAS|PARCIAL)/.test(joined)) {
        return false;
    }
    if (cleaned.length < 2) return false;
    const hasLetter = cleaned.some(t => /[A-Z]/.test(t));
    if (!hasLetter) return false;
    return cleaned.every(t => SIZE_TOKEN_REGEX.test(t));
};

const isTabularGradeRow = (tokens) => {
    const cleaned = tokens.map(cleanToken).filter(Boolean);
    if (!cleaned.length) return false;
    if (cleaned.length && isRefToken(cleaned[0])) return false;

    const startsWithGrade = cleaned[0] === 'GRADE';
    const relevantTokens = startsWithGrade ? cleaned.slice(1) : cleaned;

    if (!relevantTokens.length) return false;

    const hasNonNumericSize = relevantTokens.some(t => !/^\d+$/.test(t));
    if (!startsWithGrade && !hasNonNumericSize) {
        return false;
    }

    if (!relevantTokens.every(t => SIZE_TOKEN_REGEX.test(t))) return false;
    if (relevantTokens.length > 10) return false;
    return true;
};

const tokenizeLine = (line) => {
    if (typeof line !== 'string') {
        return [];
    }
    return line
        .split(/[^\wÀ-ÿ.]+/)
        .map((token) => token.trim())
        .filter(Boolean);
};

const isPotentialSizeToken = (token) => {
    const cleaned = cleanToken(token);
    if (isRefToken(cleaned)) return false;
    if (/(PRODUZIR|TOTAL|ESTOQUE|LOTE|SALDO|SOBRAS|PARCIAL|GRADE|REF)/.test(cleaned)) {
        return false;
    }
    return SIZE_TOKEN_REGEX.test(cleaned);
};

const normalizeLabel = (label) => {
    if (typeof label !== 'string') {
        return '';
    }
    return label.normalize('NFD').replace(/[^\w]/g, '').toUpperCase();
};

const isLikelyReferenceSuffix = (suffix = '') => {
    if (typeof suffix !== 'string') {
        return false;
    }

    const normalized = suffix
        .normalize('NFD')
        .replace(/[^A-Z0-9-]/gi, '')
        .toUpperCase();

    if (!normalized) {
        return false;
    }

    if (/^[0-9-]+$/.test(normalized)) {
        const digitsOnly = normalized.replace(/-/g, '');
        if (!digitsOnly || /^0+$/.test(digitsOnly)) {
            return false;
        }
        return digitsOnly.length <= 4;
    }

    return /^[A-Z0-9-]+$/.test(normalized);
};

const isTotalLabel = (label) => {
    const normalized = normalizeLabel(label);
    if (!normalized) {
        return false;
    }
    if (normalized === 'TOTAL') {
        return true;
    }
    if (normalized.startsWith('TOTAL')) {
        return true;
    }
    if (normalized === 'TOT' || normalized === 'TOTAIS') {
        return true;
    }
    return TOTAL_LABELS.has(normalized);
};

const sanitizeNumberToken = (token) => {
    if (typeof token === 'number' && Number.isFinite(token)) {
        return Math.round(token);
    }
    if (typeof token !== 'string') {
        return null;
    }
    const cleaned = token
        .replace(/[^0-9,.-]/g, '')
        .replace(/\.(?=\d{3}(\D|$))/g, '')
        .replace(',', '.');
    if (!cleaned || cleaned === '-' || cleaned === '.') {
        return null;
    }
    const parsed = parseFloat(cleaned);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    return Math.round(parsed);
};

const sanitizeCellValue = (cell) => {
    if (typeof cell === 'string') {
        return cell.trim();
    }
    if (typeof cell === 'number') {
        return Number.isFinite(cell) ? String(Math.round(cell)) : '';
    }
    if (cell instanceof Date) {
        return cell.toISOString();
    }
    if (cell === null || typeof cell === 'undefined') {
        return '';
    }
    return String(cell).trim();
};

// Helper function for simple uppercase conversion without accent normalization
// Available for cases where accent normalization is not needed
const toTrimmedUppercase = (value) => {
    const raw = sanitizeCellValue(value);
    if (!raw) {
        return '';
    }
    return raw.toUpperCase().trim();
};

const normalizeForComparison = (value) => {
    const raw = sanitizeCellValue(value);
    if (!raw) {
        return '';
    }
    return raw
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
};

const mapGradeToQuantities = (grades, quantities) => {
    const result = {};
    grades.forEach((grade, index) => {
        const quantity = quantities[index];
        if (Number.isFinite(quantity)) {
            result[grade] = quantity;
        } else {
            result[grade] = 0;
        }
    });
    return result;
};

const isProduceLine = (text) => {
    if (typeof text !== 'string') {
        return false;
    }
    const normalized = text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
    return normalized.includes('PRODUZIR');
};

const extractNumbersFromLine = (text) => {
    if (typeof text !== 'string') {
        return [];
    }
    // Accept things like "-57", "13", "0", "1.234", "1,234"
    // First try to match numbers with optional decimal separators
    const matches = text.match(/-?\d+(?:[.,]\d+)?/g) || [];
    const numbers = matches.map((n) => {
        // Replace comma with dot for parsing
        const normalized = n.replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? Math.round(parsed) : 0;
    });
    // eslint-disable-next-line no-console
    console.log('[PDF DEBUG] extractNumbersFromLine input:', JSON.stringify(text), 'output:', numbers);
    return numbers;
};

const extractQuantitiesFromLine = (line, grades = []) => {
    if (typeof line !== 'string') {
        return [];
    }
    const normalized = line.normalize('NFD');
    const [, tail = ''] = normalized.split(/a\s*produzir/i);
    let quantities = tail
        .split(/[^0-9,.-]+/)
        .map(sanitizeNumberToken)
        .filter((value) => value !== null);

    if (grades.length > 0 && quantities.length === grades.length + 1) {
        quantities = quantities.slice(0, grades.length);
    }

    return quantities;
};

const extractNumbersFromCell = (cell) => {
    if (!cell) {
        return [];
    }
    const matches = String(cell).match(/-?[\d,.]+/g);
    if (!matches) {
        return [];
    }
    return matches
        .map(sanitizeNumberToken)
        .filter((value) => value !== null);
};

const sanitizeRow = (row) => {
    if (Array.isArray(row)) {
        return row.map(sanitizeCellValue);
    }
    return [sanitizeCellValue(row)];
};

const rowHasContent = (row = []) => row.some((cell) => typeof cell === 'string' ? cell.trim() : cell);

const rowContainsProduceLabel = (row = []) => row.some((cell) => typeof cell === 'string' && PRODUCE_LABEL_REGEX.test(cell));

const getFirstColumnValue = (row = []) => {
    if (!Array.isArray(row) || row.length <= LABEL_COLUMN_INDEX) {
        return '';
    }
    return sanitizeCellValue(row[LABEL_COLUMN_INDEX]);
};

const formatGradeValue = (value) => {
    const raw = sanitizeCellValue(value);
    if (!raw) {
        return '';
    }
    if (/^\d$/.test(raw)) {
        return raw.padStart(2, '0');
    }
    return raw;
};

const extractGradeFromQtdeRow = (row = []) => {
    const grade = [];
    for (let columnIndex = 1; columnIndex < row.length; columnIndex++) {
        const cell = row[columnIndex];
        if (cell === null || typeof cell === 'undefined') {
            continue;
        }
        const formatted = formatGradeValue(cell);
        if (!formatted) {
            continue;
        }
        if (isTotalLabel(formatted)) {
            continue;
        }
        grade.push(formatted);
    }
    return grade;
};

const findRefInRow = (row = []) => {
    for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
        const cell = row[cellIndex];
        if (!cell) {
            continue;
        }
        const tokens = tokenizeLine(cell);
        for (const token of tokens) {
            const match = token.match(REF_REGEX);
            if (!match) {
                continue;
            }
            const normalizedRef = toTrimmedUppercase(match[1]);
            const [, suffix = ''] = normalizedRef.split('.');
            if (isTotalLabel(suffix)) {
                continue;
            }
            if (!isLikelyReferenceSuffix(suffix)) {
                continue;
            }
            return {
                ref: normalizedRef,
                cellIndex,
                token: normalizedRef,
            };
        }
    }
    return null;
};

const rowIsNumericOnly = (row = []) => {
    let hasValue = false;
    for (const cell of row) {
        if (typeof cell === 'number') {
            if (!Number.isFinite(cell)) {
                return false;
            }
            hasValue = true;
            continue;
        }

        if (typeof cell === 'string') {
            const trimmed = cell.trim();
            if (!trimmed) {
                continue;
            }
            if (!NUMERIC_ONLY_REGEX.test(trimmed)) {
                return false;
            }
            hasValue = true;
            continue;
        }

        if (cell) {
            return false;
        }
    }

    return hasValue;
};

const extractGradeTokensFromRow = (row = [], { startCellIndex = 0, skipRefToken } = {}) => {
    const tokens = [];
    let refSkipped = !skipRefToken;
    for (let cellIndex = startCellIndex; cellIndex < row.length; cellIndex++) {
        const cell = row[cellIndex];
        if (!cell) {
            continue;
        }
        const cellTokens = tokenizeLine(cell);
        for (const token of cellTokens) {
            if (!refSkipped && token.toUpperCase() === skipRefToken.toUpperCase()) {
                refSkipped = true;
                continue;
            }
            if (!isPotentialSizeToken(token)) {
                continue;
            }
            const normalizedToken = token.toUpperCase();
            if (!tokens.includes(normalizedToken)) {
                tokens.push(normalizedToken);
            }
        }
    }
    return tokens;
};

const collectQuantitiesFromProduceRow = (row = []) => {
    const labelIndex = row.findIndex((cell) => typeof cell === 'string' && PRODUCE_LABEL_REGEX.test(cell));
    if (labelIndex === -1) {
        return [];
    }
    const quantities = [];
    quantities.push(...extractQuantitiesFromLine(row[labelIndex]));
    for (let index = labelIndex + 1; index < row.length; index++) {
        quantities.push(...extractNumbersFromCell(row[index]));
    }
    return quantities;
};

const collectQuantitiesFromTabularRow = (row = [], refToken = '') => {
    if (!rowHasContent(row)) {
        return [];
    }
    const quantities = [];
    let collecting = false;

    for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
        const cell = row[cellIndex];
        if (!cell) {
            continue;
        }
        const match = typeof cell === 'string' ? cell.match(REF_REGEX) : null;
        if (!collecting && match) {
            const normalizedRef = toTrimmedUppercase(match[1]);
            const [, suffix = ''] = normalizedRef.split('.');
            if (isTotalLabel(suffix)) {
                return [];
            }
            if (!refToken || normalizedRef === refToken) {
                collecting = true;
                const suffixText = cell.slice(cell.indexOf(match[0]) + match[0].length);
                quantities.push(...extractNumbersFromCell(suffixText));
            }
            continue;
        }

        if (!collecting) {
            continue;
        }

        quantities.push(...extractNumbersFromCell(cell));
    }

    return quantities;
};

const findQuantitiesForRow = (rows = [], rowIndex = 0, refToken = '') => {
    for (let offset = 0; rowIndex + offset < rows.length; offset++) {
        const candidateIndex = rowIndex + offset;
        const candidateRow = rows[candidateIndex];
        if (!rowHasContent(candidateRow)) {
            continue;
        }
        if (offset > 0) {
            if (rowIsNumericOnly(candidateRow)) {
                continue;
            }
            if (findRefInRow(candidateRow)) {
                break;
            }
        }
        if (!rowContainsProduceLabel(candidateRow)) {
            continue;
        }
        const produceQuantities = collectQuantitiesFromProduceRow(candidateRow);
        if (produceQuantities.length) {
            return {
                quantities: produceQuantities,
                lastRowIndex: candidateIndex,
            };
        }
    }

    const tabularQuantities = collectQuantitiesFromTabularRow(rows[rowIndex], refToken);
    if (tabularQuantities.length) {
        return {
            quantities: tabularQuantities,
            lastRowIndex: rowIndex,
        };
    }

    return null;
};

const parseTabularLayout = (lines = []) => {
    const blocks = [];
    let currentGrade = null;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const tokens = tokenizeLine(line);
        if (!tokens.length) continue;

        if (isRefToken(tokens[0])) {
            if (!currentGrade) {
                continue;
            }
            const ref = cleanToken(tokens[0]);
            const values = tokens.slice(1).map(v => Number(v.replace(/[^\d-]/g, '') || 0));
            const tamanhos = {};
            currentGrade.forEach((size, idx) => {
                tamanhos[size] = values[idx] ?? 0;
            });
            blocks.push({
                ref,
                grade: [...currentGrade],
                tamanhos,
            });
            continue;
        }

        if (isTabularGradeRow(tokens)) {
            currentGrade = tokens.map(cleanToken).filter(isPotentialSizeToken);
            continue;
        }
    }
    return blocks;
};

const parseRowsIntoBlocks = (rows = []) => {
    const sanitizedRows = Array.isArray(rows) ? rows.map(sanitizeRow) : [];
    const blocks = [];

    // Debug: log all lines for PDF parsing
    for (let i = 0; i < sanitizedRows.length; i++) {
        const raw = sanitizedRows[i];
        const s = raw && raw.length > 0 ? String(raw[0] || '') : '';
        const normalized = s
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .trim();

        if (normalized.includes('PRODUZIR')) {
            // eslint-disable-next-line no-console
            console.log('[PDF DEBUG] A PRODUZIR candidate at line', i, ':', JSON.stringify(s));
            // eslint-disable-next-line no-console
            console.log('[PDF DEBUG] Next line:', JSON.stringify(sanitizedRows[i + 1] && sanitizedRows[i + 1].length > 0 ? String(sanitizedRows[i + 1][0] || '') : ''));
        }
    }

    for (let rowIndex = 0; rowIndex < sanitizedRows.length; rowIndex++) {
        const row = sanitizedRows[rowIndex];
        if (!rowHasContent(row)) continue;

        const refInfo = findRefInRow(row);
        if (!refInfo) continue;

        // Find grade for this product/variation
        let productGrade = [];
        const sameLineTokens = extractGradeTokensFromRow(row, { startCellIndex: refInfo.cellIndex, skipRefToken: refInfo.token });

        if (sameLineTokens.length > 1) {
            productGrade = sameLineTokens;
        } else {
            // Look for a grade row - search backwards and forwards for grade information
            for (let i = Math.max(0, rowIndex - 10); i < Math.min(sanitizedRows.length, rowIndex + 20); i++) {
                const candidateRow = sanitizedRows[i];
                const tokens = tokenizeLine(candidateRow.join(' '));
                if (isPdfGradeRow(tokens)) {
                    productGrade = tokens.filter(isPotentialSizeToken);
                    // eslint-disable-next-line no-console
                    console.log(`[PDF DEBUG] Grade encontrada para ${refInfo.ref} na linha ${i}:`, productGrade);
                    break;
                }
            }
        }

        // Find "A PRODUZIR" line for this variation
        let produceIdx = -1;
        let values = [];
        
        // First try direct search for "A PRODUZIR"
        for (let i = rowIndex; i < Math.min(sanitizedRows.length, rowIndex + 20); i++) {
            const candidateRow = sanitizedRows[i];
            const candidateText = candidateRow && candidateRow.length > 0 ? String(candidateRow[0] || '') : '';
            if (isProduceLine(candidateText)) {
                produceIdx = i;
                // eslint-disable-next-line no-console
                console.log(`[PDF DEBUG] A PRODUZIR encontrada para ${refInfo.ref} na linha ${i}:`, JSON.stringify(candidateText));
                
                // Extract values from "A PRODUZIR" line
                const produceRow = sanitizedRows[produceIdx];
                const produceText = produceRow && produceRow.length > 0 ? String(produceRow[0] || '') : '';
                // eslint-disable-next-line no-console
                console.log(`[PDF DEBUG] Extraindo valores da linha "A PRODUZIR" para ${refInfo.ref}:`, JSON.stringify(produceText));
                values = extractNumbersFromLine(produceText);
                // eslint-disable-next-line no-console
                console.log(`[PDF DEBUG] Valores extraídos da linha "A PRODUZIR" para ${refInfo.ref}:`, values);

                // If we extracted zero or obviously too few numbers, try the next few lines
                if (!values.length || (productGrade.length > 0 && values.length < productGrade.length)) {
                    for (let nextIdx = produceIdx + 1; nextIdx < Math.min(sanitizedRows.length, produceIdx + 5); nextIdx++) {
                        const nextRow = sanitizedRows[nextIdx];
                        const nextText = nextRow && nextRow.length > 0 ? String(nextRow[0] || '') : '';
                        // Skip if this looks like another label (contains "PRODUZIR", "TOTAL", etc.)
                        const nextNormalized = nextText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
                        if (nextNormalized.includes('PRODUZIR') || nextNormalized.includes('TOTAL') || nextNormalized.includes('SALDO')) {
                            break;
                        }
                        // eslint-disable-next-line no-console
                        console.log(`[PDF DEBUG] Tentando linha ${nextIdx} para ${refInfo.ref}:`, JSON.stringify(nextText));
                        const nextValues = extractNumbersFromLine(nextText);
                        if (nextValues.length > values.length) {
                            values = nextValues;
                            // eslint-disable-next-line no-console
                            console.log(`[PDF DEBUG] Valores extraídos da linha ${nextIdx} para ${refInfo.ref}:`, values);
                            if (productGrade.length > 0 && values.length >= productGrade.length) {
                                break; // We have enough values
                            }
                        }
                    }
                }
                break;
            }
        }

        // If direct search failed, try using findQuantitiesForRow as fallback
        if (produceIdx === -1 || !values.length) {
            const quantitiesResult = findQuantitiesForRow(sanitizedRows, rowIndex, refInfo.token);
            if (quantitiesResult && quantitiesResult.quantities.length) {
                values = quantitiesResult.quantities;
                produceIdx = quantitiesResult.lastRowIndex;
                // eslint-disable-next-line no-console
                console.log(`[PDF DEBUG] Valores encontrados via findQuantitiesForRow para ${refInfo.ref}:`, values);
            }
        }

        if (!values.length) {
            // eslint-disable-next-line no-console
            console.warn(`[PDF DEBUG] ✗ Nenhum valor encontrado na linha "A PRODUZIR" para ${refInfo.ref}`);
            continue;
        }

        // Use product grade if available, otherwise try to infer from values
        let resolvedGrade = productGrade;
        if (!resolvedGrade.length) {
            // Try to find grade from context
            for (let i = Math.max(0, rowIndex - 10); i < Math.min(sanitizedRows.length, rowIndex + 20); i++) {
                const candidateRow = sanitizedRows[i];
                const tokens = tokenizeLine(candidateRow.join(' '));
                if (isPdfGradeRow(tokens)) {
                    resolvedGrade = tokens.filter(isPotentialSizeToken);
                    break;
                }
            }
        }

        if (!resolvedGrade.length) {
            if (values.length === 1) {
                resolvedGrade = ['UNICA'];
            } else {
                // eslint-disable-next-line no-console
                console.warn(`[PDF DEBUG] ✗ Grade não encontrada para ${refInfo.ref}, pulando variação`);
                continue;
            }
        }

        // If there's a trailing grand total, drop it
        if (values.length === resolvedGrade.length + 1) {
            values = values.slice(0, resolvedGrade.length);
            // eslint-disable-next-line no-console
            console.log(`[PDF DEBUG] Total removido para ${refInfo.ref}:`, values);
        }

        // Align values with grade
        if (values.length !== resolvedGrade.length) {
            if (values.length < resolvedGrade.length) {
                const padding = new Array(resolvedGrade.length - values.length).fill(0);
                values = [...values, ...padding];
                // eslint-disable-next-line no-console
                console.warn(`[PDF DEBUG] ⚠️ Complementando valores com zeros para ${refInfo.ref}:`, values);
            } else {
                values = values.slice(0, resolvedGrade.length);
                // eslint-disable-next-line no-console
                console.warn(`[PDF DEBUG] ⚠️ Truncando valores para ${refInfo.ref}:`, values);
            }
        }

        // Map into tamanhos using mapGradeToQuantities
        const tamanhos = mapGradeToQuantities(resolvedGrade, values);

        // eslint-disable-next-line no-console
        console.log(`[PDF DEBUG] ✓ Variação salva: ${refInfo.ref}`, tamanhos);

        blocks.push({
            ref: refInfo.ref,
            grade: resolvedGrade,
            tamanhos,
        });

        if (produceIdx > rowIndex) {
            rowIndex = produceIdx;
        }
    }

    return blocks;
};

const collectRowNumbersFromColumns = (row = [], { startColumnIndex = 1, maxColumns } = {}) => {
    if (!Array.isArray(row)) {
        return [];
    }

    const limit = typeof maxColumns === 'number' ? maxColumns : row.length;
    const numbers = [];
    for (let columnIndex = startColumnIndex; columnIndex < limit; columnIndex++) {
        const cell = row[columnIndex];
        if (cell === null || typeof cell === 'undefined' || cell === '') {
            continue;
        }
        const parsed = sanitizeNumberToken(cell);
        if (parsed === null) {
            continue;
        }
        numbers.push(parsed);
    }
    return numbers;
};

const collectRowNumbersWithFallback = (row = [], gradeLength = 0) => {
    const numbers = collectRowNumbersFromColumns(row, { startColumnIndex: 1 });
    if (numbers.length) {
        return numbers;
    }

    const firstCellNumbers = extractNumbersFromCell(row?.[0]);
    if (firstCellNumbers.length) {
        return firstCellNumbers;
    }

    if (gradeLength <= 0) {
        return collectRowNumbersFromColumns(row, { startColumnIndex: 0 });
    }

    return numbers;
};

const collectRowNonEmptyValues = (row = [], { startColumnIndex = 1, maxColumns } = {}) => {
    if (!Array.isArray(row)) {
        return [];
    }

    const limit = typeof maxColumns === 'number' ? maxColumns : row.length;
    const values = [];
    for (let columnIndex = startColumnIndex; columnIndex < limit; columnIndex++) {
        const cell = row[columnIndex];
        if (cell === null || typeof cell === 'undefined') {
            continue;
        }
        const sanitized = sanitizeCellValue(cell);
        if (!sanitized) {
            continue;
        }
        values.push(sanitized);
    }
    return values;
};

const shouldDebugVariation = (productBase) => ['016', '101'].includes(productBase);

const logXlsxDebugInfo = ({
    ref,
    linhaCodigo,
    linhaAProduzir,
    linhaQtde,
    rows,
    gradeValues,
}) => {
    const [productBase] = ref.split('.');
    if (!shouldDebugVariation(productBase)) {
        return;
    }

    const safeIndex = (index) => (typeof index === 'number' && index >= 0 ? index : null);
    const codigoIndex = safeIndex(linhaCodigo);
    const produzirIndex = safeIndex(linhaAProduzir);
    const qtdeIndex = safeIndex(linhaQtde);

    const codigoRow = codigoIndex !== null ? rows[codigoIndex] : null;
    const produzirRow = produzirIndex !== null ? rows[produzirIndex] : null;
    const qtdeRow = qtdeIndex !== null ? rows[qtdeIndex] : null;

    const codigoColA = getFirstColumnValue(codigoRow) || '';
    const produzirColA = getFirstColumnValue(produzirRow) || '';
    const qtdeColA = getFirstColumnValue(qtdeRow) || '';

    const produzirNumericValues = collectRowNumbersWithFallback(produzirRow, gradeValues.length);
    const qtdeValues = collectRowNonEmptyValues(qtdeRow, { startColumnIndex: 1 });

    const formatLineNumber = (index) => (index !== null ? index + 1 : 'N/D');

    // eslint-disable-next-line no-console
    console.log('[DEBUG XLSX] Variacao:', ref);
    // eslint-disable-next-line no-console
    console.log('  linhaCodigo   =', formatLineNumber(codigoIndex), 'valor colA:', codigoColA);
    // eslint-disable-next-line no-console
    console.log('  linhaAProduzir=', formatLineNumber(produzirIndex), 'valor colA:', produzirColA);
    // eslint-disable-next-line no-console
    console.log('  linhaQtde     =', formatLineNumber(qtdeIndex), 'valor colA:', qtdeColA);
    // eslint-disable-next-line no-console
    console.log('  linhaAProduzir valores:', produzirNumericValues);
    // eslint-disable-next-line no-console
    console.log('  linhaQtde tamanhos:', qtdeValues);
};

const isVariationCode = (text) => {
    if (!text || typeof text !== 'string') {
        return false;
    }
    const normalized = normalizeForComparison(text);
    return REF_REGEX_STRICT.test(normalized);
};

const parseXlsxRowsIntoBlocks = (rows = []) => {
    if (!Array.isArray(rows) || !rows.length) {
        return [];
    }

    const sanitizedRows = rows.map(sanitizeRow);
    const blocks = [];
    const maxRow = sanitizedRows.length - 1;
    const COL_A = 0;
    const COL_B = 1;

    // Helper to get label from column A
    const getLabel = (sheetRow, rowIndex) => {
        if (!Array.isArray(sheetRow) || rowIndex < 0 || rowIndex >= sanitizedRows.length) {
            return '';
        }
        const cell = sheetRow[COL_A];
        return cell == null ? '' : String(cell).trim();
    };

    for (let rowIndex = 0; rowIndex < sanitizedRows.length; rowIndex++) {
        const row = sanitizedRows[rowIndex];
        const label = getLabel(row, rowIndex);
        if (!label) {
            continue;
        }

        // Check if this is a variation code
        if (!isVariationCode(label)) {
            continue;
        }

        // Use toTrimmedUppercase since we already validated with isVariationCode which uses normalizeForComparison
        const code = toTrimmedUppercase(label);
        // eslint-disable-next-line no-console
        console.log('[XLSX DEBUG] variation code at row', rowIndex, ':', label);

        // Find A PRODUZIR within this block
        let rowProduce = -1;
        for (let r = rowIndex + 1; r <= maxRow; r++) {
            const candidateRow = sanitizedRows[r];
            const candidateLabel = getLabel(candidateRow, r);
            const candidateNormalized = normalizeForComparison(candidateLabel);

            if (isVariationCode(candidateLabel)) {
                break; // next variation => end of this block
            }

            if (candidateNormalized.includes('PRODUZIR')) {
                rowProduce = r;
                // eslint-disable-next-line no-console
                console.log(`[XLSX DEBUG] A PRODUZIR for ${code} at row ${r}`);
                break;
            }
        }

        if (rowProduce === -1) {
            logXlsxDebugInfo({
                ref: code,
                linhaCodigo: rowIndex,
                linhaAProduzir: -1,
                linhaQtde: -1,
                rows: sanitizedRows,
                gradeValues: [],
            });
            // eslint-disable-next-line no-console
            console.warn(`[XLSX DEBUG] ✗ A PRODUZIR não encontrada para ${code}`);
            continue;
        }

        // Find Qtde after A PRODUZIR
        let rowQtde = -1;
        for (let r = rowProduce + 1; r <= maxRow; r++) {
            const candidateRow = sanitizedRows[r];
            const candidateLabel = getLabel(candidateRow, r);
            const candidateNormalized = normalizeForComparison(candidateLabel);

            if (isVariationCode(candidateLabel)) {
                break; // next variation
            }

            if (candidateNormalized.startsWith('QTDE')) {
                rowQtde = r;
                // eslint-disable-next-line no-console
                console.log(`[XLSX DEBUG] QTDE for ${code} at row ${r}`);
                break;
            }
        }

        if (rowQtde === -1) {
            logXlsxDebugInfo({
                ref: code,
                linhaCodigo: rowIndex,
                linhaAProduzir: rowProduce,
                linhaQtde: -1,
                rows: sanitizedRows,
                gradeValues: [],
            });
            // eslint-disable-next-line no-console
            console.warn(`[XLSX DEBUG] ✗ QTDE não encontrada para ${code}`);
            continue;
        }

        // Extract grade from rowQtde using extractGradeFromQtdeRow
        const gradeRow = sanitizedRows[rowQtde];
        const grade = extractGradeFromQtdeRow(gradeRow);

        if (!grade.length) {
            logXlsxDebugInfo({
                ref: code,
                linhaCodigo: rowIndex,
                linhaAProduzir: rowProduce,
                linhaQtde: rowQtde,
                rows: sanitizedRows,
                gradeValues: [],
            });
            // eslint-disable-next-line no-console
            console.warn(`[XLSX DEBUG] ✗ Grade vazia para ${code}`);
            continue;
        }

        // Extract values from rowProduce
        const produceRow = sanitizedRows[rowProduce];
        let values = [];
        const produceMaxCol = produceRow ? produceRow.length - 1 : 0;
        for (let c = COL_B; c <= produceMaxCol; c++) {
            const v = produceRow && produceRow[c] != null ? produceRow[c] : null;
            if (v == null || v === '') {
                continue;
            }
            const parsed = sanitizeNumberToken(v);
            if (parsed !== null) {
                values.push(parsed);
            }
        }

        if (values.length === grade.length + 1) {
            values = values.slice(0, grade.length); // drop grand total
            // eslint-disable-next-line no-console
            console.log(`[XLSX DEBUG] Total removido para ${code}:`, values);
        }

        // Align values with grade
        if (values.length !== grade.length) {
            if (values.length < grade.length) {
                const padding = new Array(grade.length - values.length).fill(0);
                values = [...values, ...padding];
                // eslint-disable-next-line no-console
                console.warn(`[XLSX DEBUG] ⚠️ Complementando valores com zeros para ${code}:`, values);
            } else {
                values = values.slice(0, grade.length);
                // eslint-disable-next-line no-console
                console.warn(`[XLSX DEBUG] ⚠️ Truncando valores para ${code}:`, values);
            }
        }

        // Map into tamanhos using mapGradeToQuantities
        const tamanhos = mapGradeToQuantities(grade, values);

        // Log debug info
        logXlsxDebugInfo({
            ref: code,
            linhaCodigo: rowIndex,
            linhaAProduzir: rowProduce,
            linhaQtde: rowQtde,
            rows: sanitizedRows,
            gradeValues: grade,
        });

        // eslint-disable-next-line no-console
        console.log(`[XLSX DEBUG] ✓ Variação salva: ${code}`, tamanhos);

        blocks.push({
            ref: code,
            grade: grade.slice(),
            tamanhos,
        });

        if (rowQtde > rowIndex) {
            rowIndex = rowQtde;
        }
    }

    return blocks;
};

const isBlockLayout = (rows = []) => {
    if (!rows || rows.length < 3) return false;

    let hasRef = false;
    let hasProduce = false;
    let hasQtde = false;

    for (const row of rows) {
        const firstCell = getFirstColumnValue(row);
        if (!firstCell) continue;

        const comparable = normalizeForComparison(firstCell);
        if (REF_REGEX.test(comparable)) hasRef = true;
        if (comparable.includes('PRODUZIR')) hasProduce = true;
        if (comparable.startsWith('QTDE')) hasQtde = true;
    }

    return hasRef && hasProduce && hasQtde;
};

const isTabularLayout = (rows = []) => {
    if (!rows || rows.length < 2) return false;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const tokens = tokenizeLine(row.join(' '));
        if (isTabularGradeRow(tokens)) {
            if (i + 1 < rows.length) {
                const nextRowTokens = tokenizeLine(rows[i + 1].join(' '));
                if (nextRowTokens.length > 1 && isRefToken(nextRowTokens[0])) {
                    return true;
                }
            }
        }
    }

    return false;
};

const areGradesEqual = (gradeA = [], gradeB = []) => {
    if (gradeA.length !== gradeB.length) {
        return false;
    }
    return gradeA.every((value, index) => value === gradeB[index]);
};

const aggregateBlocksIntoSnapshots = (blocks = []) => {
    if (!Array.isArray(blocks) || blocks.length === 0) {
        return [];
    }

    const grouped = new Map();
    blocks.forEach((block) => {
        const originalRef = typeof block?.ref === 'string' ? block.ref : '';
        if (!originalRef) {
            return;
        }
        const refMatch = originalRef.match(REF_REGEX);
        if (!refMatch) {
            return;
        }
        const normalizedRef = refMatch[1];
        const [prefix] = normalizedRef.split('.');
        const safePrefix = prefix || normalizedRef;
        const grade = Array.isArray(block?.grade) ? block.grade : [];
        if (!grouped.has(safePrefix)) {
            grouped.set(safePrefix, {
                productCode: safePrefix,
                grade: grade.slice(),
                variations: [],
                warnings: [],
            });
        }
        const group = grouped.get(safePrefix);
        if (!group.grade.length && grade.length) {
            group.grade = grade.slice();
        } else if (grade.length && !areGradesEqual(group.grade, grade)) {
            group.warnings.push(`Grade divergente detectada para ${normalizedRef}: [${grade.join(', ')}] (mantida grade original [${group.grade.join(', ')}])`);
        }
        group.variations.push({
            ref: normalizedRef,
            grade: grade.slice(),
            tamanhos: block.tamanhos,
        });
    });

    return Array.from(grouped.values());
};

const ensureBlocksFound = (blocks) => {
    if (!Array.isArray(blocks) || !blocks.length) {
        const error = new Error("Nenhuma variação encontrada no arquivo importado. Verifique se o relatório segue o layout padrão com códigos no formato '000.XX' e a linha 'A PRODUZIR'.");
        error.code = NO_VARIATIONS_FOUND_ERROR;
        throw error;
    }
    return blocks;
};

const getRawCellValue = (cell) => {
    if (!cell) {
        return null;
    }
    if (typeof cell.v !== 'undefined') {
        return cell.v;
    }
    if (typeof cell.w !== 'undefined') {
        return cell.w;
    }
    return null;
};

const logSheetColumnADebugInfo = (sheet, sheetName) => {
    if (!sheet || !sheet['!ref']) {
        return;
    }

    const range = utils.decode_range(sheet['!ref']);
    const startRow = range.s.r;
    const endRow = range.e.r;

    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
        const cellRef = utils.encode_cell({ c: LABEL_COLUMN_INDEX, r: rowIndex });
        const cell = sheet[cellRef];
        const raw = getRawCellValue(cell);
        const stringValue = raw == null ? '' : String(raw);
        const upper = toTrimmedUppercase(stringValue);
        if (/^\d{3}\./.test(upper)) {
            // console.log('[DEBUG XLSX] possivel codigo na linha', rowIndex + 1, 'aba', sheetName || '(sem nome)', ':', JSON.stringify(stringValue));
        }

        if (upper.includes('PRODUZIR')) {
            // console.log('[DEBUG XLSX] linha com PRODUZIR na linha', rowIndex + 1, 'aba', sheetName || '(sem nome)', ':', JSON.stringify(stringValue));
        }
    }
};

const defaultPdfjsLib = {
    getDocument: typeof getDocumentFromPdfjs === 'function' ? getDocumentFromPdfjs : null,
    GlobalWorkerOptions: GlobalWorkerOptions || null,
};

const ensurePdfWorkerConfigured = () => {
    const workerOptions = defaultPdfjsLib.GlobalWorkerOptions;
    if (!workerOptions) {
        return;
    }

    if (!workerOptions.workerPort) {
        const workerPort = getPdfWorkerPort();
        if (workerPort) {
            workerOptions.workerPort = workerPort;
        }
    }

    if (!workerOptions.workerPort && pdfWorkerSrc && !workerOptions.workerSrc) {
        workerOptions.workerSrc = pdfWorkerSrc;
    }
};

let cachedPdfjsLib = null;
let injectedPdfjsLib = null;

export const clearPdfjsLibCache = () => {
    cachedPdfjsLib = null;
};

export const terminatePdfjsWorkerForTests = () => {
    terminateCachedPdfWorker();
};

export const setPdfjsLibForTests = (lib, { terminateWorker = true } = {}) => {
    if (terminateWorker) {
        terminateCachedPdfWorker();
    }
    injectedPdfjsLib = lib || null;
    cachedPdfjsLib = null;
};

export const loadPdfJsLibrary = async () => {
    if (injectedPdfjsLib) {
        return injectedPdfjsLib;
    }

    if (cachedPdfjsLib) {
        return cachedPdfjsLib;
    }

    if (!defaultPdfjsLib.getDocument) {
        const error = new Error('Não foi possível carregar a biblioteca pdf.js para leitura de arquivos PDF. Verifique a instalação das dependências.');
        error.code = PDF_LIBRARY_UNAVAILABLE_ERROR;
        throw error;
    }

    ensurePdfWorkerConfigured();

    cachedPdfjsLib = defaultPdfjsLib;
    return cachedPdfjsLib;
};

const extractPdfLines = async (arrayBuffer) => {
    if (!(arrayBuffer instanceof ArrayBuffer)) {
        return [];
    }

    const pdfjsLib = await loadPdfJsLibrary();

    if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
        const error = new Error('A biblioteca pdf.js não está disponível para leitura de arquivos PDF.');
        error.code = PDF_LIBRARY_UNAVAILABLE_ERROR;
        throw error;
    }

    try {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = typeof loadingTask.promise === 'object' && typeof loadingTask.promise.then === 'function'
            ? await loadingTask.promise
            : await loadingTask;

        const pageCount = pdf.numPages || 0;
        const lines = [];
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item) => item.str)
                .join(' ')
                .split(/\r?\n|(?<=\s{2,})/)
                .map((segment) => segment.trim())
                .filter(Boolean);
            lines.push(...pageText);
        }
        return lines;
    } catch (error) {
        const extractionError = new Error('Falha ao extrair texto do PDF. Verifique se o arquivo está íntegro e tente novamente.');
        extractionError.code = PDF_EXTRACTION_FAILED_ERROR;
        extractionError.cause = error;
        throw extractionError;
    }
};

const extractXlsxRows = (arrayBuffer) => {
    const workbook = read(arrayBuffer, { type: 'array' });
    const rows = [];

    workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            return;
        }
        logSheetColumnADebugInfo(sheet, sheetName);
        const sheetRows = utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        sheetRows.forEach((row) => {
            if (Array.isArray(row)) {
                rows.push(row);
            } else {
                rows.push([row]);
            }
        });
    });

    return rows;
};

export const flattenSnapshotsToVariations = (snapshots = []) => {
    const flattened = [];
    snapshots.forEach((snapshot) => {
        const variations = Array.isArray(snapshot?.variations) ? snapshot.variations : [];
        variations.forEach((variation) => {
            const tamanhos = variation?.tamanhos || {};
            const total = Object.values(tamanhos)
                .filter((value) => Number.isFinite(value))
                .reduce((sum, value) => sum + value, 0);
            flattened.push({
                productCode: snapshot.productCode,
                ref: variation?.ref || '',
                tamanhos,
                total,
            });
        });
    });
    return flattened;
};

const parsePdfLines = (lines = []) => {
    const tabularBlocks = parseTabularLayout(lines);
    if (tabularBlocks.length) {
        return tabularBlocks;
    }
    const rows = lines.map(line => [line]);
    return parseRowsIntoBlocks(rows);
};

export const importStockFile = async ({ file, arrayBuffer, type }) => {
    const normalizedType = typeof type === 'string' ? type.toLowerCase() : '';
    let buffer = arrayBuffer;

    if (!(buffer instanceof ArrayBuffer)) {
        if (file && typeof file.arrayBuffer === 'function') {
            buffer = await file.arrayBuffer();
        }
    }

    if (!(buffer instanceof ArrayBuffer)) {
        throw new Error('Nenhum arquivo válido foi fornecido para importação.');
    }

    const isPdf = normalizedType === 'pdf' || (file?.type || '').includes('pdf');
    const isXlsx = normalizedType === 'xlsx' || (file?.type || '').includes('sheet');

    let blocks = [];

    if (isPdf) {
        const lines = await extractPdfLines(buffer);
        blocks = parsePdfLines(lines);
    } else if (isXlsx) {
        const rows = extractXlsxRows(buffer);
        const lines = rows.map(row => row.join(' '));
        if (isBlockLayout(rows)) {
            blocks = parseXlsxRowsIntoBlocks(rows);
        } else if (isTabularLayout(rows)) {
            blocks = parseTabularLayout(lines);
        } else {
            blocks = parseRowsIntoBlocks(rows);
        }
    } else {
        throw new Error('Tipo de arquivo não suportado para importação.');
    }

    blocks = ensureBlocksFound(blocks);
    return aggregateBlocksIntoSnapshots(blocks);
};

export default importStockFile;
