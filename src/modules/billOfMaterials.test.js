import { applyBillOfMaterialsMovements } from './billOfMaterials';

const mockDoc = jest.fn((dbArg, ...segments) => segments.join('/'));
let mockGenerateIdCounter = 0;

jest.mock('../firebase', () => ({
    db: {},
}));

jest.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    Timestamp: { now: jest.fn(() => ({ seconds: 0, nanoseconds: 0 })) },
}));

jest.mock('./shared', () => ({
    generateId: jest.fn(() => {
        mockGenerateIdCounter += 1;
        return `mov-test-${mockGenerateIdCounter}`;
    }),
    buildProductLookupMap: (...sources) => {
        const map = new Map();
        sources.forEach((list) => {
            (list || []).forEach((product) => {
                if (product && product.id) {
                    map.set(product.id, product);
                }
            });
        });
        return map;
    },
}));

describe('applyBillOfMaterialsMovements', () => {
    beforeEach(() => {
        mockDoc.mockClear();
        mockGenerateIdCounter = 0;
        const { generateId } = require('./shared');
        if (generateId.mockClear) {
            generateId.mockClear();
        }
    });

    it('applies variation-specific bill of materials and falls back to default when missing', () => {
        const batch = {
            update: jest.fn(),
            set: jest.fn(),
        };

        const product = {
            id: 'product-1',
            billOfMaterials: [
                {
                    stockProductId: 'stock-component-a',
                    stockVariationId: 'varA',
                    quantityPerPiece: 1,
                },
            ],
            variations: [
                {
                    id: 'var1',
                    label: 'Var 1',
                    billOfMaterials: [
                        {
                            stockProductId: 'stock-component-b',
                            stockVariationId: 'varB',
                            quantityPerPiece: 0.5,
                            dashboardIds: ['dash-allowed'],
                        },
                    ],
                },
                {
                    id: 'var2',
                    label: 'Var 2',
                    billOfMaterials: [],
                },
                {
                    id: 'var3',
                    label: 'Var 3',
                    billOfMaterials: [
                        {
                            stockProductId: 'stock-component-c',
                            stockVariationId: 'varC',
                            quantityPerPiece: 4,
                            dashboardIds: ['dash-other'],
                        },
                    ],
                },
            ],
        };

        const productionDetails = [
            {
                productId: 'product-1',
                produced: 10,
                variations: [
                    { variationId: 'var1', variationKey: 'id::var1', label: 'Var 1', produced: 5 },
                    { variationId: 'var2', variationKey: 'id::var2', label: 'Var 2', produced: 3 },
                    { variationId: 'var3', variationKey: 'id::var3', label: 'Var 3', produced: 2 },
                ],
            },
        ];

        const stockProducts = [
            {
                id: 'stock-component-a',
                variations: [
                    { id: 'varA', currentStock: 20 },
                ],
            },
            {
                id: 'stock-component-b',
                variations: [
                    { id: 'varB', currentStock: 10 },
                ],
            },
            {
                id: 'stock-component-c',
                variations: [
                    { id: 'varC', currentStock: 5 },
                ],
            },
        ];

        applyBillOfMaterialsMovements({
            batch,
            productionDetails,
            productSources: [[product]],
            stockProducts,
            sourceEntryId: 'entry-1',
            user: { uid: 'user-1', email: 'user@example.com' },
            movementTimestamp: { seconds: 123, nanoseconds: 0 },
            dashboardId: 'dash-allowed',
        });

        expect(batch.update).toHaveBeenCalledTimes(2);
        expect(batch.set).toHaveBeenCalledTimes(2);

        const updatePayloads = batch.update.mock.calls.map(([, payload]) => payload);
        expect(updatePayloads).toEqual(expect.arrayContaining([
            {
                variations: [
                    expect.objectContaining({ id: 'varA', currentStock: 17 }),
                ],
            },
            {
                variations: [
                    expect.objectContaining({ id: 'varB', currentStock: 7.5 }),
                ],
            },
        ]));

        expect(mockDoc.mock.calls).toEqual(expect.arrayContaining([
            [expect.anything(), 'stock/data/products', 'stock-component-a'],
            [expect.anything(), 'stock/data/products', 'stock-component-b'],
        ]));

        expect(mockDoc.mock.calls).toEqual(expect.not.arrayContaining([
            [expect.anything(), 'stock/data/products', 'stock-component-c'],
        ]));

        const movementPayloads = batch.set.mock.calls.map(([, payload]) => payload);
        expect(movementPayloads).toEqual(expect.arrayContaining([
            expect.objectContaining({
                productId: 'stock-component-a',
                variationId: 'varA',
                quantity: 3,
            }),
            expect.objectContaining({
                productId: 'stock-component-b',
                variationId: 'varB',
                quantity: 2.5,
            }),
        ]));

        expect(movementPayloads).toEqual(expect.not.arrayContaining([
            expect.objectContaining({ productId: 'stock-component-c' }),
        ]));
    });
});
