import { read, utils } from 'xlsx';

const REF_REGEX = /(\d{3}\.\d{2})/;
const GRADE_LABEL_REGEX = /grade/i;
const PRODUCE_LABEL_REGEX = /a\s*produzir/i;
const TOTAL_LABELS = new Set(['TOTAL', 'TOTAIS', 'TOTALGERAL', 'TOTALGERAL:', 'TOTALGERAL.', 'TOTALG', 'TOT', 'TOTALPRODUZIR', 'TOTALPRODUÇÃO']);

const normalizeLabel = (label) => {
    if (typeof label !== 'string') {
        return '';
    }
    return label.normalize('NFD').replace(/[^\w]/g, '').toUpperCase();
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

const extractGradesFromLine = (line) => {
    const tokens = tokenizeLine(line);
    const gradeIndex = tokens.findIndex((token) => GRADE_LABEL_REGEX.test(token));
    if (gradeIndex === -1) {
        return [];
    }
    return tokens
        .slice(gradeIndex + 1)
        .filter((token) => !isTotalLabel(token));
};

const extractQuantitiesFromLine = (line) => {
    if (typeof line !== 'string') {
        return [];
    }
    const normalized = line.normalize('NFD');
    const [, tail = ''] = normalized.split(/a\s*produzir/i);
    return tail
        .split(/[^0-9,.-]+/)
        .map(sanitizeNumberToken)
        .filter((value) => value !== null);
};

export const parseLinesIntoBlocks = (lines = []) => {
    const blocks = [];
    const totalLines = Array.isArray(lines) ? lines : [];

    for (let i = 0; i < totalLines.length; i++) {
        const line = totalLines[i];
        if (typeof line !== 'string') {
            continue;
        }
        const refMatch = line.match(REF_REGEX);
        if (!refMatch) {
            continue;
        }
        const ref = refMatch[1];

        let gradeLineIndex = -1;
        for (let j = i + 1; j < totalLines.length; j++) {
            const candidate = totalLines[j];
            if (typeof candidate !== 'string') {
                continue;
            }
            if (REF_REGEX.test(candidate)) {
                break;
            }
            if (GRADE_LABEL_REGEX.test(candidate)) {
                gradeLineIndex = j;
                break;
            }
        }
        if (gradeLineIndex === -1) {
            continue;
        }

        const grades = extractGradesFromLine(totalLines[gradeLineIndex]);
        if (!grades.length) {
            continue;
        }

        let produceLineIndex = -1;
        for (let j = gradeLineIndex + 1; j < totalLines.length; j++) {
            const candidate = totalLines[j];
            if (typeof candidate !== 'string') {
                continue;
            }
            if (REF_REGEX.test(candidate)) {
                break;
            }
            if (PRODUCE_LABEL_REGEX.test(candidate)) {
                produceLineIndex = j;
                break;
            }
        }

        if (produceLineIndex === -1) {
            continue;
        }

        const quantities = extractQuantitiesFromLine(totalLines[produceLineIndex]);
        if (!quantities.length) {
            continue;
        }

        const mapped = mapGradeToQuantities(grades, quantities);
        if (Object.keys(mapped).length === 0) {
            continue;
        }

        blocks.push({
            ref,
            grade: grades.slice(),
            tamanhos: mapped,
        });
        i = produceLineIndex;
    }

    return blocks;
};

const areGradesEqual = (gradeA = [], gradeB = []) => {
    if (gradeA.length !== gradeB.length) {
        return false;
    }
    return gradeA.every((value, index) => value === gradeB[index]);
};

const aggregateBlocksIntoSnapshots = (blocks = []) => {
    const grouped = new Map();
    blocks.forEach((block) => {
        const ref = typeof block?.ref === 'string' ? block.ref : '';
        if (!ref) {
            return;
        }
        const [prefix] = ref.split('.');
        const safePrefix = prefix || ref;
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
            group.warnings.push(`Grade divergente detectada para ${ref}: [${grade.join(', ')}] (mantida grade original [${group.grade.join(', ')}])`);
        }
        group.variations.push({
            ref,
            grade: grade.slice(),
            tamanhos: block.tamanhos,
        });
    });

    return Array.from(grouped.values());
};

const PDFJS_CDN_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.js';
const PDFJS_WORKER_CDN_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.js';

let cachedPdfjsLib = null;
let injectedPdfjsLib = null;

export const clearPdfjsLibCache = () => {
    cachedPdfjsLib = null;
};

export const setPdfjsLibForTests = (lib) => {
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

    if (typeof window !== 'undefined') {
        if (window.pdfjsLib) {
            cachedPdfjsLib = window.pdfjsLib;
            return cachedPdfjsLib;
        }

        try {
            const module = await import(/* webpackIgnore: true */ PDFJS_CDN_URL);
            const lib = module?.default || module;

            if (lib?.GlobalWorkerOptions) {
                const workerSrc = lib.GlobalWorkerOptions.workerSrc;
                if (!workerSrc) {
                    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;
                }
            }

            cachedPdfjsLib = lib || null;
            return cachedPdfjsLib;
        } catch (error) {
            console.warn('Não foi possível carregar pdf.js dinamicamente.', error);
        }
    }

    return null;
};

const extractPdfLines = async (arrayBuffer) => {
    if (!(arrayBuffer instanceof ArrayBuffer)) {
        return [];
    }

    const pdfjsLib = await loadPdfJsLibrary();

    if (pdfjsLib && typeof pdfjsLib.getDocument === 'function') {
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
            console.warn('Falha ao extrair texto do PDF via pdf.js. Tentando fallback.', error);
        }
    }

    const decoder = new TextDecoder('utf-8');
    const fallbackText = decoder.decode(arrayBuffer);
    return fallbackText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
};

const extractXlsxLines = (arrayBuffer) => {
    const workbook = read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        return [];
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    return rows
        .map((row) => row
            .map((cell) => (typeof cell === 'string' ? cell : (Number.isFinite(cell) ? String(cell) : '')))
            .join(' ')
            .trim())
        .filter(Boolean);
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
        const blocks = parseLinesIntoBlocks(lines);
        return aggregateBlocksIntoSnapshots(blocks);
    }

    if (normalizedType === 'xlsx' || (file?.type || '').includes('sheet')) {
        const lines = extractXlsxLines(buffer);
        const blocks = parseLinesIntoBlocks(lines);
        return aggregateBlocksIntoSnapshots(blocks);
    }

    throw new Error('Tipo de arquivo não suportado para importação.');
};

export default importStockFile;
