import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, doc, setDoc, deleteDoc, writeBatch, getDocs, query, orderBy, Timestamp, onSnapshot } from 'firebase/firestore';
import { Layers, List, PlusCircle, Save, Trash2, Trash, Box, ArrowLeft, BarChart } from 'lucide-react';
import { db } from '../firebase';
import HeaderContainer from '../components/HeaderContainer';
import GlobalNavigation from '../components/GlobalNavigation';
import ReportExportControls from '../components/ReportExportControls';
import { TRAVETE_MACHINES, raceBullLogoUrl } from './constants';
import { computeOperationalTimeBreakdown } from './travete';
import {
  GlobalStyles,
  generateId,
  createOperationalSequenceOperation,
  convertOperationToSeconds,
  formatSecondsToDurationLabel,
  aggregateProductOptionsForSequences,
  exportSequenciaOperacionalPDF,
  createDefaultOperationDestinations,
  normalizeOperationDestinations
} from './shared';
import { useAuth } from './auth';

const TRAVETE_VARIATION_CONFIGS = [
    { machineType: 'Travete 2 Agulhas', suffix: '2 Agulhas', defaultMultiplier: 1, idSuffix: '2agulhas' },
    { machineType: 'Travete 1 Agulha', suffix: '1 Agulha', defaultMultiplier: 2, idSuffix: '1agulha' },
    { machineType: 'Travete Convencional', suffix: 'Convencional', defaultMultiplier: 3, idSuffix: 'convencional' },
];

