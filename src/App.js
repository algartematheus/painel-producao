import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Sun, Moon, PlusCircle, List, Edit, Trash2, Save, XCircle, ChevronLeft, ChevronRight, MessageSquare, Layers, ChevronUp, ChevronDown, LogOut, Settings, ChevronDown as ChevronDownIcon, Package, Monitor, ArrowLeft, ArrowRight, UserCog, BarChart, Film, Warehouse, Trash, FileDown } from 'lucide-react';
import { db } from './firebase';
import { AuthProvider, useAuth, LoginPage } from './modules/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { StockManagementApp } from './modules/gerenciamentodeestoque';
import { OperationalSequenceApp } from './modules/sequenciaOperacional';
import { raceBullLogoUrl, initialDashboards, FIXED_PERIODS, TRAVETE_MACHINES, ALL_PERMISSIONS, defaultRoles } from './modules/constants';
import {
  generateId,
  sha256Hex,
  ADMIN_PASSWORD_HASH,
  IS_VALID_ADMIN_PASSWORD_HASH,
  GlobalStyles,
  ConfirmationModal,
  useClickOutside,
  usePrevious,
  buildProductLookupMap,
  getEmployeeProducts,
  sumProducedQuantities,
  findFirstProductDetail,
  resolveProductReference,
  resolveEmployeeStandardTime,
  exportDashboardPerformancePDF
} from './modules/shared';
import {
  getOrderedActiveLots,
  getLotRemainingPieces,
  splitGoalSegments,
  joinGoalSegments,
  sumGoalDisplay,
  createProductionRowFromDetail,
  computeDefaultPredictionsForEdit,
  buildRowsFromPredictions,
  areProductionRowsEqual,
  computeMetaFromStandardTime,
  computeEfficiencyPercentage,
  buildProductNames,
  buildNumericSegments,
  formatSegmentedNumbers,
  formatGoalBlockDisplay
} from './modules/producao';
import {
  createTraveteProductFormState,
  createDefaultTraveteProductItem,
  createDefaultTraveteEmployee,
  formatTraveteLotDisplay,
  splitTraveteGoalSegments,
  resolveTraveteLotBaseId,
  findTraveteVariationForLot,
  buildTraveteStandardTimePatch,
  applyTraveteAutoSuggestions,
  formatTraveteLotDisplayName,
  getTraveteBaseProductName,
} from './modules/travete';

