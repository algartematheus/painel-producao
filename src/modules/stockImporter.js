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

const REF_REGEX = /^(\d{3,}\.[\w-]+)/i;
const NUMERIC_ONLY_REGEX = /^-?\d+(?:[.,]\d+)?$/;
const PRODUCE_LABEL_REGEX = /a produzir/i;
const TOTAL_LABELS = new Set(['TOTAL', 'TOTAIS', 'TOTALGERAL', 'TOTALGERAL:', 'TOTALGERAL.', 'TOTALG', 'TOT', 'TOTALPRODUZIR', 'TOTALPRODUÇÃO']);

export const PDF_LIBRARY_UNAVAILABLE_ERROR = 'PDF_LIBRARY_UNAVAILABLE';
export const PDF_EXTRACTION_FAILED_ERROR = 'PDF_EXTRACTION_FAILED';
export const NO_VARIATIONS_FOUND_ERROR = 'NO_VARIATIONS_FOUND';

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
    const normalized = normalizeLabel(token);
    if (!normalized) {
        return false;
    }
    if (normalized === 'GRADE' || normalized.startsWith('GRADE')) {
        return false;
    }
    if (normalized.startsWith('REF')) {
        return false;
    }
    if (PRODUCE_LABEL_REGEX.test(token)) {
        return false;
    }
    if (isTotalLabel(token)) {
        return false;
    }
    if (/^[0-9]$/.test(normalized)) {
        return false;
    }
    if (/^[0-9]{2,4}$/.test(normalized)) {
        return true;
    }
    if (/^[A-Z]{1,4}$/.test(normalized)) {
        return true;
    }
    if (/^[0-9]{1,2}[A-Z]{1,2}$/.test(normalized)) {
        return true;
    }
    if (/^[A-Z]{1,2}[0-9]{1,2}$/.test(normalized)) {
        return true;
    }
    if (normalized === 'UNICA' || normalized === 'UNICO' || normalized === 'UNIQUE') {
        return true;
    }
    return false;
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
            const normalizedRef = match[1].toUpperCase();
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

const findGradeForVariation = (rows = [], rowIndex = 0, refCellIndex = 0, refToken = '') => {
    const currentRow = rows[rowIndex] || [];
    const sameRowTokens = extractGradeTokensFromRow(currentRow, {
        startCellIndex: refCellIndex,
        skipRefToken: refToken,
    });

    if (sameRowTokens.length && sameRowTokens.some((token) => /[A-Z]/.test(token))) {
        return sameRowTokens;
    }

    const lookaheadLimit = 6;
    for (let offset = 1; offset <= lookaheadLimit && rowIndex + offset < rows.length; offset++) {
        const candidateRow = rows[rowIndex + offset];
        if (!rowHasContent(candidateRow)) {
            continue;
        }
        if (candidateRow.some((cell) => typeof cell === 'string' && REF_REGEX.test(cell))) {
            break;
        }
        if (rowContainsProduceLabel(candidateRow)) {
            break;
        }
        const tokens = extractGradeTokensFromRow(candidateRow);
        if (tokens.length) {
            return tokens;
        }
    }

    const lookbehindLimit = 3;
    for (let offset = 1; offset <= lookbehindLimit && rowIndex - offset >= 0; offset++) {
        const candidateRow = rows[rowIndex - offset];
        if (!rowHasContent(candidateRow)) {
            continue;
        }
        if (candidateRow.some((cell) => typeof cell === 'string' && REF_REGEX.test(cell))) {
            break;
        }
        if (rowContainsProduceLabel(candidateRow)) {
            continue;
        }
        const tokens = extractGradeTokensFromRow(candidateRow);
        if (tokens.length) {
            return tokens;
        }
    }

    return [];
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
            const normalizedRef = match[1].toUpperCase();
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

const parseRowsIntoBlocks = (rows = []) => {
    const sanitizedRows = Array.isArray(rows) ? rows.map(sanitizeRow) : [];
    const blocks = [];

    for (let rowIndex = 0; rowIndex < sanitizedRows.length; rowIndex++) {
        const row = sanitizedRows[rowIndex];
        if (!rowHasContent(row)) {
            continue;
        }

        const refInfo = findRefInRow(row);
        if (!refInfo) {
            continue;
        }

        const { ref, cellIndex, token } = refInfo;
        const gradeTokens = findGradeForVariation(sanitizedRows, rowIndex, cellIndex, token);
        const quantitiesResult = findQuantitiesForRow(sanitizedRows, rowIndex, token);

        if (!quantitiesResult) {
            continue;
        }

        const { lastRowIndex } = quantitiesResult;
        let { quantities } = quantitiesResult;
        let resolvedGrade = gradeTokens.slice();

        if (!resolvedGrade.length) {
            if (quantities.length === 1) {
                resolvedGrade = ['UNICA'];
            } else {
                continue;
            }
        }

        if (quantities.length === resolvedGrade.length + 1) {
            quantities = quantities.slice(0, resolvedGrade.length);
        }

        if (quantities.length !== resolvedGrade.length) {
            if (quantities.length < resolvedGrade.length) {
                const padding = new Array(resolvedGrade.length - quantities.length).fill(0);
                quantities = [...quantities, ...padding];
            } else {
                quantities = quantities.slice(0, resolvedGrade.length);
            }
        }

        const tamanhos = mapGradeToQuantities(resolvedGrade, quantities);
        blocks.push({
            ref,
            grade: resolvedGrade,
            tamanhos,
        });

        if (lastRowIndex > rowIndex) {
            rowIndex = lastRowIndex;
        }
    }

    return blocks;
};

export const parseLinesIntoBlocks = (lines = []) => {
    const normalizedLines = Array.isArray(lines) ? lines : [];
    const rows = normalizedLines.map((line) => {
        if (Array.isArray(line)) {
            return line;
        }
        return [line];
    });
    return parseRowsIntoBlocks(rows);
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
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        return [];
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    return rows.map((row) => (Array.isArray(row) ? row.map(sanitizeCellValue) : [sanitizeCellValue(row)]));
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

    if (normalizedType === 'pdf' || (file?.type || '').includes('pdf')) {
        const lines = await extractPdfLines(buffer);
        const blocks = ensureBlocksFound(parseLinesIntoBlocks(lines));
        return aggregateBlocksIntoSnapshots(blocks);
    }

    if (normalizedType === 'xlsx' || (file?.type || '').includes('sheet')) {
        const rows = extractXlsxRows(buffer);
        const blocks = ensureBlocksFound(parseRowsIntoBlocks(rows));
        return aggregateBlocksIntoSnapshots(blocks);
    }

    throw new Error('Tipo de arquivo não suportado para importação.');
};

export default importStockFile;