export const OperationalSequenceApp = ({ onNavigateToCrono, onNavigateToStock, onNavigateToReports, dashboards = [], user }) => {
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
    const [sequenceExportFormat, setSequenceExportFormat] = useState('pdf');
    const [isExportingSequence, setIsExportingSequence] = useState(false);
    const { logout } = useAuth();
    const [theme, setTheme] = useState(() => {
        if (typeof window === 'undefined') return 'light';
        return localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const root = window.document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = useCallback(() => {
        setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
    }, []);

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

    const createProductsForSequence = useCallback(async ({
        modelName,
        productionMinutes,
        traveteMinutesByMachine,
    }) => {
        const trimmedName = (modelName || '').trim();
        if (!trimmedName || !dashboards || dashboards.length === 0) {
            return null;
        }

        const baseId = generateId('seqProd');
        const creationIso = new Date().toISOString();
        const actor = user ? { uid: user.uid, email: user.email } : null;
        const batch = writeBatch(db);
        const productionProducts = [];
        const traveteProducts = {};
        const relatedIds = new Set();
        const dashboardNameSet = new Set();
        const safeTraveteMinutes = traveteMinutesByMachine || {};
        const baseTwoNeedleMinutes = Number.isFinite(safeTraveteMinutes['Travete 2 Agulhas'])
            ? parseFloat(safeTraveteMinutes['Travete 2 Agulhas'].toFixed(4))
            : 0;

        dashboards.forEach((dashboard) => {
            if (dashboard.id === 'travete') {
                TRAVETE_VARIATION_CONFIGS.forEach((config) => {
                    const normalizedSuffix = config.idSuffix;
                    const productId = `${baseId}_${normalizedSuffix}`;
                    const docRef = doc(db, `dashboards/${dashboard.id}/products`, productId);
                    const rawMinutes = safeTraveteMinutes[config.machineType];
                    const minutesValue = Number.isFinite(rawMinutes)
                        ? parseFloat(rawMinutes.toFixed(4))
                        : 0;

                    let multiplier = config.defaultMultiplier;
                    if (config.machineType === 'Travete 2 Agulhas' && minutesValue > 0) {
                        multiplier = 1;
                    } else if (baseTwoNeedleMinutes > 0 && minutesValue > 0) {
                        multiplier = parseFloat((minutesValue / baseTwoNeedleMinutes).toFixed(4));
                    }

                    const productData = {
                        id: productId,
                        name: `${trimmedName} - ${config.suffix}`,
                        baseProductId: baseId,
                        baseProductName: trimmedName,
                        machineType: config.machineType,
                        variationMultiplier: multiplier,
                        standardTime: minutesValue,
                        createdAt: creationIso,
                        createdBy: actor,
                    };

                    batch.set(docRef, productData, { merge: true });

                    const aggregated = {
                        ...productData,
                        dashboardId: dashboard.id,
                        dashboardName: dashboard.name,
                        standardTimeHistory: [],
                    };

                    traveteProducts[config.machineType] = aggregated;
                    relatedIds.add(productId);
                    if (dashboard.name) {
                        dashboardNameSet.add(dashboard.name);
                    }
                });
                return;
            }

            const productId = baseId;
            const docRef = doc(db, `dashboards/${dashboard.id}/products`, productId);
            const safeProductionMinutes = Number.isFinite(productionMinutes)
                ? parseFloat(Math.max(0, productionMinutes).toFixed(4))
                : 0;
            const productData = {
                id: productId,
                name: trimmedName,
                baseProductId: baseId,
                baseProductName: trimmedName,
                standardTime: safeProductionMinutes,
                createdAt: creationIso,
                createdBy: actor,
            };

            batch.set(docRef, productData, { merge: true });

            const aggregated = {
                ...productData,
                dashboardId: dashboard.id,
                dashboardName: dashboard.name,
                standardTimeHistory: [],
            };

            productionProducts.push(aggregated);
            relatedIds.add(productId);
            if (dashboard.name) {
                dashboardNameSet.add(dashboard.name);
            }
        });

        try {
            await batch.commit();
        } catch (error) {
            console.error('Não foi possível criar os produtos automaticamente a partir da sequência operacional:', error);
            return null;
        }

        const primaryProduction = productionProducts.find(product => product.dashboardId === 'producao')
            || productionProducts[0]
            || null;
        const primaryTravete = traveteProducts['Travete 2 Agulhas']
            || Object.values(traveteProducts)[0]
            || null;
        const primaryProduct = primaryProduction || primaryTravete;

        const aggregatedOption = {
            id: primaryProduct?.id || baseId,
            name: trimmedName,
            baseProductId: baseId,
            baseProductName: trimmedName,
            primaryProductId: primaryProduct?.id || baseId,
            primaryProduct,
            productionProducts,
            traveteProducts,
            relatedProductIds: Array.from(relatedIds),
            dashboardNames: Array.from(dashboardNameSet).filter(Boolean).sort((a, b) => a.localeCompare(b)),
            displayLabel: trimmedName,
            tags: [
                ...(productionProducts.length > 0 ? ['Produção'] : []),
                ...(Object.keys(traveteProducts).length > 0 ? ['Travete'] : []),
            ],
            allProducts: [
                ...productionProducts,
                ...Object.values(traveteProducts),
            ],
        };

        setProductOptions(prev => [
            ...prev.filter(option => option.baseProductId !== aggregatedOption.baseProductId),
            aggregatedOption,
        ]);

        setFormState(prev => ({
            ...prev,
            productId: aggregatedOption.primaryProductId,
            baseProductId: aggregatedOption.baseProductId,
            dashboardId: aggregatedOption.primaryProduct?.dashboardId || prev.dashboardId,
        }));

        return aggregatedOption;
    }, [dashboards, setFormState, setProductOptions, user]);

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
            const nextOperation = { ...operation, [field]: value };
            if (field === 'maquina') {
                const manuallyEdited = operation.destinosManualmenteEditados
                    ?? operation.destinos?.manuallyEdited
                    ?? false;
                if (manuallyEdited) {
                    nextOperation.destinos = normalizeOperationDestinations(
                        operation.destinos,
                        value
                    );
                } else {
                    nextOperation.destinos = createDefaultOperationDestinations(value);
                }
            }
            return nextOperation;
        }));
    }, []);

    const handleOperationDestinationChange = useCallback((operationId, target, checked) => {
        setOperations(prev => prev.map(operation => {
            if (operation.id !== operationId) return operation;

            const normalized = normalizeOperationDestinations(operation.destinos, operation.maquina);
            const nextDestinos = {
                production: normalized.production,
                travete: { ...normalized.travete },
            };

            if (target === 'production') {
                nextDestinos.production = checked;
                if (checked) {
                    TRAVETE_MACHINES.forEach((machine) => {
                        nextDestinos.travete[machine] = false;
                    });
                } else {
                    const hasTraveteSelected = TRAVETE_MACHINES.some(machine => nextDestinos.travete[machine]);
                    if (!hasTraveteSelected) {
                        nextDestinos.production = true;
                    }
                }
            } else if (TRAVETE_MACHINES.includes(target)) {
                TRAVETE_MACHINES.forEach((machine) => {
                    nextDestinos.travete[machine] = machine === target ? checked : false;
                });
                if (checked) {
                    nextDestinos.production = false;
                } else {
                    const hasTraveteSelected = TRAVETE_MACHINES.some(machine => nextDestinos.travete[machine]);
                    if (!hasTraveteSelected) {
                        nextDestinos.production = true;
                    }
                }
            }

            return {
                ...operation,
                destinos: nextDestinos,
                destinosManualmenteEditados: true,
            };
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

    const handleExportSequence = useCallback(async (format = 'pdf') => {
        setIsExportingSequence(true);
        try {
            if (format === 'blank') {
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
                const proceed = typeof window !== 'undefined'
                    ? window.confirm('Nenhuma operação preenchida. Deseja gerar a folha em branco?')
                    : true;
                if (!proceed) {
                    return;
                }
                await exportBlankSequence(sequencePayload.modelo);
                return;
            }

            await exportSequenciaOperacionalPDF(sequencePayload, true);
        } catch (error) {
            console.error('Erro ao exportar sequência operacional:', error);
            if (typeof window !== 'undefined') {
                window.alert('Não foi possível exportar a sequência. Verifique o console para mais detalhes.');
            }
        } finally {
            setIsExportingSequence(false);
        }
    }, [
        buildOperationsForPdf,
        exportBlankSequence,
        formState.empresa,
        formState.modelo,
    ]);

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
                destinos: operation.destinos || operation.destinations || null,
                destinosManualmenteEditados: operation.destinosManualmenteEditados
                    ?? operation.destinos?.manuallyEdited
                    ?? operation.destinations?.manuallyEdited
                    ?? false,
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
        const preparedOperations = operations
            .map((operation, index) => {
                const tempoValor = parseFloat(operation.tempoValor);
                const seconds = convertOperationToSeconds(operation);
                if (!(seconds > 0)) return null;
                const destinosNormalizados = normalizeOperationDestinations(
                    operation.destinos,
                    operation.maquina
                );
                const destinosManuais = operation.destinosManualmenteEditados
                    ?? operation.destinos?.manuallyEdited
                    ?? false;
                if (destinosManuais) {
                    destinosNormalizados.manuallyEdited = true;
                }
                return {
                    numero: operation.numero ? parseInt(operation.numero, 10) || index + 1 : index + 1,
                    descricao: operation.descricao?.trim() || `Operação ${index + 1}`,
                    maquina: operation.maquina?.trim() || 'N/A',
                    unidade: operation.unidade || 'min',
                    tempoValor: tempoValor || 0,
                    tempoSegundos: parseFloat(seconds.toFixed(2)),
                    tempoMinutos: parseFloat((seconds / 60).toFixed(4)),
                    destinos: destinosNormalizados,
                    destinosManualmenteEditados: destinosManuais,
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
            let selectedOption = formState.productId
                ? findProductOptionByProductId(formState.productId)
                : null;

            if (!selectedOption) {
                selectedOption = await createProductsForSequence({
                    modelName: trimmedModelo,
                    productionMinutes: productionMinutesOnly,
                    traveteMinutesByMachine,
                });
            }

            if (!selectedOption) {
                alert('Não foi possível definir ou criar o produto vinculado para esta sequência.');
                return;
            }

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
                baseProductId: selectedOption.baseProductId || formState.baseProductId || null,
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
    }, [createProductsForSequence, findProductOptionByProductId, formState, isSaving, operations, selectedSequenceId, updateLinkedProductsStandardTimes, user]);

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
        return [...productOptions].sort((a, b) => {
            const labelA = a.displayLabel || a.name || '';
            const labelB = b.displayLabel || b.name || '';
            return labelA.localeCompare(labelB);
        });
    }, [productOptions]);

    const selectedProduct = useMemo(() => findProductOptionByProductId(formState.productId), [findProductOptionByProductId, formState.productId]);

    const navigationButtons = useMemo(() => {
        const items = [];
        if (onNavigateToCrono) {
            items.push({
                key: 'crono',
                label: 'Voltar para Quadros',
                icon: ArrowLeft,
                onClick: onNavigateToCrono,
                baseClassName: 'px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2 w-full sm:w-auto justify-center',
                alwaysShowLabel: true,
            });
        }
        if (onNavigateToStock) {
            items.push({
                key: 'stock',
                label: 'Estoque',
                icon: Box,
                onClick: onNavigateToStock,
                baseClassName: 'px-3 py-2 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 flex items-center gap-2 w-full sm:w-auto justify-center',
                alwaysShowLabel: true,
            });
        }
        if (onNavigateToReports) {
            items.push({
                key: 'reports',
                label: 'Relatórios',
                icon: BarChart,
                onClick: onNavigateToReports,
                baseClassName: 'px-3 py-2 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 flex items-center gap-2 w-full sm:w-auto justify-center',
                alwaysShowLabel: true,
            });
        }
        return items;
    }, [onNavigateToCrono, onNavigateToStock, onNavigateToReports]);

    const sequenceExportOptions = useMemo(() => ([
        { value: 'pdf', label: 'Sequência Preenchida (PDF)' },
        { value: 'blank', label: 'Folha em Branco' },
    ]), []);

    const sequenceExportTranslations = useMemo(() => ({
        formatLabel: 'Tipo de Exportação',
        exportButton: 'Gerar PDF',
        exportingButton: 'Gerando PDF...',
    }), []);

    return (
        <div className="responsive-root min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200">
            <GlobalStyles />
            <HeaderContainer>
                <GlobalNavigation
                    logoSrc={raceBullLogoUrl}
                    title="Sequência Operacional"
                    subtitle="Cadastre e mantenha as operações padrão por modelo."
                    navigationButtons={navigationButtons}
                    userEmail={user?.email}
                    onLogout={logout}
                    logoutLabel="Sair"
                    logoutButtonClassName="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 text-red-500 w-full sm:w-auto justify-center"
                    hideLogoutLabelOnMobile={true}
                    theme={theme}
                    onToggleTheme={toggleTheme}
                />
            </HeaderContainer>

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
                                    <label className="text-sm font-medium">Produto vinculado (opcional)</label>
                                    <select
                                        value={formState.productId}
                                        onChange={(e) => handleProductSelect(e.target.value)}
                                        className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                    >
                                        <option value="">
                                            {isLoadingProducts ? 'Carregando produtos...' : 'Criar produto automaticamente'}
                                        </option>
                                        {productOptionsSorted.map(product => (
                                            <option key={product.id} value={product.id}>
                                                {product.displayLabel || product.name}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        Selecione um produto existente apenas se desejar reaproveitar tempos já cadastrados.
                                    </p>
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
                                                <th className="p-3 text-left">Destinos</th>
                                                <th className="p-3 text-center">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                            {operations.map(operation => {
                                                const destinos = normalizeOperationDestinations(operation.destinos, operation.maquina);
                                                return (
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
                                                    <td className="p-2">
                                                        <div className="flex flex-col gap-1 text-xs">
                                                            <label className="inline-flex items-center gap-2">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={destinos.production}
                                                                    onChange={(e) => handleOperationDestinationChange(operation.id, 'production', e.target.checked)}
                                                                />
                                                                Produção
                                                            </label>
                                                            {TRAVETE_MACHINES.map(machine => (
                                                                <label key={machine} className="inline-flex items-center gap-2">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={destinos.travete[machine]}
                                                                        onChange={(e) => handleOperationDestinationChange(operation.id, machine, e.target.checked)}
                                                                    />
                                                                    {machine}
                                                                </label>
                                                            ))}
                                                        </div>
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
                                                );
                                            })}
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
                                    <p>
                                        <span className="font-semibold">Produto vinculado:</span>{' '}
                                        {selectedProduct
                                            ? (selectedProduct.displayLabel || selectedProduct.name)
                                            : 'Será criado automaticamente com o modelo informado'}
                                    </p>
                                    {selectedProduct?.dashboardNames?.length > 0 && (
                                        <p><span className="font-semibold">Quadros:</span> {selectedProduct.dashboardNames.join(' • ')}</p>
                                    )}
                                    <p><span className="font-semibold">Última atualização:</span> {selectedSequenceId ? 'Sequência existente' : 'Novo cadastro'}</p>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                                <ReportExportControls
                                    variant="inline"
                                    selectedFormat={sequenceExportFormat}
                                    formats={sequenceExportOptions}
                                    onFormatChange={setSequenceExportFormat}
                                    onExport={handleExportSequence}
                                    isExporting={isExportingSequence}
                                    translations={sequenceExportTranslations}
                                    className="justify-start sm:justify-end"
                                />
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

