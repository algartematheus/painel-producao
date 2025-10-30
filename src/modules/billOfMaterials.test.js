import { applyBillOfMaterialsMovements, buildBillOfMaterialsMovementDetails } from './billOfMaterials';

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

    it('updates stock without creating movements when suppressMovementRecords is true', () => {
        const batch = {
            update: jest.fn(),
            set: jest.fn(),
        };

        const productionDetails = [
            {
                productId: 'product-1',
                produced: 4,
            },
        ];

        const stockProducts = [
            {
                id: 'stock-component-a',
                variations: [
                    { id: 'varA', currentStock: 10 },
                ],
            },
        ];

        applyBillOfMaterialsMovements({
            batch,
            productionDetails,
            productSources: [[
                {
                    id: 'product-1',
                    billOfMaterials: [
                        { stockProductId: 'stock-component-a', stockVariationId: 'varA', quantityPerPiece: 0.5 },
                    ],
                },
            ]],
            stockProducts,
            sourceEntryId: 'entry-1',
            user: { uid: 'user-1', email: 'user@example.com' },
            suppressMovementRecords: true,
        });

        expect(batch.update).toHaveBeenCalledTimes(1);
        expect(batch.set).not.toHaveBeenCalled();
    });

    it('creates movement history without changing stock when suppressStockUpdates is true', () => {
        const batch = {
            update: jest.fn(),
            set: jest.fn(),
        };

        const productionDetails = [
            {
                productId: 'product-1',
                produced: 6,
                variations: [
                    { variationId: 'var1', variationKey: 'id::var1', label: 'Var 1', produced: 4 },
                    { variationId: 'var2', variationKey: 'id::var2', label: 'Var 2', produced: 2 },
                ],
            },
        ];

        const product = {
            id: 'product-1',
            billOfMaterials: [
                { stockProductId: 'stock-component-a', stockVariationId: 'varA', quantityPerPiece: 1 },
            ],
            variations: [
                {
                    id: 'var1',
                    label: 'Var 1',
                    billOfMaterials: [
                        { stockProductId: 'stock-component-b', stockVariationId: 'varB1', quantityPerPiece: 2 },
                    ],
                },
                {
                    id: 'var2',
                    label: 'Var 2',
                    billOfMaterials: [
                        { stockProductId: 'stock-component-b', stockVariationId: 'varB2', quantityPerPiece: 1 },
                    ],
                },
            ],
        };

        const stockProducts = [
            {
                id: 'stock-component-b',
                variations: [
                    { id: 'varB1', currentStock: 30 },
                    { id: 'varB2', currentStock: 15 },
                ],
            },
        ];

        applyBillOfMaterialsMovements({
            batch,
            productionDetails,
            productSources: [[product]],
            stockProducts,
            sourceEntryId: 'entry-2',
            user: { uid: 'user-2', email: 'user2@example.com' },
            suppressStockUpdates: true,
        });

        expect(batch.update).not.toHaveBeenCalled();
        expect(batch.set).toHaveBeenCalledTimes(2);

        const movementVariations = batch.set.mock.calls.map(([, payload]) => payload.variationId);
        expect(movementVariations).toHaveLength(2);
        expect(movementVariations).toEqual(expect.arrayContaining(['varB1', 'varB2']));

        const quantities = batch.set.mock.calls.map(([, payload]) => payload.quantity);
        expect(quantities).toEqual(expect.arrayContaining([8, 2]));
    });
});

describe('buildBillOfMaterialsMovementDetails', () => {
    it('creates movement entries with variation data and signs', () => {
        const originalDetails = [
            {
                productId: 'prod-1',
                produced: 10,
                variations: [
                    { variationId: 'var-a', produced: 4 },
                    { variationId: 'var-b', produced: 6 },
                ],
            },
        ];

        const updatedDetails = [
            {
                productId: 'prod-1',
                produced: 12,
                variations: [
                    { variationId: 'var-a', produced: 5 },
                    { variationId: 'var-b', produced: 7 },
                ],
            },
            {
                productBaseId: 'base-2',
                produced: 3,
            },
        ];

        const result = buildBillOfMaterialsMovementDetails({ originalDetails, updatedDetails });

        expect(result).toEqual([
            {
                productId: 'prod-1',
                productBaseId: '',
                produced: -10,
                variations: [
                    { variationId: 'var-a', produced: -4 },
                    { variationId: 'var-b', produced: -6 },
                ],
            },
            {
                productId: 'prod-1',
                productBaseId: '',
                produced: 12,
                variations: [
                    { variationId: 'var-a', produced: 5 },
                    { variationId: 'var-b', produced: 7 },
                ],
            },
            {
                productId: '',
                productBaseId: 'base-2',
                produced: 3,
            },
        ]);
    });

    it('filters out empty movements when there is no delta', () => {
        const originalDetails = [
            { productId: 'prod-1', produced: 0 },
        ];
        const updatedDetails = [
            { productId: 'prod-1', produced: 0 },
        ];

        const result = buildBillOfMaterialsMovementDetails({ originalDetails, updatedDetails });

        expect(result).toEqual([]);
    });
});
