import { utils, write } from 'xlsx';
import importStockFile, {
    PDF_LIBRARY_UNAVAILABLE_ERROR,
    clearPdfjsLibCache,
    flattenSnapshotsToVariations,
    setPdfjsLibForTests,
    terminatePdfjsWorkerForTests,
    loadPdfJsLibrary,
} from './stockImporter';

jest.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: null, workerPort: null },
    getDocument: jest.fn(),
}));

const mockGetDocument = jest.fn();

describe('stockImporter', () => {
    beforeEach(() => {
        mockGetDocument.mockReset();
        setPdfjsLibForTests({
            getDocument: mockGetDocument,
        });
        clearPdfjsLibCache();
        terminatePdfjsWorkerForTests();
    });

    afterEach(() => {
        setPdfjsLibForTests(null);
        clearPdfjsLibCache();
        terminatePdfjsWorkerForTests();
    });

    it('terminates cached pdf.js workers during test cleanup', async () => {
        const originalWorker = global.Worker;
        const terminate = jest.fn();
        const mockWorkerInstance = { terminate };
        global.Worker = jest.fn(() => mockWorkerInstance);

        try {
            setPdfjsLibForTests(null);
            clearPdfjsLibCache();

            const pdfjsLib = await loadPdfJsLibrary();

            expect(global.Worker).toHaveBeenCalledTimes(1);
            expect(pdfjsLib.GlobalWorkerOptions.workerPort).toBe(mockWorkerInstance);

            terminatePdfjsWorkerForTests();

            expect(terminate).toHaveBeenCalledTimes(1);
            expect(pdfjsLib.GlobalWorkerOptions.workerPort).toBeNull();
        } finally {
            global.Worker = originalWorker;
        }
    });

    it('throws an informative error when the pdf.js library is unavailable', async () => {
        const buffer = new ArrayBuffer(8);
        setPdfjsLibForTests({ getDocument: null });
        clearPdfjsLibCache();

        await expect(importStockFile({ arrayBuffer: buffer, type: 'pdf' })).rejects.toMatchObject({
            code: PDF_LIBRARY_UNAVAILABLE_ERROR,
            message: 'A biblioteca pdf.js não está disponível para leitura de arquivos PDF.',
        });
    });

    it('parses PDF content into grouped product snapshots', async () => {
        const mockPage = {
            getTextContent: jest.fn().mockResolvedValue({
                items: [
                    { str: '1234.AZ CAMISA' },
                    { str: 'GRADE PP P M G GG TOTAL' },
                    { str: 'A PRODUZIR 10 20 30 40 50 150' },
                    { str: '1234.BY CALÇA' },
                    { str: 'GRADE 34 36 38 40 TOTAL' },
                    { str: 'A PRODUZIR 5 10 15 20 50' },
                ],
            }),
        };

        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(mockPage),
            }),
        });

        const buffer = new ArrayBuffer(8);
        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'pdf' });

        expect(mockGetDocument).toHaveBeenCalledTimes(1);
        expect(snapshots).toEqual([
            {
                productCode: '1234',
                grade: ['PP', 'P', 'M', 'G', 'GG'],
                warnings: [
                    "Grade divergente detectada para 1234.BY: [34, 36, 38, 40] (mantida grade original [PP, P, M, G, GG])"
                ],
                variations: [
                    {
                        ref: '1234.AZ',
                        grade: ['PP', 'P', 'M', 'G', 'GG'],
                        tamanhos: { PP: 10, P: 20, M: 30, G: 40, GG: 50 },
                    },
                    {
                        ref: '1234.BY',
                        grade: ['34', '36', '38', '40'],
                        tamanhos: { '34': 5, '36': 10, '38': 15, '40': 20 },
                    },
                ],
            },
        ]);

        const flattened = flattenSnapshotsToVariations(snapshots);
        expect(flattened).toEqual([
            {
                productCode: '1234',
                ref: '1234.AZ',
                tamanhos: { PP: 10, P: 20, M: 30, G: 40, GG: 50 },
                total: 150,
            },
            {
                productCode: '1234',
                ref: '1234.BY',
                tamanhos: { '34': 5, '36': 10, '38': 15, '40': 20 },
                total: 50,
            },
        ]);
    });

    it('parses PDF content when produce totals appear after extended summary lines', async () => {
        const fillerLines = Array.from({ length: 9 }, (_, index) => ({ str: `RESUMO ${index + 1}` }));
        const mockPage = {
            getTextContent: jest.fn().mockResolvedValue({
                items: [
                    { str: '5678.AB BLUSA' },
                    { str: 'GRADE PP P M G TOTAL' },
                    ...fillerLines,
                    { str: 'A PRODUZIR 3 6 9 12 30' },
                ],
            }),
        };

        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(mockPage),
            }),
        });

        const buffer = new ArrayBuffer(8);
        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'pdf' });

        expect(mockGetDocument).toHaveBeenCalledTimes(1);
        expect(snapshots).toEqual([
            {
                productCode: '5678',
                grade: ['PP', 'P', 'M', 'G'],
                warnings: [],
                variations: [
                    {
                        ref: '5678.AB',
                        grade: ['PP', 'P', 'M', 'G'],
                        tamanhos: { PP: 3, P: 6, M: 9, G: 12 },
                    },
                ],
            },
        ]);
    });

    it('parses PDF content skipping numeric summary lines before produce totals', async () => {
        const mockPage = {
            getTextContent: jest.fn().mockResolvedValue({
                items: [
                    { str: '2468.BC VESTIDO' },
                    { str: 'GRADE PP P M G TOTAL' },
                    { str: '482.00' },
                    { str: '0,00' },
                    { str: 'A PRODUZIR 7 14 21 28 70' },
                ],
            }),
        };

        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(mockPage),
            }),
        });

        const buffer = new ArrayBuffer(8);
        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'pdf' });

        expect(mockGetDocument).toHaveBeenCalledTimes(1);
        expect(snapshots).toEqual([
            {
                productCode: '2468',
                grade: ['PP', 'P', 'M', 'G'],
                warnings: [],
                variations: [
                    {
                        ref: '2468.BC',
                        grade: ['PP', 'P', 'M', 'G'],
                        tamanhos: { PP: 7, P: 14, M: 21, G: 28 },
                    },
                ],
            },
        ]);
    });

    it('prefers the latest produce vector when PDF output contains noisy prefixes', async () => {
        const mockPage = {
            getTextContent: jest.fn().mockResolvedValue({
                items: [
                    { str: '016.AZ CALÇA MASC.INFANT JUVENIL' },
                    { str: 'GRADE 06 08 10 12 14 16 02 04' },
                    { str: 'A PRODUZIR 0 0 0 0 0 0 0 0' },
                    { str: 'A PRODUZIR -5 10 0 4 -3 2 1 20 29' },
                ],
            }),
        };

        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(mockPage),
            }),
        });

        const buffer = new ArrayBuffer(8);
        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'pdf' });

        expect(mockGetDocument).toHaveBeenCalledTimes(1);
        expect(snapshots).toEqual([
            {
                productCode: '016',
                grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
                warnings: [],
                variations: [
                    {
                        ref: '016.AZ',
                        grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
                        tamanhos: {
                            '06': -5,
                            '08': 10,
                            '10': 0,
                            '12': 4,
                            '14': -3,
                            '16': 2,
                            '02': 1,
                            '04': 20,
                        },
                    },
                ],
            },
        ]);
    });

    it('parses PDF content exported in tabular layout', async () => {
        const mockPage = {
            getTextContent: jest.fn().mockResolvedValue({
                items: [
                    { str: 'REFTAM PP P M G TOTAL\n' },
                    { str: '016.01 10 20 30 40 100\n' },
                    { str: '016.02 5 10 15 20 50\n' },
                    { str: 'TOTAL 15 30 45 60 150\n' },
                    { str: '\n' },
                    { str: 'REFTAM 34 36 38 40 TOTAL\n' },
                    { str: '017.01 1 2 3 4 10\n' },
                    { str: '017.TOTAL 1 2 3 4 10\n' },
                ],
            }),
        };

        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(mockPage),
            }),
        });

        const buffer = new ArrayBuffer(8);
        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'pdf' });

        expect(mockGetDocument).toHaveBeenCalledTimes(1);
        expect(snapshots).toEqual([
            {
                productCode: '016',
                grade: ['PP', 'P', 'M', 'G'],
                warnings: [
                    "Grade divergente detectada para 016.02: [PP, P, M, G] (mantida grade original [PP, P, M, G])"
                ],
                variations: [
                    {
                        ref: '016.01',
                        grade: ['PP', 'P', 'M', 'G'],
                        tamanhos: { PP: 10, P: 20, M: 30, G: 40 },
                    },
                    {
                        ref: '016.02',
                        grade: ['PP', 'P', 'M', 'G'],
                        tamanhos: { PP: 5, P: 10, M: 15, G: 20 },
                    },
                ],
            },
            {
                productCode: '017',
                grade: ['34', '36', '38', '40'],
                warnings: [],
                variations: [
                    {
                        ref: '017.01',
                        grade: ['34', '36', '38', '40'],
                        tamanhos: { '34': 1, '36': 2, '38': 3, '40': 4 },
                    },
                ],
            },
        ]);
    });

    it('parses XLSX content using A PRODUZIR blocks and Qtde grade rows', async () => {
        const workbook = utils.book_new();
        const sheet1 = utils.aoa_to_sheet([
            ['016.AZ'],
            ['CALÇA MASC.INFANT JUVENIL'],
            ['AZUL SEGUNDA QUALIDADE'],
            ['Lotes Anteriores:', 248, 31, 36, 33, 30, 32, 24, 29, 463],
            ['TOTAL ESTOQUES:', 10, 20, 30, 40],
            ['A PRODUZIR', -5, 10, 0, 4, -3, 2, 1, 20, 29],
            ['Saldo/Sobras', 0],
            ['Qtde', '06', '08', '10', '12', '14', '16', '02', '04'],
            ['016.DV'],
            ['CALÇA MASC.INFANT JUVENIL'],
            ['A PRODUZIR', 1, 2, 3, 4, 5, 6, 7, 8, 36],
            ['Produção Extra', 0],
            ['Qtde', '06', '08', '10', '12', '14', '16', '02', '04'],
        ]);
        const sheet2 = utils.aoa_to_sheet([
            ['017.ST'],
            ['CALÇA FEMININA'],
            ['A PRODUZIR', 9, 8, 7, 6, 30],
            ['Saldo/Sobras', 0],
            ['Qtde', 'P', 'M', 'G', 'GG'],
        ]);

        utils.book_append_sheet(workbook, sheet1, 'Planilha1');
        utils.book_append_sheet(workbook, sheet2, 'Planilha2');
        const buffer = write(workbook, { bookType: 'xlsx', type: 'array' });

        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'xlsx' });

        expect(snapshots).toEqual([
            {
                productCode: '016',
                grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
                warnings: [],
                variations: [
                    {
                        ref: '016.AZ',
                        grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
                        tamanhos: {
                            '06': -5,
                            '08': 10,
                            '10': 0,
                            '12': 4,
                            '14': -3,
                            '16': 2,
                            '02': 1,
                            '04': 20,
                        },
                    },
                    {
                        ref: '016.DV',
                        grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
                        tamanhos: {
                            '06': 1,
                            '08': 2,
                            '10': 3,
                            '12': 4,
                            '14': 5,
                            '16': 6,
                            '02': 7,
                            '04': 8,
                        },
                    },
                ],
            },
            {
                productCode: '017',
                grade: ['P', 'M', 'G', 'GG'],
                warnings: [],
                variations: [
                    {
                        ref: '017.ST',
                        grade: ['P', 'M', 'G', 'GG'],
                        tamanhos: { P: 9, M: 8, G: 7, GG: 6 },
                    },
                ],
            },
        ]);
    });

    it('parses XLSX content when A PRODUZIR quantities live in the first cell', async () => {
        const workbook = utils.book_new();
        const worksheet = utils.aoa_to_sheet([
            ['447.AZ'],
            ['CALÇA MASC.INFANT JUVENIL'],
            ['Lotes Anteriores:', 248, 31, 36, 33, 30, 32, 24, 29, 463],
            ['TOTAL ESTOQUES:', 10, 20, 30, 40],
            ['A PRODUZIR: -57 -5 10 0 4 -3 2 1'],
            ['Saldo/Sobras', 0],
            ['Qtde', '06', '08', '10', '12', '14', '16', '02', '04'],
        ]);

        utils.book_append_sheet(workbook, worksheet, 'Planilha1');
        const buffer = write(workbook, { bookType: 'xlsx', type: 'array' });

        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'xlsx' });

        expect(snapshots).toEqual([
            {
                productCode: '447',
                grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
                warnings: [],
                variations: [
                    {
                        ref: '447.AZ',
                        grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
                        tamanhos: {
                            '06': -57,
                            '08': -5,
                            '10': 10,
                            '12': 0,
                            '14': 4,
                            '16': -3,
                            '02': 2,
                            '04': 1,
                        },
                    },
                ],
            },
        ]);
    });

    it('parses XLSX content exported in tabular layout, incluindo referências com quatro dígitos', async () => {
        const workbook = utils.book_new();
        const worksheet = utils.aoa_to_sheet([
            ['REFTAM', 'PP', 'P', 'M', 'G', 'TOTAL'],
            ['1234.01', 10, 20, 30, 40, 100],
            ['1234.02', 5, 10, 15, 20, 50],
            ['TOTAL', 15, 30, 45, 60, 150],
            [],
            ['REFTAM', '34', '36', '38', '40', 'TOTAL'],
            ['5678.01', 1, 2, 3, 4, 10],
            ['5678.TOTAL', 1, 2, 3, 4, 10],
        ]);
        utils.book_append_sheet(workbook, worksheet, 'Planilha1');
        const buffer = write(workbook, { bookType: 'xlsx', type: 'array' });

        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'xlsx' });

        expect(snapshots).toEqual([
            {
                productCode: '1234',
                grade: ['PP', 'P', 'M', 'G'],
                warnings: [
                    "Grade divergente detectada para 1234.02: [PP, P, M, G] (mantida grade original [PP, P, M, G])"
                ],
                variations: [
                    {
                        ref: '1234.01',
                        grade: ['PP', 'P', 'M', 'G'],
                        tamanhos: { PP: 10, P: 20, M: 30, G: 40 },
                    },
                    {
                        ref: '1234.02',
                        grade: ['PP', 'P', 'M', 'G'],
                        tamanhos: { PP: 5, P: 10, M: 15, G: 20 },
                    },
                ],
            },
            {
                productCode: '5678',
                grade: ['34', '36', '38', '40'],
                warnings: [],
                variations: [
                    {
                        ref: '5678.01',
                        grade: ['34', '36', '38', '40'],
                        tamanhos: { '34': 1, '36': 2, '38': 3, '40': 4 },
                    },
                ],
            },
        ]);
    });

    it('parses XLSX content with grade única layout', async () => {
        const workbook = utils.book_new();
        const worksheet = utils.aoa_to_sheet([
            ['016.AZ'],
            ['A PRODUZIR', 943, 943],
            ['Qtde', 'UNICA', 'TOTAL'],
        ]);
        utils.book_append_sheet(workbook, worksheet, 'Planilha1');
        const buffer = write(workbook, { bookType: 'xlsx', type: 'array' });

        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'xlsx' });

        expect(snapshots).toEqual([
            {
                productCode: '016',
                grade: ['UNICA'],
                warnings: [],
                variations: [
                    {
                        ref: '016.AZ',
                        grade: ['UNICA'],
                        tamanhos: { UNICA: 943 },
                    },
                ],
            },
        ]);
    });

});