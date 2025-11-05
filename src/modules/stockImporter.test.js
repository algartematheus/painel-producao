import { utils, write } from 'xlsx';
import importStockFile, {
    PDF_LIBRARY_UNAVAILABLE_ERROR,
    clearPdfjsLibCache,
    flattenSnapshotsToVariations,
    parseLinesIntoBlocks,
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
                warnings: [],
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
                warnings: [],
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

    it('parses XLSX content ignoring total columns and supporting references with alphabetic suffixes', async () => {
        const workbook = utils.book_new();
        const worksheet = utils.aoa_to_sheet([
            ['1234.AZ'],
            ['Grade', 'PP', 'P', 'M', 'Total'],
            ['A Produzir', '12', '8', '4', '24'],
            [],
            ['1234.BY'],
            ['GRADE', 'PP', 'P', 'M', 'TOTAL'],
            ['A PRODUZIR', 6, 4, 2, 12],
            [],
            ['017.01'],
            ['GRADE', '34', '36', '38', '40', 'TOTAL'],
            ['A PRODUZIR', 1, 2, 3, 4, 10],
        ]);
        utils.book_append_sheet(workbook, worksheet, 'Planilha1');
        const buffer = write(workbook, { bookType: 'xlsx', type: 'array' });

        const snapshots = await importStockFile({ arrayBuffer: buffer, type: 'xlsx' });

        expect(snapshots).toEqual([
            {
                productCode: '1234',
                grade: ['PP', 'P', 'M'],
                warnings: [],
                variations: [
                    {
                        ref: '1234.AZ',
                        grade: ['PP', 'P', 'M'],
                        tamanhos: { PP: 12, P: 8, M: 4 },
                    },
                    {
                        ref: '1234.BY',
                        grade: ['PP', 'P', 'M'],
                        tamanhos: { PP: 6, P: 4, M: 2 },
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
                warnings: [],
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
            ['Grade: 2 - UNICA'],
            ['A PRODUZIR', 943, 943],
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

    it('parseLinesIntoBlocks extracts blocks for references with alphabetic suffixes', () => {
        const lines = [
            '016.AZ CAMISA MANGA LONGA',
            'GRADE PP P M',
            'A PRODUZIR 10 20 30',
            '016.B1 CALÇA JEANS',
            'GRADE 34 36',
            'A PRODUZIR 5 10',
        ];

        const blocks = parseLinesIntoBlocks(lines);

        expect(blocks).toEqual([
            {
                ref: '016.AZ',
                grade: ['PP', 'P', 'M'],
                tamanhos: { PP: 10, P: 20, M: 30 },
            },
            {
                ref: '016.B1',
                grade: ['34', '36'],
                tamanhos: { '34': 5, '36': 10 },
            },
        ]);
    });

    it('parseLinesIntoBlocks extracts blocks from tabular layout', () => {
        const lines = [
            'REFTAM PP P M G TOTAL',
            '016.01 10 20 30 40 100',
            '016.02 5 10 15 20 50',
            'TOTAL 15 30 45 60 150',
            '',
            'REFTAM 34 36 38 40',
            '017.01 1 2 3 4 10',
            '017.TOTAL 1 2 3 4 10',
        ];

        const blocks = parseLinesIntoBlocks(lines);

        expect(blocks).toEqual([
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
            {
                ref: '017.01',
                grade: ['34', '36', '38', '40'],
                tamanhos: { '34': 1, '36': 2, '38': 3, '40': 4 },
            },
        ]);
    });
});
