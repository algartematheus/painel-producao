import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StockContext, StockMovementsPage } from './gerenciamentodeestoque';
import importLegacyStockFile, { flattenSnapshotsToVariations } from './stockImporter';
import importStockFile from './importStockFile';

jest.mock('./stockImporter', () => ({
    __esModule: true,
    default: jest.fn(),
    flattenSnapshotsToVariations: jest.fn(),
}));

jest.mock('./importStockFile', () => ({
    __esModule: true,
    default: jest.fn(),
}));

const renderMovementsPage = (contextOverrides = {}) => {
    const defaultContext = {
        products: [],
        categories: [],
        addStockMovement: jest.fn(),
        stockMovements: [],
        deleteStockMovement: jest.fn(),
    };
    return render(
        <StockContext.Provider value={{ ...defaultContext, ...contextOverrides }}>
            <StockMovementsPage setConfirmation={jest.fn()} />
        </StockContext.Provider>
    );
};

beforeEach(() => {
    jest.clearAllMocks();
});

test('permite seleção de arquivos DOCX e TXT no campo de importação', () => {
    renderMovementsPage();
    const fileInput = screen.getByLabelText(/Arquivo de importação/i);
    expect(fileInput).toHaveAttribute('accept', expect.stringContaining('.docx'));
    expect(fileInput).toHaveAttribute('accept', expect.stringContaining('.txt'));
});

test('importa arquivos DOCX utilizando o novo fluxo de pré-visualização', async () => {
    const snapshots = [
        {
            productCode: '016',
            grade: ['P', 'M'],
            variations: [
                {
                    ref: '016.AZ',
                    tamanhos: { P: 2, M: 3 },
                    total: 5,
                },
            ],
        },
    ];
    importStockFile.mockResolvedValue(snapshots);
    flattenSnapshotsToVariations.mockReturnValue(snapshots[0].variations);

    renderMovementsPage({
        products: [
            {
                id: 'p1',
                name: '016 Camiseta',
                categoryId: 'c1',
                variations: [{ id: 'v1', name: '016.AZ' }],
            },
        ],
    });

    const fileInput = screen.getByLabelText(/Arquivo de importação/i);
    const file = new File(['conteudo'], 'relatorio.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    Object.defineProperty(file, 'arrayBuffer', {
        value: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
        expect(importStockFile).toHaveBeenCalledTimes(1);
    });

    expect(importLegacyStockFile).not.toHaveBeenCalled();
    expect(importStockFile).toHaveBeenCalledWith(file, { productOrder: ['016'] });
    expect(screen.getByText(/Quantidade total: 5/)).toBeInTheDocument();
});
