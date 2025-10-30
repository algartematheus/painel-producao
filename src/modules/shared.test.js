import {
    computeDefaultPredictionsForEdit,
    computeMetaFromStandardTime,
    computeEfficiencyPercentage,
} from './shared';

describe('computeDefaultPredictionsForEdit', () => {
    it('limits planned pieces to the floor of the available time ratio for active lots', () => {
        const peopleValue = '1';
        const availableTimeValue = '10';
        const productId = 'product-1';
        const standardTime = 6;

        const lots = [
            {
                id: 'lot-1',
                productId,
                status: 'ongoing',
                order: 1,
                target: 100,
                produced: 0,
            },
        ];

        const productMap = new Map([
            [productId, { id: productId, name: 'Produto 1', standardTime }],
        ]);

        const predictions = computeDefaultPredictionsForEdit({
            peopleValue,
            availableTimeValue,
            lots,
            productMap,
            fallbackProductId: productId,
        });

        expect(predictions).toHaveLength(1);
        const [prediction] = predictions;
        const expectedFloor = Math.floor((parseFloat(peopleValue) * parseFloat(availableTimeValue)) / standardTime);
        expect(expectedFloor).toBeGreaterThan(0);
        expect(prediction.plannedPieces).toBe(expectedFloor);
        expect(prediction.plannedPieces * standardTime).toBeLessThanOrEqual(parseFloat(peopleValue) * parseFloat(availableTimeValue));
    });

    it('limits planned pieces to the floor when falling back to the selected product', () => {
        const peopleValue = '1';
        const availableTimeValue = '11';
        const productId = 'product-2';
        const standardTime = 6;

        const lots = [];
        const productMap = new Map([
            [productId, { id: productId, name: 'Produto 2', standardTime }],
        ]);

        const predictions = computeDefaultPredictionsForEdit({
            peopleValue,
            availableTimeValue,
            lots,
            productMap,
            fallbackProductId: productId,
        });

        expect(predictions).toHaveLength(1);
        const [prediction] = predictions;
        const totalAvailableTime = parseFloat(peopleValue) * parseFloat(availableTimeValue);
        const expectedFloor = Math.floor(totalAvailableTime / standardTime);
        expect(expectedFloor).toBeGreaterThan(0);
        expect(prediction.plannedPieces).toBe(expectedFloor);
        expect(prediction.remainingPieces).toBe(expectedFloor);
        expect(prediction.plannedPieces * standardTime).toBeLessThanOrEqual(totalAvailableTime);
    });
});

describe('computeMetaFromStandardTime', () => {
    it('floors the goal when the ratio is greater than one but below the next whole number', () => {
        const standardTime = 100;
        const availableTime = 160;

        const meta = computeMetaFromStandardTime(standardTime, availableTime);

        expect(meta).toBe(1);
    });

    it('returns zero when the available time is insufficient for a complete piece', () => {
        const standardTime = 100;
        const availableTime = 99;

        const meta = computeMetaFromStandardTime(standardTime, availableTime);

        expect(meta).toBe(0);
    });
});

describe('computeEfficiencyPercentage', () => {
    it('keeps the efficiency aligned with the floored meta value', () => {
        const standardTime = 100;
        const availableTime = 160;
        const producedPieces = 1;

        const meta = computeMetaFromStandardTime(standardTime, availableTime);
        const efficiency = computeEfficiencyPercentage(producedPieces, standardTime, availableTime);

        expect(meta).toBe(1);
        expect(efficiency).toBe(62.5);
    });
});
