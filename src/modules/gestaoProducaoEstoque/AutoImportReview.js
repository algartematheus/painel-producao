import React, { useMemo, useState, useCallback } from 'react';
import { GripVertical } from 'lucide-react';

const normalizeProductCode = (value = '') => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.toUpperCase() : '';
};

const normalizeVariationRef = (value = '') => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.toUpperCase() : '';
};

const resolveGradeList = (snapshot) => {
    if (Array.isArray(snapshot?.grade) && snapshot.grade.length) {
        return snapshot.grade;
    }
    const tamanhos = new Set();
    (snapshot?.variations || []).forEach((variation) => {
        Object.keys(variation?.tamanhos || {}).forEach((size) => {
            if (size) {
                tamanhos.add(size);
            }
        });
    });
    return Array.from(tamanhos);
};

const safeNumber = (value) => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const getVariationTotal = (variation) => {
    if (typeof variation?.total === 'number' && Number.isFinite(variation.total)) {
        return variation.total;
    }
    return Object.values(variation?.tamanhos || {}).reduce((sum, current) => sum + safeNumber(current), 0);
};

const formatCellValue = (value) => {
    if (value === 0) {
        return '0';
    }
    if (!value) {
        return '';
    }
    return String(value);
};

const getTotalTone = (value) => {
    if (value > 0) {
        return 'text-red-600 dark:text-red-400 font-semibold';
    }
    if (value < 0) {
        return 'text-blue-600 dark:text-blue-400 font-semibold';
    }
    return 'text-gray-700 dark:text-gray-200';
};