// =====================================================================
// == CONSTANTES E FUNÇÕES AUXILIARES GLOBAIS ==
// =====================================================================

    const defaultPredictedLotLabel = useMemo(() => {
        if (isTraveteEntry || !defaultPredictions || defaultPredictions.length === 0) {
            return '';
        }

// #####################################################################
// #                                                                   #
// #               INÍCIO: COMPONENTES DE MODAIS E AUXILIARES            #
// #                                                                   #
// #####################################################################

const EntryEditorModal = ({
    isOpen,
    onClose,
    entry,
    onSave,
    products,
    productsForSelectedDate = [],
    lots = [],
    traveteMachines = TRAVETE_MACHINES,
    traveteVariationLookup = new Map(),
}) => {
    const [entryData, setEntryData] = useState(null);
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    const productMap = useMemo(
        () => buildProductLookupMap(products, productsForSelectedDate),
        [products, productsForSelectedDate]
    );

    useEffect(() => {
        if (isOpen && entry) {
            if (Array.isArray(entry.employeeEntries) && entry.employeeEntries.length > 0) {
                setEntryData({
                    type: 'travete',
                    availableTime: entry.availableTime || 0,
                    observation: entry.observation || '',
                    employeeEntries: entry.employeeEntries.map((emp, idx) => {
                        const baseProducts = getEmployeeProducts(emp);
                        const normalizedProducts = baseProducts.map(detail => ({
                            lotId: detail.lotId || '',
                            productId: detail.productId || '',
                            produced: detail.produced !== undefined ? String(detail.produced) : '',
                            isAutoSuggested: false,
                        }));
                        if (normalizedProducts.length === 0) {
                            normalizedProducts.push(createDefaultTraveteProductItem());
                        }
                        const standardTimeValue = emp.standardTime !== undefined && emp.standardTime !== null
                            ? String(emp.standardTime)
                            : '';
                        return {
                            employeeId: emp.employeeId || idx + 1,
                            machineType: emp.machineType || traveteMachines[idx] || traveteMachines[0],
                            standardTime: standardTimeValue,
                            standardTimeManual: standardTimeValue !== '',
                            products: normalizedProducts,
                        };
                    }),
                });
            } else {
                const productionDetails = Array.isArray(entry.productionDetails)
                    ? entry.productionDetails
                    : [];
                const productionRows = productionDetails
                    .map(detail => createProductionRowFromDetail(detail, productMap, lots))
                    .filter(Boolean);

                setEntryData({
                    type: 'default',
                    people: entry.people !== undefined && entry.people !== null
                        ? String(entry.people)
                        : '',
                    availableTime: entry.availableTime !== undefined && entry.availableTime !== null
                        ? String(entry.availableTime)
                        : '',
                    productionRows,
                    previousGoalDisplay: entry.goalDisplay || '',
                });
            }
        } else if (!isOpen) {
            setEntryData(null);
        }
    }, [isOpen, entry, traveteMachines, lots, productMap]);

    const traveteLotOptions = useMemo(
        () => lots.filter(lot => lot.status !== 'completed'),
        [lots]
    );

    useEffect(() => {
        if (!isOpen || !entryData || entryData.type !== 'travete') return;
        setEntryData(prev => {
            if (!prev || prev.type !== 'travete') return prev;
            const { changed, employeeEntries } = applyTraveteAutoSuggestions(
                prev.employeeEntries,
                traveteLotOptions,
                products,
                traveteVariationLookup
            );
            if (!changed) {
                return prev;
            }
            return { ...prev, employeeEntries };
        });
    }, [isOpen, entryData, traveteLotOptions, products, traveteVariationLookup]);

    const isTraveteEntry = entryData?.type === 'travete';

    const handleProductionRowChange = (index, value) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'default') return prev;
            const rows = prev.productionRows || [];
            if (index < 0 || index >= rows.length) return prev;
            const nextRows = rows.map((row, idx) => (
                idx === index
                    ? { ...row, produced: value }
                    : row
            ));
            return { ...prev, productionRows: nextRows };
        });
    };

    const entryPrimaryProductId = useMemo(() => (
        entry?.primaryProductId
        || entry?.productionDetails?.[0]?.productId
        || ''
    ), [entry]);

    const fallbackProductId = !isTraveteEntry
        ? (entryData?.productionRows?.[0]?.productId || entryPrimaryProductId)
        : '';

    const defaultPredictions = useMemo(() => {
        if (isTraveteEntry) {
            return [];
        }

        return computeDefaultPredictionsForEdit({
            peopleValue: entryData?.people,
            availableTimeValue: entryData?.availableTime,
            lots,
            productMap,
            fallbackProductId,
        });
    }, [isTraveteEntry, entryData?.people, entryData?.availableTime, lots, productMap, fallbackProductId]);

    useEffect(() => {
        if (!isOpen || isTraveteEntry) return;

        setEntryData(prev => {
            if (!prev || prev.type !== 'default') return prev;
            const existingRows = prev.productionRows || [];
            const nextRows = buildRowsFromPredictions(existingRows, defaultPredictions, lots, productMap);
            if (areProductionRowsEqual(existingRows, nextRows)) {
                return prev;
            }
            return { ...prev, productionRows: nextRows };
        });
    }, [isOpen, isTraveteEntry, defaultPredictions, lots, productMap]);

    const defaultGoalPreview = useMemo(() => {
        if (isTraveteEntry) {
            return '';
        }

        if (!defaultPredictions || defaultPredictions.length === 0) {
            const fallbackDisplay = entryData?.previousGoalDisplay || entry?.goalDisplay || '';
            return fallbackDisplay && fallbackDisplay.trim().length > 0 ? fallbackDisplay : '0';
        }

        const segments = defaultPredictions
            .map(prediction => Math.max(0, prediction.remainingPieces ?? prediction.plannedPieces ?? 0))
            .filter((value, index) => value > 0 || index === 0);

        return segments.length > 0
            ? segments.map(value => value.toLocaleString('pt-BR')).join(' / ')
            : '0';
    }, [isTraveteEntry, defaultPredictions, entryData?.previousGoalDisplay, entry?.goalDisplay]);

    const defaultPredictedLotLabel = useMemo(() => {
        if (isTraveteEntry || !defaultPredictions || defaultPredictions.length === 0) {
            return '';
        }

        return defaultPredictions
            .map(prediction => prediction.productName)
            .filter(Boolean)
            .join(' / ');
    }, [isTraveteEntry, defaultPredictions]);

    const traveteMetaPreview = useMemo(() => {
        if (!isTraveteEntry) return null;
        const availableTime = parseFloat(entryData?.availableTime) || 0;
        return (entryData?.employeeEntries || []).map(emp => {
            const standardTime = parseFloat(emp.standardTime) || 0;
            if (availableTime <= 0 || standardTime <= 0) return 0;
            return Math.round(availableTime / standardTime);
        });
    }, [isTraveteEntry, entryData]);

    const traveteMetaDisplay = useMemo(() => {
        if (!Array.isArray(traveteMetaPreview)) return '';
        return traveteMetaPreview
            .map(value => value.toLocaleString('pt-BR'))
            .join(' // ');
    }, [traveteMetaPreview]);

    if (!isOpen || !entryData) return null;

    const handleTraveteEmployeeChange = (index, field, value) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'travete') return prev;
            const updatedEmployees = prev.employeeEntries.map((emp, empIdx) => {
                if (empIdx !== index) return emp;
                let updated = { ...emp };
                switch (field) {
                    case 'machineType': {
                        updated = { ...updated, machineType: value };
                        const firstLotId = updated.products.find(item => item.lotId)?.lotId;
                        const patch = buildTraveteStandardTimePatch({
                            employee: updated,
                            lotId: firstLotId,
                            machineType: value,
                            lots,
                            products,
                            variationLookup: traveteVariationLookup,
                            resetWhenMissing: true,
                        });
                        if (patch) {
                            updated = { ...updated, ...patch };
                        }
                        break;
                    }
                    case 'standardTime': {
                        updated.standardTime = value;
                        updated.standardTimeManual = value !== '';
                        break;
                    }
                    default: {
                        updated[field] = value;
                    }
                }
                return updated;
            });
            return { ...prev, employeeEntries: updatedEmployees };
        });
    };

    const handleTraveteProductChange = (employeeIndex, productIndex, field, value) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'travete') return prev;
            const updatedEmployees = prev.employeeEntries.map((emp, empIdx) => {
                if (empIdx !== employeeIndex) return emp;
                const updatedProducts = emp.products.map((product, prodIdx) => {
                    if (prodIdx !== productIndex) return product;
                    const nextProduct = { ...product, [field]: value };
                    if (field === 'lotId') {
                        nextProduct.isAutoSuggested = false;
                    }
                    return nextProduct;
                });
                let updatedEmployee = { ...emp, products: updatedProducts };
                if (field === 'lotId') {
                    const patch = buildTraveteStandardTimePatch({
                        employee: updatedEmployee,
                        lotId: value,
                        machineType: emp.machineType,
                        lots,
                        products,
                        variationLookup: traveteVariationLookup,
                    });
                    if (patch) {
                        updatedEmployee = { ...updatedEmployee, ...patch };
                    }
                }
                return updatedEmployee;
            });
            return { ...prev, employeeEntries: updatedEmployees };
        });
    };

    const handleTraveteAddProduct = (employeeIndex) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'travete') return prev;
            const updatedEmployees = prev.employeeEntries.map((emp, empIdx) => {
                if (empIdx !== employeeIndex) return emp;
                return { ...emp, products: [...emp.products, createDefaultTraveteProductItem()] };
            });
            return { ...prev, employeeEntries: updatedEmployees };
        });
    };

    const handleTraveteRemoveProduct = (employeeIndex, productIndex) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'travete') return prev;
            const updatedEmployees = prev.employeeEntries.map((emp, empIdx) => {
                if (empIdx !== employeeIndex) return emp;
                const remaining = emp.products.filter((_, idx) => idx !== productIndex);
                return { ...emp, products: remaining.length > 0 ? remaining : [createDefaultTraveteProductItem()] };
            });
            return { ...prev, employeeEntries: updatedEmployees };
        });
    };

    const handleSave = () => {
        if (isTraveteEntry) {
            const normalizedEmployees = entryData.employeeEntries.map(emp => ({
                employeeId: emp.employeeId,
                machineType: emp.machineType,
                standardTime: emp.standardTime,
                products: emp.products.map(product => ({
                    ...product,
                    produced: parseInt(product.produced, 10) || 0,
                })),
            }));

            onSave(entry.id, {
                type: 'travete',
                availableTime: parseFloat(entryData.availableTime) || 0,
                employeeEntries: normalizedEmployees,
                observation: entryData.observation || '',
            });
            onClose();
            return;
        }

        const numericPeople = parseFloat(entryData.people) || 0;
        const numericAvailableTime = parseFloat(entryData.availableTime) || 0;
        const updatedProductions = (entryData.productionRows || [])
            .filter(row => row.productId)
            .map(row => ({
                productId: row.productId,
                produced: parseInt(row.produced, 10) || 0,
            }))
            .filter(detail => detail.produced > 0);

        const primaryProductId = updatedProductions[0]?.productId
            || entry?.primaryProductId
            || entry?.productionDetails?.[0]?.productId
            || '';

        const goalDisplayValue = defaultGoalPreview && defaultGoalPreview.trim().length > 0
            ? defaultGoalPreview
            : entry?.goalDisplay || '0';

        onSave(entry.id, {
            type: 'default',
            people: numericPeople,
            availableTime: numericAvailableTime,
            productions: updatedProductions,
            goalDisplay: goalDisplayValue,
            primaryProductId,
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-40 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-3xl modal-content max-h-[90vh] overflow-y-auto">
                <h2 className="text-xl font-bold mb-4">Editar Lançamento: {entry.period}</h2>
                {isTraveteEntry ? (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="flex flex-col">
                                <label htmlFor="travete-edit-time" className="text-sm font-medium">Tempo Disp. (min)</label>
                                <input
                                    id="travete-edit-time"
                                    type="number"
                                    value={entryData.availableTime}
                                    onChange={(e) => setEntryData(prev => ({ ...prev, availableTime: e.target.value }))}
                                    className="mt-1 w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                />
                            </div>
                            <div className="md:col-span-2 flex flex-col">
                                <label htmlFor="travete-edit-observation" className="text-sm font-medium">Observação</label>
                                <textarea
                                    id="travete-edit-observation"
                                    value={entryData.observation}
                                    onChange={(e) => setEntryData(prev => ({ ...prev, observation: e.target.value }))}
                                    className="mt-1 w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                    rows={2}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {entryData.employeeEntries.map((employee, index) => (
                                <div key={employee.employeeId || index} className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/60 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold">Funcionário {employee.employeeId}</h3>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="flex flex-col">
                                            <label className="text-sm font-medium">Máquina</label>
                                            <select
                                                value={employee.machineType}
                                                onChange={(e) => handleTraveteEmployeeChange(index, 'machineType', e.target.value)}
                                                className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                            >
                                                {traveteMachines.map(machine => (
                                                    <option key={machine} value={machine}>{machine}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex flex-col">
                                            <label className="text-sm font-medium">Tempo por Peça (min)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={employee.standardTime}
                                                onChange={(e) => handleTraveteEmployeeChange(index, 'standardTime', e.target.value)}
                                                className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        {employee.products.map((productItem, productIdx) => (
                                            <div key={`${employee.employeeId}-${productIdx}`} className="p-3 rounded-lg bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <label className="text-sm font-semibold">
                                                                {productIdx === 0
                                                                    ? 'Produto / Lote (Prioridade)'
                                                                    : productItem.isAutoSuggested
                                                                        ? 'Próximo Lote (Automático)'
                                                                        : 'Produto / Lote'}
                                                            </label>
                                                            {employee.products.length > 1 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleTraveteRemoveProduct(index, productIdx)}
                                                                    className="text-red-500 hover:text-red-400"
                                                        >
                                                            <Trash size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                                <select
                                                    value={productItem.lotId}
                                                    onChange={(e) => handleTraveteProductChange(index, productIdx, 'lotId', e.target.value)}
                                                    className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                >
                                                    <option value="">Selecione...</option>
                                                    {traveteLotOptions.map(lotOption => (
                                                        <option key={lotOption.id} value={lotOption.id}>
                                                            {formatTraveteLotDisplayName(lotOption, products)}
                                                        </option>
                                                    ))}
                                                </select>
                                                <div className="flex flex-col">
                                                    <label className="text-sm">Quantidade Produzida</label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={productItem.produced}
                                                        onChange={(e) => handleTraveteProductChange(index, productIdx, 'produced', e.target.value)}
                                                        className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => handleTraveteAddProduct(index)}
                                            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-500"
                                        >
                                            <PlusCircle size={16} /> Adicionar item fora de ordem
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col justify-center items-center bg-blue-100 dark:bg-blue-900/50 p-3 rounded-md shadow-inner">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Meta Prevista</span>
                                <span className="font-bold text-lg text-blue-600 dark:text-blue-300 text-center">
                                    {traveteMetaDisplay || '- // -'}
                                </span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="edit-people" className="block text-sm font-medium">Nº Pessoas</label>
                                <input
                                    id="edit-people"
                                    type="number"
                                    value={entryData.people}
                                    onChange={(e) => setEntryData({ ...entryData, people: e.target.value })}
                                    className="mt-1 w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                />
                            </div>
                            <div>
                                <label htmlFor="edit-time" className="block text-sm font-medium">Tempo Disp. (min)</label>
                                <input
                                    id="edit-time"
                                    type="number"
                                    value={entryData.availableTime}
                                    onChange={(e) => setEntryData({ ...entryData, availableTime: e.target.value })}
                                    className="mt-1 w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold mb-2">Produções</h3>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {(entryData.productionRows || []).map((row, index) => (
                                    <div key={row.key || `${row.productId}-${index}`} className="flex items-center justify-between gap-4">
                                        <span className="text-sm font-medium truncate">{row.productName || row.productId || 'Produto'}</span>
                                        <input
                                            type="number"
                                            value={row.produced || ''}
                                            onChange={(e) => handleProductionRowChange(index, e.target.value)}
                                            className="w-24 p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                        />
                                    </div>
                                ))}
                                {(!entryData.productionRows || entryData.productionRows.length === 0) && (
                                    <p className="text-sm text-gray-500">Nenhum lote previsto para este horário.</p>
                                )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                                {defaultPredictedLotLabel && (
                                    <div className="flex flex-col justify-center items-center bg-blue-50 dark:bg-blue-900/40 p-3 rounded-md shadow-inner">
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Lotes Previstos</span>
                                        <span className="font-semibold text-base text-blue-700 dark:text-blue-200 text-center">{defaultPredictedLotLabel}</span>
                                    </div>
                                )}
                                <div className="flex flex-col justify-center items-center bg-blue-100 dark:bg-blue-900/50 p-3 rounded-md shadow-inner">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Meta Prevista</span>
                                    <span className="font-bold text-lg text-blue-600 dark:text-blue-400">{defaultGoalPreview}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-md">Cancelar</button>
                    <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Salvar</button>
                </div>
            </div>
        </div>
    );
};



const DashboardActionDialog = ({ isOpen, onClose, onConfirm, mode, initialName }) => {
    const [name, setName] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if (isOpen) {
            setName(mode === 'rename' ? initialName : '');
        }
    }, [isOpen, mode, initialName]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (name.trim()) {
            const success = await onConfirm(name.trim());
            if (success) {
                onClose();
            } else {
                alert("Um quadro com este nome já existe.");
            }
        }
    };

    const title = mode === 'create' ? 'Criar Novo Quadro' : 'Renomear Quadro';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-30 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md modal-content">
                <form onSubmit={handleSubmit}>
                    <h2 className="text-xl font-bold mb-4">{title}</h2>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"
                        placeholder="Nome do quadro"
                        autoFocus
                    />
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600">Cancelar</button>
                        <button type="submit" className="px-4 py-2 rounded-md bg-blue-600 text-white">Salvar</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const ObservationModal = ({ isOpen, onClose, entry, onSave }) => {
    const [observation, setObservation] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if (entry) {
            setObservation(entry.observation || '');
        }
    }, [entry]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(entry.id, observation);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-30 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg modal-content">
                <h2 className="text-xl font-bold mb-4">Observação do Período: {entry?.period}</h2>
                <textarea
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    rows="5"
                    className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"
                    placeholder="Digite suas observações aqui..."
                />
                <div className="flex justify-end gap-4">
                    <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600">Cancelar</button>
                    <button onClick={handleSave} className="px-4 py-2 rounded-md bg-blue-600 text-white">Salvar</button>
                </div>
            </div>
        </div>
    );
};

const LotObservationModal = ({ isOpen, onClose, lot, onSave }) => {
    const [observation, setObservation] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if (lot) {
            setObservation(lot.observation || '');
        }
    }, [lot]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(lot.id, observation);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-30 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg modal-content">
                <h2 className="text-xl font-bold mb-4">Observação do Lote: {lot?.productName}</h2>
                <textarea
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    rows="5"
                    className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"
                    placeholder="Digite suas observações aqui..."
                />
                <div className="flex justify-end gap-4">
                    <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600">Cancelar</button>
                    <button onClick={handleSave} className="px-4 py-2 rounded-md bg-blue-600 text-white">Salvar</button>
                </div>
            </div>
        </div>
    );
};

const PasswordModal = ({ isOpen, onClose, onSuccess, adminConfig }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if(isOpen) {
            setPassword('');
            setError('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        setError('');
        if (!IS_VALID_ADMIN_PASSWORD_HASH) {
            setError('Configuração de segurança ausente. Contate o administrador.');
            return;
        }

        const inputHash = await sha256Hex(password.trim());

        if (IS_VALID_ADMIN_PASSWORD_HASH && inputHash === ADMIN_PASSWORD_HASH) {
            if(onSuccess) onSuccess();
            onClose();
        } else {
            setError('Senha incorreta.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-30 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-sm modal-content">
                 <h2 className="text-xl font-bold mb-4">Acesso Restrito</h2>
                 <p className="text-sm mb-4">Por favor, insira a senha de administrador para continuar.</p>
                 <input
                     type="password"
                     value={password}
                     onChange={(e) => setPassword(e.target.value)}
                     className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-2"
                     placeholder="Senha"
                 />
                 {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                 <div className="flex justify-end gap-4">
                     <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600">Cancelar</button>
                     <button onClick={handleConfirm} className="px-4 py-2 rounded-md bg-blue-600 text-white">Confirmar</button>
                 </div>
            </div>
        </div>
    );
};

const ReasonModal = ({ isOpen, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    
    if (!isOpen) return null;
    
    const handleConfirm = () => {
        onConfirm(reason || 'Nenhum motivo fornecido.');
        setReason('');
        onClose();
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-40 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md modal-content">
                <h2 className="text-xl font-bold mb-4">Motivo da Exclusão</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Por favor, forneça um breve motivo para a exclusão deste item. Isso ajuda na rastreabilidade.</p>
                <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows="3"
                    className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"
                    placeholder="Ex: Lançamento duplicado, erro de digitação..."
                />
                <div className="flex justify-end gap-4">
                    <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600">Cancelar</button>
                    <button onClick={handleConfirm} className="px-4 py-2 rounded-md bg-red-600 text-white">Confirmar Exclusão</button>
                </div>
            </div>
        </div>
    );
};
 
const AdminPanelModal = ({ isOpen, onClose, users, roles }) => {
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    const [selectedUser, setSelectedUser] = useState(null);
    const [editablePermissions, setEditablePermissions] = useState([]);
    
    useEffect(() => {
        if (isOpen && users.length > 0 && !selectedUser) {
            setSelectedUser(users[0]);
        }
        if (!isOpen) {
            setSelectedUser(null);
        }
    }, [isOpen, users, selectedUser]);
    
    useEffect(() => {
        if (selectedUser) {
            setEditablePermissions(selectedUser.permissions || []);
        }
    }, [selectedUser]);

    if (!isOpen) return null;

    const handlePermissionChange = (permissionKey, isChecked) => {
        setEditablePermissions(prev => {
            const newSet = new Set(prev);
            if (isChecked) {
                newSet.add(permissionKey);
            } else {
                newSet.delete(permissionKey);
            }
            return Array.from(newSet);
        });
    };
    
    const applyRoleTemplate = (roleId) => {
        if (roles[roleId]) {
            setEditablePermissions(roles[roleId].permissions);
        }
    };
    
    const handleSavePermissions = async () => {
        if (!selectedUser) return;
        try {
            const roleRef = doc(db, 'roles', selectedUser.uid);
            await setDoc(roleRef, { permissions: editablePermissions });
            alert(`Permissões do usuário ${selectedUser.email} salvas com sucesso!`);
            onClose();
        } catch (error) {
            console.error("Erro ao salvar permissões:", error);
            alert('Falha ao salvar permissões.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col modal-content">
                <div className="flex justify-between items-center mb-4 pb-4 border-b dark:border-gray-700">
                    <h2 className="text-2xl font-bold flex items-center gap-2"><UserCog/> Painel de Administração</h2>
                    <button onClick={onClose} title="Fechar"><XCircle /></button>
                </div>
                <div className="flex-grow flex gap-6 overflow-hidden">
                    <div className="w-1/3 border-r pr-6 dark:border-gray-700 overflow-y-auto">
                        <h3 className="text-lg font-semibold mb-3 sticky top-0 bg-white dark:bg-gray-900 pb-2">Usuários</h3>
                        <div className="space-y-2">
                           {users.map(user => (
                               <button 
                                   key={user.uid} 
                                   onClick={() => setSelectedUser(user)}
                                   className={`w-full text-left p-3 rounded-lg transition-colors ${selectedUser?.uid === user.uid ? 'bg-blue-100 dark:bg-blue-900/50' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                               >
                                   <p className="font-semibold truncate">{user.email}</p>
                                   <p className="text-xs text-gray-500">{user.permissions.length} permissões</p>
                               </button>
                           ))}
                        </div>
                    </div>
                    <div className="w-2/3 flex-grow overflow-y-auto pr-2">
                       {selectedUser ? (
                           <div>
                               <div className="mb-6">
                                   <h3 className="text-xl font-bold truncate">{selectedUser.email}</h3>
                                   <p className="text-gray-500">Edite as permissões para este usuário.</p>
                               </div>
                               <div className="mb-6">
                                   <label htmlFor="role-template" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Aplicar Modelo</label>
                                   <select 
                                       id="role-template"
                                       onChange={(e) => applyRoleTemplate(e.target.value)}
                                       className="mt-1 block w-full md:w-1/2 p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                   >
                                       <option value="">Selecione um modelo para começar...</option>
                                       {Object.values(roles).map(role => (
                                           <option key={role.id} value={role.id}>{role.name}</option>
                                       ))}
                                   </select>
                               </div>
                               <div className="space-y-4">
                                     <h4 className="font-semibold">Permissões Individuais</h4>
                                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                         {Object.entries(ALL_PERMISSIONS).map(([key, description]) => (
                                             <label key={key} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
                                                 <input
                                                     type="checkbox"
                                                     checked={editablePermissions.includes(key)}
                                                     onChange={(e) => handlePermissionChange(key, e.target.checked)}
                                                     className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"
                                                 />
                                                 <span className="text-sm">{description}</span>
                                             </label>
                                         ))}
                                     </div>
                               </div>
                               <div className="mt-8 pt-4 border-t dark:border-gray-700 flex justify-end">
                                   <button onClick={handleSavePermissions} className="px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
                                       Salvar Permissões
                                   </button>
                               </div>
                           </div>
                       ) : (
                           <div className="flex items-center justify-center h-full text-gray-500">
                               <p>Selecione um usuário na lista para ver e editar suas permissões.</p>
                           </div>
                       )}
                    </div>
                </div>
            </div>
        </div>
    );
};
 
const TvSelectorModal = ({ isOpen, onClose, onSelect, onStartCarousel, dashboards }) => {
    const [carouselSeconds, setCarouselSeconds] = useState(10);
    const [selectedDashboards, setSelectedDashboards] = useState(() => dashboards.map(d => d.id));
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if (isOpen) {
            setSelectedDashboards(dashboards.map(d => d.id));
        }
    }, [isOpen, dashboards]);

    if (!isOpen) return null;

    const handleToggle = (id) => {
        setSelectedDashboards(prev =>
            prev.includes(id) ? prev.filter(dId => dId !== id) : [...prev, id]
        );
    };

    const handleStart = () => {
        if (selectedDashboards.length > 0) {
            onStartCarousel({
                dashboardIds: selectedDashboards,
                interval: carouselSeconds * 1000,
            });
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-2xl w-full max-w-2xl modal-content">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <Monitor size={24} className="text-blue-500" /> Selecionar Modo de Exibição
                    </h2>
                    <button onClick={onClose} title="Fechar"><XCircle size={24} /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <h3 className="font-bold text-lg mb-2">Exibição Única</h3>
                        <p className="mb-4 text-gray-600 dark:text-gray-400 text-sm">Escolha um quadro para exibir em tela cheia.</p>
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                            {dashboards.map(dash => (
                                <button
                                    key={dash.id}
                                    onClick={() => { onSelect(dash.id); onClose(); }}
                                    className="w-full flex items-center justify-between p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                                >
                                    <span className="font-semibold">{dash.name}</span>
                                    <ArrowRight size={20} className="text-blue-500" />
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="border-l dark:border-gray-700 pl-8">
                        <h3 className="font-bold text-lg mb-2">Modo Carrossel</h3>
                        <p className="mb-4 text-gray-600 dark:text-gray-400 text-sm">Selecione os quadros e o tempo de exibição.</p>
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-2 mb-4">
                            {dashboards.map(dash => (
                                <label key={dash.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
                                    <input type="checkbox" checked={selectedDashboards.includes(dash.id)} onChange={() => handleToggle(dash.id)} className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"/>
                                    <span>{dash.name}</span>
                                </label>
                            ))}
                        </div>
                        <div className="flex items-center gap-4">
                             <div className="flex-grow">
                                <label htmlFor="carousel-time" className="text-sm">Segundos por slide:</label>
                                <input id="carousel-time" type="number" value={carouselSeconds} onChange={e => setCarouselSeconds(Number(e.target.value))} className="w-full p-2 mt-1 rounded-md bg-gray-100 dark:bg-gray-700"/>
                             </div>
                            <button onClick={handleStart} className="self-end h-10 px-4 font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 flex items-center gap-2">
                                <Film size={18} /> Iniciar Carrossel
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// #####################################################################
// #                                                                   #
// #               FIM: COMPONENTES DE MODAIS E AUXILIARES             #
// #                                                                   #
// #####################################################################



// #####################################################################
// #                                                                   #
// #           INÍCIO: COMPONENTES AUXILIARES DO DASHBOARD             #
// #                                                                   #
// #####################################################################

const StatCard = ({ title, value, unit = '', isEfficiency = false }) => {
    const valueColor = isEfficiency ? (value < 65 ? 'text-red-500' : 'text-green-600') : 'text-gray-800 dark:text-white';
    return (
        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
            <h3 className="text-lg font-medium text-gray-500 dark:text-gray-400">{title}</h3>
            <p className={`text-4xl font-bold ${valueColor} mt-2`}>{value}<span className="text-2xl ml-2">{unit}</span></p>
        </div>
    );
};

const CalendarView = ({ selectedDate, setSelectedDate, currentMonth, setCurrentMonth, calendarView, setCalendarView, allProductionData }) => {
    const handleNavigation = (offset) => {
        if (calendarView === 'day') setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
        else if (calendarView === 'month') setCurrentMonth(prev => new Date(prev.getFullYear() + offset, prev.getMonth(), 1));
        else if (calendarView === 'year') setCurrentMonth(prev => new Date(prev.getFullYear() + offset * 10, prev.getMonth(), 1));
    };
    const handleHeaderClick = () => {
        if (calendarView === 'day') setCalendarView('month');
        if (calendarView === 'month') setCalendarView('year');
    };
    const handleMonthSelect = (monthIndex) => { setCurrentMonth(new Date(currentMonth.getFullYear(), monthIndex, 1)); setCalendarView('day'); };
    const handleYearSelect = (year) => { setCurrentMonth(new Date(year, currentMonth.getMonth(), 1)); setCalendarView('month'); };
    const renderHeader = () => {
        let text = '';
        if (calendarView === 'day') text = currentMonth.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        else if (calendarView === 'month') text = currentMonth.getFullYear();
        else { const startYear = Math.floor(currentMonth.getFullYear() / 10) * 10; text = `${startYear} - ${startYear + 9}`; }
        return <button onClick={handleHeaderClick} className="text-xl font-semibold hover:text-blue-500">{text}</button>;
    };
    const renderDayView = () => {
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const startDate = new Date(startOfMonth);
        startDate.setDate(startDate.getDate() - startOfMonth.getDay());
        const days = Array.from({ length: 42 }, (_, i) => { const day = new Date(startDate); day.setDate(day.getDate() + i); return day; });
        return (
            <div className="grid grid-cols-7 gap-2 text-center">
                {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, i) => <div key={i} className="font-medium text-gray-500 text-sm">{day}</div>)}
                {days.map((day, i) => {
                    const isSelected = day.toDateString() === selectedDate.toDateString();
                    const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                    const hasData = !!(allProductionData[day.toISOString().slice(0, 10)] && allProductionData[day.toISOString().slice(0, 10)].length > 0);
                    return (<button key={i} onClick={() => setSelectedDate(day)} className={`p-2 rounded-full text-sm relative ${isCurrentMonth ? '' : 'text-gray-400 dark:text-gray-600'} ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{day.getDate()}{hasData && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full"></span>}</button>);
                })}
            </div>
        );
    };
    const renderMonthView = () => {
        const months = Array.from({length: 12}, (_, i) => new Date(0, i).toLocaleString('pt-BR', {month: 'short'}));
        return ( <div className="grid grid-cols-4 gap-2 text-center">{months.map((month, i) => (<button key={month} onClick={() => handleMonthSelect(i)} className="p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">{month}</button>))}</div> );
    };
    const renderYearView = () => {
        const startYear = Math.floor(currentMonth.getFullYear() / 10) * 10;
        const years = Array.from({ length: 10 }, (_, i) => startYear + i);
        return ( <div className="grid grid-cols-4 gap-2 text-center">{years.map(year => (<button key={year} onClick={() => handleYearSelect(year)} className="p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">{year}</button>))}</div> );
    };
    return (
        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
            <div className="flex justify-between items-center mb-4">
                <button onClick={() => handleNavigation(-1)} title="Anterior"><ChevronLeft/></button>
                {renderHeader()}
                <button onClick={() => handleNavigation(1)} title="Próximo"><ChevronRight/></button>
            </div>
            {calendarView === 'day' && renderDayView()}
            {calendarView === 'month' && renderMonthView()}
            {calendarView === 'year' && renderYearView()}
        </div>
    );
};

const TrashItemDisplay = ({ item, products, user, onRestore, canRestore }) => {
    const date = new Date(item.deletedAt).toLocaleString('pt-BR');
    
    const commonHeader = (
      <div className="flex justify-between items-start">
        <div>
            <p className="font-bold text-lg mb-1">{item.itemType === 'product' ? 'PRODUTO DELETADO' : (item.itemType === 'lot' ? 'LOTE DELETADO' : 'LANÇAMENTO DELETADO')}</p>
            <p className="text-sm">Deletado por: <span className="font-semibold">{item.deletedByEmail}</span> em <span className="font-semibold">{date}</span></p>
            <p className="mt-2">Motivo: <span className="italic font-medium">{item.reason || 'Nenhum motivo fornecido.'}</span></p>
        </div>
        {canRestore && <button onClick={() => onRestore(item)} className="p-2 bg-green-500 text-white rounded-md text-sm">Restaurar</button>}
      </div>
    );

    const getStatusText = (status) => {
        switch(status) {
            case 'future': return 'Na Fila';
            case 'ongoing': return 'Em Andamento';
            case 'completed': return 'Concluído';
            case 'completed_missing': return 'Concluído (com Falta)';
            case 'completed_exceeding': return 'Concluído (com Sobra)';
            default: return status;
        }
    };

    if (item.itemType === 'product') {
        const doc = item.originalDoc;
        const lastKnownTime = doc.standardTimeHistory?.[doc.standardTimeHistory.length - 1]?.time || 'N/A';
        return (
            <div className="p-4 bg-red-50 dark:bg-red-900/30 rounded-lg border-2 border-red-500/50">
                {commonHeader}
                <div className="mt-3 p-3 bg-red-100 dark:bg-red-900/80 rounded-md">
                    <p className="font-bold">Detalhes do Produto:</p>
                    <p>Nome/Código: <span className="font-semibold">{doc.name}</span></p>
                    <p>Tempo Padrão (na exclusão): <span className="font-semibold">{lastKnownTime} min</span></p>
                </div>
            </div>
        );
    }

    if (item.itemType === 'lot') {
        const doc = item.originalDoc;
        return (
            <div className="p-4 bg-red-50 dark:bg-red-900/30 rounded-lg border-2 border-red-500/50">
                {commonHeader}
                <div className="mt-3 p-3 bg-red-100 dark:bg-red-900/80 rounded-md">
                    <p className="font-bold">Detalhes do Lote:</p>
                    <p>Produto: <span className="font-semibold">{doc.productName}</span> {doc.customName && `(${doc.customName})`}</p>
                    <p>Lote Sequencial #: <span className="font-semibold">{doc.sequentialId}</span></p>
                    <p>Meta Total: <span className="font-semibold">{doc.target} un.</span></p>
                    <p>Produzido até a Exclusão: <span className="font-semibold">{doc.produced} un.</span></p>
                    <p>Status na Exclusão: <span className="font-semibold">{getStatusText(doc.status)}</span></p>
                </div>
            </div>
        );
    }
    
    if (item.itemType === 'entry') {
        const doc = item.originalDoc;
        const productionList = doc.productionDetails.map(d => {
            const product = products.find(p => p.id === d.productId);
            return `${d.produced} un. (${product?.name || 'Produto Excluído'})`;
        }).join(', ');

        return (
             <div className="p-4 bg-red-50 dark:bg-red-900/30 rounded-lg border-2 border-red-500/50">
                {commonHeader}
                <div className="mt-3 p-3 bg-red-100 dark:bg-red-900/80 rounded-md">
                    <p className="font-bold">Detalhes do Lançamento:</p>
                    <p>Período: <span className="font-semibold">{doc.period}</span></p>
                    <p>Pessoas / Tempo: <span className="font-semibold">{doc.people} / {doc.availableTime} min</span></p>
                    <p>Meta Registrada: <span className="font-semibold">{doc.goalDisplay}</span></p>
                    <p>Produção Registrada: <span className="font-semibold">{productionList}</span></p>
                </div>
            </div>
        );
    }

    return null;
};

const LotReport = ({ lots, products }) => {
    const reportData = useMemo(() => {
        const completedLots = lots.filter(l => l.status.startsWith('completed') && l.startDate && l.endDate);
        if (completedLots.length === 0) {
            return { lotDetails: [], overallAverage: 0 };
        }

        let totalPieces = 0;
        let totalDays = 0;

        const lotDetails = completedLots.map(lot => {
            const startDate = new Date(lot.startDate);
            const endDate = new Date(lot.endDate);
            const durationMillis = endDate - startDate;
            const durationDays = Math.max(1, durationMillis / (1000 * 60 * 60 * 24));
            
            const averageDaily = lot.produced > 0 ? (lot.produced / durationDays) : 0;

            totalPieces += lot.produced;
            totalDays += durationDays;

            return {
                ...lot,
                duration: durationDays.toFixed(1),
                averageDaily: averageDaily.toFixed(2),
            };
        });

        const overallAverage = totalDays > 0 ? (totalPieces / totalDays) : 0;

        return { lotDetails, overallAverage: overallAverage.toFixed(2) };
    }, [lots]);

    return (
        <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
                <BarChart className="mr-2 text-blue-500"/> Relatório de Lotes Concluídos
            </h2>
            {reportData.lotDetails.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">Nenhum lote concluído para exibir o relatório.</p>
            ) : (
                <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div className="md:col-span-4 bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg text-center">
                        <h3 className="font-bold text-lg text-blue-800 dark:text-blue-300">Média Geral de Produção Diária</h3>
                        <p className="text-3xl font-extrabold text-blue-600 dark:text-blue-400">{reportData.overallAverage} <span className="text-lg">peças/dia</span></p>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                            <tr>
                                <th className="p-3">Lote</th>
                                <th className="p-3 text-center">Total Produzido</th>
                                <th className="p-3 text-center">Duração (dias)</th>
                                <th className="p-3 text-center">Média Diária (peças)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                            {reportData.lotDetails.map(lot => (
                                <tr key={lot.id}>
                                    <td className="p-3 font-semibold">{lot.productName}{lot.customName ? ` - ${lot.customName}` : ''} (#{lot.sequentialId})</td>
                                    <td className="p-3 text-center">{lot.produced} / {lot.target}</td>
                                    <td className="p-3 text-center">{lot.duration}</td>
                                    <td className="p-3 text-center font-bold text-green-600 dark:text-green-400">{lot.averageDaily}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
            )}
        </section>
    );
};

// #####################################################################
// #                                                                   #
// #           INÍCIO: CRONOANÁLISE DASHBOARD (CÓDIGO PRINCIPAL)         #
// #                                                                   #
// #####################################################################

const CronoanaliseDashboard = ({ onNavigateToStock, onNavigateToOperationalSequence, user, permissions, startTvMode, dashboards, users, roles, currentDashboardIndex, setCurrentDashboardIndex }) => {
    const { logout } = useAuth();
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);
    const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
    
    useEffect(() => { if (currentDashboardIndex >= dashboards.length && dashboards.length > 0) { setCurrentDashboardIndex(dashboards.length - 1); } }, [dashboards, currentDashboardIndex, setCurrentDashboardIndex]);

    const currentDashboard = dashboards[currentDashboardIndex] || null;
    const isTraveteDashboard = currentDashboard?.id === 'travete';
    
    const [products, setProducts] = useState([]);
    const [lots, setLots] = useState([]);
    const [allProductionData, setAllProductionData] = useState({});
    const [trashItems, setTrashItems] = useState([]);
    
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [calendarView, setCalendarView] = useState('day');
    
    const [lotCounter, setLotCounter] = useState(1);
    
    const [lotFilter, setLotFilter] = useState('ongoing');
    const [newLot, setNewLot] = useState({ productId: '', target: '', customName: '' });
    const [editingLotId, setEditingLotId] = useState(null);
    const [editingLotData, setEditingLotData] = useState({ target: '', customName: '' });
    const [newProduct, setNewProduct] = useState({ name: '', standardTime: '' });
    const [editingProductId, setEditingProductId] = useState(null);
    const [editingProductData, setEditingProductData] = useState({ name: '', standardTime: '' });
    
    const [newEntry, setNewEntry] = useState({ period: '', people: '', availableTime: 60, productId: '', productions: [] });
    const [traveteProductForm, setTraveteProductForm] = useState(() => createTraveteProductFormState());
    const resetTraveteProductForm = useCallback(() => {
        setTraveteProductForm(createTraveteProductFormState());
    }, [setTraveteProductForm]);
    const [traveteEntry, setTraveteEntry] = useState({
        period: '',
        availableTime: 60,
        employeeEntries: [createDefaultTraveteEmployee(1), createDefaultTraveteEmployee(2)],
    });
    const traveteMachines = TRAVETE_MACHINES;

    const [goalPreview, setGoalPreview] = useState("0");
    const [predictedLots, setPredictedLots] = useState([]);
    const [modalState, setModalState] = useState({ type: null, data: null });
    const [showUrgent, setShowUrgent] = useState(false);
    const [urgentProduction, setUrgentProduction] = useState({ productId: '', produced: '' });
    const [isExportingReport, setIsExportingReport] = useState(false);
    const [isNavOpen, setIsNavOpen] = useState(false);
    const navRef = useRef();
    useClickOutside(navRef, () => setIsNavOpen(false));

    const productsForSelectedDate = useMemo(() => {
        const targetDate = new Date(selectedDate);
        targetDate.setHours(23, 59, 59, 999);

        if (employeeSummaries.length === 0) {
            return defaultResult;
        }

        const goalBlocks = employeeSummaries.map(emp => emp.metaSegments);
        const lotBlocks = employeeSummaries.map(emp => emp.lotSegments);

        const goalDisplay = employeeSummaries
            .map(emp => emp.metaDisplay || '-')
            .join(' // ');

        const lotDisplay = employeeSummaries
            .map(emp => emp.lotDisplay || '-')
            .join(' // ');

        const productionDetails = employeeSummaries.flatMap(emp => emp.productionDetails);
        const totalMeta = employeeSummaries.reduce((sum, emp) => sum + (emp.meta || 0), 0);
        const totalProduced = employeeSummaries.reduce((sum, emp) => sum + (emp.produced || 0), 0);

        const isValid = Boolean(
            period &&
            availableTime > 0 &&
            employeeSummaries.every(emp => emp.valid)
        );

        return {
            employeeSummaries,
            goalDisplay,
            lotDisplay,
            isValid,
            productionDetails,
            totalMeta,
            totalProduced,
            goalBlocks,
            lotBlocks,
        };
    }, [lots, productsForSelectedDate, traveteVariationLookup, products]);

    const traveteComputedEntry = useMemo(() => {
        if (!isTraveteDashboard) {
            return {
                employeeSummaries: [],
                goalDisplay: '- // -',
                lotDisplay: '- // -',
                isValid: false,
                productionDetails: [],
                totalMeta: 0,
                totalProduced: 0,
                goalBlocks: [],
                lotBlocks: [],
            };
        }

        return summarizeTraveteEntry(traveteEntry);
    }, [isTraveteDashboard, summarizeTraveteEntry, traveteEntry]);

    const travetePreviewPending = useMemo(() => {
        if (!isTraveteDashboard) return false;
        if (!traveteEntry.period || !(parseFloat(traveteEntry.availableTime) > 0)) return false;
        return traveteEntry.employeeEntries.some(emp => (emp.products || []).some(item => item.lotId));
    }, [isTraveteDashboard, traveteEntry]);

                if (!validTimeEntry) {
                    return null; 
                }
                return { ...p, standardTime: validTimeEntry.time };
            })
            .filter(Boolean);
    }, [products, selectedDate]);

    const traveteVariationLookup = useMemo(() => {
        const lookup = new Map();
        productsForSelectedDate.forEach(product => {
            if (!product?.machineType) return;
            const baseId = product.baseProductId || product.id;
            if (!lookup.has(baseId)) {
                lookup.set(baseId, new Map());
            }
            lookup.get(baseId).set(product.machineType, product);
        });
        return lookup;
    }, [productsForSelectedDate]);
    
    const summarizeTraveteEntry = useCallback((entryDraft) => {
        const defaultResult = {
            employeeSummaries: [],
            goalDisplay: '- // -',
            lotDisplay: '- // -',
            isValid: false,
            productionDetails: [],
            totalMeta: 0,
            totalProduced: 0,
            goalBlocks: [],
            lotBlocks: [],
        };

        if (!entryDraft) {
            return defaultResult;
        }

        const availableTime = parseFloat(entryDraft.availableTime) || 0;
        const period = entryDraft.period;
        const activeLots = getOrderedActiveLots(lots);

        const employeeSummaries = (entryDraft.employeeEntries || []).map((emp) => {
            const manualStandardTime = parseFloat(emp.standardTime);
            let derivedStandardTime = 0;

            const productSummaries = (emp.products || []).map(productItem => {
                const lot = productItem.lotId ? (lots.find(l => l.id === productItem.lotId) || null) : null;
                const produced = parseInt(productItem.produced, 10) || 0;
                const variation = lot
                    ? findTraveteVariationForLot(lot, emp.machineType, productsForSelectedDate, traveteVariationLookup)
                    : null;
                const baseProductId = lot ? resolveTraveteLotBaseId(lot, productsForSelectedDate) : null;
                const variationStandardTime = variation?.standardTime ? parseFloat(variation.standardTime) : NaN;
                if (!Number.isNaN(variationStandardTime) && variationStandardTime > 0 && derivedStandardTime <= 0) {
                    derivedStandardTime = variationStandardTime;
                }

                return {
                    lot,
                    lotId: lot?.id || '',
                    productId: variation?.id || '',
                    productBaseId: baseProductId || '',
                    produced,
                    standardTime: (!Number.isNaN(variationStandardTime) && variationStandardTime > 0)
                        ? variationStandardTime
                        : 0,
                };
            });

            const standardTimeValue = (!Number.isNaN(manualStandardTime) && manualStandardTime > 0)
                ? manualStandardTime
                : derivedStandardTime;

            const produced = productSummaries.reduce((sum, item) => sum + (item.produced || 0), 0);
            const meta = (standardTimeValue > 0 && availableTime > 0)
                ? Math.round(availableTime / standardTimeValue)
                : 0;
            const efficiency = (standardTimeValue > 0 && availableTime > 0 && produced > 0)
                ? parseFloat((((produced * standardTimeValue) / availableTime) * 100).toFixed(2))
                : 0;

            const productionDetails = productSummaries
                .filter(item => item.produced > 0 && item.lotId)
                .map(item => ({
                    lotId: item.lotId,
                    productId: item.productId,
                    produced: item.produced,
                    ...(item.productBaseId ? { productBaseId: item.productBaseId } : {}),
                    standardTime: item.standardTime || standardTimeValue || 0,
                }));

            const productsForSave = productSummaries
                .filter(item => item.produced > 0 && item.lotId)
                .map(item => ({
                    lotId: item.lotId,
                    produced: item.produced,
                    productId: item.productId,
                    productBaseId: item.productBaseId || undefined,
                    standardTime: item.standardTime || standardTimeValue || 0,
                    lotName: item.lot ? formatTraveteLotDisplayName(item.lot, products) : '',
                }));

            const valid = Boolean(
                period &&
                availableTime > 0 &&
                productionDetails.length > 0 &&
                standardTimeValue > 0
            );

            const primaryLot = productSummaries.find(item => item.lot)?.lot || null;
            const manualNextLotItem = productSummaries.slice(1).find(item => item.lot) || null;
            const manualNextLot = manualNextLotItem?.lot || null;

            const currentLot = primaryLot || activeLots[0] || null;
            let nextLotCandidate = manualNextLot || null;

            if (!nextLotCandidate && currentLot) {
                const currentIndex = activeLots.findIndex(l => l.id === currentLot.id);
                if (currentIndex !== -1) {
                    nextLotCandidate = activeLots.slice(currentIndex + 1).find(Boolean) || null;
                }
            }

            if (!nextLotCandidate && !currentLot && activeLots.length > 0) {
                nextLotCandidate = activeLots[0];
            }

            const currentLotName = currentLot ? formatTraveteLotDisplayName(currentLot, products) : '';
            const rawNextLotName = nextLotCandidate ? formatTraveteLotDisplayName(nextLotCandidate, products) : '';
            const remainingInCurrentLot = getLotRemainingPieces(currentLot);
            const nextLotRemaining = getLotRemainingPieces(nextLotCandidate);

            const plannedForCurrentLot = currentLot ? Math.min(meta, remainingInCurrentLot || 0) : 0;
            const leftoverMetaForNext = Math.max(0, meta - plannedForCurrentLot);
            const manualNextProduced = manualNextLotItem ? manualNextLotItem.produced || 0 : 0;
            const nextMetaPieces = manualNextLotItem && manualNextProduced > 0
                ? manualNextProduced
                : nextLotRemaining;

            const shouldShowNextLot = Boolean(nextLotCandidate)
                && (manualNextLotItem || leftoverMetaForNext > 0)
                && (nextMetaPieces > 0);

            const machineSuffix = emp.machineType?.replace('Travete ', '') || '';
            const currentLotLabel = currentLotName
                ? `${currentLotName}${machineSuffix ? ` - ${machineSuffix}` : ''}`
                : '';
            const nextLotName = shouldShowNextLot ? rawNextLotName : '';
            const lotDisplay = currentLotLabel
                ? (shouldShowNextLot && nextLotName ? `${currentLotLabel} / ${nextLotName}` : currentLotLabel)
                : (shouldShowNextLot && nextLotName ? nextLotName : '-');

            const currentMetaValue = currentLot ? remainingInCurrentLot : (meta > 0 ? meta : 0);
            const currentMetaLabel = currentMetaValue > 0
                ? currentMetaValue.toLocaleString('pt-BR')
                : (currentLot ? '0' : (meta > 0 ? meta.toLocaleString('pt-BR') : '0'));
            const nextMetaLabel = shouldShowNextLot
                ? (nextMetaPieces > 0 ? nextMetaPieces.toLocaleString('pt-BR') : '0')
                : '';
            const metaDisplay = nextMetaLabel ? `${currentMetaLabel}/${nextMetaLabel}` : currentMetaLabel;

            const producedSegments = productSummaries.map(item => {
                const producedNumeric = parseInt(item.produced, 10);
                return Number.isNaN(producedNumeric) ? 0 : producedNumeric;
            });
            const formattedProducedSegments = producedSegments.filter((value, idx) => (idx === 0) || value > 0)
                .map(value => value.toLocaleString('pt-BR'));
            const producedDisplay = formattedProducedSegments.length > 0
                ? formattedProducedSegments.join(' / ')
                : produced.toLocaleString('pt-BR');

            return {
                ...emp,
                produced,
                meta,
                efficiency,
                standardTimeValue,
                productionDetails,
                productsForSave,
                productSummaries,
                valid,
                metaDisplay,
                lotDisplay,
                producedDisplay,
                currentLotName,
                nextLotName,
                shouldShowNextLot,
                metaSegments: {
                    current: currentMetaValue,
                    next: shouldShowNextLot ? nextMetaPieces : null,
                    showNext: shouldShowNextLot,
                },
                lotSegments: {
                    current: currentLotName,
                    next: shouldShowNextLot ? nextLotName : '',
                    machineType: emp.machineType || '',
                },
            };
        });

        if (employeeSummaries.length === 0) {
            return defaultResult;
        }

        const goalBlocks = employeeSummaries.map(emp => emp.metaSegments);
        const lotBlocks = employeeSummaries.map(emp => emp.lotSegments);

        const goalDisplay = employeeSummaries
            .map(emp => emp.metaDisplay || '-')
            .join(' // ');

        const lotDisplay = employeeSummaries
            .map(emp => emp.lotDisplay || '-')
            .join(' // ');

        const productionDetails = employeeSummaries.flatMap(emp => emp.productionDetails);
        const totalMeta = employeeSummaries.reduce((sum, emp) => sum + (emp.meta || 0), 0);
        const totalProduced = employeeSummaries.reduce((sum, emp) => sum + (emp.produced || 0), 0);

        const isValid = Boolean(
            period &&
            availableTime > 0 &&
            employeeSummaries.every(emp => emp.valid)
        );

        return {
            employeeSummaries,
            goalDisplay,
            lotDisplay,
            isValid,
            productionDetails,
            totalMeta,
            totalProduced,
            goalBlocks,
            lotBlocks,
        };
    }, [lots, productsForSelectedDate, traveteVariationLookup, products]);

    const traveteComputedEntry = useMemo(() => {
        if (!isTraveteDashboard) {
            return {
                employeeSummaries: [],
                goalDisplay: '- // -',
                lotDisplay: '- // -',
                isValid: false,
                productionDetails: [],
                totalMeta: 0,
                totalProduced: 0,
                goalBlocks: [],
                lotBlocks: [],
            };
        }

        return summarizeTraveteEntry(traveteEntry);
    }, [isTraveteDashboard, summarizeTraveteEntry, traveteEntry]);

    const travetePreviewPending = useMemo(() => {
        if (!isTraveteDashboard) return false;
        if (!traveteEntry.period || !(parseFloat(traveteEntry.availableTime) > 0)) return false;
        return traveteEntry.employeeEntries.some(emp => (emp.products || []).some(item => item.lotId));
    }, [isTraveteDashboard, traveteEntry]);

    const isEntryFormValid = useMemo(() => {
        if (isTraveteDashboard) {
            return traveteComputedEntry.isValid;
        }

        const allFieldsFilled = newEntry.productions.every(p => p !== '' && p !== null);

        const atLeastOneIsPositive = newEntry.productions.some(p => parseInt(p, 10) > 0);

        const hasProduction = allFieldsFilled && atLeastOneIsPositive;

        const hasUrgentProduction = showUrgent && urgentProduction.productId && (parseInt(urgentProduction.produced, 10) || 0) > 0;

        return (
            newEntry.period &&
            (parseFloat(newEntry.people) > 0) &&
            (parseFloat(newEntry.availableTime) > 0) &&
            newEntry.productId &&
            (hasProduction || hasUrgentProduction)
        );
    }, [isTraveteDashboard, traveteComputedEntry, newEntry, showUrgent, urgentProduction]);
    
    useEffect(() => {
        if (!user || !currentDashboard) return;

        const unsubProducts = onSnapshot(query(collection(db, `dashboards/${currentDashboard.id}/products`)), snap => {
            setProducts(snap.docs.map(d => d.data()));
        });
        const unsubLots = onSnapshot(query(collection(db, `dashboards/${currentDashboard.id}/lots`), orderBy("order")), snap => {
            setLots(snap.docs.map(d => d.data()));
        });
        const unsubProdData = onSnapshot(doc(db, `dashboards/${currentDashboard.id}/productionData`, "data"), snap => {
            setAllProductionData(snap.exists() ? snap.data() : {});
        });
        const unsubTrash = onSnapshot(query(collection(db, 'trash')), snap => {
             setTrashItems(snap.docs.map(d => d.data()));
        });

        const clearPreviewOnUnmount = async () => {
            if(currentDashboard?.id) {
                await deleteDoc(doc(db, `dashboards/${currentDashboard.id}/previews/live`));
            }
        };

        return () => {
            unsubProducts();
            unsubLots();
            unsubProdData();
            unsubTrash();
            clearPreviewOnUnmount();
        };

    }, [user, currentDashboard]);
    
    const dateKey = selectedDate.toISOString().slice(0, 10);
    const productionData = useMemo(() => allProductionData[dateKey] || [], [allProductionData, dateKey]);
    
    useEffect(() => { setLotCounter(lots.length > 0 ? Math.max(0, ...lots.map(l => l.sequentialId || 0)) + 1 : 1); }, [lots]);

    useEffect(() => {
        if (!isTraveteDashboard) {
            setTraveteProductForm(createTraveteProductFormState());
            setTraveteEntry({
                period: '',
                availableTime: 60,
                employeeEntries: [createDefaultTraveteEmployee(1), createDefaultTraveteEmployee(2)],
            });
        }
    }, [isTraveteDashboard]);

    const closeModal = () => setModalState({ type: null, data: null });
    
    useEffect(() => {
        if (!currentDashboard?.id) return;

        const previewRef = doc(db, `dashboards/${currentDashboard.id}/previews/live`);

        if (isTraveteDashboard) {
            const hasBasicInfo = traveteEntry.period && parseFloat(traveteEntry.availableTime) > 0;
            const hasAnyProduct = traveteEntry.employeeEntries.some(emp => (emp.products || []).some(item => item.lotId));
            if (hasBasicInfo && hasAnyProduct) {
                const handler = setTimeout(async () => {
                    const employeePreview = traveteComputedEntry.employeeSummaries.map(emp => ({
                        employeeId: emp.employeeId,
                        machineType: emp.machineType,
                        products: (emp.productsForSave || []).map(item => ({
                            lotName: item.lotName || '',
                            produced: item.produced,
                        })),
                    }));

                    const lotNames = Array.from(new Set(employeePreview.flatMap(emp => (emp.products || []).map(p => p.lotName).filter(Boolean))));
                    const lotDisplayValue = traveteComputedEntry.lotDisplay && traveteComputedEntry.lotDisplay.trim().length > 0
                        ? traveteComputedEntry.lotDisplay
                        : lotNames.join(' | ');

                    await setDoc(previewRef, {
                        period: traveteEntry.period,
                        goalDisplay: traveteComputedEntry.goalDisplay,
                        availableTime: traveteEntry.availableTime,
                        people: traveteEntry.employeeEntries.length,
                        employeeEntries: employeePreview,
                        lotDisplayName: lotDisplayValue || '',
                        timestamp: Timestamp.now(),
                    });
                }, 500);

                return () => {
                    clearTimeout(handler);
                };
            }

            deleteDoc(previewRef);
            return;
        }

        if (newEntry.period && newEntry.people > 0 && newEntry.availableTime > 0 && newEntry.productId) {

            const handler = setTimeout(async () => {
                const product = productsForSelectedDate.find(p => p.id === newEntry.productId);

                await setDoc(previewRef, {
                    period: newEntry.period,
                    goalDisplay: goalPreview,
                    productName: product?.name || '',
                    timestamp: Timestamp.now()
                });
            }, 1500);

            return () => {
                clearTimeout(handler);
            };
        }

        deleteDoc(previewRef);
    }, [isTraveteDashboard, goalPreview, newEntry, traveteEntry, traveteComputedEntry, currentDashboard, productsForSelectedDate, products]);


    const handleAddEntry = useCallback(async (e) => {
        e.preventDefault();
        if (!currentDashboard) return;

        if (isTraveteDashboard) {
            if (!traveteComputedEntry.isValid) return;

            const entryId = Date.now().toString();
            const batch = writeBatch(db);
            const prodDataRef = doc(db, `dashboards/${currentDashboard.id}/productionData`, "data");
            const employeeEntries = traveteComputedEntry.employeeSummaries.map(emp => ({
                employeeId: emp.employeeId,
                machineType: emp.machineType,
                produced: emp.produced || 0,
                standardTime: emp.standardTimeValue || 0,
                products: (emp.productsForSave || []).map(product => ({
                    lotId: product.lotId,
                    productId: product.productId,
                    produced: product.produced,
                    standardTime: product.standardTime,
                    ...(product.productBaseId ? { productBaseId: product.productBaseId } : {}),
                })),
            }));

            const newEntryData = {
                id: entryId,
                period: traveteEntry.period,
                people: traveteEntry.employeeEntries.length,
                availableTime: traveteEntry.availableTime,
                goalDisplay: traveteComputedEntry.goalDisplay,
                lotDisplay: traveteComputedEntry.lotDisplay,
                traveteGoalBlocks: traveteComputedEntry.goalBlocks || [],
                traveteLotBlocks: traveteComputedEntry.lotBlocks || [],
                employeeEntries,
                productionDetails: traveteComputedEntry.productionDetails,
                observation: '',
                createdBy: { uid: user.uid, email: user.email },
            };

            const updatedDayData = [...(allProductionData[dateKey] || []), newEntryData];
            batch.set(prodDataRef, { [dateKey]: updatedDayData }, { merge: true });

            for (const detail of traveteComputedEntry.productionDetails) {
                const lotToUpdate = detail.lotId
                    ? lots.find(l => l.id === detail.lotId)
                    : detail.productBaseId
                        ? lots.find(l => resolveTraveteLotBaseId(l, productsForSelectedDate) === detail.productBaseId)
                        : lots.find(l => l.productId === detail.productId);
                if (lotToUpdate) {
                    const lotRef = doc(db, `dashboards/${currentDashboard.id}/lots`, lotToUpdate.id);
                    const newProduced = (lotToUpdate.produced || 0) + detail.produced;
                    const updatePayload = {
                        produced: newProduced,
                        lastEditedBy: { uid: user.uid, email: user.email },
                        lastEditedAt: Timestamp.now(),
                    };
                    if (lotToUpdate.status === 'future' && newProduced > 0) {
                        updatePayload.status = 'ongoing';
                        updatePayload.startDate = new Date().toISOString();
                    }
                    if (newProduced >= lotToUpdate.target && !lotToUpdate.status.startsWith('completed')) {
                        updatePayload.status = 'completed';
                        updatePayload.endDate = new Date().toISOString();
                    }
                    batch.update(lotRef, updatePayload);
                }
            }

            const previewRef = doc(db, `dashboards/${currentDashboard.id}/previews/live`);
            batch.delete(previewRef);

            await batch.commit();

            setTraveteEntry({
                period: '',
                availableTime: 60,
                employeeEntries: [createDefaultTraveteEmployee(1), createDefaultTraveteEmployee(2)],
            });
            return;
        }

        if (!isEntryFormValid) return;

        const productionDetails = [];
        if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) {
            productionDetails.push({ productId: urgentProduction.productId, produced: parseInt(urgentProduction.produced, 10) });
        }
        predictedLots.filter(p => !p.isUrgent).forEach((lot, index) => {
            const producedAmount = parseInt(newEntry.productions[index], 10) || 0;
            if (lot && producedAmount > 0) {
                productionDetails.push({ productId: lot.productId, produced: producedAmount });
            }
        });

        const newEntryData = {
            id: Date.now().toString(),
            period: newEntry.period,
            people: newEntry.people,
            availableTime: newEntry.availableTime,
            productionDetails,
            observation: '',
            goalDisplay: goalPreview,
            primaryProductId: newEntry.productId,
            createdBy: { uid: user.uid, email: user.email },
        };

        const batch = writeBatch(db);
        const prodDataRef = doc(db, `dashboards/${currentDashboard.id}/productionData`, "data");

        const updatedDayData = [...(allProductionData[dateKey] || []), newEntryData];
        batch.set(prodDataRef, { [dateKey]: updatedDayData }, { merge: true });

        for (const detail of productionDetails) {
            const lotToUpdate = lots.find(l => l.productId === detail.productId);
            if(lotToUpdate){
                const lotRef = doc(db, `dashboards/${currentDashboard.id}/lots`, lotToUpdate.id);
                const newProduced = (lotToUpdate.produced || 0) + detail.produced;
                const updatePayload = {
                    produced: newProduced,
                    lastEditedBy: { uid: user.uid, email: user.email },
                    lastEditedAt: Timestamp.now(),
                };
                if (lotToUpdate.status === 'future' && newProduced > 0) {
                    updatePayload.status = 'ongoing';
                    updatePayload.startDate = new Date().toISOString();
                }
                if (newProduced >= lotToUpdate.target && !lotToUpdate.status.startsWith('completed')) {
                    updatePayload.status = 'completed';
                    updatePayload.endDate = new Date().toISOString();
                }
                batch.update(lotRef, updatePayload);
            }
        }

        const previewRef = doc(db, `dashboards/${currentDashboard.id}/previews/live`);
        batch.delete(previewRef);

        await batch.commit();

        setNewEntry({ period: '', people: '', availableTime: 60, productId: newEntry.productId, productions: [] });
        setUrgentProduction({productId: '', produced: ''});
        setShowUrgent(false);
    }, [currentDashboard, isTraveteDashboard, traveteComputedEntry, traveteEntry, allProductionData, dateKey, lots, user, isEntryFormValid, showUrgent, urgentProduction, predictedLots, newEntry, goalPreview, productsForSelectedDate]);
    
    
    const handleSaveTraveteEntry = async (entryId, updatedData) => {
        const originalEntry = productionData.find(e => e.id === entryId);
        if (!originalEntry) {
            console.error('Lançamento do Travete não encontrado para editar.');
            return;
        }

        const entryDraft = {
            period: originalEntry.period,
            availableTime: updatedData.availableTime,
            employeeEntries: (updatedData.employeeEntries || []).map((emp, index) => ({
                employeeId: emp.employeeId || index + 1,
                machineType: emp.machineType,
                standardTime: emp.standardTime,
                products: (emp.products || []).map(product => ({
                    lotId: product.lotId || '',
                    produced: product.produced || 0,
                })),
            })),
        };

        const computed = summarizeTraveteEntry(entryDraft);
        if (!computed.isValid || computed.employeeSummaries.length === 0) {
            console.error('Dados do Travete inválidos para salvar edição.');
            return;
        }

        const batch = writeBatch(db);
        const prodDataRef = doc(db, `dashboards/${currentDashboard.id}/productionData`, 'data');

        const productionDeltas = new Map();
        const accumulateDetail = (detail, sign) => {
            const lotTarget = detail.lotId
                ? lots.find(l => l.id === detail.lotId)
                : detail.productBaseId
                    ? lots.find(l => resolveTraveteLotBaseId(l, productsForSelectedDate) === detail.productBaseId)
                    : lots.find(l => l.productId === detail.productId);
            if (!lotTarget) return;
            productionDeltas.set(lotTarget.id, (productionDeltas.get(lotTarget.id) || 0) + sign * detail.produced);
        };

        (originalEntry.productionDetails || []).forEach(detail => accumulateDetail(detail, -1));
        computed.productionDetails.forEach(detail => accumulateDetail(detail, 1));

        for (const [lotId, delta] of productionDeltas.entries()) {
            if (delta === 0) continue;
            const lotRef = doc(db, `dashboards/${currentDashboard.id}/lots`, lotId);
            batch.update(lotRef, {
                produced: increment(delta),
                lastEditedBy: { uid: user.uid, email: user.email },
                lastEditedAt: Timestamp.now(),
            });
        }

        const updatedDayData = productionData.map(entry => {
            if (entry.id !== entryId) return entry;

            const employeeEntries = computed.employeeSummaries.map(emp => ({
                employeeId: emp.employeeId,
                machineType: emp.machineType,
                produced: emp.produced || 0,
                standardTime: emp.standardTimeValue || 0,
                products: (emp.productsForSave || []).map(product => ({
                    lotId: product.lotId,
                    productId: product.productId,
                    produced: product.produced,
                    standardTime: product.standardTime,
                    ...(product.productBaseId ? { productBaseId: product.productBaseId } : {}),
                })),
            }));

            return {
                ...entry,
                people: employeeEntries.length,
                availableTime: entryDraft.availableTime,
                goalDisplay: computed.goalDisplay,
                lotDisplay: computed.lotDisplay,
                traveteGoalBlocks: computed.goalBlocks || [],
                traveteLotBlocks: computed.lotBlocks || [],
                employeeEntries,
                productionDetails: computed.productionDetails,
                observation: updatedData.observation || entry.observation || '',
                lastEditedBy: { uid: user.uid, email: user.email },
                lastEditedAt: Timestamp.now(),
            };
        });

        batch.set(prodDataRef, { [dateKey]: updatedDayData }, { merge: true });

        try {
            await batch.commit();
        } catch (error) {
            console.error('Erro ao salvar edição do Travete:', error);
        }
    };

    const handleSaveEntry = async (entryId, updatedData) => {
      if (isTraveteDashboard || updatedData?.type === 'travete') {
          await handleSaveTraveteEntry(entryId, updatedData);
          return;
      }

      const originalEntry = productionData.find(e => e.id === entryId);
      if (!originalEntry) {
          console.error("Lançamento original não encontrado para editar.");
          return;
      }
 
      const batch = writeBatch(db);
      const prodDataRef = doc(db, `dashboards/${currentDashboard.id}/productionData`, "data");
 
      const productionDeltas = new Map();
      const updatedProductions = Array.isArray(updatedData.productions) ? updatedData.productions : [];

      (originalEntry.productionDetails || []).forEach(detail => {
          productionDeltas.set(detail.productId, (productionDeltas.get(detail.productId) || 0) - detail.produced);
      });

      updatedProductions.forEach(detail => {
          productionDeltas.set(detail.productId, (productionDeltas.get(detail.productId) || 0) + detail.produced);
      });
 
      for (const [productId, delta] of productionDeltas.entries()) {
          if (delta === 0) continue;
 
          const lotToUpdate = lots.find(l => l.productId === productId);
          if (lotToUpdate) {
              const lotRef = doc(db, `dashboards/${currentDashboard.id}/lots`, lotToUpdate.id);
              batch.update(lotRef, {
                  produced: increment(delta),
                  lastEditedBy: { uid: user.uid, email: user.email },
                  lastEditedAt: Timestamp.now(),
              });
          }
      }
      
      const updatedDayData = productionData.map(e => {
          if (e.id === entryId) {
              return {
                  ...e,
                  people: updatedData.people,
                  availableTime: updatedData.availableTime,
                  productionDetails: updatedProductions,
                  goalDisplay: updatedData.goalDisplay !== undefined ? updatedData.goalDisplay : e.goalDisplay,
                  primaryProductId: updatedData.primaryProductId !== undefined ? updatedData.primaryProductId : e.primaryProductId,
                  lastEditedBy: { uid: user.uid, email: user.email },
                  lastEditedAt: Timestamp.now(),
              };
          }
          return e;
      });
      
      batch.set(prodDataRef, { [dateKey]: updatedDayData }, { merge: true });
 
      try {
          await batch.commit();
          console.log("Lançamento atualizado com sucesso.");
      } catch (error) {
          console.error("Erro ao salvar lançamento editado:", error);
      }
    };


    const executeSoftDelete = async (reason, itemId, itemType, itemDoc) => {
        try {
            const trashId = Date.now().toString();
            const trashItem = {
                id: trashId,
                originalId: itemId,
                itemType: itemType,
                originalDoc: itemDoc,
                deletedByEmail: user.email,
                deletedAt: new Date().toISOString(),
                reason,
                dashboardId: currentDashboard.id,
            };

            const batch = writeBatch(db);
            batch.set(doc(db, "trash", trashId), trashItem);

            if (itemType === 'lot') {
                batch.delete(doc(db, `dashboards/${currentDashboard.id}/lots`, itemId));
            } else if (itemType === 'product') {
                batch.delete(doc(db, `dashboards/${currentDashboard.id}/products`, itemId));
            } else if (itemType === 'entry') {
                const updatedDayData = productionData.filter(e => e.id !== itemId);
                const updatedProdData = { ...allProductionData, [dateKey]: updatedDayData };
                batch.set(doc(db, `dashboards/${currentDashboard.id}/productionData`, "data"), updatedProdData, { merge: true });
                
                for (const detail of itemDoc.productionDetails) {
                    const lotToUpdate = lots.find(l => l.productId === detail.productId);
                    if(lotToUpdate){
                        const newProduced = Math.max(0, (lotToUpdate.produced || 0) - detail.produced);
                        const newStatus = (lotToUpdate.status.startsWith('completed') && newProduced < lotToUpdate.target) ? 'ongoing' : lotToUpdate.status;
                        batch.update(doc(db, `dashboards/${currentDashboard.id}/lots`, lotToUpdate.id), { produced: newProduced, status: newStatus });
                    }
                }
            }
            await batch.commit();

        } catch (e) { console.error('Erro ao mover item para lixeira:', e); } 
        finally { closeModal(); }
    };

    const handleRestoreItem = async (itemToRestore) => {
      const { itemType, originalDoc, dashboardId, id: trashId } = itemToRestore;
      
      if (dashboardId !== currentDashboard.id) {
          alert("Este item pertence a outro quadro e não pode ser restaurado aqui.");
          return;
      }
      
      const batch = writeBatch(db);
      
      if (itemType === 'product') {
          batch.set(doc(db, `dashboards/${dashboardId}/products`, originalDoc.id), originalDoc);
      } else if (itemType === 'lot') {
          batch.set(doc(db, `dashboards/${dashboardId}/lots`, originalDoc.id), originalDoc);
      } else if (itemType === 'entry') {
          const entryDateKey = new Date(itemToRestore.deletedAt).toISOString().slice(0, 10);
          const dayEntries = allProductionData[entryDateKey] || [];
          const restoredDayEntries = [...dayEntries, originalDoc];
          const updatedProdData = { ...allProductionData, [entryDateKey]: restoredDayEntries };
          batch.set(doc(db, `dashboards/${dashboardId}/productionData`, "data"), updatedProdData, { merge: true });
          
          for (const detail of originalDoc.productionDetails) {
              const lotToUpdate = lots.find(l => l.productId === detail.productId);
               if(lotToUpdate){
                  const newProduced = (lotToUpdate.produced || 0) + detail.produced;
                  const newStatus = (newProduced >= lotToUpdate.target) ? 'completed' : lotToUpdate.status;
                  batch.update(doc(db, `dashboards/${dashboardId}/lots`, lotToUpdate.id), { produced: newProduced, status: newStatus });
              }
          }
      }
      
      batch.delete(doc(db, "trash", trashId));
      await batch.commit();
    };

    const handleDeleteItemFlow = (itemId, itemType) => {
        let itemDoc;
        if (itemType === 'entry') itemDoc = productionData.find(i => i.id === itemId);
        else if (itemType === 'lot') itemDoc = lots.find(i => i.id === itemId);
        else if (itemType === 'product') itemDoc = products.find(i => i.id === itemId);
        if (!itemDoc) return;
        
        const onConfirmReason = (reason) => {
            if(permissions.DELETE_ENTRIES) { 
                executeSoftDelete(reason, itemId, itemType, itemDoc);
            }
        };

        setModalState({ type: 'reason', data: { onConfirm: onConfirmReason } });
    };

    const handleDeleteLot = (lotId) => handleDeleteItemFlow(lotId, 'lot');
    const handleDeleteProduct = (productId) => handleDeleteItemFlow(productId, 'product');
    const handleDeleteEntry = (entryId) => handleDeleteItemFlow(entryId, 'entry');

    const handleAddDashboard = async (name) => {
        if (dashboards.some(d => d.name.toLowerCase() === name.toLowerCase())) return false;
        const newOrder = dashboards.length > 0 ? Math.max(...dashboards.map(d => d.order)) + 1 : 1;
        const id = Date.now().toString();
        await setDoc(doc(db, "dashboards", id), { id, name, order: newOrder });
        return true;
    };
    const handleRenameDashboard = async (id, newName) => {
        if (dashboards.some(d => d.id !== id && d.name.toLowerCase() === newName.toLowerCase())) return false;
        await updateDoc(doc(db, "dashboards", id), { name: newName });
        return true;
    };
    const handleDeleteDashboard = async (id) => {
        if (dashboards.length <= 1) return;
        alert("A exclusão de quadros e seus sub-dados deve ser feita com cuidado, preferencialmente por uma Cloud Function para garantir a limpeza completa. Esta ação apenas removerá o quadro da lista.");
        await deleteDoc(doc(db, "dashboards", id));
    };

    const handleMoveDashboard = async (dashboardId, direction) => {
        const currentIndex = dashboards.findIndex(d => d.id === dashboardId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= dashboards.length) return;

        const currentDash = dashboards[currentIndex];
        const swapDash = dashboards[newIndex];

        const batch = writeBatch(db);
        const currentDashRef = doc(db, "dashboards", currentDash.id);
        const swapDashRef = doc(db, "dashboards", swapDash.id);

        batch.update(currentDashRef, { order: swapDash.order });
        batch.update(swapDashRef, { order: currentDash.order });

        await batch.commit();
    };
    
    const handleSelectTvMode = () => setModalState({ type: 'tvSelector', data: null });
    
    useEffect(() => {
        const validProducts = productsForSelectedDate;
        if (validProducts.length > 0) {
            const isCurrentSelectionValid = validProducts.some(p => p.id === newEntry.productId);
            if (!isCurrentSelectionValid) {
                setNewEntry(prev => ({ ...prev, productId: validProducts[0].id, productions: [] }));
            }
        } else {
             setNewEntry(prev => ({ ...prev, productId: '', productions: [] }));
        }
    }, [newEntry.productId, productsForSelectedDate]);

    const calculatePredictions = useCallback(() => {
        if (isTraveteDashboard) {
            return { allPredictions: [], currentGoalPreview: traveteComputedEntry.goalDisplay || '- // -' };
        }

    const people = parseFloat(newEntry.people) || 0;
    const availableTime = parseFloat(newEntry.availableTime) || 0;
    let timeConsumedByUrgent = 0;
    let urgentPrediction = null;

    const currentProducts = productsForSelectedDate;

    // calcula tempo consumido pela produção urgente (se houver)
    if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) {
        const urgentProduct = currentProducts.find(p => p.id === urgentProduction.productId);
        if (urgentProduct && urgentProduct.standardTime > 0) {
            timeConsumedByUrgent = urgentProduct.standardTime * urgentProduction.produced;
            const urgentLot = lots.find(l => l.productId === urgentProduct.id);
            urgentPrediction = {
                ...(urgentLot || {}),
                productId: urgentProduct.id,
                productName: urgentProduct.name,
                producible: parseInt(urgentProduction.produced, 10),
                remainingPieces: getLotRemainingPieces(urgentLot),
                isUrgent: true,
            };
        }
    }

    const totalAvailableMinutes = availableTime * people;
    let timeForNormal = totalAvailableMinutes - timeConsumedByUrgent;
    const normalPredictions = [];

    if (timeForNormal > 0) {
        const activeLots = getOrderedActiveLots(lots);

        // 1) Encontrar o primeiro lote incompleto (prioridade real)
        let startIndex = activeLots.findIndex(l => ((l.target || 0) - (l.produced || 0)) > 0);

        // 2) Se não houver lote incompleto, usar fallback para newEntry.productId (como antes)
        if (startIndex === -1 && newEntry.productId) {
            startIndex = activeLots.findIndex(l => l.productId === newEntry.productId);
        }

        // 3) Se encontramos um índice válido, iteramos a partir dele
        if (startIndex !== -1) {
            // opcional: limite de quantos produtos queremos prever (até 10 conforme pediu)
            const MAX_PREDICTIONS = 10;
            for (let i = startIndex; i < activeLots.length && timeForNormal > 0 && normalPredictions.length < MAX_PREDICTIONS; i++) {
                const lot = activeLots[i];
                const productForLot = currentProducts.find(p => p.id === lot.productId);

                if (!productForLot || productForLot.standardTime <= 0) continue;

                const remainingPiecesInLot = getLotRemainingPieces(lot);
                if (remainingPiecesInLot === 0) continue;

                // Se não há tempo sequer para 1 peça (check rápido), para o cálculo.
                if (timeForNormal < productForLot.standardTime) {
                    break;
                }

                // CÁLCULO PRINCIPAL: usar arredondamento para o inteiro mais próximo (Math.round)
                const producibleFloat = timeForNormal / productForLot.standardTime;
                const roundedProducible = Math.round(producibleFloat); // 79.71 -> 80
                // garantir ao menos 1 (mas já garantimos timeForNormal >= standardTime)
                const producible = Math.min(remainingPiecesInLot, Math.max(0, roundedProducible));

                if (producible <= 0) {
                    // nada a produzir (proteção), sai do loop
                    break;
                }

                normalPredictions.push({
                    ...lot,
                    producible,
                    remainingPieces: remainingPiecesInLot,
                    productName: productForLot.name,
                });

                // subtrai o tempo "consumido" por essa previsão
                timeForNormal -= producible * productForLot.standardTime;

                // evita loops estranhos: se o tempo ficar <= 0, encerra
                if (timeForNormal <= 0) break;
            }
        } else if (newEntry.productId) {
            // fallback: usuário escolheu produto que não está em activeLots — calcula o que dá para produzir
            const selectedProduct = currentProducts.find(p => p.id === newEntry.productId);
            if (selectedProduct && selectedProduct.standardTime > 0) {
                const producibleFloat = timeForNormal / selectedProduct.standardTime;
                const producible = Math.round(producibleFloat);
                if (producible > 0) {
                    normalPredictions.push({
                        id: `nolot-${selectedProduct.id}`,
                        productId: selectedProduct.id,
                        productName: selectedProduct.name,
                        producible,
                        remainingPieces: producible,
                    });
                }
            }
        }
    }

    const allPredictions = urgentPrediction ? [urgentPrediction, ...normalPredictions] : normalPredictions;
    const normalGoalSegments = normalPredictions
        .map(prediction => {
            const value = prediction.remainingPieces ?? prediction.producible ?? 0;
            return value > 0 ? value : 0;
        })
        .filter((value, index) => value > 0 || index === 0);
    return {
        allPredictions,
        currentGoalPreview: normalGoalSegments.length > 0
            ? normalGoalSegments.join(' / ')
            : '0',
    };
    }, [isTraveteDashboard, traveteComputedEntry.goalDisplay, newEntry.people, newEntry.availableTime, newEntry.productId, productsForSelectedDate, lots, urgentProduction, showUrgent]);

  
    useEffect(() => {
        if (isTraveteDashboard) {
            setPredictedLots([]);
            setGoalPreview(traveteComputedEntry.goalDisplay || '- // -');
            return;
        }

        const { allPredictions, currentGoalPreview } = calculatePredictions();
        setPredictedLots(allPredictions);
        setGoalPreview(currentGoalPreview);

        const expectedCount = allPredictions.filter(p => !p.isUrgent).length;
        if (newEntry.productions.length !== expectedCount) {
            setNewEntry(prev => ({ ...prev, productions: Array(expectedCount).fill('') }));
        }
    }, [isTraveteDashboard, traveteComputedEntry.goalDisplay, calculatePredictions, newEntry.productions.length]);

    const predictedLotLabel = useMemo(() => {
        if (isTraveteDashboard) return '';
        const labels = predictedLots
            .filter(lot => !lot.isUrgent)
            .map(lot => lot.productName || lot.name || '')
            .filter(Boolean);
        return labels.join(' / ');
    }, [isTraveteDashboard, predictedLots]);

    const productMapForSelectedDate = useMemo(
        () => buildProductLookupMap(productsForSelectedDate),
        [productsForSelectedDate]
    );
    
    const processedData = useMemo(() => {
        if (isTraveteDashboard || !productionData || productionData.length === 0) return [];
        let cumulativeProduction = 0, cumulativeGoal = 0, cumulativeEfficiencySum = 0;
        return [...productionData].sort((a, b) => (a.period || "").localeCompare(b.period || "")).map((item, index) => {
            let totalTimeValue = 0, totalProducedInPeriod = 0;
            const producedForDisplay = (item.productionDetails || []).map(d => `${d.produced || 0}`).join(' / ');
            (item.productionDetails || []).forEach(detail => {
                const product = productMapForSelectedDate.get(detail.productId);
                if (product?.standardTime) { totalTimeValue += (detail.produced || 0) * product.standardTime; totalProducedInPeriod += (detail.produced || 0); }
            });
            const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
            const efficiency = totalAvailableTime > 0 ? parseFloat(((totalTimeValue / totalAvailableTime) * 100).toFixed(2)) : 0;
            const goalSegments = splitGoalSegments(item.goalDisplay || '');
            const numericGoal = sumGoalDisplay(item.goalDisplay || '');
            const goalForDisplay = joinGoalSegments(goalSegments);
            cumulativeProduction += totalProducedInPeriod;
            cumulativeGoal += numericGoal;
            cumulativeEfficiencySum += efficiency;
            const cumulativeEfficiency = parseFloat((cumulativeEfficiencySum / (index + 1)).toFixed(2));
            return { ...item, produced: totalProducedInPeriod, goal: numericGoal, goalForDisplay, producedForDisplay, efficiency, cumulativeProduction, cumulativeGoal, cumulativeEfficiency };
        });
    }, [isTraveteDashboard, productionData, productMapForSelectedDate]);

    const traveteProcessedData = useMemo(() => {
        if (!isTraveteDashboard || !productionData || productionData.length === 0) return [];
        let cumulativeMeta = [];
        let cumulativeProduction = [];
        let cumulativeEfficiencySum = [];
        let cumulativeEntryCounts = [];

        return [...productionData]
            .sort((a, b) => (a.period || "").localeCompare(b.period || ""))
            .map((entry) => {
                const entryGoalSegments = splitTraveteGoalSegments(entry.goalDisplay || '');
                const employees = (entry.employeeEntries || []).map((emp, empIndex) => {
                    const productsArray = getEmployeeProducts(emp);
                    const producedValue = sumProducedQuantities(productsArray, emp.produced);
                    const firstProduct = findFirstProductDetail(productsArray, emp);
                    const { product } = resolveProductReference(emp, firstProduct, productMapForSelectedDate);
                    const standardTime = resolveEmployeeStandardTime(emp, firstProduct, product);
                    const availableTime = entry.availableTime || 0;
                    const meta = computeMetaFromStandardTime(standardTime, availableTime);
                    const efficiency = computeEfficiencyPercentage(producedValue, standardTime, availableTime);

                    cumulativeMeta[empIndex] = (cumulativeMeta[empIndex] || 0) + meta;
                    cumulativeProduction[empIndex] = (cumulativeProduction[empIndex] || 0) + producedValue;
                    cumulativeEfficiencySum[empIndex] = (cumulativeEfficiencySum[empIndex] || 0) + efficiency;
                    cumulativeEntryCounts[empIndex] = (cumulativeEntryCounts[empIndex] || 0) + 1;
                    const entriesCount = cumulativeEntryCounts[empIndex] || 1;
                    const cumulativeEfficiency = parseFloat(((cumulativeEfficiencySum[empIndex] || 0) / entriesCount).toFixed(2));
                    const productNames = buildProductNames(productsArray, productMapForSelectedDate);
                    const producedSegments = buildNumericSegments(productsArray);
                    const producedDisplay = formatSegmentedNumbers(producedSegments, producedValue);
                    const entryGoalDisplay = entryGoalSegments[empIndex] || '';
                    const metaDisplay = entryGoalDisplay || (meta > 0 ? meta.toLocaleString('pt-BR') : '-');

                    return {
                        ...emp,
                        produced: producedValue,
                        producedDisplay,
                        meta,
                        efficiency,
                        standardTime,
                        cumulativeMeta: (cumulativeMeta[empIndex] || 0),
                        cumulativeProduced: (cumulativeProduction[empIndex] || 0),
                        cumulativeEfficiency,
                        productName: productNames || product?.name || '',
                        metaDisplay,
                    };
                });

                return {
                    ...entry,
                    employees,
                };
            });
    }, [isTraveteDashboard, productionData, productMapForSelectedDate]);

    const summary = useMemo(() => {
        if (isTraveteDashboard) {
            if (traveteProcessedData.length === 0) {
                return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
            }
            const lastEntry = traveteProcessedData[traveteProcessedData.length - 1];
            const employees = lastEntry.employees || [];
            const totalProduced = employees.reduce((sum, emp) => sum + (emp.cumulativeProduced || 0), 0);
            const totalGoal = employees.reduce((sum, emp) => sum + (emp.cumulativeMeta || 0), 0);
            const lastHourEfficiency = employees.length > 0
                ? parseFloat((employees.reduce((sum, emp) => sum + (emp.efficiency || 0), 0) / employees.length).toFixed(2))
                : 0;
            const averageEfficiency = employees.length > 0
                ? parseFloat((employees.reduce((sum, emp) => sum + (emp.cumulativeEfficiency || 0), 0) / employees.length).toFixed(2))
                : 0;
            return { totalProduced, totalGoal, lastHourEfficiency, averageEfficiency };
        }

        if (processedData.length === 0) return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
        const lastEntry = processedData.slice(-1)[0];
        return { totalProduced: lastEntry.cumulativeProduction, totalGoal: lastEntry.cumulativeGoal, lastHourEfficiency: lastEntry.efficiency, averageEfficiency: lastEntry.cumulativeEfficiency };
    }, [isTraveteDashboard, processedData, traveteProcessedData]);

    const monthlySummary = useMemo(() => {
        if (isTraveteDashboard) {
            const year = currentMonth.getFullYear();
            const month = currentMonth.getMonth();
            let totalMonthlyProduction = 0;
            let totalMonthlyGoal = 0;
            let totalDailyEfficiency = 0;
            let productiveDaysCount = 0;

            Object.keys(allProductionData).forEach(dateStr => {
                try {
                    const date = new Date(dateStr + "T00:00:00");
                    if (date.getFullYear() !== year || date.getMonth() !== month) return;

                    const productsForDateMap = new Map(products
                        .map(p => {
                            const validTimeEntry = p.standardTimeHistory?.filter(h => new Date(h.effectiveDate) <= date).pop();
                            if (!validTimeEntry) return null;
                            return [p.id, { ...p, standardTime: validTimeEntry.time }];
                        })
                        .filter(Boolean));

                    const dayData = allProductionData[dateStr];
                    if (!dayData || dayData.length === 0) return;

                    let dayMetaPerEmployee = [];
                    let dayProductionPerEmployee = [];
                    let dayEfficiencyPerEmployee = [];

                    dayData.forEach(entry => {
                        (entry.employeeEntries || []).forEach((emp, index) => {
                            const productsArray = getEmployeeProducts(emp);
                            const produced = sumProducedQuantities(productsArray, emp.produced);
                            const firstProduct = findFirstProductDetail(productsArray, emp);
                            const { product } = resolveProductReference(emp, firstProduct, productsForDateMap);
                            const standardTime = resolveEmployeeStandardTime(emp, firstProduct, product);
                            const availableTime = entry.availableTime || 0;
                            const meta = computeMetaFromStandardTime(standardTime, availableTime);
                            const efficiency = computeEfficiencyPercentage(produced, standardTime, availableTime);

                            dayMetaPerEmployee[index] = (dayMetaPerEmployee[index] || 0) + meta;
                            dayProductionPerEmployee[index] = (dayProductionPerEmployee[index] || 0) + produced;
                            dayEfficiencyPerEmployee[index] = (dayEfficiencyPerEmployee[index] || 0) + efficiency;
                        });
                    });

                    const employeesCount = Math.max(dayMetaPerEmployee.length, dayEfficiencyPerEmployee.length);
                    if (employeesCount > 0) {
                        productiveDaysCount++;
                        totalMonthlyGoal += dayMetaPerEmployee.reduce((sum, value) => sum + (value || 0), 0);
                        totalMonthlyProduction += dayProductionPerEmployee.reduce((sum, value) => sum + (value || 0), 0);
                        const dailyAverageEfficiency = dayEfficiencyPerEmployee.reduce((sum, value) => sum + (value || 0), 0) /
                            (employeesCount * (dayData.length || 1));
                        totalDailyEfficiency += dailyAverageEfficiency || 0;
                    }
                } catch (e) {
                    console.error("Data inválida no sumário mensal:", dateStr);
                }
            });

            const averageMonthlyEfficiency = productiveDaysCount > 0
                ? parseFloat((totalDailyEfficiency / productiveDaysCount).toFixed(2))
                : 0;

            return { totalProduction: totalMonthlyProduction, totalGoal: totalMonthlyGoal, averageEfficiency: averageMonthlyEfficiency };
        }

        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        let totalMonthlyProduction = 0, totalMonthlyGoal = 0, totalDailyAverageEfficiencies = 0, productiveDaysCount = 0;
        Object.keys(allProductionData).forEach(dateStr => {
            try {
                const date = new Date(dateStr + "T00:00:00");
                const productsForDateMap = new Map(products
                    .map(p => {
                        const validTimeEntry = p.standardTimeHistory?.filter(h => new Date(h.effectiveDate) <= date).pop();
                        if (!validTimeEntry) return null;
                        return [p.id, { ...p, standardTime: validTimeEntry.time }];
                    })
                    .filter(Boolean));


                if(date.getFullYear() === year && date.getMonth() === month) {
                    const dayData = allProductionData[dateStr];
                    if (dayData && dayData.length > 0) {
                        productiveDaysCount++;
                        let dailyProduction = 0, dailyGoal = 0, dailyEfficiencySum = 0;
                        dayData.forEach(item => {
                            let periodProduction = 0, totalTimeValue = 0;
                            (item.productionDetails || []).forEach(detail => {
                                periodProduction += (detail.produced || 0);
                                const product = productsForDateMap.get(detail.productId);
                                if (product?.standardTime) totalTimeValue += (detail.produced || 0) * product.standardTime;
                            });
                            if (item.goalDisplay) dailyGoal += sumGoalDisplay(item.goalDisplay);
                            dailyProduction += periodProduction;
                            const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
                            dailyEfficiencySum += totalAvailableTime > 0 ? (totalTimeValue / totalAvailableTime) * 100 : 0;
                        });
                        totalDailyAverageEfficiencies += dayData.length > 0 ? dailyEfficiencySum / dayData.length : 0;
                        totalMonthlyProduction += dailyProduction;
                        totalMonthlyGoal += dailyGoal;
                    }
                }
            } catch(e) { console.error("Data inválida no sumário mensal:", dateStr); }
        });
        const averageMonthlyEfficiency = productiveDaysCount > 0 ? parseFloat((totalDailyAverageEfficiencies / productiveDaysCount).toFixed(2)) : 0;
        return { totalProduction: totalMonthlyProduction, totalGoal: totalMonthlyGoal, averageEfficiency: averageMonthlyEfficiency };
    }, [isTraveteDashboard, allProductionData, currentMonth, products]);

    const monthlyBreakdownForPdf = useMemo(() => {
        const breakdown = [];
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();

        Object.entries(allProductionData || {}).forEach(([dateStr, entries]) => {
            const dayEntries = Array.isArray(entries) ? entries : [];
            if (dayEntries.length === 0) return;
            const referenceDate = new Date(`${dateStr}T00:00:00`);
            if (referenceDate.getFullYear() !== year || referenceDate.getMonth() !== month) return;

            if (isTraveteDashboard) {
                const productsForDateMap = new Map(products
                    .map(p => {
                        const validTimeEntry = p.standardTimeHistory?.filter(h => new Date(h.effectiveDate) <= referenceDate).pop();
                        if (!validTimeEntry) return null;
                        return [p.id, { ...p, standardTime: validTimeEntry.time }];
                    })
                    .filter(Boolean));

                const dayMetaPerEmployee = [];
                const dayProductionPerEmployee = [];
                let efficiencyTotal = 0;
                let efficiencySamples = 0;

                dayEntries.forEach(entry => {
                    (entry.employeeEntries || []).forEach((emp, index) => {
                        const productsArray = getEmployeeProducts(emp);
                        const produced = sumProducedQuantities(productsArray, emp.produced);
                        const firstProduct = findFirstProductDetail(productsArray, emp);
                        const { product } = resolveProductReference(emp, firstProduct, productsForDateMap);
                        const standardTime = resolveEmployeeStandardTime(emp, firstProduct, product);
                        const availableTime = entry.availableTime || 0;
                        const meta = computeMetaFromStandardTime(standardTime, availableTime);
                        const efficiency = computeEfficiencyPercentage(produced, standardTime, availableTime);

                        dayMetaPerEmployee[index] = (dayMetaPerEmployee[index] || 0) + meta;
                        dayProductionPerEmployee[index] = (dayProductionPerEmployee[index] || 0) + produced;
                        if (efficiency > 0) {
                            efficiencyTotal += efficiency;
                            efficiencySamples += 1;
                        }
                    });
                });

                if (dayMetaPerEmployee.length > 0 || dayProductionPerEmployee.length > 0) {
                    breakdown.push({
                        date: referenceDate,
                        totalGoal: dayMetaPerEmployee.reduce((sum, value) => sum + (value || 0), 0),
                        totalProduction: dayProductionPerEmployee.reduce((sum, value) => sum + (value || 0), 0),
                        averageEfficiency: efficiencySamples > 0 ? parseFloat((efficiencyTotal / efficiencySamples).toFixed(2)) : 0,
                    });
                }
            } else {
                const productsForDateMap = new Map(products
                    .map(p => {
                        const validTimeEntry = p.standardTimeHistory?.filter(h => new Date(h.effectiveDate) <= referenceDate).pop();
                        if (!validTimeEntry) return null;
                        return [p.id, { ...p, standardTime: validTimeEntry.time }];
                    })
                    .filter(Boolean));

                let dailyProduction = 0;
                let dailyGoal = 0;
                let efficiencyTotal = 0;
                let efficiencySamples = 0;

                dayEntries.forEach(item => {
                    let periodProduction = 0;
                    let totalTimeValue = 0;
                    (item.productionDetails || []).forEach(detail => {
                        const produced = detail.produced || 0;
                        periodProduction += produced;
                        const product = productsForDateMap.get(detail.productId);
                        if (product?.standardTime) {
                            totalTimeValue += produced * product.standardTime;
                        }
                    });
                    if (item.goalDisplay) {
                        dailyGoal += sumGoalDisplay(item.goalDisplay);
                    }
                    dailyProduction += periodProduction;
                    const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
                    if (totalAvailableTime > 0) {
                        efficiencyTotal += (totalTimeValue / totalAvailableTime) * 100;
                        efficiencySamples += 1;
                    }
                });

                breakdown.push({
                    date: referenceDate,
                    totalGoal: dailyGoal,
                    totalProduction: dailyProduction,
                    averageEfficiency: efficiencySamples > 0 ? parseFloat((efficiencyTotal / efficiencySamples).toFixed(2)) : 0,
                });
            }
        });

        breakdown.sort((a, b) => a.date - b.date);
        return breakdown;
    }, [isTraveteDashboard, allProductionData, currentMonth, products]);

    const lotSummaryForPdf = useMemo(() => {
        if (!Array.isArray(lots) || lots.length === 0) {
            return { completed: [], active: [], overallAverage: 0 };
        }
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const isDateInCurrentMonth = (value) => {
            if (!value) return false;
            const parsed = new Date(value);
            return parsed.getFullYear() === year && parsed.getMonth() === month;
        };

        const completed = [];
        const active = [];
        let totalPieces = 0;
        let totalDays = 0;

        lots.forEach(lot => {
            const produced = Number(lot.produced) || 0;
            const target = Number(lot.target) || 0;
            const efficiency = target > 0 ? (produced / target) * 100 : 0;
            const baseName = lot.customName
                ? `${lot.productName || lot.baseProductName || lot.name || lot.id} - ${lot.customName}`
                : (lot.productName || lot.baseProductName || lot.name || lot.id || lot.id);

            if (lot.status?.startsWith('completed') && isDateInCurrentMonth(lot.endDate)) {
                let duration = 0;
                if (lot.startDate && lot.endDate) {
                    const start = new Date(lot.startDate);
                    const end = new Date(lot.endDate);
                    duration = Math.max(1, (end - start) / (1000 * 60 * 60 * 24));
                }
                const averageDaily = duration > 0 ? produced / duration : 0;
                completed.push({
                    id: lot.id,
                    name: baseName,
                    produced,
                    target,
                    efficiency,
                    duration,
                    averageDaily,
                    endDate: lot.endDate || '',
                });
                if (duration > 0) {
                    totalPieces += produced;
                    totalDays += duration;
                }
            } else if (lot.status === 'ongoing' || lot.status === 'future') {
                active.push({
                    id: lot.id,
                    name: baseName,
                    produced,
                    target,
                    efficiency,
                    status: lot.status,
                });
            }
        });

        completed.sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
        active.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const overallAverage = totalDays > 0 ? totalPieces / totalDays : 0;
        return { completed, active, overallAverage };
    }, [lots, currentMonth]);

    const handleExportDashboardReport = useCallback(async () => {
        if (!currentDashboard) return;
        try {
            setIsExportingReport(true);
            await exportDashboardPerformancePDF({
                dashboardName: currentDashboard.name,
                selectedDate,
                currentMonth,
                isTraveteDashboard,
                summary,
                monthlySummary,
                dailyEntries: processedData,
                traveteEntries: traveteProcessedData,
                lotSummary: lotSummaryForPdf,
                monthlyBreakdown: monthlyBreakdownForPdf,
            });
        } catch (error) {
            console.error('Erro ao exportar relatório do dashboard:', error);
            alert('Não foi possível gerar o PDF do relatório. Verifique o console para mais detalhes.');
        } finally {
            setIsExportingReport(false);
        }
    }, [currentDashboard, selectedDate, currentMonth, isTraveteDashboard, summary, monthlySummary, processedData, traveteProcessedData, lotSummaryForPdf, monthlyBreakdownForPdf]);

    const traveteGroupedProducts = useMemo(() => {
        if (!isTraveteDashboard) return [];
        const groups = new Map();

        products.forEach(product => {
            const baseName = getTraveteBaseProductName(product);
            const baseId = product.baseProductId || product.baseProductName || baseName || product.id;
            if (!groups.has(baseId)) {
                groups.set(baseId, { baseId, baseName, variations: [] });
            }
            groups.get(baseId).variations.push(product);
        });

        return Array.from(groups.values()).map(group => ({
            ...group,
            variations: group.variations.sort((a, b) => (a.variationMultiplier || 0) - (b.variationMultiplier || 0)),
        })).sort((a, b) => a.baseName.localeCompare(b.baseName));
    }, [isTraveteDashboard, products]);

    const traveteLotOptions = useMemo(() => {
        if (!isTraveteDashboard) return [];
        return lots
            .filter(lot => lot.status !== 'completed')
            .slice()
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }, [isTraveteDashboard, lots]);

    useEffect(() => {
        if (!isTraveteDashboard) return;
        setTraveteEntry(prev => {
            const { changed, employeeEntries } = applyTraveteAutoSuggestions(
                prev.employeeEntries,
                traveteLotOptions,
                productsForSelectedDate,
                traveteVariationLookup
            );
            if (!changed) {
                return prev;
            }
            return { ...prev, employeeEntries };
        });
    }, [
        isTraveteDashboard,
        traveteEntry.period,
        traveteEntry.availableTime,
        traveteEntry.employeeEntries,
        traveteLotOptions,
        productsForSelectedDate,
        traveteVariationLookup,
    ]);

    const availablePeriods = useMemo(() => FIXED_PERIODS.filter(p => !productionData.some(e => e.period === p)), [productionData]);
    const filteredLots = useMemo(() => [...lots].filter(l => lotFilter === 'ongoing' ? (l.status === 'ongoing' || l.status === 'future') : l.status.startsWith('completed')), [lots, lotFilter]);


    const handleInputChange = (e) => { const { name, value } = e.target; setNewEntry(prev => ({ ...prev, [name]: value, ...(name === 'productId' && { productions: [] }) })); };
    const handleUrgentChange = (e) => setUrgentProduction(prev => ({...prev, [e.target.name]: e.target.value}));
    const handleProductionChange = (index, value) => { const newProductions = [...newEntry.productions]; newProductions[index] = value; setNewEntry(prev => ({ ...prev, productions: newProductions })); };
    const handleTraveteBaseTimeChange = (value) => {
        setTraveteProductForm(prev => {
            const numericValue = parseFloat(value);
            const isValid = !Number.isNaN(numericValue) && numericValue > 0;
            const nextState = { ...prev, baseTime: value };
            if (!prev.oneNeedleManual) {
                nextState.oneNeedleTime = isValid ? (numericValue * 2).toFixed(2) : '';
            }
            if (!prev.conventionalManual) {
                nextState.conventionalTime = isValid ? (numericValue * 3).toFixed(2) : '';
            }
            return nextState;
        });
    };
    const handleTraveteVariationToggle = (field, checked) => {
        setTraveteProductForm(prev => {
            const nextState = { ...prev, [field]: checked };
            if (checked) {
                if (field === 'createOneNeedle' && !prev.oneNeedleManual && !prev.oneNeedleTime) {
                    const numericValue = parseFloat(prev.baseTime);
                    nextState.oneNeedleTime = (!Number.isNaN(numericValue) && numericValue > 0) ? (numericValue * 2).toFixed(2) : '';
                }
                if (field === 'createConventional' && !prev.conventionalManual && !prev.conventionalTime) {
                    const numericValue = parseFloat(prev.baseTime);
                    nextState.conventionalTime = (!Number.isNaN(numericValue) && numericValue > 0) ? (numericValue * 3).toFixed(2) : '';
                }
            }
            return nextState;
        });
    };
    const handleTraveteVariationTimeChange = (field, value) => {
        const manualField = field === 'oneNeedleTime' ? 'oneNeedleManual' : 'conventionalManual';
        setTraveteProductForm(prev => ({
            ...prev,
            [field]: value,
            [manualField]: value !== '',
        }));
    };
    const handleTraveteVariationTimeBlur = (field) => {
        const manualField = field === 'oneNeedleTime' ? 'oneNeedleManual' : 'conventionalManual';
        const multiplier = field === 'oneNeedleTime' ? 2 : 3;
        setTraveteProductForm(prev => {
            if (prev[field]) {
                return prev;
            }
            const numericValue = parseFloat(prev.baseTime);
            const isValid = !Number.isNaN(numericValue) && numericValue > 0;
            return {
                ...prev,
                [manualField]: false,
                [field]: isValid ? (numericValue * multiplier).toFixed(2) : '',
            };
        });
    };
    const handleTraveteFieldChange = (field, value) => {
        setTraveteEntry(prev => ({ ...prev, [field]: value }));
    };
    const handleTraveteEmployeeChange = (index, field, value) => {
        setTraveteEntry(prev => ({
            ...prev,
            employeeEntries: prev.employeeEntries.map((emp, empIndex) => {
                if (empIndex !== index) return emp;
                let updated = { ...emp };

                switch (field) {
                    case 'machineType': {
                        updated = { ...updated, machineType: value, standardTimeManual: false };
                        const firstLotId = (updated.products || []).find(item => item.lotId)?.lotId;
                        const patch = buildTraveteStandardTimePatch({
                            employee: updated,
                            lotId: firstLotId,
                            machineType: value,
                            lots,
                            products: productsForSelectedDate,
                            variationLookup: traveteVariationLookup,
                            resetWhenMissing: true,
                        });
                        if (patch) {
                            updated = { ...updated, ...patch };
                        }
                        break;
                    }
                    case 'standardTime': {
                        updated.standardTime = value;
                        updated.standardTimeManual = value !== '';
                        break;
                    }
                    default: {
                        updated[field] = value;
                    }
                }
                return updated;
            }),
        }));
    };
    const handleTraveteStandardTimeBlur = (index) => {
        setTraveteEntry(prev => ({
            ...prev,
            employeeEntries: prev.employeeEntries.map((emp, empIndex) => {
                if (empIndex !== index) return emp;
                if (emp.standardTime) return emp;
                const firstLotId = (emp.products || []).find(item => item.lotId)?.lotId;
                const patch = buildTraveteStandardTimePatch({
                    employee: emp,
                    lotId: firstLotId,
                    machineType: emp.machineType,
                    lots,
                    products: productsForSelectedDate,
                    variationLookup: traveteVariationLookup,
                });
                if (!patch) return emp;
                return { ...emp, ...patch };
            }),
        }));
    };
    const handleTraveteProductChange = (employeeIndex, productIndex, field, value) => {
        setTraveteEntry(prev => ({
            ...prev,
            employeeEntries: prev.employeeEntries.map((emp, empIdx) => {
                if (empIdx !== employeeIndex) return emp;
                const updatedProducts = (emp.products || []).map((product, prodIdx) => {
                    if (prodIdx !== productIndex) return product;
                    const nextProduct = { ...product, [field]: value };
                    if (field === 'lotId') {
                        nextProduct.isAutoSuggested = false;
                    }
                    return nextProduct;
                });
                let updatedEmployee = { ...emp, products: updatedProducts };
                if (field === 'lotId') {
                    const patch = buildTraveteStandardTimePatch({
                        employee: updatedEmployee,
                        lotId: value,
                        machineType: emp.machineType,
                        lots,
                        products: productsForSelectedDate,
                        variationLookup: traveteVariationLookup,
                    });
                    if (patch) {
                        updatedEmployee = { ...updatedEmployee, ...patch };
                    }
                }
                return updatedEmployee;
            }),
        }));
    };
    const handleTraveteAddProduct = (employeeIndex) => {
        setTraveteEntry(prev => ({
            ...prev,
            employeeEntries: prev.employeeEntries.map((emp, empIdx) => {
                if (empIdx !== employeeIndex) return emp;
                return { ...emp, products: [...(emp.products || []), createDefaultTraveteProductItem()] };
            }),
        }));
    };
    const handleTraveteRemoveProduct = (employeeIndex, productIndex) => {
        setTraveteEntry(prev => ({
            ...prev,
            employeeEntries: prev.employeeEntries.map((emp, empIdx) => {
                if (empIdx !== employeeIndex) return emp;
                const remaining = (emp.products || []).filter((_, idx) => idx !== productIndex);
                return { ...emp, products: remaining.length > 0 ? remaining : [createDefaultTraveteProductItem()] };
            }),
        }));
    };
    
    const handleAddProduct = async (e) => {
        e.preventDefault();
        if (!currentDashboard) return;

        if (isTraveteDashboard) {
            const trimmedName = traveteProductForm.baseName.trim();
            if (!trimmedName) return;

            const variationConfigs = [
                { key: 'createTwoNeedle', suffix: '2 Agulhas', machineType: 'Travete 2 Agulhas', timeField: 'baseTime', defaultMultiplier: 1 },
                { key: 'createOneNeedle', suffix: '1 Agulha', machineType: 'Travete 1 Agulha', timeField: 'oneNeedleTime', defaultMultiplier: 2 },
                { key: 'createConventional', suffix: 'Convencional', machineType: 'Travete Convencional', timeField: 'conventionalTime', defaultMultiplier: 3 },
            ];

            const baseTimeNumeric = parseFloat(traveteProductForm.baseTime);
            let hasInvalid = false;
            const variationsToCreate = variationConfigs.reduce((acc, config) => {
                if (!traveteProductForm[config.key]) {
                    return acc;
                }
                const rawTime = traveteProductForm[config.timeField];
                const parsedTime = parseFloat(rawTime);
                if (Number.isNaN(parsedTime) || parsedTime <= 0) {
                    hasInvalid = true;
                    return acc;
                }
                acc.push({
                    suffix: config.suffix,
                    machineType: config.machineType,
                    timeValue: parseFloat(parsedTime.toFixed(2)),
                    defaultMultiplier: config.defaultMultiplier,
                });
                return acc;
            }, []);

            if (hasInvalid || variationsToCreate.length === 0) return;

            const baseId = generateId('traveteBase');
            const creationIso = new Date().toISOString();
            const batch = writeBatch(db);

            variationsToCreate.forEach((variation) => {
                const id = `${baseId}_${variation.suffix.replace(/\s+/g, '').toLowerCase()}`;
                const referenceBase = (!Number.isNaN(baseTimeNumeric) && baseTimeNumeric > 0) ? baseTimeNumeric : null;
                const multiplier = referenceBase
                    ? parseFloat((variation.timeValue / referenceBase).toFixed(4))
                    : variation.defaultMultiplier;
                const productData = {
                    id,
                    name: `${trimmedName} - ${variation.suffix}`,
                    baseProductId: baseId,
                    baseProductName: trimmedName,
                    machineType: variation.machineType,
                    variationMultiplier: multiplier,
                    standardTimeHistory: [{
                        time: variation.timeValue,
                        effectiveDate: creationIso,
                        changedBy: { uid: user.uid, email: user.email },
                    }],
                    createdBy: { uid: user.uid, email: user.email },
                };
                batch.set(doc(db, `dashboards/${currentDashboard.id}/products`, id), productData);
            });

            await batch.commit();
            resetTraveteProductForm();
            return;
        }

        if (!newProduct.name || !newProduct.standardTime) return;
        const id = Date.now().toString();
        const newProductData = {
            id,
            name: newProduct.name,
            standardTimeHistory: [{
                time: parseFloat(newProduct.standardTime),
                effectiveDate: new Date().toISOString(),
                changedBy: { uid: user.uid, email: user.email },
            }],
            createdBy: { uid: user.uid, email: user.email },
        };
        await setDoc(doc(db, `dashboards/${currentDashboard.id}/products`, id), newProductData);
        setNewProduct({ name: '', standardTime: '' });
    };

    const handleStartEditProduct = (product) => {
        if (!product) return;
        setEditingProductId(product.id);
        const history = product.standardTimeHistory || [];
        const latest = history.length > 0 ? history[history.length - 1].time : product.standardTime || '';
        setEditingProductData({ name: product.name, standardTime: latest });
    };

    const handleEditingProductFieldChange = useCallback((field, value) => {
        setEditingProductData(prev => ({ ...prev, [field]: value }));
    }, []);

    const handleSaveProduct = async (id) => { 
        if (!editingProductData.name || !editingProductData.standardTime || !currentDashboard) return;
        
        const productDoc = products.find(p => p.id === id);
        if(!productDoc) return;
        
        const latestTime = productDoc.standardTimeHistory[productDoc.standardTimeHistory.length - 1].time;
        const newTime = parseFloat(editingProductData.standardTime);
        const newHistory = [...productDoc.standardTimeHistory];

        if (latestTime !== newTime) {
            newHistory.push({
                time: newTime,
                effectiveDate: new Date().toISOString(),
                changedBy: { uid: user.uid, email: user.email },
            });
        }
        
        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/products`, id), {
            name: editingProductData.name,
            standardTimeHistory: newHistory,
            lastEditedBy: { uid: user.uid, email: user.email },
        });
        
        setEditingProductId(null); 
    };

    const handleSaveObservation = async (entryId, observation) => {
        const updatedDayData = productionData.map(e => e.id === entryId ? { ...e, observation } : e);
        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/productionData`, "data"), { 
            [dateKey]: updatedDayData,
        });
    };
    const handleSaveLotObservation = async (lotId, observation) => {
        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/lots`, lotId), { 
            observation,
            lastEditedBy: { uid: user.uid, email: user.email },
            lastEditedAt: Timestamp.now(),
        });
    };
    const handleAddLot = async (e) => {
        e.preventDefault();
        if (!newLot.productId || !newLot.target || !currentDashboard) return;

        let product = null;
        let lotBaseMetadata = {};

        if (isTraveteDashboard) {
            const selectedGroup = traveteGroupedProducts.find(group => group.baseId === newLot.productId);
            if (!selectedGroup) return;

            product = selectedGroup.variations.find(variation => variation.machineType === 'Travete 2 Agulhas')
                || selectedGroup.variations[0]
                || null;

            lotBaseMetadata = {
                productBaseId: selectedGroup.baseId,
                productBaseName: selectedGroup.baseName,
            };

            if (!product) {
                product = {
                    id: selectedGroup.baseId,
                    name: selectedGroup.baseName,
                };
            }
        } else {
            product = products.find(p => p.id === newLot.productId);
        }

        if (!product) return;
        const id = Date.now().toString();
        const newLotData = {
            id,
            sequentialId: lotCounter,
            ...newLot,
            productId: product.id,
            productName: isTraveteDashboard ? (lotBaseMetadata.productBaseName || product.name) : product.name,
            target: parseInt(newLot.target, 10),
            produced: 0,
            status: 'future',
            order: Date.now(),
            observation: '',
            startDate: null,
            endDate: null,
            createdBy: { uid: user.uid, email: user.email },
            ...(isTraveteDashboard ? lotBaseMetadata : { machineType: product.machineType }),
        };
        await setDoc(doc(db, `dashboards/${currentDashboard.id}/lots`, id), newLotData);
        setNewLot({ productId: '', target: '', customName: '' });
    };
    const handleStartEditLot = (lot) => { setEditingLotId(lot.id); setEditingLotData({ target: lot.target, customName: lot.customName || '' }); };
    const handleSaveLotEdit = async (lotId) => { 
        const lot = lots.find(l => l.id === lotId);
        if(!lot) return;

        const newTarget = parseInt(editingLotData.target, 10);
        const wasCompleted = lot.status.startsWith('completed');
        const isCompletingNow = lot.produced >= newTarget && !wasCompleted;

        const updatePayload = {
            target: newTarget,
            customName: editingLotData.customName,
            lastEditedBy: { uid: user.uid, email: user.email },
            lastEditedAt: Timestamp.now(),
        };

        if (isCompletingNow) {
            updatePayload.status = 'completed';
            updatePayload.endDate = new Date().toISOString();
        } else if (wasCompleted && lot.produced < newTarget) {
            updatePayload.status = 'ongoing';
            updatePayload.endDate = null;
        }

        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/lots`, lotId), updatePayload);
        setEditingLotId(null);
    };
    const handleLotStatusChange = async (lotId, newStatus) => {
        const lot = lots.find(l => l.id === lotId);
        if(!lot) return;
        
        const updatePayload = { 
            status: newStatus,
            lastEditedBy: { uid: user.uid, email: user.email },
            lastEditedAt: Timestamp.now(),
        };
        const isCompleting = newStatus.startsWith('completed');
        const wasCompleted = lot.status.startsWith('completed');

        if (isCompleting && !wasCompleted) {
            updatePayload.endDate = new Date().toISOString();
        } else if (!isCompleting && wasCompleted) {
            updatePayload.endDate = null;
        }

        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/lots`, lotId), updatePayload);
    };
    const handleMoveLot = async (lotId, direction) => {
        const sorted = lots.filter(l => ['ongoing', 'future'].includes(l.status)).sort((a, b) => a.order - b.order);
        const currentIndex = sorted.findIndex(l => l.id === lotId);
        if ((direction === 'up' && currentIndex > 0) || (direction === 'down' && currentIndex < sorted.length - 1)) {
            const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            const currentLot = sorted[currentIndex];
            const swapLot = sorted[swapIndex];
            
            const batch = writeBatch(db);
            batch.update(doc(db, `dashboards/${currentDashboard.id}/lots`, currentLot.id), { order: swapLot.order });
            batch.update(doc(db, `dashboards/${currentDashboard.id}/lots`, swapLot.id), { order: currentLot.order });
            await batch.commit();
        }
    };
        
    if (!currentDashboard) {
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p className="text-xl">Carregando quadros...</p></div>;
    }

    return (
        <div className="responsive-root min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 font-sans">
            <GlobalStyles/>
            <EntryEditorModal
                isOpen={modalState.type === 'editEntry'}
                onClose={closeModal}
                entry={modalState.data}
                onSave={handleSaveEntry}
                products={products}
                productsForSelectedDate={productsForSelectedDate}
                lots={lots}
                traveteMachines={TRAVETE_MACHINES}
                traveteVariationLookup={traveteVariationLookup}
            />
            
            <DashboardActionDialog isOpen={modalState.type === 'dashboardAction'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} mode={modalState.data?.mode} initialName={modalState.data?.initialName}/>
            <ConfirmationModal isOpen={modalState.type === 'confirmation'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} title={modalState.data?.title} message={modalState.data?.message} />
            <ObservationModal isOpen={modalState.type === 'observation'} onClose={closeModal} entry={modalState.data} onSave={handleSaveObservation} />
            <LotObservationModal isOpen={modalState.type === 'lotObservation'} onClose={closeModal} lot={modalState.data} onSave={handleSaveLotObservation} />
            <PasswordModal isOpen={modalState.type === 'password'} onClose={closeModal} onSuccess={modalState.data?.onSuccess} adminConfig={{}} />
            <ReasonModal isOpen={modalState.type === 'reason'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} />
            <AdminPanelModal isOpen={modalState.type === 'adminSettings'} onClose={closeModal} users={users} roles={roles} />
            <TvSelectorModal isOpen={modalState.type === 'tvSelector'} onClose={closeModal} onSelect={startTvMode} onStartCarousel={startTvMode} dashboards={dashboards} />

            <header className="bg-white dark:bg-gray-900 shadow-md p-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between sticky top-0 z-20">
                <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
                    <img src={raceBullLogoUrl} alt="Race Bull Logo" className="h-12 w-auto dark:invert" />
                    <div ref={navRef} className="relative w-full md:w-auto">
                        <button onClick={() => setIsNavOpen(!isNavOpen)} title="Mudar Quadro" className="flex w-full items-center justify-between gap-2 p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white tracking-wider text-center">{currentDashboard.name}</h1>
                            <ChevronDownIcon size={20} className={`transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isNavOpen && (
                            <div className="absolute top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-xl py-2 z-30 dropdown-content">
                                {dashboards.map((dash, index) => (
                                    <div key={dash.id} className="flex items-center justify-between px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">
                                        <div className="flex items-center gap-2">
                                            {permissions.MANAGE_DASHBOARDS && (
                                                <div className="flex flex-col">
                                                    <button onClick={() => handleMoveDashboard(dash.id, 'up')} disabled={index === 0} className="disabled:opacity-20"><ChevronUp size={16} /></button>
                                                    <button onClick={() => handleMoveDashboard(dash.id, 'down')} disabled={index === dashboards.length - 1} className="disabled:opacity-20"><ChevronDown size={16} /></button>
                                                </div>
                                            )}
                                            <button onClick={() => { setCurrentDashboardIndex(index); setIsNavOpen(false); }} className="flex-grow text-left">{dash.name}</button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {permissions.MANAGE_DASHBOARDS && <button onClick={() => { setIsNavOpen(false); setModalState({ type: 'dashboardAction', data: { mode: 'rename', initialName: dash.name, onConfirm: (newName) => handleRenameDashboard(dash.id, newName) } }); }} title="Renomear Quadro"><Edit size={16} className="text-yellow-500 hover:text-yellow-400" /></button>}
                                            {permissions.MANAGE_DASHBOARDS && <button onClick={() => { setIsNavOpen(false); setModalState({ type: 'confirmation', data: { title: 'Confirmar Exclusão', message: `Tem certeza que deseja excluir o quadro "${dash.name}"?`, onConfirm: () => handleDeleteDashboard(dash.id) } }); }} title="Excluir Quadro"><Trash2 size={16} className="text-red-500 hover:text-red-400" /></button>}
                                        </div>
                                    </div>
                                ))}
                                <div className="border-t my-2 dark:border-gray-600"></div>
                                {permissions.MANAGE_DASHBOARDS && <button onClick={() => { setIsNavOpen(false); setModalState({ type: 'dashboardAction', data: { mode: 'create', onConfirm: handleAddDashboard } }); }} className="w-full text-left px-4 py-2 text-sm text-blue-600 dark:text-blue-400 font-semibold hover:bg-gray-100 dark:hover:bg-gray-700">+ Criar Novo Quadro</button>}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full md:w-auto md:justify-end">
                    <button onClick={onNavigateToOperationalSequence} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 w-full sm:w-auto justify-center">
                        <Layers size={20} />
                        <span className="hidden sm:inline">Sequência Operacional</span>
                    </button>
                    <button onClick={onNavigateToStock} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 w-full sm:w-auto justify-center">
                        <Warehouse size={20} />
                        <span className="hidden sm:inline">Gerenciamento de Estoque</span>
                    </button>
                    <button
                        onClick={handleExportDashboardReport}
                        disabled={isExportingReport}
                        className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 w-full sm:w-auto justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <FileDown size={20} />
                        <span className="hidden sm:inline">{isExportingReport ? 'Gerando...' : 'Exportar Relatório'}</span>
                    </button>
                    <span className='text-sm text-gray-500 dark:text-gray-400 hidden md:block'>{user.email}</span>
                    <button onClick={logout} title="Sair" className="p-2 rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-400 dark:hover:bg-red-900"><LogOut size={20} /></button>
                    <button onClick={handleSelectTvMode} title="Modo TV" className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700"><Monitor size={20} /></button>
                    {permissions.MANAGE_SETTINGS && <button onClick={() => setModalState({ type: 'adminSettings' })} title="Configurações" className="p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"><Settings size={20} /></button>}
                    <button onClick={toggleTheme} title={theme === 'light' ? "Mudar para Tema Escuro" : "Mudar para Tema Claro"} className="p-2 rounded-full bg-gray-200 dark:bg-gray-700">{theme === 'light' ? <Moon size={20}/> : <Sun size={20}/>}</button>
                </div>
            </header>
            
            <main className="p-4 md:p-8 grid grid-cols-1 gap-8 responsive-main">
                 <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                     <div className="lg:col-span-1">
                         <CalendarView selectedDate={selectedDate} setSelectedDate={setSelectedDate} currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} calendarView={calendarView} setCalendarView={setCalendarView} allProductionData={allProductionData} />
                     </div>
                    <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
                        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-lg text-center">
                            <h3 className="font-semibold">Resumo Mensal</h3>
                            {isTraveteDashboard ? (
                                <>
                                    <p>Produção Total: {monthlySummary.totalProduction.toLocaleString('pt-BR')} un.</p>
                                    <p>Meta Total: {monthlySummary.totalGoal.toLocaleString('pt-BR')} un.</p>
                                    <p>Eficiência Média Mensal: {monthlySummary.averageEfficiency}%</p>
                                </>
                            ) : (
                                <>
                                    <p>Produção: {monthlySummary.totalProduction.toLocaleString('pt-BR')} un.</p>
                                    <p>Meta: {monthlySummary.totalGoal.toLocaleString('pt-BR')} un.</p>
                                    <p>Eficiência Média: {monthlySummary.averageEfficiency}%</p>
                                </>
                            )}
                        </div>
                        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-lg text-center">
                            <h3 className="font-semibold">Resumo do Dia</h3>
                            {isTraveteDashboard ? (
                                <>
                                    <p>Produção Combinada: {summary.totalProduced.toLocaleString('pt-BR')} un.</p>
                                    <p>Meta Combinada: {summary.totalGoal.toLocaleString('pt-BR')} un.</p>
                                    <p>Média de Eficiência Geral: {summary.averageEfficiency}%</p>
                                </>
                            ) : (
                                <>
                                    <p>Produção: {summary.totalProduced.toLocaleString('pt-BR')} un.</p>
                                    <p>Meta: {summary.totalGoal.toLocaleString('pt-BR')} un.</p>
                                    <p>Eficiência Média: {summary.averageEfficiency}%</p>
                                </>
                            )}
                        </div>
                    </div>
                 </section>
                 <h2 className="text-2xl font-bold border-b-2 border-blue-500 pb-2">Resultados de: {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</h2>
                 <LotReport lots={lots} products={productsForSelectedDate}/>
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard title="Produção Acumulada (Dia)" value={summary.totalProduced.toLocaleString('pt-BR')} unit="un." />
                    <StatCard title="Meta Acumulada (Dia)" value={summary.totalGoal.toLocaleString('pt-BR')} unit="un." />
                    <StatCard title="Eficiência da Última Hora" value={summary.lastHourEfficiency} unit="%" isEfficiency />
                    <StatCard title="Média de Eficiência (Dia)" value={summary.averageEfficiency} unit="%" isEfficiency />
                </section>
                 
 
                 <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                     <h2 className="text-xl font-semibold mb-4 flex items-center"><List className="mr-2 text-blue-500"/> Detalhamento por Período</h2>
                     <div className="overflow-x-auto">
                         {isTraveteDashboard ? (
                             <table className="w-full text-sm">
                                 <thead className="bg-gray-50 dark:bg-gray-800">
                                     <tr>
                                         <th className="p-3 text-left border-r dark:border-gray-600">Período</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Meta F1</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Produção F1</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Eficiência F1</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Meta Acum. F1</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Prod. Acum. F1</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Eficiência Média F1</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600 font-bold">{'//'}</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Meta F2</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Produção F2</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Eficiência F2</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Meta Acum. F2</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Prod. Acum. F2</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Eficiência Média F2</th>
                                         <th className="p-3 text-left border-r dark:border-gray-600">Lançado por</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Obs.</th>
                                         <th className="p-3 text-center">Ações</th>
                                     </tr>
                                 </thead>
                                 <tbody className="divide-y divide-x divide-gray-200 dark:divide-gray-600">
                                     {traveteProcessedData.map((entry) => {
                                         const employeeOne = entry.employees?.[0] || {};
                                         const employeeTwo = entry.employees?.[1] || {};
                                         const formatNumber = (value) => Number(value || 0).toLocaleString('pt-BR');
                                         const formatEfficiency = (value) => `${Number(value || 0).toFixed(2)}%`;
                                         const machinesLabel = [employeeOne.machineType, employeeTwo.machineType].filter(Boolean).join(' & ');
                                         return (
                                             <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                 <td className="p-3 border-r dark:border-gray-600 align-top">
                                                 <div className="font-semibold">{entry.period}</div>
                                                 <div className="text-xs text-gray-500">Tempo: {formatNumber(entry.availableTime)} min</div>
                                                 {machinesLabel && <div className="text-xs text-gray-500">Máquinas: {machinesLabel}</div>}
                                                 {entry.lotDisplay && <div className="text-xs text-gray-500">Lotes: {entry.lotDisplay}</div>}
                                                </td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{employeeOne.metaDisplay || formatNumber(employeeOne.meta)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{employeeOne.producedDisplay || formatNumber(employeeOne.produced)}</td>
                                                 <td className={`p-3 text-center border-r dark:border-gray-600 ${Number(employeeOne.efficiency || 0) < 65 ? 'text-red-500' : 'text-green-600'}`}>{formatEfficiency(employeeOne.efficiency)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{formatNumber(employeeOne.cumulativeMeta)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{formatNumber(employeeOne.cumulativeProduced)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{formatEfficiency(employeeOne.cumulativeEfficiency)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600 font-bold">{'//'}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{employeeTwo.metaDisplay || formatNumber(employeeTwo.meta)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{employeeTwo.producedDisplay || formatNumber(employeeTwo.produced)}</td>
                                                 <td className={`p-3 text-center border-r dark:border-gray-600 ${Number(employeeTwo.efficiency || 0) < 65 ? 'text-red-500' : 'text-green-600'}`}>{formatEfficiency(employeeTwo.efficiency)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{formatNumber(employeeTwo.cumulativeMeta)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{formatNumber(employeeTwo.cumulativeProduced)}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">{formatEfficiency(employeeTwo.cumulativeEfficiency)}</td>
                                                 <td className="p-3 text-left text-xs truncate border-r dark:border-gray-600">{entry.createdBy?.email}</td>
                                                 <td className="p-3 text-center border-r dark:border-gray-600">
                                                     <button onClick={() => setModalState({ type: 'observation', data: entry })} title="Observação">
                                                         <MessageSquare size={18} className={entry.observation ? 'text-blue-500 hover:text-blue-400' : 'text-gray-500 hover:text-blue-400'}/>
                                                     </button>
                                                 </td>
                                                 <td className="p-3">
                                                     <div className="flex gap-2 justify-center">
                                                         {permissions.EDIT_ENTRIES && (
                                                             <button
                                                                 onClick={() => setModalState({ type: 'editEntry', data: entry })}
                                                                 title="Editar Lançamento"
                                                                 className="text-yellow-500 hover:text-yellow-400"
                                                             >
                                                                 <Edit size={18} />
                                                             </button>
                                                         )}
                                                         {permissions.DELETE_ENTRIES && <button onClick={() => handleDeleteEntry(entry.id)} title="Excluir Lançamento"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>}
                                                     </div>
                                                 </td>
                                             </tr>
                                         );
                                     })}
                                 </tbody>
                             </table>
                         ) : (
                             <table className="w-full text-sm">
                                 <thead className="bg-gray-50 dark:bg-gray-800">
                                     <tr>
                                         <th className="p-3 text-left border-r dark:border-gray-600">Período</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Pessoas / Tempo</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Meta</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Produção</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Eficiência</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Meta Acum.</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Prod. Acum.</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Efic. Acum.</th>
                                         <th className="p-3 text-left border-r dark:border-gray-600">Lançado por</th>
                                         <th className="p-3 text-center border-r dark:border-gray-600">Obs.</th>
                                         <th className="p-3 text-center">Ações</th>
                                     </tr>
                                 </thead>
                                 <tbody className="divide-y divide-x divide-gray-200 dark:divide-gray-600">
                                     {processedData.map((d) => (
                                         <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                             <td className="p-3 font-semibold border-r dark:border-gray-600">{d.period}</td>
                                             <td className="p-3 text-center border-r dark:border-gray-600">{d.people} / {d.availableTime} min</td>
                                             <td className="p-3 text-center border-r dark:border-gray-600">{d.goalForDisplay || d.goal}</td>
                                             <td className="p-3 text-center border-r dark:border-gray-600">{d.producedForDisplay || d.produced}</td>
                                             <td className={`p-3 text-center font-semibold border-r dark:border-gray-600 ${d.efficiency < 65 ? 'text-red-500' : 'text-green-600'}`}>{d.efficiency}%</td>
                                             <td className="p-3 text-center border-r dark:border-gray-600">{d.cumulativeGoal}</td>
                                             <td className="p-3 text-center border-r dark:border-gray-600">{d.cumulativeProduction}</td>
                                             <td className={`p-3 text-center font-semibold border-r dark:border-gray-600 ${d.cumulativeEfficiency < 65 ? 'text-red-500' : 'text-green-600'}`}>{d.cumulativeEfficiency}%</td>
                                             <td className="p-3 text-left text-xs truncate border-r dark:border-gray-600">{d.createdBy?.email}</td>
                                             <td className="p-3 text-center border-r dark:border-gray-600">
                                                 <button onClick={() => setModalState({ type: 'observation', data: d })} title="Observação">
                                                     <MessageSquare size={18} className={d.observation ? 'text-blue-500 hover:text-blue-400' : 'text-gray-500 hover:text-blue-400'}/>
                                                 </button>
                                             </td>
                                             <td className="p-3">
                                                 <div className="flex gap-2 justify-center">
                                                     {permissions.EDIT_ENTRIES &&
                                                         <button
                                                             onClick={() => setModalState({ type: 'editEntry', data: d })}
                                                             title="Editar Lançamento"
                                                             className="text-yellow-500 hover:text-yellow-400"
                                                         >
                                                             <Edit size={18} />
                                                         </button>
                                                     }
                                                     {permissions.DELETE_ENTRIES && <button onClick={() => handleDeleteEntry(d.id)} title="Excluir Lançamento"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>}
                                                 </div>
                                             </td>
                                         </tr>
                                     ))}
                                 </tbody>
                             </table>
                         )}
                     </div>
                 </section>

                 {permissions.ADD_ENTRIES && (
                     <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                         <h2 className="text-xl font-semibold mb-4 flex items-center"><PlusCircle className="mr-2 text-blue-500"/> Adicionar Novo Lançamento</h2>
                         {isTraveteDashboard ? (
                             <form onSubmit={handleAddEntry} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col">
                                        <label htmlFor="travete-period">Período</label>
                                        <select
                                            id="travete-period"
                                            value={traveteEntry.period}
                                             onChange={(e) => handleTraveteFieldChange('period', e.target.value)}
                                             required
                                             className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                         >
                                             <option value="" disabled>Selecione...</option>
                                             {availablePeriods.map(time => (<option key={time} value={time}>{time}</option>))}
                                         </select>
                                     </div>
                                    <div className="flex flex-col">
                                        <label htmlFor="travete-time">Tempo Disponível (min)</label>
                                        <input
                                            id="travete-time"
                                            type="number"
                                             min="1"
                                             value={traveteEntry.availableTime}
                                             onChange={(e) => handleTraveteFieldChange('availableTime', e.target.value)}
                                             required
                                            className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                   {traveteEntry.employeeEntries.map((employee, index) => {
                                        const metaInfo = traveteComputedEntry.employeeSummaries[index] || {};
                                        const formatTime = (value) => {
                                            if (!value || Number.isNaN(Number(value))) return '--';
                                            return `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} min`;
                                        };
                                        return (
                                             <div key={employee.employeeId} className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/50 space-y-4">
                                                 <div className="flex items-center justify-between">
                                                     <h3 className="text-lg font-semibold">Funcionário {employee.employeeId}</h3>
                                                     <span className="text-xs uppercase tracking-wide text-gray-500">{employee.machineType}</span>
                                                 </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="flex flex-col">
                                                        <label>Máquina</label>
                                                        <select
                                                            value={employee.machineType}
                                                            onChange={(e) => handleTraveteEmployeeChange(index, 'machineType', e.target.value)}
                                                            className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                        >
                                                            {traveteMachines.map(machine => (<option key={machine} value={machine}>{machine}</option>))}
                                                        </select>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <label>Tempo por Peça (min)</label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            value={employee.standardTime ?? ''}
                                                            onChange={(e) => handleTraveteEmployeeChange(index, 'standardTime', e.target.value)}
                                                            onBlur={() => handleTraveteStandardTimeBlur(index)}
                                                            className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                            required
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-4">
                                                    {(employee.products || []).map((productItem, productIdx) => {
                                                        const lot = productItem.lotId ? traveteLotOptions.find(option => option.id === productItem.lotId) || null : null;
                                                        const lotName = lot ? formatTraveteLotDisplayName(lot, products) : '--';
                                                        return (
                                                            <div key={`${employee.employeeId}-${productIdx}`} className="p-3 rounded-lg bg-white/60 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <label className="text-sm font-semibold">
                                                                        {productIdx === 0
                                                                            ? 'Produto / Lote (Prioridade)'
                                                                            : productItem.isAutoSuggested
                                                                                ? 'Próximo Lote (Automático)'
                                                                                : 'Produto / Lote'}
                                                                    </label>
                                                                    {employee.products.length > 1 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleTraveteRemoveProduct(index, productIdx)}
                                                                            className="text-red-500 hover:text-red-400"
                                                                            title="Remover este item"
                                                                        >
                                                                            <Trash size={16} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <select
                                                                    value={productItem.lotId}
                                                                    onChange={(e) => handleTraveteProductChange(index, productIdx, 'lotId', e.target.value)}
                                                                    className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                                >
                                                                    <option value="">Selecione...</option>
                                                                    {traveteLotOptions.map(lotOption => (
                                                                        <option key={lotOption.id} value={lotOption.id}>
                                                                            {formatTraveteLotDisplayName(lotOption, products)}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                    <div className="flex flex-col">
                                                                        <label className="text-sm">Quantidade Produzida</label>
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            value={productItem.produced}
                                                                            onChange={(e) => handleTraveteProductChange(index, productIdx, 'produced', e.target.value)}
                                                                            className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                                        />
                                                                    </div>
                                                                    <div className="flex flex-col text-xs text-gray-600 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/30 p-3 rounded-md">
                                                                        <span className="font-semibold text-sm">Tempo Padrão Atual</span>
                                                                        <span>{formatTime(metaInfo.standardTimeValue || employee.standardTime)}</span>
                                                                        <span className="mt-1 text-[11px]">Lote Selecionado: {lotName}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleTraveteAddProduct(index)}
                                                        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-500"
                                                    >
                                                        <PlusCircle size={16} /> Adicionar item fora de ordem
                                                    </button>
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    <span className="block">Meta Individual: {metaInfo.meta || 0}</span>
                                                    <span className="block">Eficiência Prevista: {metaInfo.efficiency ? `${Number(metaInfo.efficiency).toFixed(2)}%` : '0%'}</span>
                                                </div>
                                            </div>
                                         );
                                     })}
                                 </div>
                                 <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-t pt-4 dark:border-gray-700">
                                     <div className="flex flex-col justify-center items-center bg-blue-50 dark:bg-blue-900/40 p-3 rounded-md shadow-inner w-full md:w-64">
                                         <label className="text-sm font-medium text-gray-800 dark:text-gray-200">Lotes Previstos</label>
                                         <span className="font-bold text-base text-blue-700 dark:text-blue-200 text-center">{traveteComputedEntry.lotDisplay || '- // -'}</span>
                                     </div>
                                    <div className="flex flex-col justify-center items-center bg-blue-100 dark:bg-blue-900/50 p-3 rounded-md shadow-inner w-full md:w-64">
                                        <label className="text-sm font-medium text-gray-800 dark:text-gray-200">Meta Prevista</label>
                                        <span className={`font-bold text-xl ${travetePreviewPending ? 'text-yellow-500 dark:text-yellow-300' : 'text-blue-600 dark:text-blue-300'}`}>
                                            {traveteComputedEntry.goalDisplay || '- // -'}
                                        </span>
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={!isEntryFormValid}
                                        className="h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
                                    >
                                        Adicionar
                                    </button>
                                </div>
                            </form>
                         ) : (
                             <form onSubmit={handleAddEntry} className="grid grid-cols-1 gap-4 items-end">
                                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                     <div className="flex flex-col">
                                         <label htmlFor="entry-period">Período</label>
                                         <select id="entry-period" name="period" value={newEntry.period} onChange={handleInputChange} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                             <option value="" disabled>Selecione...</option>
                                             {availablePeriods.map(time => (<option key={time} value={time}>{time}</option>))}
                                         </select>
                                     </div>
                                     <div className="flex flex-col"><label htmlFor="entry-people">Nº Pessoas</label><input id="entry-people" type="number" name="people" value={newEntry.people} onChange={handleInputChange} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700" /></div>
                                     <div className="flex flex-col"><label htmlFor="entry-available-time">Tempo Disp.</label><input id="entry-available-time" type="number" name="availableTime" value={newEntry.availableTime} onChange={handleInputChange} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                                     <div className="flex flex-col">
                                         <label htmlFor="entry-product">Produto (Prioridade)</label>
                                         <select id="entry-product" name="productId" value={newEntry.productId} onChange={handleInputChange} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                             <option value="">Selecione...</option>
                                             {[...productsForSelectedDate].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>(<option key={p.id} value={p.id}>{p.name}</option>))}
                                         </select>
                                     </div>
                                 </div>
                                 <div className="flex flex-col space-y-4">
                                     <div className="flex flex-wrap gap-4 items-end">
                                         <div className='flex flex-wrap gap-4 items-end'>
                                             {predictedLots.filter(p => !p.isUrgent).map((lot, index) => (
                                                 <div key={lot.id || index} className="flex flex-col min-w-[100px]">
                                                     <label className="text-sm truncate" htmlFor={`prod-input-${index}`}>Prod. ({lot.productName})</label>
                                                     <input id={`prod-input-${index}`} type="number" value={newEntry.productions[index] || ''} onChange={(e) => handleProductionChange(index, e.target.value)} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700" />
                                                 </div>
                                             ))}
                                         </div>
                                         <div className="min-w-[150px] ml-auto">
                                             <button type="button" onClick={() => setShowUrgent(p => !p)} className="text-sm text-blue-500 hover:underline mb-2 flex items-center gap-1">
                                                 <PlusCircle size={14} />{showUrgent ? 'Remover item fora de ordem' : 'Adicionar item fora de ordem'}
                                             </button>
                                             {showUrgent && (
                                                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-blue-50 dark:bg-gray-800 rounded-lg">
                                                     <div className="flex flex-col">
                                                         <label htmlFor="urgent-lot">Lote Urgente</label>
                                                         <select id="urgent-lot" name="productId" value={urgentProduction.productId} onChange={handleUrgentChange} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                                             <option value="">Selecione...</option>
                                                             {lots.filter(l=>l.status!=='completed').map(l=>(<option key={l.id} value={l.productId}>{l.productName}{l.customName?` - ${l.customName}`:''}</option>))}
                                                         </select>
                                                     </div>
                                                     <div className="flex flex-col"><label htmlFor="urgent-produced">Produzido (Urgente)</label><input id="urgent-produced" type="number" name="produced" value={urgentProduction.produced} onChange={handleUrgentChange} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                                                 </div>
                                             )}
                                         </div>
                                     </div>
                                    <div className="flex justify-end gap-4 items-center pt-4 border-t dark:border-gray-700">
                                        {predictedLotLabel && (
                                            <div className="flex flex-col justify-center items-center bg-blue-50 dark:bg-blue-900/30 p-2 rounded-md shadow-inner h-full min-h-[60px] w-48 text-center">
                                                <label className="text-sm font-medium text-gray-800 dark:text-gray-200">Lotes Previstos</label>
                                                <span className="font-semibold text-base text-blue-600 dark:text-blue-300">{predictedLotLabel}</span>
                                            </div>
                                        )}
                                        <div className="flex flex-col justify-center items-center bg-blue-100 dark:bg-blue-900/50 p-2 rounded-md shadow-inner h-full min-h-[60px] w-48">
                                            <label className="text-sm font-medium text-gray-800 dark:text-gray-200">Meta Prevista</label>
                                            <span className="font-bold text-xl text-blue-600 dark:text-blue-400">{goalPreview || '0'}</span>
                                        </div>
                                        <button type="submit" disabled={!isEntryFormValid} className="h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto">Adicionar</button>
                                    </div>
                                </div>
                            </form>
                        )}
                     </section>
                 )}
                  <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                      <h2 className="text-xl font-semibold mb-4 flex items-center"><Layers className="mr-2 text-blue-500"/> Controle de Lotes de Produção</h2>
                      {permissions.MANAGE_LOTS && <div className="mb-6 border-b pb-6 dark:border-gray-700">
                          <h3 className="text-lg font-medium mb-4">Criar Novo Lote</h3>
                          <form onSubmit={handleAddLot} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                               <div className="flex flex-col">
                                   <label htmlFor="newLotProduct">Produto</label>
                                  <select id="newLotProduct" name="productId" value={newLot.productId} onChange={e => setNewLot({...newLot, productId: e.target.value})} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                      <option value="">Selecione...</option>
                                      {isTraveteDashboard ? (
                                          traveteGroupedProducts.map(group => (
                                              <option key={group.baseId} value={group.baseId}>
                                                  {group.baseName}
                                              </option>
                                          ))
                                      ) : (
                                          [...products]
                                              .sort((a,b)=>a.name.localeCompare(b.name))
                                              .map(p => (
                                                  <option key={p.id} value={p.id}>
                                                      {p.name}
                                                  </option>
                                              ))
                                      )}
                                  </select>
                               </div>
                               <div className="flex flex-col"><label htmlFor="newLotTarget">Quantidade</label><input type="number" id="newLotTarget" name="target" value={newLot.target} onChange={e => setNewLot({...newLot, target: e.target.value})} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                               <div className="flex flex-col"><label htmlFor="newLotCustomName">Nome (Opcional)</label><input type="text" id="newLotCustomName" name="customName" value={newLot.customName} onChange={e => setNewLot({...newLot, customName: e.target.value})} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                               <button type="submit" className="h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600 w-full sm:w-auto">Criar Lote</button>
                          </form>
                      </div>}
                      <div className="flex gap-2 mb-4 border-b pb-2 dark:border-gray-700 flex-wrap">
                          <button onClick={() => setLotFilter('ongoing')} className={`px-3 py-1 text-sm rounded-full ${lotFilter==='ongoing' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>Em Andamento</button>
                          <button onClick={() => setLotFilter('completed')} className={`px-3 py-1 text-sm rounded-full ${lotFilter==='completed' ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>Concluídos</button>
                      </div>
                      <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                          {filteredLots.map((lot, index, arr) => {
                              let lotBgClass = 'bg-gray-50 dark:bg-gray-800';
                              if (lot.status === 'completed_missing' || lot.status === 'completed_exceeding') {
                                  lotBgClass = 'bg-gradient-to-r from-green-200 to-red-200 dark:from-green-800/50 dark:to-red-800/50';
                              } else if (lot.status === 'completed') {
                                  lotBgClass = 'bg-green-100 dark:bg-green-900/50';
                              }
                              return (
                                  <div key={lot.id} className={`${lotBgClass} p-4 rounded-lg`}>
                                  <div className="flex justify-between items-start">
                                      <div className="flex items-center gap-2">
                                          {permissions.MANAGE_LOTS && !lot.status.startsWith('completed') && (
                                              <div className="flex flex-col"><button onClick={() => handleMoveLot(lot.id, 'up')} disabled={index===0} className="disabled:opacity-20"><ChevronUp size={16}/></button><button onClick={() => handleMoveLot(lot.id, 'down')} disabled={index===arr.length-1} className="disabled:opacity-20"><ChevronDown size={16}/></button></div>
                                          )}
                                          <div>
                                              <h4 className="font-bold text-lg">
                                                  {isTraveteDashboard
                                                      ? formatTraveteLotDisplayName(lot, products)
                                                      : `${lot.productName}${lot.customName ? ' - ' + lot.customName : ''}`}
                                              </h4>
                                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                                  <p>Lote #{lot.sequentialId} | Prioridade: {index+1}</p>
                                                  <p>Criado por: {lot.createdBy?.email || 'N/A'}</p>
                                                  {lot.lastEditedBy && <p>Editado por: {lot.lastEditedBy.email}</p>}
                                              </div>
                                              {(lot.startDate || lot.endDate) && (
                                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                      {lot.startDate && `Início: ${new Date(lot.startDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                                                      {lot.endDate && ` | Fim: ${new Date(lot.endDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                                                  </p>
                                              )}
                                          </div>
                                      </div>
                                      <div className="flex items-center gap-4">
                                          {permissions.MANAGE_LOTS && <select 
                                              value={lot.status} 
                                              onChange={(e) => handleLotStatusChange(lot.id, e.target.value)} 
                                              className="text-xs font-semibold p-1 rounded-full bg-gray-200 dark:bg-gray-600 border-none appearance-none text-center"
                                          >
                                              { (lot.status === 'ongoing' || lot.status === 'future') ? ( 
                                                  <> 
                                                      <option value={lot.status}>{lot.status === 'future' ? 'Na Fila' : 'Em Andamento'}</option> 
                                                      <option value="completed">Concluir</option> 
                                                      <option value="completed_missing">Concluir c/ Falta</option>
                                                      <option value="completed_exceeding">Concluir c/ Sobra</option>
                                                  </> 
                                              ) : ( 
                                                  <> 
                                                      <option value={lot.status}>{
                                                          lot.status === 'completed' ? 'Concluído' :
                                                          lot.status === 'completed_missing' ? 'Com Falta' :
                                                          'Com Sobra'
                                                      }</option>
                                                      <option value="ongoing">Reabrir</option>
                                                  </> 
                                              )}
                                          </select>}
                                          <div className="flex gap-2">
                                              <button onClick={()=>setModalState({type:'lotObservation', data:lot})} title="Observação">
                                                  <MessageSquare size={18} className={lot.observation ? 'text-blue-500 hover:text-blue-400' : 'text-gray-500 hover:text-blue-400'}/>
                                              </button>
                                              {permissions.MANAGE_LOTS && <button onClick={()=>handleStartEditLot(lot)} title="Editar Lote"><Edit size={18} className="text-yellow-500 hover:text-yellow-400"/></button>}
                                              {permissions.MANAGE_LOTS && <button onClick={()=>handleDeleteLot(lot.id)} title="Excluir Lote"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>}
                                          </div>
                                      </div>
                                  </div>
                                  <div className="mt-2">
                                      <div className="flex justify-between text-sm mb-1 items-center">
                                          <span>Progresso</span>
                                          {editingLotId === lot.id ? (
                                              <div className="flex items-center gap-2 flex-wrap">
                                                  <span>{lot.produced||0} / </span>
                                                  <input type="number" value={editingLotData.target} onChange={e=>setEditingLotData({...editingLotData,target:e.target.value})} className="p-1 w-24"/>
                                                  <input type="text" value={editingLotData.customName} onChange={e=>setEditingLotData({...editingLotData,customName:e.target.value})} className="p-1 w-32"/>
                                                  <button onClick={()=>handleSaveLotEdit(lot.id)}><Save size={16}/></button><button onClick={()=>setEditingLotId(null)}><XCircle size={16}/></button>
                                              </div>
                                          ) : (<span>{lot.produced||0} / {lot.target||0}</span>)}
                                      </div>
                                      <div className="w-full bg-gray-200 dark:bg-gray-600 h-2.5 rounded-full"><div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${((lot.produced||0)/(lot.target||1))*100}%`}}></div></div>
                                  </div>
                                  </div>
                              );
                          })}
                      </div>
                  </section>

 
                  <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                      <h2 className="text-xl font-semibold mb-4 flex items-center"><Package className="mr-2 text-blue-500"/> Gerenciamento de Produtos</h2>
                      {isTraveteDashboard ? (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                              {permissions.MANAGE_PRODUCTS && (
                                  <div className="space-y-4">
                                      <h3 className="text-lg font-medium">Cadastrar Produto Base</h3>
                                      <form onSubmit={handleAddProduct} className="space-y-4">
                                          <div>
                                              <label htmlFor="travete-base-name">Nome do Produto Base</label>
                                              <input
                                                  id="travete-base-name"
                                                  type="text"
                                                  value={traveteProductForm.baseName}
                                                  onChange={(e) => setTraveteProductForm(prev => ({ ...prev, baseName: e.target.value }))}
                                                  required
                                                  className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                              />
                                          </div>
                                          <div className="space-y-3">
                                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Variações e Tempos</span>
                                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                  <div className="space-y-2">
                                                      <label className="flex items-center gap-2 text-sm font-medium">
                                                          <input
                                                              type="checkbox"
                                                              checked={traveteProductForm.createTwoNeedle}
                                                              onChange={(e) => handleTraveteVariationToggle('createTwoNeedle', e.target.checked)}
                                                          />
                                                          Travete 2 Agulhas
                                                      </label>
                                                      <input
                                                          type="number"
                                                          step="0.01"
                                                          min="0"
                                                          value={traveteProductForm.baseTime}
                                                          onChange={(e) => handleTraveteBaseTimeChange(e.target.value)}
                                                          className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                          placeholder="Tempo (min)"
                                                          required={traveteProductForm.createTwoNeedle}
                                                      />
                                                  </div>
                                                  <div className="space-y-2">
                                                      <label className="flex items-center gap-2 text-sm font-medium">
                                                          <input
                                                              type="checkbox"
                                                              checked={traveteProductForm.createOneNeedle}
                                                              onChange={(e) => handleTraveteVariationToggle('createOneNeedle', e.target.checked)}
                                                          />
                                                          Travete 1 Agulha
                                                      </label>
                                                      <input
                                                          type="number"
                                                          step="0.01"
                                                          min="0"
                                                          value={traveteProductForm.oneNeedleTime}
                                                          onChange={(e) => handleTraveteVariationTimeChange('oneNeedleTime', e.target.value)}
                                                          onBlur={() => handleTraveteVariationTimeBlur('oneNeedleTime')}
                                                          className={`w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 ${!traveteProductForm.createOneNeedle ? 'opacity-60' : ''}`}
                                                          placeholder="Tempo (min)"
                                                          required={traveteProductForm.createOneNeedle}
                                                          disabled={!traveteProductForm.createOneNeedle}
                                                      />
                                                  </div>
                                                  <div className="space-y-2">
                                                      <label className="flex items-center gap-2 text-sm font-medium">
                                                          <input
                                                              type="checkbox"
                                                              checked={traveteProductForm.createConventional}
                                                              onChange={(e) => handleTraveteVariationToggle('createConventional', e.target.checked)}
                                                          />
                                                          Travete Convencional
                                                      </label>
                                                      <input
                                                          type="number"
                                                          step="0.01"
                                                          min="0"
                                                          value={traveteProductForm.conventionalTime}
                                                          onChange={(e) => handleTraveteVariationTimeChange('conventionalTime', e.target.value)}
                                                          onBlur={() => handleTraveteVariationTimeBlur('conventionalTime')}
                                                          className={`w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 ${!traveteProductForm.createConventional ? 'opacity-60' : ''}`}
                                                          placeholder="Tempo (min)"
                                                          required={traveteProductForm.createConventional}
                                                          disabled={!traveteProductForm.createConventional}
                                                      />
                                                  </div>
                                              </div>
                                          </div>
                                          <button type="submit" className="w-full h-10 bg-green-600 text-white rounded-md hover:bg-green-700">Salvar</button>
                                      </form>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">Escolha quais variações criar e ajuste os tempos caso precise personalizar algum cenário específico.</p>
                                  </div>
                              )}
                              <div className={!permissions.MANAGE_PRODUCTS ? 'lg:col-span-2' : ''}>
                                  <h3 className="text-lg font-medium mb-4">Produtos Base e Variações ({traveteGroupedProducts.length})</h3>
                                  <div className="space-y-4 max-h-72 overflow-y-auto pr-2">
                                      {traveteGroupedProducts.length > 0 ? (
                                          traveteGroupedProducts.map(group => (
                                              <div key={group.baseId} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-800/40 space-y-3">
                                                  <div className="flex items-center justify-between">
                                                      <h4 className="text-lg font-semibold">{group.baseName}</h4>
                                                      <span className="text-xs uppercase tracking-wide text-gray-500">{group.variations.length} variações</span>
                                                  </div>
                                                  <table className="w-full text-sm">
                                                      <thead className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                                          <tr>
                                                              <th className="pb-1">Máquina</th>
                                                              <th className="pb-1">Produto</th>
                                                              <th className="pb-1">Tempo Atual</th>
                                                              <th className="pb-1">Criado Por</th>
                                                              <th className="pb-1">Última Edição</th>
                                                              {permissions.MANAGE_PRODUCTS && <th className="pb-1 text-center">Ações</th>}
                                                          </tr>
                                                      </thead>
                                                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                          {group.variations.map(variation => {
                                                              const history = variation.standardTimeHistory || [];
                                                              const latest = history[history.length - 1] || {};
                                                              const createdBy = variation.createdBy?.email || '--';
                                                              const editedBy = variation.lastEditedBy?.email || createdBy;
                                                              const isEditing = editingProductId === variation.id;
                                                              return (
                                                                  <tr key={variation.id} className="text-sm">
                                                                      <td className="py-2">{variation.machineType || '-'}</td>
                                                                      {isEditing ? (
                                                                          <>
                                                                              <td className="py-2">
                                                                                  <input
                                                                                      type="text"
                                                                                      value={editingProductData.name}
                                                                                      onChange={(e) => handleEditingProductFieldChange('name', e.target.value)}
                                                                                      className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600"
                                                                                  />
                                                                              </td>
                                                                              <td className="py-2">
                                                                                  <input
                                                                                      type="number"
                                                                                      step="0.01"
                                                                                      value={editingProductData.standardTime}
                                                                                      onChange={(e) => handleEditingProductFieldChange('standardTime', e.target.value)}
                                                                                      className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600"
                                                                                  />
                                                                              </td>
                                                                              <td className="py-2" colSpan={2}></td>
                                                                          </>
                                                                      ) : (
                                                                          <>
                                                                              <td className="py-2">{variation.name}</td>
                                                                              <td className="py-2">{latest.time ? `${latest.time} min` : 'N/A'}</td>
                                                                              <td className="py-2 text-xs truncate">{createdBy}</td>
                                                                              <td className="py-2 text-xs truncate">{editedBy}</td>
                                                                          </>
                                                                      )}
                                                                      {permissions.MANAGE_PRODUCTS && (
                                                                          <td className="py-2">
                                                                              <div className="flex gap-2 justify-center">
                                                                                  {isEditing ? (
                                                                                      <>
                                                                                          <button onClick={() => handleSaveProduct(variation.id)} title="Salvar"><Save size={18} className="text-green-500" /></button>
                                                                                          <button onClick={() => setEditingProductId(null)} title="Cancelar"><XCircle size={18} className="text-gray-500" /></button>
                                                                                      </>
                                                                                  ) : (
                                                                                      <>
                                                                                          <button onClick={() => handleStartEditProduct(variation)} title="Editar"><Edit size={18} className="text-yellow-500 hover:text-yellow-400" /></button>
                                                                                          <button onClick={() => handleDeleteProduct(variation.id)} title="Excluir"><Trash2 size={18} className="text-red-500 hover:text-red-400" /></button>
                                                                                      </>
                                                                                  )}
                                                                              </div>
                                                                          </td>
                                                                      )}
                                                                  </tr>
                                                              );
                                                          })}
                                                      </tbody>
                                                  </table>
                                              </div>
                                          ))
                                      ) : (
                                          <p>Nenhum produto cadastrado.</p>
                                      )}
                                  </div>
                              </div>
                          </div>
                      ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                           {permissions.MANAGE_PRODUCTS && <div>
                               <h3 className="text-lg font-medium mb-4">Cadastrar Novo Produto</h3>
                               <form onSubmit={handleAddProduct} className="space-y-3">
                                   <div><label htmlFor="newProductName">Nome</label><input type="text" id="newProductName" value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                                   <div><label htmlFor="newProductTime">Tempo Padrão (min)</label><input type="number" id="newProductTime" value={newProduct.standardTime} onChange={e=>setNewProduct({...newProduct,standardTime:e.target.value})} step="0.01" required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                                   <button type="submit" className="w-full h-10 bg-green-600 text-white rounded-md">Salvar</button>
                               </form>
                           </div>}
                           <div className={!permissions.MANAGE_PRODUCTS ? 'lg:col-span-2' : ''}>
                               <h3 className="text-lg font-medium mb-4">Produtos Cadastrados ({products.length})</h3>
                               <div className="overflow-auto max-h-60 rounded-lg border dark:border-gray-700">
                                   <table className="w-full text-left">
                                        <thead className="bg-gray-100 dark:bg-gray-700"><tr>
                                          <th className="p-3">Nome/Código</th>
                                          <th className="p-3">Tempo Padrão (na data)</th>
                                          <th className="p-3">Criado Por</th>
                                          <th className="p-3">Última Edição</th>
                                          {permissions.MANAGE_PRODUCTS && <th className="p-3 text-center">Ações</th>}
                                       </tr></thead>
                                       <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
{[...products].sort((a, b) => a.name.localeCompare(b.name)).map(p => {
    const history = p.standardTimeHistory || [];
    const currentTime = history.length > 0 ? history[history.length - 1].time : 'N/A';

    const targetDateEnd = new Date(selectedDate);
    targetDateEnd.setHours(23, 59, 59, 999);
    const historicalEntry = history.filter(h => new Date(h.effectiveDate) <= targetDateEnd).pop();

    const didExistOnDate = !!historicalEntry;
    const historicalTime = historicalEntry ? historicalEntry.time : 'N/A';

    return (
        <tr key={p.id} className={!didExistOnDate ? 'bg-red-50 dark:bg-red-900/20' : ''}>
            {editingProductId === p.id ? (
                <>
                    <td className="p-2"><input type="text" value={editingProductData.name} onChange={e => handleEditingProductFieldChange('name', e.target.value)} className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600" /></td>
                    <td className="p-2"><input type="number" step="0.01" value={editingProductData.standardTime} onChange={e => handleEditingProductFieldChange('standardTime', e.target.value)} className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600" /></td>
                    <td colSpan="2"></td>
                    {permissions.MANAGE_PRODUCTS && <td className="p-3">
                        <div className="flex gap-2 justify-center">
                            <button onClick={() => handleSaveProduct(p.id)} title="Salvar"><Save size={18} className="text-green-500" /></button>
                            <button onClick={() => setEditingProductId(null)} title="Cancelar"><XCircle size={18} className="text-gray-500" /></button>
                        </div>
                    </td>}
                </>
            ) : (
                <>
                    <td className={`p-3 font-semibold ${!didExistOnDate ? 'text-red-500' : ''}`}>{p.name}{!didExistOnDate && ' (Não existia)'}</td>
                    <td className="p-3">
                        {historicalTime} min
                        {didExistOnDate && currentTime !== historicalTime && <span className="text-xs text-gray-500 ml-2">(Atual: {currentTime} min)</span>}
                    </td>
                    <td className="p-3 text-xs truncate">{p.createdBy?.email}</td>
                    <td className="p-3 text-xs truncate">{p.lastEditedBy?.email}</td>
                    {permissions.MANAGE_PRODUCTS && <td className="p-3">
                        <div className="flex gap-2 justify-center">
                            <button onClick={() => handleStartEditProduct(p)} title="Editar"><Edit size={18} className="text-yellow-500 hover:text-yellow-400" /></button>
                            <button onClick={() => handleDeleteProduct(p.id)} title="Excluir"><Trash2 size={18} className="text-red-500 hover:text-red-400" /></button>
                        </div>
                    </td>}
                </>
            )}
        </tr>
    );
  })}
</tbody>
                                   </table>
                               </div>
                           </div>
                       </div>
                   )}
                  </section>

                   
                 {permissions.VIEW_TRASH && <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg mt-8">
                     <h2 className="text-xl font-semibold mb-4 flex items-center"><Trash2 className="mr-2 text-red-500"/> Lixeira</h2>
                     <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                         {trashItems.filter(item => item.dashboardId === currentDashboard.id).length > 0 
                             ? trashItems.filter(item => item.dashboardId === currentDashboard.id).map(item=>(
                                 <TrashItemDisplay 
                                     key={item.id} 
                                     item={item} 
                                     products={products} 
                                     user={user} 
                                     onRestore={handleRestoreItem} 
                                     canRestore={permissions.RESTORE_TRASH} 
                                 />
                               )) 
                             : <p>Lixeira vazia.</p>}
                     </div>
                 </section>}
            </main>
        </div>
    );
};


const FullScreenAlert = ({ isOpen }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex flex-col justify-center items-center z-[100] text-white animate-pulse">
            <span className="text-9xl" role="img" aria-label="Alerta">⚠️</span>
            <h1 className="text-6xl font-extrabold mt-4 text-red-500">EFICIÊNCIA ABAIXO DO ESPERADO!</h1>
        </div>
    );
};


const TvModeDisplay = ({ tvOptions, stopTvMode, dashboards }) => {
    const [theme] = useState(() => localStorage.getItem('theme') || 'dark');
    const [transitioning, setTransitioning] = useState(false);
    useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

    const isCarousel = typeof tvOptions === 'object';
    const initialDashboardId = isCarousel ? tvOptions.dashboardIds[0] : tvOptions;

    const [currentDashboardId, setCurrentDashboardId] = useState(initialDashboardId);
    
    const [showFullScreenAlert, setShowFullScreenAlert] = useState(false);

    const changeDashboard = useCallback((newId) => {
        setTransitioning(true);
        setTimeout(() => {
            setCurrentDashboardId(newId);
            setTransitioning(false);
        }, 300);
    }, []);

    useEffect(() => {
        if (!isCarousel || tvOptions.dashboardIds.length <= 1) return;
        
        const interval = setInterval(() => {
            const currentIndex = tvOptions.dashboardIds.indexOf(currentDashboardId);
            const nextIndex = (currentIndex + 1) % tvOptions.dashboardIds.length;
            changeDashboard(tvOptions.dashboardIds[nextIndex]);
        }, tvOptions.interval);

        return () => clearInterval(interval);
    }, [tvOptions, isCarousel, currentDashboardId, changeDashboard]);

    const currentDashboard = useMemo(() => dashboards.find(d => d.id === currentDashboardId), [currentDashboardId, dashboards]);
    const isTraveteDashboard = currentDashboard?.id === 'travete';
    
    const [products, setProducts] = useState([]);
    const [allProductionData, setAllProductionData] = useState({});
    const [previewData, setPreviewData] = useState(null);

    useEffect(() => {
        if (!currentDashboard) return;

        const unsubProducts = onSnapshot(query(collection(db, `dashboards/${currentDashboard.id}/products`)), snap => {
            setProducts(snap.docs.map(d => d.data()));
        });
        
        const unsubProdData = onSnapshot(doc(db, `dashboards/${currentDashboard.id}/productionData`, "data"), snap => {
            setAllProductionData(snap.exists() ? snap.data() : {});
        });

        const unsubPreview = onSnapshot(doc(db, `dashboards/${currentDashboard.id}/previews/live`), (doc) => {
            if (doc.exists()) {
                setPreviewData(doc.data());
            } else {
                setPreviewData(null);
            }
        });

        return () => {
            unsubProducts();
            unsubProdData();
            unsubPreview();
        };

    }, [currentDashboard]);

    
    const [selectedDate, setSelectedDate] = useState(() => {
        const initial = new Date();
        initial.setHours(0, 0, 0, 0);
        return initial;
    });

    const handlePrevDay = useCallback(() => {
        setSelectedDate(prev => {
            const next = new Date(prev);
            next.setDate(prev.getDate() - 1);
            return next;
        });
    }, []);

    const handleNextDay = useCallback(() => {
        setSelectedDate(prev => {
            const next = new Date(prev);
            next.setDate(prev.getDate() + 1);
            return next;
        });
    }, []);

    const selectedDateLabel = useMemo(() => selectedDate.toLocaleDateString('pt-BR'), [selectedDate]);

    const isTodaySelected = useMemo(() => {
        const todayReference = new Date();
        todayReference.setHours(0, 0, 0, 0);
        return selectedDate.toDateString() === todayReference.toDateString();
    }, [selectedDate]);

    const productsForSelectedDate = useMemo(() => {
        const targetDate = new Date(selectedDate);
        targetDate.setHours(23, 59, 59, 999);

        return products
            .map(p => {
                if (!p.standardTimeHistory || p.standardTimeHistory.length === 0) return null;
                const validTimeEntry = p.standardTimeHistory.filter(h => new Date(h.effectiveDate) <= targetDate).pop();
                if (!validTimeEntry) return null;
                return { ...p, standardTime: validTimeEntry.time };
            })
            .filter(Boolean);
    }, [products, selectedDate]);

    const dateKey = selectedDate.toISOString().slice(0, 10);
    const productionData = useMemo(() => allProductionData[dateKey] || [], [allProductionData, dateKey]);

    const productMapForSelectedDate = useMemo(
        () => buildProductLookupMap(productsForSelectedDate),
        [productsForSelectedDate]
    );

    const processedData = useMemo(() => {
        if (isTraveteDashboard || !productionData || productionData.length === 0) return [];
        let cumulativeProduction = 0, cumulativeGoal = 0, cumulativeEfficiencySum = 0;
        return [...productionData].sort((a,b)=>(a.period||"").localeCompare(b.period||"")).map((item, index) => {
            let totalTimeValue = 0, totalProducedInPeriod = 0;
            const producedForDisplay = (item.productionDetails || []).map(d => `${d.produced || 0}`).join(' / ');
            (item.productionDetails || []).forEach(detail => {
                const product = productMapForSelectedDate.get(detail.productId);
                if (product?.standardTime) {
                    totalTimeValue += (detail.produced || 0) * product.standardTime;
                    totalProducedInPeriod += (detail.produced || 0);
                }
            });
            const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
            const efficiency = totalAvailableTime > 0 ? parseFloat(((totalTimeValue / totalAvailableTime) * 100).toFixed(2)) : 0;
            const goalSegments = splitGoalSegments(item.goalDisplay || '');
            const numericGoal = sumGoalDisplay(item.goalDisplay || '');
            const goalForDisplay = joinGoalSegments(goalSegments);
            cumulativeProduction += totalProducedInPeriod;
            cumulativeGoal += numericGoal;
            cumulativeEfficiencySum += efficiency;
            const cumulativeEfficiency = parseFloat((cumulativeEfficiencySum / (index + 1)).toFixed(2));
            return { ...item, produced:totalProducedInPeriod, goal:numericGoal, goalForDisplay, producedForDisplay, efficiency, cumulativeProduction, cumulativeGoal, cumulativeEfficiency };
        });
    }, [isTraveteDashboard, productionData, productMapForSelectedDate]);

    const traveteProcessedData = useMemo(() => {
        if (!isTraveteDashboard || !productionData || productionData.length === 0) return [];

        let cumulativeMeta = [];
        let cumulativeProduction = [];
        let cumulativeEfficiencySum = [];
        let cumulativeEntryCounts = [];

        return [...productionData]
            .sort((a, b) => (a.period || "").localeCompare(b.period || ""))
            .map((entry) => {
                const availableTime = parseFloat(entry.availableTime) || 0;

                const storedGoalBlocks = Array.isArray(entry.traveteGoalBlocks) ? entry.traveteGoalBlocks : null;
                const storedLotBlocks = Array.isArray(entry.traveteLotBlocks) ? entry.traveteLotBlocks : null;
                const entryGoalSegments = splitTraveteGoalSegments(entry.goalDisplay || '');

                const employees = (entry.employeeEntries || []).map((emp, empIndex) => {
                    const productsArray = getEmployeeProducts(emp);
                    const producedValue = sumProducedQuantities(productsArray, emp.produced);
                    const firstProduct = findFirstProductDetail(productsArray, emp);
                    const { product } = resolveProductReference(emp, firstProduct, productMapForSelectedDate);
                    const standardTime = resolveEmployeeStandardTime(emp, firstProduct, product);
                    const meta = computeMetaFromStandardTime(standardTime, availableTime);
                    const efficiency = computeEfficiencyPercentage(producedValue, standardTime, availableTime);

                    cumulativeMeta[empIndex] = (cumulativeMeta[empIndex] || 0) + meta;
                    cumulativeProduction[empIndex] = (cumulativeProduction[empIndex] || 0) + producedValue;
                    cumulativeEfficiencySum[empIndex] = (cumulativeEfficiencySum[empIndex] || 0) + efficiency;
                    cumulativeEntryCounts[empIndex] = (cumulativeEntryCounts[empIndex] || 0) + 1;

                    const entriesCount = cumulativeEntryCounts[empIndex] || 1;
                    const cumulativeEfficiency = parseFloat(((cumulativeEfficiencySum[empIndex] || 0) / entriesCount).toFixed(2));
                    const productNames = buildProductNames(productsArray, productMapForSelectedDate);

                    const goalBlock = storedGoalBlocks?.[empIndex] || null;
                    const lotBlock = storedLotBlocks?.[empIndex] || null;
                    const entryGoalDisplay = entryGoalSegments[empIndex] || '';
                    const fallbackGoalDisplay = entryGoalDisplay || (meta > 0 ? meta.toLocaleString('pt-BR') : '-');
                    const goalDisplayForEmployee = formatGoalBlockDisplay(goalBlock, fallbackGoalDisplay, meta);

                    const lotFallbackLabel = (productNames || product?.name) ? (productNames || product?.name) : '-';
                    const lotDisplayForEmployee = formatTraveteLotDisplay(lotBlock, lotFallbackLabel);

                    const producedSegments = buildNumericSegments(productsArray);
                    const producedDisplay = formatSegmentedNumbers(producedSegments, producedValue);

                    return {
                        ...emp,
                        produced: producedValue,
                        producedDisplay,
                        standardTime,
                        meta,
                        efficiency,
                        cumulativeMeta: cumulativeMeta[empIndex] || 0,
                        cumulativeProduced: cumulativeProduction[empIndex] || 0,
                        cumulativeEfficiency,
                        productName: productNames || product?.name || '',
                        metaDisplay: goalDisplayForEmployee,
                        lotDisplay: lotDisplayForEmployee,
                    };
                });

                return {
                    ...entry,
                    employees,
                };
            });
    }, [isTraveteDashboard, productionData, productMapForSelectedDate]);
 useMemo(() => {
        if (!isTraveteDashboard || !productionData || productionData.length === 0) return [];

        let cumulativeMeta = [];
        let cumulativeProduction = [];
        let cumulativeEfficiencySum = [];
        let cumulativeEntryCounts = [];

        return [...productionData]
            .sort((a, b) => (a.period || "").localeCompare(b.period || ""))
            .map((entry) => {
                const availableTime = parseFloat(entry.availableTime) || 0;

                const storedGoalBlocks = Array.isArray(entry.traveteGoalBlocks) ? entry.traveteGoalBlocks : null;
                const storedLotBlocks = Array.isArray(entry.traveteLotBlocks) ? entry.traveteLotBlocks : null;

                const employees = (entry.employeeEntries || []).map((emp, empIndex) => {
                    const productsArray = getEmployeeProducts(emp);
                    const producedValue = sumProducedQuantities(productsArray, emp.produced);
                    const firstProduct = findFirstProductDetail(productsArray, emp);
                    const { product } = resolveProductReference(emp, firstProduct, productMapForSelectedDate);
                    const standardTime = resolveEmployeeStandardTime(emp, firstProduct, product);
                    const meta = computeMetaFromStandardTime(standardTime, availableTime);
                    const efficiency = computeEfficiencyPercentage(producedValue, standardTime, availableTime);

                    cumulativeMeta[empIndex] = (cumulativeMeta[empIndex] || 0) + meta;
                    cumulativeProduction[empIndex] = (cumulativeProduction[empIndex] || 0) + producedValue;
                    cumulativeEfficiencySum[empIndex] = (cumulativeEfficiencySum[empIndex] || 0) + efficiency;
                    cumulativeEntryCounts[empIndex] = (cumulativeEntryCounts[empIndex] || 0) + 1;

                    const entriesCount = cumulativeEntryCounts[empIndex] || 1;
                    const cumulativeEfficiency = parseFloat(((cumulativeEfficiencySum[empIndex] || 0) / entriesCount).toFixed(2));
                    const productNames = buildProductNames(productsArray, productMapForSelectedDate);

                    const goalBlock = storedGoalBlocks?.[empIndex] || null;
                    const lotBlock = storedLotBlocks?.[empIndex] || null;
                    const fallbackGoalDisplay = meta > 0 ? meta.toLocaleString('pt-BR') : '-';
                    const goalDisplayForEmployee = formatGoalBlockDisplay(goalBlock, fallbackGoalDisplay, meta);

                    const lotFallbackLabel = (productNames || product?.name) ? (productNames || product?.name) : '-';
                    const lotDisplayForEmployee = formatTraveteLotDisplay(lotBlock, lotFallbackLabel);

                    return {
                        ...emp,
                        produced: producedValue,
                        standardTime,
                        meta,
                        efficiency,
                        cumulativeMeta: cumulativeMeta[empIndex] || 0,
                        cumulativeProduced: cumulativeProduction[empIndex] || 0,
                        cumulativeEfficiency,
                        productName: productNames || product?.name || '',
                        metaDisplay: goalDisplayForEmployee,
                        lotDisplay: lotDisplayForEmployee,
                    };
                });

                const metaBlockStrings = employees.length > 0
                    ? employees.map(emp => emp.metaDisplay || '-')
                    : [];
                const goalDisplay = entry.goalDisplay || (metaBlockStrings.length > 0 ? metaBlockStrings.join(' // ') : '- // -');
                const lotBlockStrings = employees.length > 0
                    ? employees.map(emp => emp.lotDisplay || '-')
                    : [];
                const lotDisplay = entry.lotDisplay || (lotBlockStrings.length > 0 ? lotBlockStrings.join(' // ') : '- // -');

                const producedDisplay = employees.length > 0
                    ? employees.map(emp => (emp.produced || 0).toLocaleString('pt-BR')).join(' // ')
                    : '0 // 0';

                const efficiencyDisplay = employees.length > 0
                    ? employees.map(emp => `${Number(emp.efficiency || 0).toFixed(2)}%`).join(' // ')
                    : '0% // 0%';

                const cumulativeMetaDisplay = employees.length > 0
                    ? employees.map(emp => (emp.cumulativeMeta || 0).toLocaleString('pt-BR')).join(' // ')
                    : '0 // 0';

                const cumulativeProducedDisplay = employees.length > 0
                    ? employees.map(emp => (emp.cumulativeProduced || 0).toLocaleString('pt-BR')).join(' // ')
                    : '0 // 0';

                const cumulativeEfficiencyDisplay = employees.length > 0
                    ? employees.map(emp => `${Number(emp.cumulativeEfficiency || 0).toFixed(2)}%`).join(' // ')
                    : '0% // 0%';

                const totalMeta = employees.reduce((sum, emp) => sum + (emp.meta || 0), 0);
                const totalProduced = employees.reduce((sum, emp) => sum + (emp.produced || 0), 0);
                const totalEfficiency = employees.length > 0
                    ? parseFloat((employees.reduce((sum, emp) => sum + (emp.efficiency || 0), 0) / employees.length).toFixed(2))
                    : 0;
                const totalCumulativeMeta = employees.reduce((sum, emp) => sum + (emp.cumulativeMeta || 0), 0);
                const totalCumulativeProduced = employees.reduce((sum, emp) => sum + (emp.cumulativeProduced || 0), 0);
                const totalCumulativeEfficiency = employees.length > 0
                    ? parseFloat((employees.reduce((sum, emp) => sum + (emp.cumulativeEfficiency || 0), 0) / employees.length).toFixed(2))
                    : 0;

                return {
                    ...entry,
                    employees,
                    goalDisplay,
                    producedDisplay,
                    efficiencyDisplay,
                    cumulativeMetaDisplay,
                    cumulativeProducedDisplay,
                    cumulativeEfficiencyDisplay,
                    lotDisplay,
                    totalMeta,
                    totalProduced,
                    totalEfficiency,
                    totalCumulativeMeta,
                    totalCumulativeProduced,
                    totalCumulativeEfficiency,
                    goalForDisplay: goalDisplay,
                };
            });
    }, [isTraveteDashboard, productionData, productMapForSelectedDate]);

    const traveteDataByPeriod = useMemo(() => {
        if (!isTraveteDashboard) return {};
        return traveteProcessedData.reduce((acc, entry) => {
            if (entry?.period) {
                acc[entry.period] = entry;
            }
            return acc;
        }, {});
    }, [isTraveteDashboard, traveteProcessedData]);
    
    const prevProductionData = usePrevious(productionData);
    
    useEffect(() => {
        if (prevProductionData && productionData.length > prevProductionData.length) {
            if (isTraveteDashboard) {
                const newTraveteEntry = traveteProcessedData[traveteProcessedData.length - 1];
                const efficiencyToCheck = newTraveteEntry?.totalEfficiency ?? 0;
                if (newTraveteEntry && efficiencyToCheck < 65) {
                    setShowFullScreenAlert(true);
                }
            } else {
                const newEntry = processedData[processedData.length - 1];
                if (newEntry && newEntry.efficiency < 65) {
                    setShowFullScreenAlert(true);
                }
            }
        }
    }, [productionData, prevProductionData, processedData, traveteProcessedData, isTraveteDashboard]);

    useEffect(() => {
        if (showFullScreenAlert) {
            const timer = setTimeout(() => {
                setShowFullScreenAlert(false);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [showFullScreenAlert]);


    const monthlySummary = useMemo(() => {
        const referenceDate = new Date(selectedDate);
        const year = referenceDate.getFullYear();
        const month = referenceDate.getMonth();

        if (isTraveteDashboard) {
            let totalMonthlyProduction = 0;
            let totalMonthlyGoal = 0;
            let totalDailyEfficiency = 0;
            let productiveDaysCount = 0;

            Object.keys(allProductionData).forEach(dateStr => {
                try {
                    const date = new Date(dateStr + "T00:00:00");
                    if (date.getFullYear() !== year || date.getMonth() !== month) return;

                    const productsForDateMap = new Map(products
                        .map(p => {
                            const validTimeEntry = p.standardTimeHistory?.filter(h => new Date(h.effectiveDate) <= date).pop();
                            if (!validTimeEntry) return null;
                            return [p.id, { ...p, standardTime: validTimeEntry.time }];
                        })
                        .filter(Boolean));

                    const dayData = allProductionData[dateStr];
                    if (!dayData || dayData.length === 0) return;

                    let dayMetaPerEmployee = [];
                    let dayProductionPerEmployee = [];
                    let dayEfficiencyPerEmployee = [];

                    dayData.forEach(entry => {
                        (entry.employeeEntries || []).forEach((emp, index) => {
                            const producedFromDetails = (emp.productionDetails || []).reduce((sum, detail) => sum + (detail.produced || 0), 0);
                            const produced = emp.produced !== undefined ? parseInt(emp.produced, 10) || 0 : producedFromDetails;
                            const product = productsForDateMap.get(emp.productId);
                            const standardTime = product?.standardTime || 0;
                            const availableTime = entry.availableTime || 0;
                            const meta = (standardTime > 0 && availableTime > 0) ? Math.round(availableTime / standardTime) : 0;
                            const efficiency = (standardTime > 0 && availableTime > 0 && produced > 0)
                                ? (produced * standardTime) / availableTime * 100
                                : 0;

                            dayMetaPerEmployee[index] = (dayMetaPerEmployee[index] || 0) + meta;
                            dayProductionPerEmployee[index] = (dayProductionPerEmployee[index] || 0) + produced;
                            dayEfficiencyPerEmployee[index] = (dayEfficiencyPerEmployee[index] || 0) + efficiency;
                        });
                    });

                    const employeesCount = Math.max(dayMetaPerEmployee.length, dayEfficiencyPerEmployee.length);
                    if (employeesCount > 0) {
                        productiveDaysCount++;
                        totalMonthlyGoal += dayMetaPerEmployee.reduce((sum, value) => sum + (value || 0), 0);
                        totalMonthlyProduction += dayProductionPerEmployee.reduce((sum, value) => sum + (value || 0), 0);
                        const dailyAverageEfficiency = dayEfficiencyPerEmployee.reduce((sum, value) => sum + (value || 0), 0) /
                            (employeesCount * (dayData.length || 1));
                        totalDailyEfficiency += dailyAverageEfficiency || 0;
                    }
                } catch (e) {
                    console.error("Data inválida no sumário mensal:", dateStr);
                }
            });

            const averageMonthlyEfficiency = productiveDaysCount > 0
                ? parseFloat((totalDailyEfficiency / productiveDaysCount).toFixed(2))
                : 0;

            return { totalProduction: totalMonthlyProduction, totalGoal: totalMonthlyGoal, averageEfficiency: averageMonthlyEfficiency };
        }

        let totalMonthlyProduction = 0, totalMonthlyGoal = 0, totalDailyAverageEfficiencies = 0, productiveDaysCount = 0;

        Object.keys(allProductionData).forEach(dateStr => {
            try {
                const date = new Date(dateStr + "T00:00:00");
                const productsForDateMap = new Map(products
                    .map(p => {
                        const validTimeEntry = p.standardTimeHistory?.filter(h => new Date(h.effectiveDate) <= date).pop();
                        if (!validTimeEntry) return null;
                        return [p.id, { ...p, standardTime: validTimeEntry.time }];
                    })
                    .filter(Boolean));
                if(date.getFullYear() === year && date.getMonth() === month) {
                    const dayData = allProductionData[dateStr];
                    if (dayData && dayData.length > 0) {
                        productiveDaysCount++;
                        let dailyProduction = 0, dailyGoal = 0, dailyEfficiencySum = 0;
                        dayData.forEach(item => {
                            let periodProduction = 0, totalTimeValue = 0;
                            (item.productionDetails || []).forEach(detail => {
                                periodProduction += (detail.produced || 0);
                                const product = productsForDateMap.get(detail.productId);
                                if (product?.standardTime) totalTimeValue += (detail.produced || 0) * product.standardTime;
                            });
                            if (item.goalDisplay) dailyGoal += sumGoalDisplay(item.goalDisplay);
                            dailyProduction += periodProduction;
                            const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
                            dailyEfficiencySum += totalAvailableTime > 0 ? (totalTimeValue / totalAvailableTime) * 100 : 0;
                        });
                        totalDailyAverageEfficiencies += dayData.length > 0 ? dailyEfficiencySum / dayData.length : 0;
                        totalMonthlyProduction += dailyProduction;
                        totalMonthlyGoal += dailyGoal;
                    }
                }
            } catch(e) { console.error("Data inválida no sumário mensal:", dateStr); }
        });
        const averageMonthlyEfficiency = productiveDaysCount > 0 ? parseFloat((totalDailyAverageEfficiencies / productiveDaysCount).toFixed(2)) : 0;
        return { totalProduction: totalMonthlyProduction, totalGoal: totalMonthlyGoal, averageEfficiency: averageMonthlyEfficiency };
    }, [isTraveteDashboard, allProductionData, selectedDate, products]);

    const handleNextDash = () => {
        const i = dashboards.findIndex(d=>d.id===currentDashboardId);
        const nextId = dashboards[(i+1)%dashboards.length].id;
        changeDashboard(nextId);
    };
    const handlePrevDash = () => {
        const i = dashboards.findIndex(d=>d.id===currentDashboardId);
        const prevId = dashboards[(i-1+dashboards.length)%dashboards.length].id;
        changeDashboard(prevId);
    };
    
    const renderTvTable = () => {
        if (isTraveteDashboard) {
            const getPeopleTimeValue = (period) => {
                const entry = traveteDataByPeriod[period];
                if (entry) {
                    const peopleCount = entry.employeeEntries?.length || entry.people || entry.employees?.length || 0;
                    const availableTime = entry.availableTime || 0;
                    return `${peopleCount} / ${availableTime} min`;
                }
                if (isTodaySelected && previewData && previewData.period === period) {
                    const peopleCount = previewData.people || (previewData.employeeEntries?.length || 0);
                    const availableTime = previewData.availableTime || 0;
                    return `${peopleCount} / ${availableTime} min`;
                }
                return '- / -';
            };

            const getAlteracaoValue = (period) => {
                const entry = traveteDataByPeriod[period];
                if (entry) {
                    if (entry.lotDisplay) {
                        return entry.lotDisplay;
                    }
                    if (entry.employees?.length) {
                        const names = entry.employees
                            .map(emp => emp.lotDisplay || emp.productName || '')
                            .filter(Boolean);
                        if (names.length) {
                            return names.join(' // ');
                        }
                    }
                }
                if (isTodaySelected && previewData && previewData.period === period) {
                    if (previewData.lotDisplayName) {
                        return previewData.lotDisplayName;
                    }
                    const previewNames = (previewData.employeeEntries || [])
                        .map(emp => {
                            const productLots = (emp.products || [])
                                .map(item => item.lotName || '')
                                .filter(Boolean)
                                .join(' / ');
                            if (productLots) return productLots;
                            return emp.machineType;
                        })
                        .filter(Boolean);
                    if (previewNames.length) {
                        return previewNames.join(' // ');
                    }
                }
                return '-';
            };

            const formatTraveteEmployeeProduction = (employee) => {
                const productDetails = Array.isArray(employee.products) && employee.products.length > 0
                    ? employee.products
                    : (employee.productionDetails || []);

                if (productDetails.length > 0) {
                    const producedSegments = productDetails.map(detail => parseInt(detail.produced, 10) || 0);
                    const sanitizedSegments = producedSegments.filter((value, idx) => (idx === 0) || value > 0);

                    if (sanitizedSegments.length > 1) {
                        return sanitizedSegments
                            .map(value => value.toLocaleString('pt-BR'))
                            .join(' / ');
                    }

                    if (sanitizedSegments.length === 1) {
                        return sanitizedSegments[0].toLocaleString('pt-BR');
                    }
                }

                const producedValue = employee.produced !== undefined
                    ? parseInt(employee.produced, 10) || 0
                    : 0;

                return producedValue.toLocaleString('pt-BR');
            };

            const joinTraveteEmployees = (entry, mapper, fallbackValue = '-') => {
                const employees = entry?.employees || [];
                if (employees.length === 0) {
                    return null;
                }

                const formattedValues = employees.map((employee, index) => {
                    const rawValue = mapper(employee, index);
                    if (rawValue === null || rawValue === undefined) {
                        return '';
                    }
                    if (typeof rawValue === 'number') {
                        return rawValue.toLocaleString('pt-BR');
                    }
                    return String(rawValue);
                });

                const hasContent = formattedValues.some(value => value !== '');
                if (!hasContent) {
                    if (fallbackValue === null) {
                        return null;
                    }
                    return employees.map(() => fallbackValue).join(' // ');
                }

                return formattedValues.map(value => (value === '' ? fallbackValue : value)).join(' // ');
            };

            const getTraveteCellContent = (period, rowKey) => {
                const entry = traveteDataByPeriod[period];
                if (entry) {
                    switch (rowKey) {
                        case 'goalDisplay': {
                            const directValue = entry.goalDisplay;
                            if (directValue) return directValue;
                            const fallback = joinTraveteEmployees(entry, (emp) => {
                                if (emp.metaDisplay) return emp.metaDisplay;
                                if (typeof emp.meta === 'number' && emp.meta > 0) {
                                    return emp.meta;
                                }
                                return null;
                            });
                            return fallback || '-';
                        }
                        case 'producedDisplay': {
                            const directValue = entry.producedDisplay;
                            if (directValue) return directValue;
                            const fallback = joinTraveteEmployees(entry, (emp) => {
                                if (emp.producedDisplay) return emp.producedDisplay;
                                return formatTraveteEmployeeProduction(emp);
                            }, '0');
                            return fallback || '0 // 0';
                        }
                        case 'efficiencyDisplay': {
                            const directValue = entry.efficiencyDisplay;
                            if (directValue) return directValue;
                            const fallback = joinTraveteEmployees(entry, (emp) => {
                                const raw = typeof emp.efficiency === 'number'
                                    ? emp.efficiency
                                    : parseFloat(emp.efficiency);
                                const value = Number.isFinite(raw) ? raw : 0;
                                return `${value.toFixed(2)}%`;
                            }, '0%');
                            return fallback || '0% // 0%';
                        }
                        case 'cumulativeMetaDisplay': {
                            const directValue = entry.cumulativeMetaDisplay;
                            if (directValue) return directValue;
                            const fallback = joinTraveteEmployees(entry, (emp) => {
                                const raw = typeof emp.cumulativeMeta === 'number'
                                    ? emp.cumulativeMeta
                                    : parseInt(emp.cumulativeMeta, 10);
                                const value = Number.isFinite(raw) ? raw : 0;
                                return value;
                            }, '0');
                            return fallback || '0 // 0';
                        }
                        case 'cumulativeProducedDisplay': {
                            const directValue = entry.cumulativeProducedDisplay;
                            if (directValue) return directValue;
                            const fallback = joinTraveteEmployees(entry, (emp) => {
                                const raw = typeof emp.cumulativeProduced === 'number'
                                    ? emp.cumulativeProduced
                                    : parseInt(emp.cumulativeProduced, 10);
                                const value = Number.isFinite(raw) ? raw : 0;
                                return value;
                            }, '0');
                            return fallback || '0 // 0';
                        }
                        case 'cumulativeEfficiencyDisplay': {
                            const directValue = entry.cumulativeEfficiencyDisplay;
                            if (directValue) return directValue;
                            const fallback = joinTraveteEmployees(entry, (emp) => {
                                const raw = typeof emp.cumulativeEfficiency === 'number'
                                    ? emp.cumulativeEfficiency
                                    : parseFloat(emp.cumulativeEfficiency);
                                const value = Number.isFinite(raw) ? raw : 0;
                                return `${value.toFixed(2)}%`;
                            }, '0%');
                            return fallback || '0% // 0%';
                        }
                        default:
                            return '-';
                    }
                }
                if (rowKey === 'goalDisplay' && isTodaySelected && previewData && previewData.period === period) {
                    return previewData.goalDisplay || '-';
                }
                return '-';
            };

            const traveteRows = [
                { key: 'goalDisplay', label: 'Meta', highlight: 'text-blue-600', previewHighlight: 'text-yellow-500' },
                { key: 'producedDisplay', label: 'Produção' },
                { key: 'efficiencyDisplay', label: 'Eficiência', isColor: true, getValues: (entry) => entry.employees?.map(emp => emp.efficiency || 0) || [] },
                { key: 'cumulativeMetaDisplay', label: 'Meta Acum.' },
                { key: 'cumulativeProducedDisplay', label: 'Prod. Acum.' },
                { key: 'cumulativeEfficiencyDisplay', label: 'Efic. Acum.', isColor: true, getValues: (entry) => entry.employees?.map(emp => emp.cumulativeEfficiency || 0) || [] },
                { key: 'monthlyGoal', label: 'Meta Mês', isMonthly: true, value: monthlySummary.totalGoal.toLocaleString('pt-BR') },
                { key: 'monthlyProduction', label: 'Prod. Mês', isMonthly: true, value: monthlySummary.totalProduction.toLocaleString('pt-BR') },
                { key: 'monthlyEfficiency', label: 'Efic. Mês', isMonthly: true, isColor: true, value: `${monthlySummary.averageEfficiency}%` },
            ];

            const shouldWarnLowEfficiency = (entry) => entry?.employees?.some(emp => (emp.efficiency || 0) < 70);

            return (
                <div className="overflow-x-auto w-full text-center p-6 border-4 border-blue-900 rounded-xl shadow-2xl bg-white text-gray-900 responsive-tv">
                    <table className="min-w-full table-fixed">
                        <thead className="text-white bg-blue-500">
                            <tr>
                                <th colSpan={FIXED_PERIODS.length + 1} className="p-4 text-5xl relative">
                                    <div className="absolute top-2 left-2 flex items-center gap-2">
                                        <button onClick={stopTvMode} className="p-2 bg-red-600 text-white rounded-full flex items-center gap-1 text-sm"><XCircle size={18} /> SAIR</button>
                                        {!isCarousel && (
                                            <>
                                                <button onClick={handlePrevDash} className="p-2 bg-blue-700 text-white rounded-full"><ArrowLeft size={18} /></button>
                                                <button onClick={handleNextDash} className="p-2 bg-blue-700 text-white rounded-full"><ArrowRight size={18} /></button>
                                            </>
                                        )}
                                    </div>
                                    {!isCarousel && (
                                        <div className="absolute top-2 right-2 flex items-center gap-2">
                                            <button onClick={handlePrevDay} className="px-3 py-1 bg-blue-700 text-white rounded-full text-sm">⬅ Dia anterior</button>
                                            <button onClick={handleNextDay} className="px-3 py-1 bg-blue-700 text-white rounded-full text-sm">Dia seguinte ➡</button>
                                        </div>
                                    )}
                                    {currentDashboard.name.toUpperCase()} - {selectedDateLabel}
                                </th>
                            </tr>
                            <tr>
                                <th className="p-2 text-left">Resumo</th>
                                {FIXED_PERIODS.map(period => {
                                    const entry = traveteDataByPeriod[period];
                                    const isPreviewSlot = !entry && previewData && previewData.period === period;
                                    return (
                                        <th key={period} className={`p-2 text-sm ${isPreviewSlot ? 'text-yellow-300' : ''}`}>
                                            {getPeopleTimeValue(period)}
                                        </th>
                                    );
                                })}
                            </tr>
                            <tr>
                                <th className="p-2 text-left">Alteração</th>
                                {FIXED_PERIODS.map(period => {
                                    const entry = traveteDataByPeriod[period];
                                    const isPreviewSlot = !entry && previewData && previewData.period === period;
                                    return (
                                        <th key={period} className={`p-2 text-base ${isPreviewSlot ? 'text-yellow-300' : ''}`}>
                                            {getAlteracaoValue(period)}
                                        </th>
                                    );
                                })}
                            </tr>
                            <tr>
                                <th className="p-3 text-left">Hora</th>
                                {FIXED_PERIODS.map(period => (
                                    <th key={period} className="p-3 text-3xl">{period}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="text-2xl divide-y divide-gray-200">
                            {traveteRows.map(row => (
                                <tr key={row.key} className={row.isMonthly ? 'bg-gray-100' : ''}>
                                    <td className="p-3 font-bold text-left sticky left-0 bg-gray-200">{row.label}</td>
                                    {row.isMonthly ? (
                                        <td colSpan={FIXED_PERIODS.length} className={`p-3 font-extrabold ${row.isColor ? (parseFloat(row.value) < 65 ? 'text-red-500' : 'text-green-600') : ''}`}>
                                            {row.value}
                                        </td>
                                    ) : (
                                        FIXED_PERIODS.map(period => {
                                            const entry = traveteDataByPeriod[period];
                                            const isPreviewSlot = !entry && isTodaySelected && previewData && previewData.period === period;
                                            let cellClass = 'p-3 font-extrabold';
                                            let cellContent = getTraveteCellContent(period, row.key);

                                            if (row.key === 'goalDisplay') {
                                                if (entry) {
                                                    cellClass += ` ${row.highlight}`;
                                                } else if (isPreviewSlot) {
                                                    cellClass += ` ${row.previewHighlight || 'text-yellow-500'}`;
                                                }
                                            } else if (row.isColor && entry && cellContent !== '-') {
                                                const values = row.getValues ? row.getValues(entry) : [];
                                                const hasLow = values.some(value => Number(value) < 65);
                                                cellClass += hasLow ? ' text-red-500' : ' text-green-600';
                                            }

                                            const warningNeeded = row.key === 'producedDisplay' && entry && shouldWarnLowEfficiency(entry);

                                            return (
                                                <td key={period} className={cellClass}>
                                                    {warningNeeded && (
                                                        <span role="img" aria-label="Alerta" className="text-yellow-400 text-3xl">⚠️ </span>
                                                    )}
                                                    {cellContent}
                                                </td>
                                            );
                                        })
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }

        const dataByPeriod = processedData.reduce((acc, curr) => ({ ...acc, [curr.period]: curr }), {});

        const getPeopleTimeValue = (p) => dataByPeriod[p] ? `${dataByPeriod[p].people} / ${dataByPeriod[p].availableTime} min` : '- / -';
        const getProductionValue = (p) => dataByPeriod[p]?.producedForDisplay || '-';
        const getAlteracaoValue = (p) => {
            const launched = dataByPeriod[p];
            if (launched && launched.productionDetails?.length > 0) {
                return launched.productionDetails.map(d => productMapForSelectedDate.get(d.productId)?.name).filter(Boolean).join(' / ');
            }
            if (isTodaySelected && previewData && previewData.period === p) {
                return previewData.productName;
            }
            return '-';
        };

        const TV_ROWS = [
            { key: 'meta', label: 'Meta', formatter: (p) => dataByPeriod[p]?.goalForDisplay || dataByPeriod[p]?.goal || '-' },
            { key: 'producedForDisplay', label: 'Produção', formatter: getProductionValue },
            { key: 'efficiency', label: 'Eficiência', isColor: true, formatter: (p) => dataByPeriod[p] ? `${dataByPeriod[p].efficiency}%` : '-' },
            { key: 'cumulativeGoal', label: 'Meta Acum.', formatter: (p) => dataByPeriod[p]?.cumulativeGoal.toLocaleString('pt-BR') || '-' },
            { key: 'cumulativeProduction', label: 'Prod. Acum.', formatter: (p) => dataByPeriod[p]?.cumulativeProduction.toLocaleString('pt-BR') || '-' },
            { key: 'cumulativeEfficiency', label: 'Efic. Acum.', isColor: true, formatter: (p) => dataByPeriod[p] ? `${dataByPeriod[p].cumulativeEfficiency}%` : '-' },
            { key: 'monthlyGoal', label: 'Meta Mês', isMonthly: true, value: monthlySummary.totalGoal.toLocaleString('pt-BR') },
            { key: 'monthlyProduction', label: 'Prod. Mês', isMonthly: true, value: monthlySummary.totalProduction.toLocaleString('pt-BR') },
            { key: 'monthlyEfficiency', label: 'Efic. Mês', isMonthly: true, isColor: true, value: `${monthlySummary.averageEfficiency}%` },
        ];

        return (
            <div className="overflow-x-auto w-full text-center p-6 border-4 border-blue-900 rounded-xl shadow-2xl bg-white text-gray-900">
                <table className="min-w-full table-fixed">
                    <thead className="text-white bg-blue-500">
                        <tr><th colSpan={FIXED_PERIODS.length + 1} className="p-4 text-5xl relative">
                            <div className="absolute top-2 left-2 flex items-center gap-2">
                                <button onClick={stopTvMode} className="p-2 bg-red-600 text-white rounded-full flex items-center gap-1 text-sm"><XCircle size={18} /> SAIR</button>
                                {!isCarousel && (
                                    <>
                                        <button onClick={handlePrevDash} className="p-2 bg-blue-700 text-white rounded-full"><ArrowLeft size={18} /></button>
                                        <button onClick={handleNextDash} className="p-2 bg-blue-700 text-white rounded-full"><ArrowRight size={18} /></button>
                                    </>
                                )}
                            </div>
                            {!isCarousel && (
                                <div className="absolute top-2 right-2 flex items-center gap-2">
                                    <button onClick={handlePrevDay} className="px-3 py-1 bg-blue-700 text-white rounded-full text-sm">⬅ Dia anterior</button>
                                    <button onClick={handleNextDay} className="px-3 py-1 bg-blue-700 text-white rounded-full text-sm">Dia seguinte ➡</button>
                                </div>
                            )}
                            {currentDashboard.name.toUpperCase()} - {selectedDateLabel}
                        </th></tr>
                        <tr><th className="p-2 text-left">Resumo</th>{FIXED_PERIODS.map(p => <th key={p} className="p-2 text-sm">{getPeopleTimeValue(p)}</th>)}</tr>
                        <tr><th className="p-2 text-left">Alteração</th>{FIXED_PERIODS.map(p => {
                            const launched = dataByPeriod[p];
                            const isPreviewSlot = isTodaySelected && previewData && previewData.period === p && !launched;
                              return (<th key={p} className={`p-2 text-base ${isPreviewSlot ? 'text-yellow-300' : ''}`}>{getAlteracaoValue(p)}</th>);
                        })}</tr>
                        <tr><th className="p-3 text-left">Hora</th>{FIXED_PERIODS.map(p => <th key={p} className="p-3 text-3xl">{p}</th>)}</tr>
                    </thead>
                    <tbody className="text-2xl divide-y divide-gray-200">
                        {TV_ROWS.map(row => (
                            <tr key={row.key} className={row.isMonthly ? 'bg-gray-100' : ''}>
                                <td className="p-3 font-bold text-left sticky left-0 bg-gray-200">{row.label}</td>
                                {row.isMonthly ? (
                                    <td colSpan={FIXED_PERIODS.length} className={`p-3 font-extrabold ${row.isColor ? (parseFloat(row.value) < 65 ? 'text-red-500' : 'text-green-600') : ''}`}>{row.value}</td>
                                ) : (
                                    FIXED_PERIODS.map(p => {
                                        const launched = dataByPeriod[p];
                                        let cellContent, cellClass = 'p-3 font-extrabold';

                                        if (row.key === 'meta') {
                                            if (launched) {
                                                cellContent = launched.goalForDisplay;
                                                cellClass += ' text-blue-600';
                                            } else if (previewData && previewData.period === p) {
                                                cellContent = previewData.goalDisplay;
                                                cellClass += ' text-yellow-500';
                                            } else {
                                                cellContent = '-';
                                            }
                                        } else {
                                            cellContent = row.formatter(p);
                                            if (row.isColor && cellContent !== '-') {
                                                const numericVal = dataByPeriod[p]?.[row.key];
                                                cellClass += parseFloat(numericVal) < 65 ? ' text-red-500' : ' text-green-600';
                                            }
                                        }

                                        const efficiency = dataByPeriod[p]?.efficiency;

                                        return <td key={p} className={cellClass}>
                                            {row.key === 'producedForDisplay' && launched && efficiency != null && efficiency < 70 && (
                                              <span role="img" aria-label="Alerta" className="text-yellow-400 text-3xl">⚠️ </span>
                                            )}
                                            {cellContent}
                                        </td>;
                                    })
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    if (!currentDashboard) {
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p className="text-xl">Carregando...</p></div>;
    }

    return (
        <div className="min-h-screen p-4 md:p-8 bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center font-sans space-y-8">
            <FullScreenAlert isOpen={showFullScreenAlert} />
            <div className={`w-full transition-opacity duration-300 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
                {renderTvTable()}
            </div>
            <p className="text-sm text-gray-500 mt-4">Última atualização: {new Date().toLocaleTimeString('pt-BR')}</p>
        </div>
    );
};


// #####################################################################
// #                                                                   #
// #               COMPONENTE RAIZ E LÓGICA DE NAVEGAÇÃO               #
// #                                                                   #
// #####################################################################

const AppContent = () => {
    const { user, loading } = useAuth();
    const [currentApp, setCurrentApp] = useState('cronoanalise');
    const [tvMode, setTvMode] = useState(null);
    const [currentDashboardIndex, setCurrentDashboardIndex] = useState(() => {
        const savedIndex = localStorage.getItem('lastDashboardIndex');
        return savedIndex ? parseInt(savedIndex, 10) : 0;
    });

    const [dashboards, setDashboards] = useState([]);
    const [usersWithRoles, setUsersWithRoles] = useState([]);
    const [userPermissions, setUserPermissions] = useState({});

    useEffect(() => {
        localStorage.setItem('lastDashboardIndex', currentDashboardIndex);
    }, [currentDashboardIndex]);
    
    useEffect(() => {
        if (!user) {
            setUserPermissions({});
            setDashboards([]);
            setUsersWithRoles([]);
            return;
        }

        let unsubDashboards; 

        const setupDataAndListeners = async () => {
            try {
                // --- Etapa 1: Verificar e criar dashboards iniciais (apenas uma vez) ---
                const dashboardsQuery = query(collection(db, "dashboards"), orderBy("order"));
                const initialDashboardsSnap = await getDocs(dashboardsQuery);
                
                if (initialDashboardsSnap.empty) {
                    console.log("Nenhum dashboard encontrado, criando dados iniciais...");
                    const batch = writeBatch(db);
                    initialDashboards.forEach(dash => {
                        const docRef = doc(db, "dashboards", dash.id);
                        batch.set(docRef, dash);
                    });
                    await batch.commit();
                    console.log("Dashboards iniciais criados com sucesso.");
                }

                // --- Etapa 2: Iniciar o listener em tempo real para dashboards ---
                unsubDashboards = onSnapshot(dashboardsQuery, (snap) => {
                    const fetchedDashboards = snap.docs.map(d => d.data());
                    setDashboards(fetchedDashboards);
                }, (error) => {
                    console.error("Erro no listener de Dashboards:", error);
                });

                // --- Etapa 3: Buscar dados de usuários e permissões (apenas uma vez) ---
                const rolesSnap = await getDocs(collection(db, "roles"));
                const rolesData = new Map(rolesSnap.docs.map(d => [d.id, d.data()]));

                const usersSnap = await getDocs(collection(db, "users"));
                const usersData = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
                
                const combinedUsers = usersData.map(u => ({ ...u, permissions: rolesData.get(u.uid)?.permissions || [] }));
                setUsersWithRoles(combinedUsers);

                const currentUserPermissionsDoc = rolesData.get(user.uid);
                let permissionsList = currentUserPermissionsDoc?.permissions || [];
                
                if (currentUserPermissionsDoc?.role === 'admin') {
                     permissionsList = Object.keys(ALL_PERMISSIONS);
                }
                
                const permissionsMap = {};
                for (const key in ALL_PERMISSIONS) {
                    permissionsMap[key] = permissionsList.includes(key);
                }
                
                setUserPermissions(permissionsMap);

            } catch (error) {
                console.error("ERRO CRÍTICO AO CONFIGURAR DADOS:", error);
            }
        };

        setupDataAndListeners();

        return () => {
            if (unsubDashboards) {
                unsubDashboards();
            }
        };
    }, [user]);


    const startTvMode = useCallback((options) => setTvMode(options), []);
    const stopTvMode = useCallback(() => setTvMode(null), []);

    if (loading) {
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p className="text-xl">Carregando autenticação...</p></div>;
    }
    
    if (!user) {
        return <LoginPage />;
    }

    if (dashboards.length === 0 || Object.keys(userPermissions).length === 0) {
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p className="text-xl">Carregando dados do usuário...</p></div>;
    }

    if (tvMode && currentApp === 'cronoanalise') {
        return <TvModeDisplay tvOptions={tvMode} stopTvMode={stopTvMode} dashboards={dashboards} />;
    }

    if (currentApp === 'stock') {
        return <StockManagementApp onNavigateToCrono={() => setCurrentApp('cronoanalise')} />;
    }

    if (currentApp === 'sequencia-operacional') {
        return (
            <OperationalSequenceApp
                onNavigateToCrono={() => setCurrentApp('cronoanalise')}
                onNavigateToStock={() => setCurrentApp('stock')}
                dashboards={dashboards}
                user={user}
            />
        );
    }

    return <CronoanaliseDashboard
        onNavigateToStock={() => setCurrentApp('stock')}
        onNavigateToOperationalSequence={() => setCurrentApp('sequencia-operacional')}
        user={user}
        permissions={userPermissions}
        startTvMode={startTvMode}
        dashboards={dashboards}
        users={usersWithRoles}
        roles={defaultRoles}
        currentDashboardIndex={currentDashboardIndex}
        setCurrentDashboardIndex={setCurrentDashboardIndex}
    />;
};

const App = () => {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
};


export default App;
