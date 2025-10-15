import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, doc, setDoc, deleteDoc, writeBatch, getDocs, query, orderBy, Timestamp, onSnapshot } from 'firebase/firestore';
import { Layers, List, PlusCircle, Save, Trash2, Trash, Box, ArrowLeft, FileDown, FilePlus } from 'lucide-react';
import { db } from '../firebase';
import { TRAVETE_MACHINES } from './constants';
import { computeOperationalTimeBreakdown } from './travete';
import {
  GlobalStyles,
  generateId,
  createOperationalSequenceOperation,
  convertOperationToSeconds,
  formatSecondsToDurationLabel,
  aggregateProductOptionsForSequences,
  exportSequenciaOperacionalPDF
} from './shared';

export const OperationalSequenceApp = ({ onNavigateToCrono, onNavigateToStock, dashboards = [], user }) => {
    const [sequences, setSequences] = useState([]);
    const [productOptions, setProductOptions] = useState([]);
    const [isLoadingProducts, setIsLoadingProducts] = useState(false);
    const [selectedSequenceId, setSelectedSequenceId] = useState(null);
    const [formState, setFormState] = useState({
        empresa: 'Race Bull',
        modelo: '',
        codigo: '',
        dashboardId: '',
        productId: '',
        baseProductId: '',
    });
    const [operations, setOperations] = useState([createOperationalSequenceOperation({ numero: '1' })]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const sequencesQuery = query(collection(db, 'sequenciasOperacionais'), orderBy('modelo'));
        const unsubscribe = onSnapshot(sequencesQuery, (snap) => {
            setSequences(snap.docs.map(doc => doc.data()));
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        let isMounted = true;
        const fetchProducts = async () => {
            if (!dashboards.length) {
                setProductOptions([]);
                return;
            }
            setIsLoadingProducts(true);
            try {
                const results = await Promise.all(dashboards.map(async (dashboard) => {
                    const snap = await getDocs(collection(db, `dashboards/${dashboard.id}/products`));
                    return snap.docs.map(docSnap => ({
                        id: docSnap.id,
                        dashboardId: dashboard.id,
                        dashboardName: dashboard.name,
                        ...docSnap.data(),
                    }));
                }));
                if (isMounted) {
                    const flattened = results.flat();
                    const aggregated = aggregateProductOptionsForSequences(flattened);
                    setProductOptions(aggregated);
                }
            } catch (error) {
                console.error('Erro ao carregar produtos para Sequência Operacional:', error);
            } finally {
                if (isMounted) {
                    setIsLoadingProducts(false);
                }
            }
        };
        fetchProducts();
        return () => {
            isMounted = false;
        };
    }, [dashboards]);

    const resetForm = useCallback(() => {
        setSelectedSequenceId(null);
        setFormState({
            empresa: 'Race Bull',
            modelo: '',
            codigo: '',
            dashboardId: '',
            productId: '',
            baseProductId: '',
        });
        setOperations([createOperationalSequenceOperation({ numero: '1' })]);
    }, []);

    const totalSeconds = useMemo(() => operations.reduce((total, operation) => total + convertOperationToSeconds(operation), 0), [operations]);
    const totalMinutes = useMemo(() => parseFloat((totalSeconds / 60).toFixed(4)), [totalSeconds]);
    const formattedTotal = useMemo(() => formatSecondsToDurationLabel(totalSeconds), [totalSeconds]);

    const findProductOptionByProductId = useCallback((targetId) => {
        if (!targetId) return null;
        return productOptions.find(option => option.id === targetId || option.relatedProductIds?.includes(targetId)) || null;
    }, [productOptions]);

    useEffect(() => {
        if (!formState.productId || productOptions.length === 0) return;
        const option = findProductOptionByProductId(formState.productId);
        if (option && formState.productId !== option.primaryProductId) {
            setFormState(prev => ({
                ...prev,
                productId: option.primaryProductId,
                baseProductId: prev.baseProductId || option.baseProductId || '',
                dashboardId: option.primaryProduct?.dashboardId || prev.dashboardId,
            }));
        }
    }, [findProductOptionByProductId, formState.productId, productOptions.length]);

    const handleFormChange = useCallback((field, value) => {
        setFormState(prev => ({ ...prev, [field]: value }));
    }, []);

    const handleProductSelect = useCallback((productId) => {
        const option = findProductOptionByProductId(productId);
        if (option) {
            setFormState(prev => ({
                ...prev,
                productId: option.primaryProductId,
                dashboardId: option.primaryProduct?.dashboardId || prev.dashboardId,
                baseProductId: option.baseProductId || '',
                modelo: option.name || option.primaryProduct?.name || prev.modelo,
            }));
        } else {
            setFormState(prev => ({ ...prev, productId, baseProductId: '', dashboardId: prev.dashboardId }));
        }
    }, [findProductOptionByProductId]);

    const handleOperationChange = useCallback((operationId, field, value) => {
        setOperations(prev => prev.map(operation => {
            if (operation.id !== operationId) return operation;
            return { ...operation, [field]: value };
        }));
    }, []);

    const handleAddOperation = useCallback(() => {
        setOperations(prev => {
            const nextIndex = prev.length + 1;
            return [...prev, createOperationalSequenceOperation({ numero: String(nextIndex) })];
        });
    }, []);

    const handleRemoveOperation = useCallback((operationId) => {
        setOperations(prev => {
            const remaining = prev.filter(operation => operation.id !== operationId);
            if (remaining.length === 0) {
                return [createOperationalSequenceOperation({ numero: '1' })];
            }
            return remaining.map((operation, index) => ({ ...operation, numero: operation.numero || String(index + 1) }));
        });
    }, []);

    const buildOperationsForPdf = useCallback(() => operations.map((operation, index) => {
        const seconds = convertOperationToSeconds(operation);
        const minutes = seconds > 0 ? parseFloat((seconds / 60).toFixed(4)) : 0;
        return {
            numero: operation.numero ? parseInt(operation.numero, 10) || index + 1 : index + 1,
            descricao: operation.descricao?.trim() || '',
            maquina: operation.maquina?.trim() || '',
            tempoMinutos: minutes,
        };
    }), [operations]);

    const exportBlankSequence = useCallback(async (presetModelName = formState.modelo || '') => {
        const defaultLineSuggestion = Math.max(operations.length, 25);
        const lineCountInput = window.prompt(
            'Quantas operações deseja exibir na folha em branco?',
            String(defaultLineSuggestion)
        );
        if (lineCountInput === null) {
            return;
        }
        const parsedLineCount = parseInt(lineCountInput, 10);
        const sanitizedLineCount = Number.isFinite(parsedLineCount) && parsedLineCount > 0
            ? parsedLineCount
            : defaultLineSuggestion;

        const modelNameInput = window.prompt(
            'Informe o nome do modelo para o cabeçalho da folha em branco:',
            presetModelName || ''
        );
        if (modelNameInput === null) {
            return;
        }

        const sequencePayload = {
            empresa: formState.empresa || 'Race Bull',
            modelo: modelNameInput.trim() || '__________',
            operacoes: [],
        };

        await exportSequenciaOperacionalPDF(sequencePayload, false, { blankLineCount: sanitizedLineCount });
    }, [formState.empresa, formState.modelo, operations.length]);

    const handleExportSequence = useCallback(async (includeData) => {
        if (!includeData) {
            await exportBlankSequence();
            return;
        }

        const sequencePayload = {
            empresa: formState.empresa || 'Race Bull',
            modelo: formState.modelo || '',
            operacoes: buildOperationsForPdf(),
        };

        const hasFilledOperation = sequencePayload.operacoes.some(op => {
            const hasTime = Number.isFinite(op.tempoMinutos) && op.tempoMinutos > 0;
            return hasTime || op.descricao || op.maquina;
        });

        if (!hasFilledOperation) {
            const proceed = window.confirm('Nenhuma operação preenchida. Deseja gerar a folha em branco?');
            if (!proceed) {
                return;
            }
            await exportBlankSequence(sequencePayload.modelo);
            return;
        }

        await exportSequenciaOperacionalPDF(sequencePayload, true);
    }, [buildOperationsForPdf, exportBlankSequence, formState.empresa, formState.modelo]);

    const handleSelectSequence = useCallback((sequence) => {
        if (!sequence) return;
        const matchingOption = findProductOptionByProductId(sequence.productId);
        const resolvedProductId = matchingOption?.primaryProductId || sequence.productId || '';
        const resolvedBaseId = sequence.baseProductId || matchingOption?.baseProductId || '';
        const resolvedDashboardId = matchingOption?.primaryProduct?.dashboardId || sequence.dashboardId || '';

        setSelectedSequenceId(sequence.id);
        setFormState({
            empresa: sequence.empresa || 'Race Bull',
            modelo: sequence.modelo || '',
            codigo: sequence.codigo || '',
            dashboardId: resolvedDashboardId,
            productId: resolvedProductId,
            baseProductId: resolvedBaseId,
        });
        const loadedOperations = (sequence.operacoes || []).map((operation, index) => {
            const tempoValor = operation.tempoValor !== undefined
                ? operation.tempoValor
                : (operation.unidade === 'seg'
                    ? (operation.tempoSegundos !== undefined ? operation.tempoSegundos : operation.tempo)
                    : (operation.tempoMinutos !== undefined ? operation.tempoMinutos : operation.tempo));
            return createOperationalSequenceOperation({
                id: generateId('seqOp'),
                numero: operation.numero !== undefined ? String(operation.numero) : String(index + 1),
                descricao: operation.descricao || '',
                maquina: operation.maquina || '',
                tempoValor: tempoValor !== undefined && tempoValor !== null ? String(tempoValor) : '',
                unidade: operation.unidade || 'min',
            });
        });
        setOperations(loadedOperations.length > 0 ? loadedOperations : [createOperationalSequenceOperation({ numero: '1' })]);
    }, [findProductOptionByProductId]);

    const updateLinkedProductsStandardTimes = useCallback(async ({ productOption, productionMinutes, traveteMinutesByMachine }) => {
        if (!productOption) return;

        const actor = user ? { uid: user.uid, email: user.email } : null;
        const nowIso = new Date().toISOString();
        const nowTimestamp = Timestamp.now();
        const batch = writeBatch(db);
        let hasUpdates = false;

        const queueUpdate = (product, minutes) => {
            if (!product || !product.dashboardId || !product.id) return;
            const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? parseFloat(minutes.toFixed(4)) : 0;
            const productRef = doc(db, `dashboards/${product.dashboardId}/products`, product.id);
            const payload = {
                standardTime: safeMinutes,
                lastEditedAt: nowTimestamp,
                lastEditedBy: actor,
            };
            if (safeMinutes > 0) {
                const existingHistory = Array.isArray(product.standardTimeHistory)
                    ? product.standardTimeHistory
                    : [];
                payload.standardTimeHistory = [
                    ...existingHistory,
                    {
                        time: safeMinutes,
                        effectiveDate: nowIso,
                        changedBy: actor,
                        source: 'sequencia-operacional',
                    },
                ];
            }
            batch.update(productRef, payload);
            hasUpdates = true;
        };

        const safeProductionMinutes = Number.isFinite(productionMinutes) && productionMinutes >= 0
            ? parseFloat(productionMinutes.toFixed(4))
            : 0;

        (productOption.productionProducts || []).forEach(product => queueUpdate(product, safeProductionMinutes));

        const traveteMap = traveteMinutesByMachine || {};
        Object.entries(productOption.traveteProducts || {}).forEach(([machineType, product]) => {
            const minutesRaw = traveteMap[machineType];
            const safeMinutes = Number.isFinite(minutesRaw) && minutesRaw >= 0
                ? parseFloat(minutesRaw.toFixed(4))
                : 0;
            queueUpdate(product, safeMinutes);
        });

        if (hasUpdates) {
            try {
                await batch.commit();
            } catch (error) {
                console.error('Não foi possível atualizar os tempos padrão vinculados:', error);
            }
        }
    }, [user]);

    const handleSaveSequence = useCallback(async (event) => {
        event.preventDefault();
        if (isSaving) return;
        const trimmedEmpresa = formState.empresa.trim() || 'Race Bull';
        const trimmedModelo = formState.modelo.trim();
        if (!trimmedModelo) {
            alert('Informe o modelo para salvar a sequência operacional.');
            return;
        }
        if (!formState.productId) {
            alert('Selecione um produto para vincular ao tempo padrão.');
            return;
        }
        const selectedOption = findProductOptionByProductId(formState.productId);
        if (!selectedOption) {
            alert('Não foi possível localizar o produto vinculado. Atualize a lista e tente novamente.');
            return;
        }
        const preparedOperations = operations
            .map((operation, index) => {
                const tempoValor = parseFloat(operation.tempoValor);
                const seconds = convertOperationToSeconds(operation);
                if (!(seconds > 0)) return null;
                return {
                    numero: operation.numero ? parseInt(operation.numero, 10) || index + 1 : index + 1,
                    descricao: operation.descricao?.trim() || `Operação ${index + 1}`,
                    maquina: operation.maquina?.trim() || 'N/A',
                    unidade: operation.unidade || 'min',
                    tempoValor: tempoValor || 0,
                    tempoSegundos: parseFloat(seconds.toFixed(2)),
                    tempoMinutos: parseFloat((seconds / 60).toFixed(4)),
                };
            })
            .filter(Boolean);

        if (preparedOperations.length === 0) {
            alert('Adicione pelo menos uma operação com tempo válido.');
            return;
        }

        const tempoSegundosTotal = preparedOperations.reduce((total, operation) => total + operation.tempoSegundos, 0);
        const tempoMinutosTotal = parseFloat((tempoSegundosTotal / 60).toFixed(4));
        const tempoDecimalPadrao = parseFloat(tempoMinutosTotal.toFixed(2));
        const breakdown = computeOperationalTimeBreakdown(preparedOperations);
        const traveteMinutesByMachine = TRAVETE_MACHINES.reduce((acc, machine) => {
            const value = breakdown.traveteMinutesByMachine[machine] || 0;
            acc[machine] = Number.isFinite(value) ? parseFloat(value.toFixed(4)) : 0;
            return acc;
        }, {});
        const productionMinutesOnly = Number.isFinite(breakdown.productionMinutes)
            ? parseFloat(Math.max(0, breakdown.productionMinutes).toFixed(4))
            : tempoMinutosTotal;

        setIsSaving(true);
        try {
            const sequenceId = selectedSequenceId || generateId('seq');
            const sequenceRef = doc(db, 'sequenciasOperacionais', sequenceId);
            const nowTimestamp = Timestamp.now();
            const nowIso = new Date().toISOString();

            const payload = {
                id: sequenceId,
                empresa: trimmedEmpresa,
                modelo: trimmedModelo,
                codigo: formState.codigo.trim(),
                dashboardId: selectedOption.primaryProduct?.dashboardId || formState.dashboardId || null,
                productId: selectedOption.primaryProductId,
                baseProductId: formState.baseProductId || selectedOption.baseProductId || null,
                operacoes: preparedOperations,
                tempoTotal: tempoDecimalPadrao,
                tempoTotalMinutos: tempoMinutosTotal,
                tempoTotalSegundos: parseFloat(tempoSegundosTotal.toFixed(2)),
                tempoTotalFormatado: formatSecondsToDurationLabel(tempoSegundosTotal),
                updatedAt: nowTimestamp,
                updatedBy: user ? { uid: user.uid, email: user.email } : null,
            };

            if (!selectedSequenceId) {
                payload.createdAt = nowTimestamp;
                payload.dataCadastro = nowIso;
                payload.createdBy = user ? { uid: user.uid, email: user.email } : null;
            }

            await setDoc(sequenceRef, payload, { merge: true });
            await updateLinkedProductsStandardTimes({
                productOption: selectedOption,
                productionMinutes: productionMinutesOnly,
                traveteMinutesByMachine,
            });
            setSelectedSequenceId(sequenceId);
            alert('Sequência operacional salva com sucesso!');
        } catch (error) {
            console.error('Erro ao salvar sequência operacional:', error);
            alert('Não foi possível salvar a sequência operacional.');
        } finally {
            setIsSaving(false);
        }
    }, [findProductOptionByProductId, formState, isSaving, operations, selectedSequenceId, updateLinkedProductsStandardTimes, user]);

    const handleDeleteSequence = useCallback(async () => {
        if (!selectedSequenceId) return;
        const sequence = sequences.find(seq => seq.id === selectedSequenceId);
        const confirmationMessage = sequence?.modelo
            ? `Deseja realmente excluir a sequência "${sequence.modelo}"?`
            : 'Deseja realmente excluir esta sequência operacional?';
        if (!window.confirm(confirmationMessage)) return;
        try {
            await deleteDoc(doc(db, 'sequenciasOperacionais', selectedSequenceId));
            resetForm();
            alert('Sequência operacional removida.');
        } catch (error) {
            console.error('Erro ao excluir sequência operacional:', error);
            alert('Não foi possível excluir a sequência.');
        }
    }, [resetForm, selectedSequenceId, sequences]);

    const sortedSequences = useMemo(() => {
        return [...sequences].sort((a, b) => (a.modelo || '').localeCompare(b.modelo || ''));
    }, [sequences]);

    const productOptionsSorted = useMemo(() => {
        return [...productOptions].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }, [productOptions]);

    const selectedProduct = useMemo(() => findProductOptionByProductId(formState.productId), [findProductOptionByProductId, formState.productId]);

    return (
        <div className="responsive-root min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200">
            <GlobalStyles />
            <header className="bg-white dark:bg-gray-900 shadow-md p-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={onNavigateToCrono} className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">
                        <ArrowLeft size={18} /> Voltar para Quadros
                    </button>
                    {onNavigateToStock && (
                        <button onClick={onNavigateToStock} className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600">
                            <Box size={18} /> Estoque
                        </button>
                    )}
                </div>
                <div className="text-right">
                    <h1 className="text-2xl font-bold">Sequência Operacional</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Cadastre e mantenha as operações padrão por modelo.</p>
                </div>
            </header>

            <main className="responsive-main py-6 space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
                    <aside className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold flex items-center gap-2"><List size={18} /> Modelos Cadastrados</h2>
                            <button onClick={resetForm} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-500">
                                <PlusCircle size={16} /> Novo
                            </button>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
                            {sortedSequences.map(sequence => {
                                const isActive = sequence.id === selectedSequenceId;
                                return (
                                    <button
                                        key={sequence.id}
                                        onClick={() => handleSelectSequence(sequence)}
                                        className={`w-full text-left p-3 rounded-lg border transition-colors ${isActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800/60'}`}
                                    >
                                        <p className="font-semibold truncate">{sequence.modelo || 'Sem nome'}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Tempo: {sequence.tempoTotalFormatado || `${sequence.tempoTotal || 0} min`}</p>
                                        {sequence.codigo && <p className="text-[11px] text-gray-400">Código: {sequence.codigo}</p>}
                                    </button>
                                );
                            })}
                            {sortedSequences.length === 0 && <p className="text-sm text-gray-500">Nenhuma sequência cadastrada.</p>}
                        </div>
                        <button
                            onClick={handleDeleteSequence}
                            disabled={!selectedSequenceId}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Trash2 size={18} /> Excluir Sequência
                        </button>
                    </aside>

                    <section className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6 space-y-6">
                        <form onSubmit={handleSaveSequence} className="space-y-6">
                            <div className="responsive-form-grid">
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">Empresa</label>
                                    <input
                                        type="text"
                                        value={formState.empresa}
                                        onChange={(e) => handleFormChange('empresa', e.target.value)}
                                        className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                        placeholder="Ex: Race Bull"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">Modelo</label>
                                    <input
                                        type="text"
                                        value={formState.modelo}
                                        onChange={(e) => handleFormChange('modelo', e.target.value)}
                                        className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                        placeholder="Ex: Calça Jeans Ref. 123"
                                        required
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">Código (opcional)</label>
                                    <input
                                        type="text"
                                        value={formState.codigo}
                                        onChange={(e) => handleFormChange('codigo', e.target.value)}
                                        className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                        placeholder="Ex: CJ-123"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">Produto Vinculado</label>
                                    <select
                                        value={formState.productId}
                                        onChange={(e) => handleProductSelect(e.target.value)}
                                        className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                        required
                                    >
                                        <option value="" disabled>{isLoadingProducts ? 'Carregando produtos...' : 'Selecione um produto'}</option>
                                        {productOptionsSorted.map(product => (
                                            <option key={product.id} value={product.id}>
                                                {product.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold flex items-center gap-2"><Layers size={18} /> Operações do Modelo</h3>
                                    <button type="button" onClick={handleAddOperation} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-500">
                                        <PlusCircle size={16} /> Adicionar operação
                                    </button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-50 dark:bg-gray-800">
                                            <tr>
                                                <th className="p-3 text-left">Nº</th>
                                                <th className="p-3 text-left">Descrição</th>
                                                <th className="p-3 text-left">Máquina</th>
                                                <th className="p-3 text-left">Tempo</th>
                                                <th className="p-3 text-left">Unidade</th>
                                                <th className="p-3 text-center">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                            {operations.map(operation => (
                                                <tr key={operation.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                                                    <td className="p-2">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={operation.numero}
                                                            onChange={(e) => handleOperationChange(operation.id, 'numero', e.target.value)}
                                                            className="w-20 p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            value={operation.descricao}
                                                            onChange={(e) => handleOperationChange(operation.id, 'descricao', e.target.value)}
                                                            className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                            placeholder="Descrição da operação"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            value={operation.maquina}
                                                            onChange={(e) => handleOperationChange(operation.id, 'maquina', e.target.value)}
                                                            className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                            placeholder="Máquina utilizada"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={operation.tempoValor}
                                                            onChange={(e) => handleOperationChange(operation.id, 'tempoValor', e.target.value)}
                                                            className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                            placeholder="Tempo"
                                                        />
                                                    </td>
                                                    <td className="p-2">
                                                        <select
                                                            value={operation.unidade}
                                                            onChange={(e) => handleOperationChange(operation.id, 'unidade', e.target.value)}
                                                            className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                        >
                                                            <option value="min">Minutos</option>
                                                            <option value="seg">Segundos</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-2 text-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveOperation(operation.id)}
                                                            className="text-red-500 hover:text-red-400"
                                                            title="Remover operação"
                                                        >
                                                            <Trash size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Informe o tempo de cada operação em minutos ou segundos. O sistema converterá automaticamente para o tempo padrão do modelo.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-blue-50 dark:bg-blue-900/40 p-4 rounded-xl">
                                    <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200">Resumo do Modelo</h4>
                                    <p className="text-sm mt-2">Tempo Total das Operações:</p>
                                    <p className="text-xl font-bold text-blue-700 dark:text-blue-200">{formattedTotal}</p>
                                    <p className="text-sm mt-2">Tempo Padrão (minutos decimais):</p>
                                    <p className="text-lg font-semibold">{totalMinutes > 0 ? totalMinutes.toFixed(2) : '0.00'} min</p>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl text-sm space-y-2">
                                    <p><span className="font-semibold">Produto vinculado:</span> {selectedProduct ? selectedProduct.name : 'Selecione um produto'}</p>
                                    {selectedProduct?.dashboardNames?.length > 0 && (
                                        <p><span className="font-semibold">Quadros:</span> {selectedProduct.dashboardNames.join(' • ')}</p>
                                    )}
                                    <p><span className="font-semibold">Última atualização:</span> {selectedSequenceId ? 'Sequência existente' : 'Novo cadastro'}</p>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                                <button
                                    type="button"
                                    onClick={() => handleExportSequence(false)}
                                    className="px-4 py-2 rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200"
                                >
                                    <span className="flex items-center justify-center gap-2"><FilePlus size={18} /> Folha em Branco</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleExportSequence(true)}
                                    className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                                >
                                    <span className="flex items-center justify-center gap-2"><FileDown size={18} /> Exportar PDF</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="px-4 py-2 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
                                >
                                    Limpar
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-6 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 justify-center"
                                >
                                    <Save size={18} /> {isSaving ? 'Salvando...' : 'Salvar Sequência'}
                                </button>
                            </div>
                        </form>
                    </section>
                </div>
            </main>
        </div>
    );
};