const AutoImportReview = ({
    rawSnapshots = [],
    orderedProductCodes = [],
    adjustments = {},
    onReorder,
    onToggleGrouping,
    onToggleAlwaysSeparate,
}) => {
    const [draggingCode, setDraggingCode] = useState(null);

    const normalizedSnapshotMap = useMemo(() => {
        const map = new Map();
        rawSnapshots.forEach((snapshot) => {
            if (!snapshot || !snapshot.productCode) {
                return;
            }
            map.set(normalizeProductCode(snapshot.productCode), snapshot);
        });
        return map;
    }, [rawSnapshots]);

    const orderedCodes = useMemo(() => {
        const seen = new Set();
        const finalOrder = [];
        orderedProductCodes.forEach((codigo) => {
            const normalized = normalizeProductCode(codigo);
            if (!normalized || seen.has(normalized)) {
                return;
            }
            if (normalizedSnapshotMap.has(normalized)) {
                seen.add(normalized);
                finalOrder.push(normalized);
            }
        });
        normalizedSnapshotMap.forEach((_, codigoNormalizado) => {
            if (!seen.has(codigoNormalizado)) {
                seen.add(codigoNormalizado);
                finalOrder.push(codigoNormalizado);
            }
        });
        return finalOrder;
    }, [orderedProductCodes, normalizedSnapshotMap]);

    const produtosOrdenados = orderedCodes
        .map((codigo) => normalizedSnapshotMap.get(codigo))
        .filter(Boolean);

    const getAdjustment = useCallback(
        (productCode) => {
            const normalized = normalizeProductCode(productCode);
            return adjustments?.[normalized] || null;
        },
        [adjustments],
    );

    const handleDragStart = (event, productCode) => {
        if (!productCode) {
            return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', productCode);
        setDraggingCode(productCode);
    };

    const handleDrop = (event, targetCode = null) => {
        event.preventDefault();
        const draggedCode = event.dataTransfer.getData('text/plain');
        setDraggingCode(null);
        if (!draggedCode || draggedCode === targetCode) {
            return;
        }
        if (typeof onReorder === 'function') {
            onReorder(draggedCode, targetCode);
        }
    };

    const handleDragOver = (event) => {
        event.preventDefault();
    };

    const renderResumoRow = (variations, gradeLength) => {
        const resumo = variations.reduce(
            (acc, variation) => {
                const total = getVariationTotal(variation);
                if (total > 0) {
                    acc.positivo += total;
                } else if (total < 0) {
                    acc.negativo += total;
                }
                return acc;
            },
            { positivo: 0, negativo: 0 },
        );
        return (
            <tr className="bg-gray-50 dark:bg-gray-900/40">
                <td colSpan={Math.max(gradeLength + 3, 2)} className="px-3 py-2 text-sm">
                    <div className="flex flex-wrap gap-4 text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">
                            Necessário produzir:{' '}
                            <span className="text-red-600 dark:text-red-400">{resumo.positivo}</span>
                        </span>
                        <span className="font-medium text-gray-700 dark:text-gray-200">
                            Sobra consolidada:{' '}
                            <span className="text-blue-600 dark:text-blue-400">{resumo.negativo}</span>
                        </span>
                    </div>
                </td>
            </tr>
        );
    };

    if (!produtosOrdenados.length) {
        return (
            <p className="text-sm text-gray-600 dark:text-gray-300">
                Gere uma prévia para revisar, reordenar e ajustar as variações antes de confirmar o lançamento.
            </p>
        );
    }

    return (
        <div className="space-y-6">
            <p className="text-sm text-gray-600 dark:text-gray-300">
                Arraste os produtos pelo ícone de alça para definir a ordem final. Use os botões para alternar entre{' '}
                <strong>Juntas</strong> ou <strong>Separadas</strong> e marque as variações que precisam ser registradas
                sempre em snapshots individuais.
            </p>
            {produtosOrdenados.map((produto) => {
                const grade = resolveGradeList(produto);
                const variations = Array.isArray(produto?.variations) ? produto.variations : [];
                const adjustment = getAdjustment(produto.productCode) || {};
                const groupingMode = adjustment.groupingMode === 'separadas' ? 'separadas' : 'juntas';
                const alwaysSeparateRefs = adjustment.alwaysSeparateRefs || {};
                const isDragging = draggingCode && normalizeProductCode(draggingCode) === normalizeProductCode(produto.productCode);
                return (
                    <div
                        key={produto.productCode}
                        className={`rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900 shadow-sm ${
                            isDragging ? 'ring-2 ring-indigo-500' : ''
                        }`}
                        onDragOver={handleDragOver}
                        onDrop={(event) => handleDrop(event, produto.productCode)}
                    >
                        <div className="flex flex-col gap-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-dashed border-gray-400 text-gray-500"
                                    draggable
                                    onDragStart={(event) => handleDragStart(event, produto.productCode)}
                                    onDragEnd={() => setDraggingCode(null)}
                                    aria-label={`Reordenar produto ${produto.productCode}`}
                                >
                                    <GripVertical size={16} />
                                </button>
                                <div>
                                    <h4 className="text-lg font-semibold">Produto {produto.productCode}</h4>
                                    <p className="text-sm text-gray-600 dark:text-gray-300">
                                        Grade: {grade.length ? grade.join(' / ') : 'Sem grade definida'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold uppercase text-gray-500">Agrupamento</span>
                                <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700 overflow-hidden">
                                    {['juntas', 'separadas'].map((modo) => (
                                        <button
                                            key={modo}
                                            type="button"
                                            onClick={() => onToggleGrouping && onToggleGrouping(produto.productCode, modo)}
                                            className={`px-3 py-1 text-sm font-medium transition-colors ${
                                                groupingMode === modo
                                                    ? 'bg-indigo-600 text-white'
                                                    : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200'
                                            }`}
                                        >
                                            {modo === 'juntas' ? 'Juntas' : 'Separadas'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-sm">
                                <thead className="bg-gray-100 dark:bg-gray-900/50">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-200">Variação</th>
                                        {grade.map((tamanho) => (
                                            <th
                                                key={`${produto.productCode}-${tamanho}`}
                                                className="px-2 py-2 text-center font-semibold text-gray-700 dark:text-gray-200"
                                            >
                                                {tamanho}
                                            </th>
                                        ))}
                                        <th className="px-2 py-2 text-center font-semibold text-gray-700 dark:text-gray-200">Total</th>
                                        <th className="px-2 py-2 text-center font-semibold text-gray-700 dark:text-gray-200">
                                            Sempre separar
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                                    {variations.map((variation) => {
                                        const variationTotal = getVariationTotal(variation);
                                        const refNormalizada = normalizeVariationRef(variation.ref);
                                        const checked = Boolean(alwaysSeparateRefs?.[refNormalizada]);
                                        return (
                                            <tr key={`${produto.productCode}-${variation.ref || 'sem-ref'}`}>
                                                <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">
                                                    {variation.ref || 'Sem referência'}
                                                </td>
                                                {grade.map((tamanho) => {
                                                    const valor = safeNumber(variation?.tamanhos?.[tamanho]);
                                                    return (
                                                        <td key={`${produto.productCode}-${variation.ref}-${tamanho}`} className="px-2 py-2 text-center">
                                                            <span className="tabular-nums text-sm text-gray-700 dark:text-gray-200">
                                                                {formatCellValue(valor)}
                                                            </span>
                                                        </td>
                                                    );
                                                })}
                                                <td className={`px-2 py-2 text-center tabular-nums ${getTotalTone(variationTotal)}`}>
                                                    {variationTotal}
                                                </td>
                                                <td className="px-2 py-2 text-center">
                                                    <input
                                                        type="checkbox"
                                                        className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                                                        checked={checked}
                                                        onChange={(event) =>
                                                            onToggleAlwaysSeparate &&
                                                            onToggleAlwaysSeparate(
                                                                produto.productCode,
                                                                variation.ref,
                                                                event.target.checked,
                                                            )
                                                        }
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {renderResumoRow(variations, grade.length)}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
            <div
                className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-4 text-center text-sm text-gray-600 dark:text-gray-300"
                onDragOver={handleDragOver}
                onDrop={(event) => handleDrop(event, null)}
            >
                Solte aqui para mover o produto para o final da lista.
            </div>
        </div>
    );
};

export default AutoImportReview;
