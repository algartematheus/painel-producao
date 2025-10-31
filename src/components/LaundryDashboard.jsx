import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Edit, MessageSquare, Package, PackageCheck, Trash2 } from 'lucide-react';
import SummaryCard from './SummaryCard';

const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') {
        try {
            const converted = value.toDate();
            return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
        } catch (error) {
            console.warn('Não foi possível converter valor em data da lavanderia:', error);
        }
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof value === 'object' && typeof value.seconds === 'number') {
        const milliseconds = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
        const parsed = new Date(milliseconds);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};

const toNonNegativeNumber = (value) => {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return 0;
        return value >= 0 ? value : 0;
    }
    if (typeof value === 'string') {
        const normalized = value.replace(',', '.');
        const parsed = parseFloat(normalized);
        if (!Number.isFinite(parsed)) return 0;
        return parsed >= 0 ? parsed : 0;
    }
    return 0;
};

const computeVariationData = (lot) => {
    const variations = Array.isArray(lot?.variations) ? lot.variations : [];
    const totals = (lot?.laundryReturnQuantities && typeof lot.laundryReturnQuantities === 'object')
        ? lot.laundryReturnQuantities
        : {};

    return variations.map((variation, index) => {
        const key = variation?.variationId || variation?.id || `index-${index}`;
        const label = (variation?.label && variation.label.trim().length > 0)
            ? variation.label
            : `Var. ${index + 1}`;

        const sent = toNonNegativeNumber(
            variation?.laundrySent
            ?? variation?.sent
            ?? variation?.target
            ?? variation?.expected
            ?? 0,
        );

        const returnedFromVariation = variation?.laundryReturned ?? variation?.returned ?? variation?.produced;
        const returnedFromTotals = totals[key]
            ?? totals[variation?.variationId]
            ?? totals[variation?.id]
            ?? totals[label];
        const returned = toNonNegativeNumber(returnedFromTotals ?? returnedFromVariation ?? 0);

        return { key, label, sent, returned, raw: variation };
    });
};

const computeLotTotals = (lot) => {
    const variationData = computeVariationData(lot);

    const sentFromVariations = variationData.reduce((sum, variation) => sum + variation.sent, 0);
    const returnedFromVariations = variationData.reduce((sum, variation) => sum + variation.returned, 0);

    const fallbackSent = toNonNegativeNumber(
        lot?.laundrySentQuantity
        ?? lot?.sentQuantity
        ?? lot?.target
        ?? 0,
    );

    const aggregatedReturnTotals = (lot?.laundryReturnQuantities && typeof lot.laundryReturnQuantities === 'object')
        ? Object.values(lot.laundryReturnQuantities).reduce((sum, value) => sum + toNonNegativeNumber(value), 0)
        : 0;

    const fallbackReturned = toNonNegativeNumber(
        lot?.laundryReturnedQuantity
        ?? aggregatedReturnTotals
        ?? lot?.produced
        ?? 0,
    );

    return {
        sent: sentFromVariations > 0 ? sentFromVariations : fallbackSent,
        returned: returnedFromVariations > 0 ? returnedFromVariations : fallbackReturned,
        variations: variationData,
    };
};

