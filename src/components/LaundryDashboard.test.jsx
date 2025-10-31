import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LaundryDashboard from './LaundryDashboard';

const StubVariationSummary = ({ variations, title }) => (
  <div data-testid="variation-summary">
    <span>{title}</span>
    {variations.map(variation => (
      <div key={variation.label}>{variation.label}: {variation.produced}/{variation.target}</div>
    ))}
  </div>
);

const sampleLots = [
  {
    id: 'lot-1',
    productName: 'Calça Jeans',
    sequentialId: 10,
    status: 'ongoing',
    order: 1,
    laundrySentAt: new Date('2024-05-01T10:00:00Z'),
    variations: [
      { variationId: 'v1', label: 'Azul', target: 100, laundrySent: 100, laundryReturned: 40 },
      { variationId: 'v2', label: 'Preto', target: 80, laundrySent: 80, laundryReturned: 20 },
    ],
    createdBy: { email: 'operador@empresa.com' },
  },
  {
    id: 'lot-2',
    productName: 'Jaqueta Couro',
    sequentialId: 11,
    status: 'completed',
    order: 2,
    laundrySentAt: new Date('2024-04-28T08:00:00Z'),
    laundryReturnedAt: new Date('2024-05-02T15:00:00Z'),
    variations: [
      { variationId: 'v3', label: 'M', target: 50, laundrySent: 50, laundryReturned: 50 },
    ],
    laundryReturnQuantities: { v3: 50 },
  },
];

describe('LaundryDashboard', () => {
  it('renders laundry metrics and pending lots', () => {
    render(
      <LaundryDashboard
        lots={sampleLots}
        lotFilter="ongoing"
        onLotFilterChange={jest.fn()}
        onLotStatusChange={jest.fn()}
        onStartEditLot={jest.fn()}
        onMoveLot={jest.fn()}
        onDeleteLot={jest.fn()}
        onOpenObservation={jest.fn()}
        canManageLots={true}
        LotVariationSummaryComponent={StubVariationSummary}
        onRegisterReturn={jest.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText('Status da Lavanderia')).toBeInTheDocument();
    expect(screen.getByText('Pendentes: 1')).toBeInTheDocument();
    expect(screen.getByText('Concluídos: 1')).toBeInTheDocument();

    const tempoCard = screen.getByText('Tempo Médio de Retorno').parentElement;
    expect(within(tempoCard).getByText(/dias/)).toBeInTheDocument();

    expect(screen.getByText('Calça Jeans')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByTestId('variation-summary')).toBeInTheDocument();
  });

  it('submits return data using modal form', async () => {
    const onRegisterReturn = jest.fn().mockResolvedValue(undefined);

    render(
      <LaundryDashboard
        lots={sampleLots}
        lotFilter="ongoing"
        onLotFilterChange={jest.fn()}
        onLotStatusChange={jest.fn()}
        onStartEditLot={jest.fn()}
        onMoveLot={jest.fn()}
        onDeleteLot={jest.fn()}
        onOpenObservation={jest.fn()}
        canManageLots={true}
        LotVariationSummaryComponent={StubVariationSummary}
        onRegisterReturn={onRegisterReturn}
      />
    );

    fireEvent.click(screen.getByText('Completa'));

    expect(screen.getByText(/Registrar devolução completa/i)).toBeInTheDocument();

    const inputs = screen.getAllByLabelText('Quantidade a registrar');
    fireEvent.change(inputs[0], { target: { value: '95' } });
    fireEvent.change(inputs[1], { target: { value: '75' } });

    fireEvent.click(screen.getByText('Registrar devolução'));

    await waitFor(() => expect(onRegisterReturn).toHaveBeenCalledTimes(1));

    expect(onRegisterReturn).toHaveBeenCalledWith('lot-1', {
      mode: 'complete',
      quantities: { v1: 95, v2: 75 },
      notes: '',
    });
  });

  it('validates partial return quantities before submitting', async () => {
    const onRegisterReturn = jest.fn().mockResolvedValue(undefined);

    render(
      <LaundryDashboard
        lots={sampleLots}
        lotFilter="ongoing"
        onLotFilterChange={jest.fn()}
        onLotStatusChange={jest.fn()}
        onStartEditLot={jest.fn()}
        onMoveLot={jest.fn()}
        onDeleteLot={jest.fn()}
        onOpenObservation={jest.fn()}
        canManageLots={true}
        LotVariationSummaryComponent={StubVariationSummary}
        onRegisterReturn={onRegisterReturn}
      />
    );

    fireEvent.click(screen.getByText('Parcial'));

    const inputs = screen.getAllByLabelText('Quantidade a registrar');
    inputs.forEach(input => {
      fireEvent.change(input, { target: { value: '0' } });
    });

    fireEvent.click(screen.getByText('Registrar devolução'));

    await waitFor(() => {
      expect(screen.getByText('Informe ao menos uma quantidade devolvida.')).toBeInTheDocument();
    });

    expect(onRegisterReturn).not.toHaveBeenCalled();
  });
});
