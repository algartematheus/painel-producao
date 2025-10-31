import { utils, write } from 'xlsx';
import importStockFile, { flattenSnapshotsToVariations } from './stockImporter';

const mockGetDocument = jest.fn();

jest.mock('pdfjs-dist/legacy/build/pdf.js', () => ({
    getDocument: mockGetDocument,
}), { virtual: true });

describe('stockImporter', () => {
    beforeEach(() => {
        mockGetDocument.mockReset();
    });

    it('parses PDF content into grouped product snapshots', async () => {
        const mockPage = {
            getTextContent: jest.fn().mockResolvedValue({
                items: [
                    { str: '016.01 CAMISA' },
                    { str: 'GRADE PP P M G GG TOTAL' },
                    { str: 'A PRODUZIR 10 20 30 40 50 150' },
                    { str: '016.02 CALÇA' },
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
                productCode: '016',
                grade: ['PP', 'P', 'M', 'G', 'GG'],
                warnings: [],
                variations: [
                    {
                        ref: '016.01',
                        grade: ['PP', 'P', 'M', 'G', 'GG'],
                        tamanhos: { PP: 10, P: 20, M: 30, G: 40, GG: 50 },
                    },
                    {
                        ref: '016.02',
                        grade: ['34', '36', '38', '40'],
                        tamanhos: { '34': 5, '36': 10, '38': 15, '40': 20 },
                    },
                ],
            },
        ]);

        const flattened = flattenSnapshotsToVariations(snapshots);
        expect(flattened).toEqual([
            {
                productCode: '016',
                ref: '016.01',
                tamanhos: { PP: 10, P: 20, M: 30, G: 40, GG: 50 },
                total: 150,
            },
            {
                productCode: '016',
                ref: '016.02',
                tamanhos: { '34': 5, '36': 10, '38': 15, '40': 20 },
                total: 50,
            },
        ]);
    });

    it('parses XLSX content ignoring total columns and supporting multiple grades', async () => {
        const workbook = utils.book_new();
        const worksheet = utils.aoa_to_sheet([
            ['016.01'],
            ['Grade', 'PP', 'P', 'M', 'Total'],
            ['A Produzir', '12', '8', '4', '24'],
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
                productCode: '016',
                grade: ['PP', 'P', 'M'],
                warnings: [],
                variations: [
                    {
                        ref: '016.01',
                        grade: ['PP', 'P', 'M'],
                        tamanhos: { PP: 12, P: 8, M: 4 },
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
});