const formatDateTime = (value) => {
    const date = toDate(value);
    if (!date) return '--';
    return date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const computeDaysDifference = (startValue, endValue) => {
    const start = toDate(startValue);
    const end = toDate(endValue);
    if (!start || !end) return null;
    const diffMs = end.getTime() - start.getTime();
    if (!Number.isFinite(diffMs)) return null;
    if (diffMs < 0) return null;
    return diffMs / (1000 * 60 * 60 * 24);
};

const isLotCompleted = (lot) => {
    if (!lot) return false;
    if (toDate(lot.laundryReturnedAt)) return true;
    const status = lot.status;
    return typeof status === 'string' && status.startsWith('completed');
};

const LaundryDashboard = ({
    lots = [],
    lotFilter = 'ongoing',
    onLotFilterChange = () => {},
    onLotStatusChange = () => {},
    onStartEditLot = () => {},
    onMoveLot = () => {},
    onDeleteLot = () => {},
    onOpenObservation = () => {},
    canManageLots = false,
    LotVariationSummaryComponent = null,
    onRegisterReturn = async () => {},
}) => {
    const VariationSummary = LotVariationSummaryComponent || (() => null);

    const orderedLots = useMemo(() => {
        if (!Array.isArray(lots)) return [];
        return [...lots].sort((a, b) => {
            const orderA = Number.isFinite(a?.order) ? a.order : 0;
            const orderB = Number.isFinite(b?.order) ? b.order : 0;
            return orderA - orderB;
        });
    }, [lots]);

    const filteredLots = useMemo(() => {
        if (lotFilter === 'completed') {
            return orderedLots.filter(lot => isLotCompleted(lot));
        }
        if (lotFilter === 'ongoing') {
            return orderedLots.filter(lot => !isLotCompleted(lot));
        }
        return orderedLots;
    }, [orderedLots, lotFilter]);

    const metrics = useMemo(() => {
        const summary = {
            pending: 0,
            completed: 0,
            durations: [],
            variationTotals: new Map(),
        };

        orderedLots.forEach(lot => {
            if (isLotCompleted(lot)) {
                summary.completed += 1;
            } else {
                summary.pending += 1;
            }

            const differenceInDays = computeDaysDifference(lot.laundrySentAt, lot.laundryReturnedAt);
            if (differenceInDays !== null) {
                summary.durations.push(differenceInDays);
            }

            computeVariationData(lot).forEach(variation => {
                const current = summary.variationTotals.get(variation.label) || { label: variation.label, sent: 0, returned: 0 };
                summary.variationTotals.set(variation.label, {
                    label: variation.label,
                    sent: current.sent + variation.sent,
                    returned: current.returned + variation.returned,
                });
            });
        });

        const averageDuration = summary.durations.length > 0
            ? summary.durations.reduce((accumulator, value) => accumulator + value, 0) / summary.durations.length
            : 0;

        const divergences = Array.from(summary.variationTotals.values())
            .map(item => ({
                ...item,
                delta: item.returned - item.sent,
            }))
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

        return {
            pending: summary.pending,
            completed: summary.completed,
            averageDuration,
            divergences,
        };
    }, [orderedLots]);

    const numberFormatter = useMemo(() => new Intl.NumberFormat('pt-BR'), []);
    const durationFormatter = useMemo(() => new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    }), []);

    const [returnModal, setReturnModal] = useState({ isOpen: false, lot: null, mode: 'partial' });
    const [returnQuantities, setReturnQuantities] = useState({});
    const [returnNotes, setReturnNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    const modalVariations = useMemo(() => {
        if (!returnModal.lot) return [];
        const variations = computeVariationData(returnModal.lot);
        if (variations.length > 0) {
            return variations;
        }
        const fallbackSent = toNonNegativeNumber(returnModal.lot?.laundrySentQuantity ?? returnModal.lot?.target ?? 0);
        const fallbackReturned = toNonNegativeNumber(returnModal.lot?.laundryReturnedQuantity ?? returnModal.lot?.produced ?? 0);
        return [{ key: 'total', label: 'Total', sent: fallbackSent, returned: fallbackReturned, raw: null }];
    }, [returnModal]);

    useEffect(() => {
        if (!returnModal.isOpen) {
            setReturnQuantities({});
            setReturnNotes('');
            setSubmitError('');
            return;
        }

        const defaults = {};
        modalVariations.forEach(variation => {
            const remaining = Math.max(variation.sent - variation.returned, 0);
            defaults[variation.key] = returnModal.mode === 'complete'
                ? variation.sent
                : (remaining > 0 ? remaining : variation.sent);
        });
        setReturnQuantities(defaults);
        setReturnNotes('');
        setSubmitError('');
    }, [returnModal, modalVariations]);

    const closeModal = () => {
        setReturnModal({ isOpen: false, lot: null, mode: 'partial' });
        setReturnQuantities({});
        setReturnNotes('');
        setSubmitError('');
    };

    const handleSubmitReturn = async (event) => {
        event.preventDefault();
        if (!returnModal.lot) return;

        setIsSubmitting(true);
        setSubmitError('');

        try {
            const normalized = Object.entries(returnQuantities).reduce((accumulator, [key, value]) => {
                const numeric = toNonNegativeNumber(value);
                return { ...accumulator, [key]: numeric };
            }, {});

            const hasPositive = Object.values(normalized).some(value => value > 0);
            if (!hasPositive) {
                setSubmitError('Informe ao menos uma quantidade devolvida.');
                setIsSubmitting(false);
                return;
            }

            await onRegisterReturn(returnModal.lot.id, {
                mode: returnModal.mode,
                quantities: normalized,
                notes: returnNotes.trim(),
            });
            closeModal();
        } catch (error) {
            setSubmitError(error?.message || 'Não foi possível registrar a devolução.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="grid grid-cols-1 gap-8">
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SummaryCard
                    title="Status da Lavanderia"
                    contentClassName="space-y-2 text-sm text-gray-600 dark:text-gray-300"
                >
                    <p><span className="font-semibold">Pendentes:</span> {numberFormatter.format(metrics.pending)}</p>
                    <p><span className="font-semibold">Concluídos:</span> {numberFormatter.format(metrics.completed)}</p>
                </SummaryCard>
                <SummaryCard
                    title="Tempo Médio de Retorno"
                    contentClassName="space-y-2 text-sm text-gray-600 dark:text-gray-300"
                >
                    {metrics.averageDuration > 0
                        ? <p>{durationFormatter.format(metrics.averageDuration)} dias</p>
                        : <p>Nenhuma devolução concluída até o momento.</p>}
                </SummaryCard>
                <SummaryCard
                    title="Divergências por Variação"
                    contentClassName="space-y-2 text-sm text-gray-600 dark:text-gray-300"
                >
                    {metrics.divergences.length === 0 && <p>Sem divergências registradas.</p>}
                    {metrics.divergences.slice(0, 5).map(item => (
                        <div key={item.label} className="flex items-center justify-between">
                            <span className="font-medium truncate" title={item.label}>{item.label}</span>
                            <span className={item.delta === 0 ? '' : (item.delta > 0 ? 'text-green-600' : 'text-red-600')}>
                                {numberFormatter.format(item.delta)}
                            </span>
                        </div>
                    ))}
                </SummaryCard>
            </section>

            <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <Package className="text-blue-500" size={20} />
                            Controle de Lotes na Lavanderia
                        </h2>
                        <div className="flex gap-2 flex-wrap">
                            <button
                                type="button"
                                onClick={() => onLotFilterChange('ongoing')}
                                className={`px-3 py-1 text-sm rounded-full ${lotFilter === 'ongoing' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                            >
                                Pendentes
                            </button>
                            <button
                                type="button"
                                onClick={() => onLotFilterChange('completed')}
                                className={`px-3 py-1 text-sm rounded-full ${lotFilter === 'completed' ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                            >
                                Concluídos
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                <tr>
                                    <th className="p-3">Lote</th>
                                    <th className="p-3">Variações (Devolvido / Enviado)</th>
                                    <th className="p-3 text-center">Qtd. Enviada</th>
                                    <th className="p-3 text-center">Qtd. Devolvida</th>
                                    <th className="p-3 text-center">Envio</th>
                                    <th className="p-3 text-center">Devolução</th>
                                    <th className="p-3 text-center">Dif. (dias)</th>
                                    <th className="p-3 text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {filteredLots.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="p-6 text-center text-gray-500 dark:text-gray-400">
                                            Nenhum lote encontrado para o filtro selecionado.
                                        </td>
                                    </tr>
                                )}
                                {filteredLots.map((lot, index, array) => {
                                    const totals = computeLotTotals(lot);
                                    const sentLabel = numberFormatter.format(Math.round(totals.sent || 0));
                                    const returnedLabel = numberFormatter.format(Math.round(totals.returned || 0));
                                    const sentDate = toDate(lot.laundrySentAt);
                                    const returnedDate = toDate(lot.laundryReturnedAt);
                                    const duration = computeDaysDifference(sentDate, returnedDate);

                                    const summaryVariations = totals.variations.map(variation => ({
                                        ...variation.raw,
                                        label: variation.label,
                                        produced: variation.returned,
                                        target: variation.sent,
                                    }));

                                    return (
                                        <tr key={lot.id} className="bg-white dark:bg-gray-900">
                                            <td className="p-4 align-top min-w-[240px]">
                                                <div className="flex items-start gap-3">
                                                    {canManageLots && !isLotCompleted(lot) && (
                                                        <div className="flex flex-col">
                                                            <button
                                                                type="button"
                                                                onClick={() => onMoveLot(lot.id, 'up')}
                                                                disabled={index === 0}
                                                                className="disabled:opacity-30"
                                                                aria-label="Mover lote para cima"
                                                            >
                                                                <ChevronUp size={16} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => onMoveLot(lot.id, 'down')}
                                                                disabled={index === array.length - 1}
                                                                className="disabled:opacity-30"
                                                                aria-label="Mover lote para baixo"
                                                            >
                                                                <ChevronDown size={16} />
                                                            </button>
                                                        </div>
                                                    )}
                                                    <div className="space-y-1">
                                                        <p className="font-semibold text-lg">
                                                            {lot.productName || 'Produto desconhecido'}{lot.customName ? ` - ${lot.customName}` : ''}
                                                        </p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Lote #{lot.sequentialId ?? '--'}</p>
                                                        {lot.createdBy?.email && (
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Criado por: {lot.createdBy.email}</p>
                                                        )}
                                                        {lot.lastEditedBy?.email && (
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Editado por: {lot.lastEditedBy.email}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4 align-top">
                                                <VariationSummary
                                                    title="Devolvido / Enviado"
                                                    variations={summaryVariations}
                                                />
                                            </td>
                                            <td className="p-4 text-center align-top font-semibold text-blue-600 dark:text-blue-300">
                                                {sentLabel}
                                            </td>
                                            <td className="p-4 text-center align-top font-semibold text-green-600 dark:text-green-300">
                                                {returnedLabel}
                                            </td>
                                            <td className="p-4 text-center align-top">{formatDateTime(lot.laundrySentAt)}</td>
                                            <td className="p-4 text-center align-top">{formatDateTime(lot.laundryReturnedAt)}</td>
                                            <td className="p-4 text-center align-top">
                                                {duration !== null ? `${durationFormatter.format(duration)} dias` : '--'}
                                            </td>
                                            <td className="p-4 align-top">
                                                <div className="flex flex-col gap-3 items-center">
                                                    {canManageLots && (
                                                        <select
                                                            value={lot.status}
                                                            onChange={(event) => onLotStatusChange(lot.id, event.target.value)}
                                                            className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-200 dark:bg-gray-700 border-none"
                                                        >
                                                            {(!isLotCompleted(lot)) ? (
                                                                <>
                                                                    <option value={lot.status}>{lot.status === 'future' ? 'Na fila' : 'Em andamento'}</option>
                                                                    <option value="completed">Concluir</option>
                                                                    <option value="completed_missing">Concluir c/ Falta</option>
                                                                    <option value="completed_exceeding">Concluir c/ Sobra</option>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <option value={lot.status}>
                                                                        {lot.status === 'completed' ? 'Concluído' : lot.status === 'completed_missing' ? 'Com Falta' : 'Com Sobra'}
                                                                    </option>
                                                                    <option value="ongoing">Reabrir</option>
                                                                </>
                                                            )}
                                                        </select>
                                                    )}
                                                    <div className="flex gap-2 flex-wrap justify-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => setReturnModal({ isOpen: true, lot, mode: 'partial' })}
                                                            className="flex items-center gap-1 px-3 py-1 rounded-md bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                                                        >
                                                            <Package size={16} /> Parcial
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setReturnModal({ isOpen: true, lot, mode: 'complete' })}
                                                            className="flex items-center gap-1 px-3 py-1 rounded-md bg-green-100 text-green-700 hover:bg-green-200"
                                                        >
                                                            <PackageCheck size={16} /> Completa
                                                        </button>
                                                    </div>
                                                    <div className="flex gap-2 justify-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => onOpenObservation(lot)}
                                                            title="Observações do lote"
                                                            className="text-blue-500 hover:text-blue-400"
                                                        >
                                                            <MessageSquare size={18} />
                                                        </button>
                                                        {canManageLots && (
                                                            <button
                                                                type="button"
                                                                onClick={() => onStartEditLot(lot)}
                                                                title="Editar lote"
                                                                className="text-yellow-500 hover:text-yellow-400"
                                                            >
                                                                <Edit size={18} />
                                                            </button>
                                                        )}
                                                        {canManageLots && (
                                                            <button
                                                                type="button"
                                                                onClick={() => onDeleteLot(lot.id)}
                                                                title="Excluir lote"
                                                                className="text-red-500 hover:text-red-400"
                                                            >
                                                                <Trash2 size={18} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {returnModal.isOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[120] p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="text-xl font-semibold">
                                    Registrar devolução {returnModal.mode === 'complete' ? 'completa' : 'parcial'}
                                </h3>
                                {returnModal.lot && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                        {returnModal.lot.productName || 'Produto desconhecido'}{returnModal.lot.customName ? ` - ${returnModal.lot.customName}` : ''}
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={closeModal}
                                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                                aria-label="Fechar modal de devolução da lavanderia"
                            >
                                ×
                            </button>
                        </div>
                        <form onSubmit={handleSubmitReturn} className="space-y-4">
                            <div className="space-y-3">
                                {modalVariations.map(variation => (
                                    <div key={variation.key} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                                        <div className="sm:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                {variation.label}
                                            </label>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                Enviado: {numberFormatter.format(Math.round(variation.sent))} | Devolvido: {numberFormatter.format(Math.round(variation.returned))}
                                            </p>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                Quantidade a registrar
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={returnQuantities[variation.key] ?? ''}
                                                onChange={(event) => setReturnQuantities(prev => ({ ...prev, [variation.key]: event.target.value }))}
                                                className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Observações (opcional)
                                </label>
                                <textarea
                                    value={returnNotes}
                                    onChange={(event) => setReturnNotes(event.target.value)}
                                    rows={3}
                                    className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700"
                                    placeholder="Detalhe devoluções parciais, avarias ou observações adicionais"
                                />
                            </div>
                            {submitError && (
                                <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
                            )}
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Registrando...' : 'Registrar devolução'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LaundryDashboard;
