import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { PlusCircle, List, Edit, Trash2, Save, XCircle, ChevronLeft, ChevronRight, MessageSquare, Layers, ChevronUp, ChevronDown, Settings, Package, Monitor, ArrowLeft, ArrowRight, UserCog, BarChart, Film, Warehouse, Trash, ClipboardList } from 'lucide-react';
import { db, functions } from './firebase';
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
  where,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { StockManagementApp } from './modules/gerenciamentodeestoque';
import { OperationalSequenceApp } from './modules/sequenciaOperacional';
import ReportsModule from './modules/relatorios';
import FichaTecnicaModule from './modules/fichatecnica';
import { raceBullLogoUrl, initialDashboards, FIXED_PERIODS, TRAVETE_MACHINES, ALL_PERMISSIONS, defaultRoles } from './modules/constants';
import {
  generateId,
  GlobalStyles,
  ConfirmationModal,
  useClickOutside,
  usePrevious,
  usePersistedTheme,
  buildProductLookupMap,
  getEmployeeProducts,
  sumProducedQuantities,
  findFirstProductDetail,
  resolveProductReference,
  resolveEmployeeStandardTime,
} from './modules/shared';
import { applyBillOfMaterialsMovements, roundToFourDecimals, buildBillOfMaterialsMovementDetails } from './modules/billOfMaterials';
import { httpsCallable } from 'firebase/functions';
import SummaryCard from './components/SummaryCard';
import HeaderContainer from './components/HeaderContainer';
import GlobalNavigation from './components/GlobalNavigation';
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
  computeEfficiencyPercentage
} from './modules/producao';
import {
  createTraveteProductFormState,
  createDefaultTraveteProductItem,
  createDefaultTraveteEmployee,
  resolveTraveteLotBaseId,
  findTraveteVariationForLot,
  buildTraveteStandardTimePatch,
  applyTraveteAutoSuggestions,
  formatTraveteLotDisplayName,
  getTraveteBaseProductName,
  buildTraveteProcessedEntries,
} from './modules/travete';

// =====================================================================
// == CONSTANTES E FUNÇÕES AUXILIARES GLOBAIS ==
// =====================================================================


// #####################################################################
// #                                                                   #
// #               INÍCIO: COMPONENTES DE MODAIS E AUXILIARES            #
// #                                                                   #
// #####################################################################

const updateTraveteEmployeeField = ({
    employees = [],
    employeeIndex,
    field,
    value,
    lots,
    products,
    variationLookup,
    resetManualOnMachineChange = false,
}) => {
    return employees.map((emp, empIdx) => {
        if (empIdx !== employeeIndex) return emp;
        let updated = { ...emp };
        switch (field) {
            case 'machineType': {
                updated = {
                    ...updated,
                    machineType: value,
                    ...(resetManualOnMachineChange ? { standardTimeManual: false } : {}),
                };
                const firstLotId = (updated.products || []).find(item => item.lotId)?.lotId;
                const patch = buildTraveteStandardTimePatch({
                    employee: updated,
                    lotId: firstLotId,
                    machineType: value,
                    lots,
                    products,
                    variationLookup,
                    resetWhenMissing: true,
                });
                if (patch) {
                    updated = { ...updated, ...patch };
                }
                break;
            }
            case 'standardTime': {
                updated = {
                    ...updated,
                    standardTime: value,
                    standardTimeManual: value !== '',
                };
                break;
            }
            default: {
                updated = { ...updated, [field]: value };
            }
        }
        return updated;
    });
};

const updateTraveteEmployeeProducts = ({
    employees = [],
    employeeIndex,
    productIndex,
    field,
    value,
    lots,
    products,
    variationLookup,
}) => {
    return employees.map((emp, empIdx) => {
        if (empIdx !== employeeIndex) return emp;
        const productsArray = Array.isArray(emp.products) ? emp.products : [];
        const updatedProducts = productsArray.map((product, prodIdx) => {
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
                variationLookup,
            });
            if (patch) {
                updatedEmployee = { ...updatedEmployee, ...patch };
            }
        }
        return updatedEmployee;
    });
};

const appendTraveteProductRow = (employees = [], employeeIndex) => {
    return employees.map((emp, empIdx) => {
        if (empIdx !== employeeIndex) return emp;
        const existing = Array.isArray(emp.products) ? emp.products : [];
        return { ...emp, products: [...existing, createDefaultTraveteProductItem()] };
    });
};

const removeTraveteProductRow = (employees = [], employeeIndex, productIndex) => {
    return employees.map((emp, empIdx) => {
        if (empIdx !== employeeIndex) return emp;
        const existing = Array.isArray(emp.products) ? emp.products : [];
        const remaining = existing.filter((_, idx) => idx !== productIndex);
        return {
            ...emp,
            products: remaining.length > 0 ? remaining : [createDefaultTraveteProductItem()],
        };
    });
};

const createEmptyBillOfMaterialsItem = () => ({
    stockProductId: '',
    stockVariationId: '',
    quantityPerPiece: '',
    dashboardIds: [],
});

const normalizeBillOfMaterialsItems = (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    return items
        .map((item) => {
            const parsedQuantity = parseFloat(item?.quantityPerPiece);
            const safeQuantity = Number.isFinite(parsedQuantity) && parsedQuantity >= 0
                ? parseFloat(parsedQuantity.toFixed(4))
                : 0;
            const sanitizedDashboardIds = Array.isArray(item?.dashboardIds)
                ? Array.from(new Set(
                    item.dashboardIds
                        .map(id => (typeof id === 'string' ? id.trim() : ''))
                        .filter(Boolean),
                ))
                : [];
            const stockProductId = typeof item?.stockProductId === 'string' ? item.stockProductId : '';
            const stockVariationId = typeof item?.stockVariationId === 'string' ? item.stockVariationId : '';

            return {
                stockProductId,
                stockVariationId,
                quantityPerPiece: safeQuantity,
                dashboardIds: sanitizedDashboardIds,
            };
        })
        .filter(item => item.stockProductId && item.stockVariationId);
};

const mapBillOfMaterialsToDraft = (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    return items.map(item => ({
        stockProductId: typeof item?.stockProductId === 'string' ? item.stockProductId : '',
        stockVariationId: typeof item?.stockVariationId === 'string' ? item.stockVariationId : '',
        quantityPerPiece: item?.quantityPerPiece !== undefined && item?.quantityPerPiece !== null
            ? String(item.quantityPerPiece)
            : '',
        dashboardIds: Array.isArray(item?.dashboardIds)
            ? item.dashboardIds
                .map(id => (typeof id === 'string' ? id.trim() : ''))
                .filter(Boolean)
            : [],
    }));
};

const buildVariationBillOfMaterialsBackfill = (rawVariations = [], fallbackBillOfMaterials = []) => {
    if (!Array.isArray(rawVariations) || rawVariations.length === 0) {
        return { needsBackfill: false, variations: [] };
    }

    const normalizedFallback = normalizeBillOfMaterialsItems(fallbackBillOfMaterials);
    if (normalizedFallback.length === 0) {
        return { needsBackfill: false, variations: rawVariations };
    }

    let needsBackfill = false;
    const updatedVariations = rawVariations.map((variation) => {
        if (Array.isArray(variation?.billOfMaterials)) {
            return variation;
        }
        needsBackfill = true;
        return {
            ...variation,
            billOfMaterials: normalizedFallback.map(item => ({ ...item })),
        };
    });

    return { needsBackfill, variations: updatedVariations };
};

const createEmptyProductVariation = () => ({
    id: generateId('productVariation'),
    label: '',
    defaultTarget: '',
    billOfMaterials: [],
    usesDefaultBillOfMaterials: false,
});

const createEmptyLotFormState = () => ({
    productId: '',
    target: '',
    customName: '',
    variations: [],
});

const createEmptyLotEditState = () => ({
    target: '',
    customName: '',
    variations: [],
});

const parseLotQuantityValue = (value) => {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.floor(value));
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return 0;
        }
        const parsed = parseInt(trimmed, 10);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, parsed);
    }
    return 0;
};

const normalizeLotInputValue = (rawValue) => {
    if (rawValue === '') {
        return '';
    }

    const parsed = parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return '0';
    }

    return String(parsed);
};

const buildLotVariationKey = (variation, index = 0) => {
    if (!variation) {
        return `index::${index}`;
    }
    if (variation.variationKey) {
        return variation.variationKey;
    }
    if (variation.variationId) {
        return `id::${variation.variationId}`;
    }
    if (variation.id) {
        return `id::${variation.id}`;
    }
    const label = typeof variation.label === 'string' ? variation.label.trim().toLowerCase() : '';
    if (label) {
        return `label::${label}::${index}`;
    }
    return `index::${index}`;
};

const normalizeLotVariationState = (variation, index = 0, existing = null) => {
    const variationKey = buildLotVariationKey(variation, index);
    const existingProduced = existing ? existing.produced : '';
    return {
        variationId: variation?.variationId || variation?.id || '',
        variationKey,
        label: variation?.label || '',
        target: parseLotQuantityValue(variation?.target),
        produced: existingProduced || '',
        currentProduced: parseLotQuantityValue(variation?.produced),
    };
};

const buildProductionStateForLot = (lot, existingState = null, fallbackIndex = 0) => {
    const key = lot?.id || `product-${lot?.productId || fallbackIndex}`;
    const lotVariations = Array.isArray(lot?.variations) ? lot.variations : [];
    const existingVariationMap = new Map(
        Array.isArray(existingState?.variations)
            ? existingState.variations.map(item => [item.variationKey || buildLotVariationKey(item), item])
            : []
    );

    const normalizedVariations = lotVariations.map((variation, index) => {
        const variationKey = buildLotVariationKey(variation, index);
        const existing = existingVariationMap.get(variationKey) || null;
        return normalizeLotVariationState(variation, index, existing);
    });

    let totalProduced = '';
    if (normalizedVariations.length > 0) {
        const existingTotal = normalizedVariations.reduce((sum, variation) => {
            const value = parseInt(variation.produced, 10);
            if (!Number.isFinite(value)) {
                return sum;
            }
            return sum + Math.max(0, value);
        }, 0);
        totalProduced = existingTotal > 0 ? String(existingTotal) : '';
    } else if (existingState) {
        totalProduced = existingState.totalProduced || '';
    }

    return {
        key,
        lotId: lot?.id || existingState?.lotId || '',
        productId: lot?.productId || existingState?.productId || '',
        productName: lot?.productName || lot?.name || existingState?.productName || '',
        totalProduced,
        variations: normalizedVariations,
    };
};

const sumDetailVariationProduced = (variations = []) => {
    if (!Array.isArray(variations) || variations.length === 0) {
        return 0;
    }
    return variations.reduce((sum, variation) => {
        const value = parseInt(variation?.produced, 10);
        if (!Number.isFinite(value)) {
            return sum;
        }
        return sum + Math.max(0, value);
    }, 0);
};

const buildCompositeVariationKey = (lotId, variationKey) => `${lotId}|||${variationKey}`;

const splitCompositeVariationKey = (compositeKey = '') => {
    const [lotId, ...rest] = String(compositeKey).split('|||');
    return [lotId, rest.join('|||')];
};

const resolveLotForDetail = (detail, lots = []) => {
    if (!detail || !Array.isArray(lots)) {
        return null;
    }
    if (detail.lotId) {
        const byId = lots.find(lot => lot.id === detail.lotId);
        if (byId) {
            return byId;
        }
    }
    if (detail.productId) {
        const byProduct = lots.find(lot => lot.productId === detail.productId);
        if (byProduct) {
            return byProduct;
        }
    }
    return null;
};

const LotVariationSummary = ({ variations = [], title = 'Grade prevista' }) => {
    if (!Array.isArray(variations) || variations.length === 0) {
        return null;
    }

    return (
        <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-3 bg-white/50 dark:bg-gray-900/30 space-y-2">
            {title && (
                <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</span>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-gray-600 dark:text-gray-300">
                {variations.map((variation, index) => {
                    const label = variation?.label && variation.label.trim().length > 0
                        ? variation.label
                        : `Var. ${index + 1}`;
                    const producedValue = parseLotQuantityValue(variation?.produced);
                    const targetValue = parseLotQuantityValue(variation?.target);
                    const key = variation?.variationId || variation?.id || buildLotVariationKey(variation, index);
                    return (
                        <div
                            key={key}
                            className="flex items-center justify-between bg-white/70 dark:bg-gray-900/40 px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700"
                        >
                            <span className="font-medium text-sm truncate" title={label}>{label}</span>
                            <span>{producedValue} / {targetValue}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const computeLotTargetFromVariations = (variations = []) => {
    if (!Array.isArray(variations) || variations.length === 0) {
        return 0;
    }

    return variations.reduce((accumulator, variation) => {
        const value = parseLotQuantityValue(variation?.target);
        return accumulator + value;
    }, 0);
};

const mapProductVariationsToLotState = (productVariations = []) => {
    if (!Array.isArray(productVariations) || productVariations.length === 0) {
        return [];
    }

    return productVariations.map((variation, index) => {
        const variationId = typeof variation?.id === 'string' && variation.id.trim().length > 0
            ? variation.id.trim()
            : `variation-${index + 1}`;
        const label = typeof variation?.label === 'string' ? variation.label.trim() : '';
        const defaultTarget = parseLotQuantityValue(variation?.defaultTarget);

        return {
            variationId,
            label,
            target: defaultTarget > 0 ? String(defaultTarget) : '',
            produced: 0,
        };
    });
};

const sanitizeLotVariationsForStorage = (variations = []) => {
    if (!Array.isArray(variations) || variations.length === 0) {
        return [];
    }

    return variations
        .map((variation, index) => {
            const variationId = typeof variation?.variationId === 'string' && variation.variationId.trim().length > 0
                ? variation.variationId.trim()
                : typeof variation?.id === 'string' && variation.id.trim().length > 0
                    ? variation.id.trim()
                    : `variation-${index + 1}`;
            const variationKey = buildLotVariationKey(variation, index);
            const label = typeof variation?.label === 'string' ? variation.label.trim() : '';
            const target = parseLotQuantityValue(variation?.target);
            const produced = parseLotQuantityValue(variation?.produced);

            return {
                variationId,
                variationKey,
                label,
                target,
                produced,
            };
        })
        .filter(variation => variation.variationId || variation.label || variation.variationKey);
};

const buildLotProductionDetailsForBillOfMaterials = (lotData = {}) => {
    if (!lotData) {
        return [];
    }

    const productId = typeof lotData.productId === 'string' ? lotData.productId : '';
    const productBaseId = typeof lotData.productBaseId === 'string' ? lotData.productBaseId : '';

    const rawVariations = Array.isArray(lotData.variations) ? lotData.variations : [];
    const normalizedVariations = rawVariations
        .map((variation, index) => {
            const producedValue = parseLotQuantityValue(variation?.target ?? variation?.produced);
            if (producedValue <= 0) {
                return null;
            }
            const variationKey = variation?.variationKey || buildLotVariationKey(variation, index);
            return {
                ...variation,
                variationKey,
                produced: producedValue,
            };
        })
        .filter(Boolean);

    if (normalizedVariations.length > 0) {
        const totalProduced = normalizedVariations.reduce((sum, variation) => sum + variation.produced, 0);
        if (totalProduced <= 0) {
            return [];
        }
        return [
            {
                productId,
                productBaseId,
                produced: totalProduced,
                variations: normalizedVariations,
            },
        ];
    }

    const targetValue = parseLotQuantityValue(lotData?.target);
    if (targetValue <= 0) {
        return [];
    }

    return [
        {
            productId,
            productBaseId,
            produced: targetValue,
        },
    ];
};

const applyBillOfMaterialsForLotCreation = async ({
    lotData,
    productSources = [],
    stockProducts = [],
    user,
    dashboardId,
}) => {
    if (!lotData || !user) {
        return;
    }

    const productionDetails = buildLotProductionDetailsForBillOfMaterials(lotData);
    if (productionDetails.length === 0) {
        return;
    }

    const movementDetails = buildBillOfMaterialsMovementDetails({ updatedDetails: productionDetails });
    if (movementDetails.length === 0) {
        return;
    }

    const batch = writeBatch(db);

    applyBillOfMaterialsMovements({
        batch,
        productionDetails: movementDetails,
        productSources,
        stockProducts,
        sourceEntryId: lotData.id,
        user,
        movementTimestamp: Timestamp.now(),
        dashboardId,
    });

    try {
        await batch.commit();
    } catch (error) {
        console.error('Erro ao registrar baixas de materiais para o lote:', error);
    }
};

const mapLotVariationsToFormState = (variations = []) => {
    const sanitized = sanitizeLotVariationsForStorage(variations);
    if (sanitized.length === 0) {
        return [];
    }

    return sanitized.map((variation, index) => ({
        variationId: variation.variationId,
        variationKey: variation.variationKey || buildLotVariationKey(variation, index),
        label: variation.label,
        target: String(variation.target),
        produced: variation.produced,
    }));
};

const createEmptyProductDraft = () => ({
    name: '',
    standardTime: '',
    billOfMaterials: [],
    variations: [createEmptyProductVariation()],
});

const buildFallbackVariationId = (productId, index, label = '') => {
    const normalizedLabel = typeof label === 'string' ? label.trim().toLowerCase() : '';
    const slug = normalizedLabel
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '');
    const base = slug.length > 0
        ? slug
        : (typeof productId === 'string' && productId.trim().length > 0
            ? productId.trim()
            : 'variation');
    return `${base}-${index + 1}`;
};

const sanitizeProductVariationsArray = (productId, rawVariations = [], fallbackBillOfMaterials = []) => {
    if (!Array.isArray(rawVariations) || rawVariations.length === 0) {
        return [];
    }

    const seenIds = new Set();
    const normalizedFallback = normalizeBillOfMaterialsItems(fallbackBillOfMaterials);

    return rawVariations.map((variation, index) => {
        const label = typeof variation?.label === 'string' ? variation.label.trim() : '';
        const baseId = (typeof variation?.id === 'string' && variation.id.trim().length > 0)
            ? variation.id.trim()
            : buildFallbackVariationId(productId, index, label);

        let finalId = baseId;
        let dedupeCounter = 1;
        while (seenIds.has(finalId)) {
            dedupeCounter += 1;
            finalId = `${baseId}-${dedupeCounter}`;
        }
        seenIds.add(finalId);

        const rawDefaultTarget = variation?.defaultTarget;
        let defaultTarget = null;
        if (typeof rawDefaultTarget === 'number') {
            defaultTarget = rawDefaultTarget;
        } else if (typeof rawDefaultTarget === 'string' && rawDefaultTarget.trim().length > 0) {
            const parsed = parseFloat(rawDefaultTarget);
            defaultTarget = Number.isFinite(parsed) ? parsed : null;
        }

        const hasCustomBillOfMaterials = Array.isArray(variation?.billOfMaterials);
        const normalizedBillOfMaterials = hasCustomBillOfMaterials
            ? normalizeBillOfMaterialsItems(variation.billOfMaterials)
            : normalizedFallback.map(item => ({ ...item }));

        return {
            id: finalId,
            label,
            defaultTarget,
            billOfMaterials: normalizedBillOfMaterials,
            usesDefaultBillOfMaterials: !hasCustomBillOfMaterials && normalizedBillOfMaterials.length > 0,
        };
    });
};

const mapProductVariationsToDraft = (productId, rawVariations = [], fallbackBillOfMaterials = []) => {
    const sanitized = sanitizeProductVariationsArray(productId, rawVariations, fallbackBillOfMaterials);
    if (sanitized.length === 0) {
        return [createEmptyProductVariation()];
    }

    return sanitized.map(variation => ({
        id: variation.id,
        label: typeof variation.label === 'string' ? variation.label : '',
        defaultTarget: Number.isFinite(variation.defaultTarget)
            ? String(variation.defaultTarget)
            : '',
        billOfMaterials: mapBillOfMaterialsToDraft(variation.billOfMaterials || []),
        usesDefaultBillOfMaterials: Boolean(variation.usesDefaultBillOfMaterials),
    }));
};

const normalizeProductVariationsForSave = (variations = [], fallbackBillOfMaterials = []) => {
    if (!Array.isArray(variations)) {
        return [];
    }

    const seenIds = new Set();
    const normalizedFallback = normalizeBillOfMaterialsItems(fallbackBillOfMaterials);

    return variations.reduce((accumulator, variation) => {
        const label = typeof variation?.label === 'string' ? variation.label.trim() : '';
        if (!label) {
            return accumulator;
        }

        const rawDefaultTarget = variation?.defaultTarget;
        let defaultTarget = null;
        if (typeof rawDefaultTarget === 'number') {
            defaultTarget = rawDefaultTarget;
        } else if (typeof rawDefaultTarget === 'string' && rawDefaultTarget.trim().length > 0) {
            const parsed = parseFloat(rawDefaultTarget);
            defaultTarget = Number.isFinite(parsed) ? parsed : null;
        }

        const baseId = (typeof variation?.id === 'string' && variation.id.trim().length > 0)
            ? variation.id.trim()
            : generateId('productVariation');
        let id = baseId;
        let suffix = 1;
        while (seenIds.has(id)) {
            suffix += 1;
            id = `${baseId}-${suffix}`;
        }
        seenIds.add(id);

        let normalizedBillOfMaterials = normalizeBillOfMaterialsItems(variation?.billOfMaterials || []);
        const inheritsDefault = Boolean(variation?.usesDefaultBillOfMaterials);
        const shouldFallbackToDefault = (!Array.isArray(variation?.billOfMaterials) || (inheritsDefault && normalizedBillOfMaterials.length === 0)) && normalizedFallback.length > 0;
        if (shouldFallbackToDefault) {
            normalizedBillOfMaterials = normalizedFallback.map(item => ({ ...item }));
        }

        accumulator.push({
            id,
            label,
            defaultTarget,
            billOfMaterials: normalizedBillOfMaterials,
        });

        return accumulator;
    }, []);
};

const BillOfMaterialsEditor = ({
    items = [],
    onChangeItem,
    onAddItem,
    onRemoveItem,
    stockProducts = [],
    stockCategoryMap = new Map(),
    title,
    addLabel = 'Adicionar Componente',
    emptyLabel = 'Nenhum componente adicionado.',
    dashboards = [],
    currentDashboardId = '',
}) => {
    const availableProducts = useMemo(
        () => stockProducts
            .filter(product => !product.isDeleted)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [stockProducts],
    );

    const dashboardOptions = useMemo(
        () => (Array.isArray(dashboards) ? dashboards.filter(d => d && d.id) : []),
        [dashboards],
    );

    return (
        <div className="space-y-3">
            {title && <h4 className="text-md font-medium">{title}</h4>}
            {items.length === 0 && (
                <p className="text-sm text-gray-500">{emptyLabel}</p>
            )}
            {items.map((item, index) => {
                const product = availableProducts.find(prod => prod.id === item.stockProductId) || null;
                const variations = Array.isArray(product?.variations) ? product.variations : [];
                const sanitizedDashboardIds = Array.isArray(item.dashboardIds)
                    ? item.dashboardIds
                        .map(id => (typeof id === 'string' ? id.trim() : ''))
                        .filter(Boolean)
                    : [];

                const handleDashboardChange = (dashboardId, isChecked) => {
                    const normalizedId = typeof dashboardId === 'string' ? dashboardId : '';
                    if (!normalizedId) return;
                    const nextIdsSet = new Set(sanitizedDashboardIds);
                    if (isChecked) {
                        nextIdsSet.add(normalizedId);
                    } else {
                        nextIdsSet.delete(normalizedId);
                    }
                    const orderedIds = dashboardOptions
                        .map(option => option.id)
                        .filter(id => nextIdsSet.has(id));
                    onChangeItem(index, 'dashboardIds', orderedIds);
                };

                return (
                    <div key={index} className="grid grid-cols-12 gap-3 items-end">
                        <div className="col-span-5">
                            <label className="block text-sm font-medium mb-1">Produto do Estoque</label>
                            <select
                                value={item.stockProductId}
                                onChange={(event) => onChangeItem(index, 'stockProductId', event.target.value)}
                                className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                            >
                                <option value="">Selecione um produto</option>
                                {availableProducts.map(prod => {
                                    const optionCategory = prod?.categoryId ? stockCategoryMap.get(prod.categoryId)?.name || null : null;
                                    const optionPrefix = optionCategory ? `[${optionCategory}] ` : '';
                                    return (
                                        <option key={prod.id} value={prod.id}>
                                            {`${optionPrefix}${prod.name}`}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                        <div className="col-span-4">
                            <label className="block text-sm font-medium mb-1">Variação</label>
                            <select
                                value={item.stockVariationId}
                                onChange={(event) => onChangeItem(index, 'stockVariationId', event.target.value)}
                                className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                disabled={!product}
                            >
                                <option value="">{product ? 'Selecione a variação' : 'Selecione um produto primeiro'}</option>
                                {variations.map(variation => (
                                    <option key={variation.id} value={variation.id}>
                                        {variation.name || variation.sku || variation.code || 'Sem nome'}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="col-span-2">
                            <label className="block text-sm font-medium mb-1">Qtd/Peça</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.quantityPerPiece}
                                onChange={(event) => onChangeItem(index, 'quantityPerPiece', event.target.value)}
                                className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                placeholder="0"
                            />
                        </div>
                        <div className="col-span-1 flex items-center justify-center">
                            <button
                                type="button"
                                onClick={() => onRemoveItem(index)}
                                className="p-2 rounded-full bg-red-500 text-white hover:bg-red-400"
                                aria-label="Remover componente"
                            >
                                <Trash size={16} />
                            </button>
                        </div>
                        {dashboardOptions.length > 0 && (
                            <div className="col-span-12">
                                <fieldset className="space-y-2">
                                    <legend className="block text-sm font-medium">Quadros aplicáveis</legend>
                                    <div className="flex flex-wrap gap-2">
                                        {dashboardOptions.map((dashboard) => {
                                            const optionId = dashboard.id;
                                            const isChecked = sanitizedDashboardIds.includes(optionId);
                                            const labelText = dashboard.name || optionId;
                                            return (
                                                <label
                                                    key={optionId}
                                                    className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${isChecked ? 'bg-blue-100 border-blue-400 dark:bg-blue-900/40 dark:border-blue-500' : 'bg-gray-100 border-gray-300 dark:bg-gray-800 dark:border-gray-700'}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={(event) => handleDashboardChange(optionId, event.target.checked)}
                                                    />
                                                    <span>
                                                        {labelText}
                                                        {currentDashboardId && currentDashboardId === optionId && (
                                                            <span className="ml-1 text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-300">Atual</span>
                                                        )}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        Sem seleção indica que o componente se aplica a todos os quadros.
                                    </p>
                                </fieldset>
                            </div>
                        )}
                    </div>
                );
            })}
            <button
                type="button"
                onClick={onAddItem}
                className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500"
            >
                <PlusCircle size={18} />
                {addLabel}
            </button>
        </div>
    );
};

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

    const handleProductionRowVariationChange = (rowIndex, variationKey, value) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'default') return prev;
            const rows = prev.productionRows || [];
            if (rowIndex < 0 || rowIndex >= rows.length) return prev;
            const targetRow = rows[rowIndex];
            if (!targetRow) return prev;
            const variations = Array.isArray(targetRow.variations)
                ? targetRow.variations.map(variation => {
                    if (variation.variationKey === variationKey || variation.variationId === variationKey) {
                        return { ...variation, produced: value };
                    }
                    return variation;
                })
                : [];
            const totalProduced = variations.reduce((sum, variation) => {
                const numeric = parseInt(variation.produced, 10);
                if (!Number.isFinite(numeric)) {
                    return sum;
                }
                return sum + Math.max(0, numeric);
            }, 0);
            const nextRow = {
                ...targetRow,
                variations,
                produced: totalProduced > 0 ? String(totalProduced) : '',
            };
            const nextRows = rows.map((row, idx) => (idx === rowIndex ? nextRow : row));
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
            const updatedEmployees = updateTraveteEmployeeField({
                employees: prev.employeeEntries,
                employeeIndex: index,
                field,
                value,
                lots,
                products,
                variationLookup: traveteVariationLookup,
            });
            return { ...prev, employeeEntries: updatedEmployees };
        });
    };

    const handleTraveteProductChange = (employeeIndex, productIndex, field, value) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'travete') return prev;
            const updatedEmployees = updateTraveteEmployeeProducts({
                employees: prev.employeeEntries,
                employeeIndex,
                productIndex,
                field,
                value,
                lots,
                products,
                variationLookup: traveteVariationLookup,
            });
            return { ...prev, employeeEntries: updatedEmployees };
        });
    };

    const handleTraveteAddProduct = (employeeIndex) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'travete') return prev;
            const updatedEmployees = appendTraveteProductRow(prev.employeeEntries, employeeIndex);
            return { ...prev, employeeEntries: updatedEmployees };
        });
    };

    const handleTraveteRemoveProduct = (employeeIndex, productIndex) => {
        setEntryData(prev => {
            if (!prev || prev.type !== 'travete') return prev;
            const updatedEmployees = removeTraveteProductRow(prev.employeeEntries, employeeIndex, productIndex);
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
            .map(row => {
                const rowVariations = Array.isArray(row.variations)
                    ? row.variations
                        .map(variation => ({
                            variationId: variation.variationId || '',
                            variationKey: variation.variationKey,
                            label: variation.label || '',
                            produced: parseInt(variation.produced, 10) || 0,
                        }))
                        .filter(variation => variation.produced > 0)
                    : [];

                const producedValue = rowVariations.length > 0
                    ? rowVariations.reduce((sum, variation) => sum + variation.produced, 0)
                    : (parseInt(row.produced, 10) || 0);

                if (producedValue <= 0) {
                    return null;
                }

                const detail = {
                    productId: row.productId,
                    produced: producedValue,
                    lotId: row.lotId || '',
                };

                if (rowVariations.length > 0) {
                    detail.variations = rowVariations;
                }

                return detail;
            })
            .filter(Boolean);

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
                            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                                {(entryData.productionRows || []).map((row, index) => {
                                    const variations = Array.isArray(row.variations) ? row.variations : [];
                                    const hasVariations = variations.length > 0;
                                    return (
                                        <div
                                            key={row.key || `${row.productId}-${index}`}
                                            className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-2"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-sm font-medium truncate">{row.productName || row.productId || 'Produto'}</span>
                                                {Number.isFinite(row?.remainingPieces) && (
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">Restante: {row.remainingPieces}</span>
                                                )}
                                            </div>
                                            {hasVariations ? (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {variations.map(variation => {
                                                        const variationLabel = variation.label && variation.label.trim().length > 0
                                                            ? variation.label
                                                            : 'Sem descrição';
                                                        return (
                                                            <div
                                                                key={variation.variationKey}
                                                                className="p-2 rounded-md bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 space-y-1"
                                                            >
                                                                <div className="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-300">
                                                                    <span className="truncate" title={variationLabel}>{variationLabel}</span>
                                                                    <span>{variation.currentProduced || 0} / {variation.target || 0}</span>
                                                                </div>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    value={variation.produced || ''}
                                                                    onChange={(e) => handleProductionRowVariationChange(index, variation.variationKey, e.target.value)}
                                                                    className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={row.produced || ''}
                                                    onChange={(e) => handleProductionRowChange(index, e.target.value)}
                                                    className="w-24 p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                />
                                            )}
                                        </div>
                                    );
                                })}
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


const NoteModal = ({ isOpen, onClose, title, initialValue = '', onSave }) => {
    const [value, setValue] = useState(initialValue);
    const modalRef = useRef(null);
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if (isOpen) {
            setValue(initialValue || '');
        }
    }, [initialValue, isOpen]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(value);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-30 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg modal-content">
                <h2 className="text-xl font-bold mb-4">{title}</h2>
                <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
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

const ObservationModal = ({ isOpen, onClose, entry, onSave }) => {
    const handleSave = useCallback(
        (value) => {
            if (entry) {
                onSave(entry.id, value);
            }
        },
        [entry, onSave],
    );

    return (
        <NoteModal
            isOpen={isOpen && Boolean(entry)}
            onClose={onClose}
            title={`Observação do Período${entry?.period ? `: ${entry.period}` : ''}`}
            initialValue={entry?.observation || ''}
            onSave={handleSave}
        />
    );
};

const LotObservationModal = ({ isOpen, onClose, lot, onSave }) => {
    const handleSave = useCallback(
        (value) => {
            if (lot) {
                onSave(lot.id, value);
            }
        },
        [lot, onSave],
    );

    return (
        <NoteModal
            isOpen={isOpen && Boolean(lot)}
            onClose={onClose}
            title={`Observação do Lote${lot?.productName ? `: ${lot.productName}` : ''}`}
            initialValue={lot?.observation || ''}
            onSave={handleSave}
        />
    );
};

const PasswordModal = ({ isOpen, onClose, onSuccess }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    const verifyAdminPassword = useMemo(() => httpsCallable(functions, 'verifyAdminPassword'), []);

    useEffect(() => {
        if(isOpen) {
            setPassword('');
            setError('');
            setIsLoading(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        if (isLoading) return;

        const trimmedPassword = password.trim();
        if (!trimmedPassword) {
            setError('Informe a senha.');
            return;
        }

        setError('');
        setIsLoading(true);

        try {
            const { data } = await verifyAdminPassword({ password: trimmedPassword });
            if (data?.valid) {
                if(onSuccess) onSuccess();
                onClose();
            } else {
                setError('Senha incorreta.');
            }
        } catch (err) {
            console.error('Erro ao validar senha de administrador.', err);
            let message = 'Não foi possível validar a senha. Tente novamente.';
            if (err?.code === 'functions/unauthenticated') {
                message = 'Faça login para continuar.';
            } else if (err?.code === 'functions/permission-denied') {
                message = 'Você não tem permissão para executar esta ação.';
            } else if (err?.code === 'functions/invalid-argument') {
                message = 'Senha inválida. Verifique e tente novamente.';
            } else if (err?.code === 'functions/failed-precondition') {
                message = 'Configuração de segurança indisponível. Contate o administrador.';
            } else if (err?.code === 'functions/internal') {
                message = 'Não foi possível validar suas permissões. Tente novamente.';
            } else if (err?.code === 'functions/unavailable') {
                message = 'Serviço temporariamente indisponível. Tente novamente em instantes.';
            }
            setError(message);
        } finally {
            setIsLoading(false);
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
                     <button
                        onClick={handleConfirm}
                        className="px-4 py-2 rounded-md bg-blue-600 text-white disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Validando...' : 'Confirmar'}
                    </button>
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
        <SummaryCard
            title={title}
            className="text-center"
            titleClassName="text-base font-medium text-gray-500 dark:text-gray-400"
            contentClassName="flex-1 flex flex-col items-center justify-center mt-4"
        >
            <p className={`text-4xl font-bold ${valueColor}`}>
                {value}
                {unit && <span className="text-2xl ml-2">{unit}</span>}
            </p>
        </SummaryCard>
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

const CronoanaliseDashboard = ({ onNavigateToStock, onNavigateToOperationalSequence, onNavigateToReports, onNavigateToFichaTecnica, user, permissions, startTvMode, dashboards, users, roles, currentDashboardIndex, setCurrentDashboardIndex }) => {
    const { logout } = useAuth();
    const { theme, toggleTheme } = usePersistedTheme();
    
    useEffect(() => { if (currentDashboardIndex >= dashboards.length && dashboards.length > 0) { setCurrentDashboardIndex(dashboards.length - 1); } }, [dashboards, currentDashboardIndex, setCurrentDashboardIndex]);

    const currentDashboard = dashboards[currentDashboardIndex] || null;
    const isTraveteDashboard = currentDashboard?.id === 'travete';
    
    const [products, setProducts] = useState([]);
    const [stockProducts, setStockProducts] = useState([]);
    const [stockCategories, setStockCategories] = useState([]);
    const [lots, setLots] = useState([]);
    const [allProductionData, setAllProductionData] = useState({});
    const [trashItems, setTrashItems] = useState([]);
    
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [calendarView, setCalendarView] = useState('day');
    
    const [lotCounter, setLotCounter] = useState(1);
    
    const [lotFilter, setLotFilter] = useState('ongoing');
    const [newLot, setNewLot] = useState(() => createEmptyLotFormState());
    const [editingLotId, setEditingLotId] = useState(null);
    const [editingLotData, setEditingLotData] = useState(() => createEmptyLotEditState());
    const [newProduct, setNewProduct] = useState(() => createEmptyProductDraft());
    const [editingProductId, setEditingProductId] = useState(null);
    const [editingProductData, setEditingProductData] = useState(() => createEmptyProductDraft());
    
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
    const [isNavOpen, setIsNavOpen] = useState(false);
    const navRef = useRef();
    useClickOutside(navRef, () => setIsNavOpen(false));
    const previousNewLotProductId = usePrevious(newLot.productId);
    const previousIsTraveteDashboard = usePrevious(isTraveteDashboard);

    const productsForSelectedDate = useMemo(() => {
        const targetDate = new Date(selectedDate);
        targetDate.setHours(23, 59, 59, 999);

        return products
            .map(p => {
                if (!p.standardTimeHistory || p.standardTimeHistory.length === 0) return null;
                const validTimeEntry = p.standardTimeHistory
                    .filter(h => new Date(h.effectiveDate) <= targetDate)
                    .pop();
                if (!validTimeEntry) return null;
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

    const sortedProductsForSelectedDate = useMemo(() => {
        if (!Array.isArray(productsForSelectedDate)) {
            return [];
        }

        return [...productsForSelectedDate].sort((a, b) => a.name.localeCompare(b.name));
    }, [productsForSelectedDate]);

    const selectedNewLotProduct = useMemo(() => {
        if (isTraveteDashboard) {
            return null;
        }

        return products.find(product => product.id === newLot.productId) || null;
    }, [isTraveteDashboard, products, newLot.productId]);

    const stockCategoryMap = useMemo(() => {
        const map = new Map();
        stockCategories.forEach(category => {
            if (category?.id) {
                map.set(category.id, category);
            }
        });
        return map;
    }, [stockCategories]);

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
                const variationStandardTime = variation && variation.standardTime
                    ? parseFloat(variation.standardTime)
                    : NaN;
                if (!Number.isNaN(variationStandardTime) && variationStandardTime > 0 && derivedStandardTime <= 0) {
                    derivedStandardTime = variationStandardTime;
                }

                const variationProductId = variation && variation.id ? variation.id : '';

                return {
                    lot,
                    lotId: lot && lot.id ? lot.id : '',
                    productId: variationProductId,
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
            const manualNextLot = (manualNextLotItem && manualNextLotItem.lot)
                ? manualNextLotItem.lot
                : null;

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

            let nextMetaPieces = 0;
            if (manualNextLotItem && manualNextProduced > 0) {
                nextMetaPieces = manualNextProduced;
            } else if (leftoverMetaForNext > 0 && nextLotCandidate) {
                const safeNextRemaining = Math.max(0, nextLotRemaining || 0);
                nextMetaPieces = safeNextRemaining > 0
                    ? Math.min(leftoverMetaForNext, safeNextRemaining)
                    : leftoverMetaForNext;
            }

            const shouldShowNextLot = Boolean(nextLotCandidate)
                && ((manualNextLotItem && manualNextProduced > 0) || nextMetaPieces > 0);

            const machineSuffix = emp.machineType
                ? emp.machineType.replace('Travete ', '')
                : '';
            const currentLotLabel = currentLotName
                ? `${currentLotName}${machineSuffix ? ` - ${machineSuffix}` : ''}`
                : '';
            const nextLotName = shouldShowNextLot ? rawNextLotName : '';
            const lotDisplay = currentLotLabel
                ? (shouldShowNextLot && nextLotName ? `${currentLotLabel} / ${nextLotName}` : currentLotLabel)
                : (shouldShowNextLot && nextLotName ? nextLotName : '-');

            const currentMetaValue = currentLot ? plannedForCurrentLot : (meta > 0 ? meta : 0);
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

    const traveteEntrySummary = useMemo(() => {
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

    useEffect(() => {
        if (!user) {
            setStockProducts([]);
            setStockCategories([]);
            return;
        }

        const categoriesQuery = query(collection(db, 'stock/data/categories'), orderBy('name'));
        const productsQuery = query(collection(db, 'stock/data/products'), orderBy('name'));

        const unsubscribeCategories = onSnapshot(categoriesQuery, snapshot => {
            setStockCategories(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
        });

        const unsubscribeProducts = onSnapshot(productsQuery, snapshot => {
            setStockProducts(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
        });

        return () => {
            unsubscribeCategories();
            unsubscribeProducts();
        };
    }, [user]);

    const isEntryFormValid = useMemo(() => {
        if (isTraveteDashboard) {
            return traveteEntrySummary.isValid;
        }

        const hasProduction = Array.isArray(newEntry.productions)
            ? newEntry.productions.some(item => {
                if (!item) return false;
                if (Array.isArray(item.variations) && item.variations.length > 0) {
                    return item.variations.some(variation => (parseInt(variation.produced, 10) || 0) > 0);
                }
                return (parseInt(item.totalProduced, 10) || 0) > 0;
            })
            : false;

        const hasUrgentProduction = showUrgent && urgentProduction.productId && (parseInt(urgentProduction.produced, 10) || 0) > 0;

        return (
            newEntry.period &&
            (parseFloat(newEntry.people) > 0) &&
            (parseFloat(newEntry.availableTime) > 0) &&
            newEntry.productId &&
            (hasProduction || hasUrgentProduction)
        );
    }, [isTraveteDashboard, traveteEntrySummary, newEntry, showUrgent, urgentProduction]);
    
    useEffect(() => {
        if (!user || !currentDashboard) return;

        const unsubProducts = onSnapshot(query(collection(db, `dashboards/${currentDashboard.id}/products`)), snap => {
            const pendingBackfills = [];
            const mappedProducts = snap.docs.map(docSnap => {
                const data = docSnap.data();
                const productId = data?.id || docSnap.id;
                const productBillOfMaterials = normalizeBillOfMaterialsItems(data?.billOfMaterials || []);
                const rawVariations = Array.isArray(data?.variations) ? data.variations : [];
                const { needsBackfill, variations: variationsForStorage } = buildVariationBillOfMaterialsBackfill(rawVariations, productBillOfMaterials);
                if (needsBackfill) {
                    pendingBackfills.push({
                        docRef: doc(db, `dashboards/${currentDashboard.id}/products`, docSnap.id),
                        variations: variationsForStorage,
                    });
                }
                const sanitizedVariations = sanitizeProductVariationsArray(productId, variationsForStorage, productBillOfMaterials);
                return {
                    ...data,
                    id: productId,
                    billOfMaterials: productBillOfMaterials,
                    variations: sanitizedVariations,
                };
            });
            setProducts(mappedProducts);
            pendingBackfills.forEach(({ docRef, variations }) => {
                updateDoc(docRef, { variations }).catch((error) => {
                    console.error('Falha ao atualizar ficha técnica das variações durante backfill:', error);
                });
            });
        });
        const unsubLots = onSnapshot(query(collection(db, `dashboards/${currentDashboard.id}/lots`), orderBy("order")), snap => {
            setLots(snap.docs.map(docSnap => {
                const data = docSnap.data();
                const sanitizedVariations = sanitizeLotVariationsForStorage(data?.variations || []);
                const targetFromVariations = sanitizedVariations.length > 0
                    ? sanitizedVariations.reduce((acc, variation) => acc + variation.target, 0)
                    : parseLotQuantityValue(data?.target);

                return {
                    ...data,
                    target: targetFromVariations,
                    variations: sanitizedVariations,
                };
            }));
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
        const productIdChanged = newLot.productId !== previousNewLotProductId;
        const dashboardModeChanged = (previousIsTraveteDashboard !== undefined)
            && previousIsTraveteDashboard !== isTraveteDashboard;

        if (!productIdChanged && !dashboardModeChanged && selectedNewLotProduct) {
            return;
        }

        if (!newLot.productId || isTraveteDashboard || !selectedNewLotProduct) {
            setNewLot(prev => {
                const hasVariations = Array.isArray(prev.variations) && prev.variations.length > 0;
                if (!hasVariations && prev.target === '') {
                    return prev;
                }
                return { ...prev, variations: [], target: '' };
            });
            return;
        }

        const mappedVariations = mapProductVariationsToLotState(selectedNewLotProduct.variations || []);
        if (mappedVariations.length === 0) {
            setNewLot(prev => ({ ...prev, variations: [], target: '' }));
            return;
        }

        const total = computeLotTargetFromVariations(mappedVariations);
        setNewLot(prev => ({
            ...prev,
            variations: mappedVariations,
            target: total > 0 ? String(total) : '0',
        }));
    }, [
        newLot.productId,
        previousNewLotProductId,
        previousIsTraveteDashboard,
        isTraveteDashboard,
        selectedNewLotProduct,
    ]);

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
                    const employeePreview = traveteEntrySummary.employeeSummaries.map(emp => ({
                        employeeId: emp.employeeId,
                        machineType: emp.machineType,
                        products: (emp.productsForSave || []).map(item => ({
                            lotName: item.lotName || '',
                            produced: item.produced,
                        })),
                    }));

                    const lotNames = Array.from(new Set(employeePreview.flatMap(emp => (emp.products || []).map(p => p.lotName).filter(Boolean))));
                    const lotDisplayValue = traveteEntrySummary.lotDisplay && traveteEntrySummary.lotDisplay.trim().length > 0
                        ? traveteEntrySummary.lotDisplay
                        : lotNames.join(' | ');

                    await setDoc(previewRef, {
                        period: traveteEntry.period,
                        goalDisplay: traveteEntrySummary.goalDisplay,
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
    }, [isTraveteDashboard, goalPreview, newEntry, traveteEntry, traveteEntrySummary, currentDashboard, productsForSelectedDate, products]);


    const regularPredictions = useMemo(
        () => predictedLots.filter(prediction => !prediction.isUrgent),
        [predictedLots]
    );


    const handleAddEntry = useCallback(async (e) => {
        e.preventDefault();
        if (!currentDashboard) return;

        if (isTraveteDashboard) {
            if (!traveteEntrySummary.isValid) return;

            const entryId = Date.now().toString();
            const batch = writeBatch(db);
            const now = Timestamp.now();
            const prodDataRef = doc(db, `dashboards/${currentDashboard.id}/productionData`, "data");
            const employeeEntries = traveteEntrySummary.employeeSummaries.map(emp => ({
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
                goalDisplay: traveteEntrySummary.goalDisplay,
                lotDisplay: traveteEntrySummary.lotDisplay,
                traveteGoalBlocks: traveteEntrySummary.goalBlocks || [],
                traveteLotBlocks: traveteEntrySummary.lotBlocks || [],
                employeeEntries,
                productionDetails: traveteEntrySummary.productionDetails,
                observation: '',
                createdBy: { uid: user.uid, email: user.email },
            };

            const updatedDayData = [...(allProductionData[dateKey] || []), newEntryData];
            batch.set(prodDataRef, { [dateKey]: updatedDayData }, { merge: true });

            for (const detail of traveteEntrySummary.productionDetails) {
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
                        lastEditedAt: now,
                    };
                    if (Array.isArray(detail.variations) && detail.variations.length > 0) {
                        const variationDeltas = new Map();
                        detail.variations.forEach((variation, variationIndex) => {
                            const producedValue = parseInt(variation.produced, 10);
                            if (!Number.isFinite(producedValue) || producedValue === 0) {
                                return;
                            }
                            const key = variation.variationKey || buildLotVariationKey(variation, variationIndex);
                            variationDeltas.set(key, (variationDeltas.get(key) || 0) + producedValue);
                        });
                        if (variationDeltas.size > 0) {
                            const updatedVariations = (Array.isArray(lotToUpdate.variations) ? lotToUpdate.variations : []).map((variation, variationIndex) => {
                                const key = buildLotVariationKey(variation, variationIndex);
                                if (!variationDeltas.has(key)) {
                                    return variation;
                                }
                                const baseProduced = parseLotQuantityValue(variation.produced);
                                return { ...variation, produced: baseProduced + variationDeltas.get(key) };
                            });
                            updatePayload.variations = updatedVariations;
                        }
                    }
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

        regularPredictions.forEach((lot, index) => {
            const productionState = newEntry.productions[index];
            if (!productionState) {
                return;
            }

            const lotVariations = Array.isArray(productionState.variations)
                ? productionState.variations
                    .map(variation => ({
                        variationId: variation.variationId || '',
                        variationKey: variation.variationKey,
                        label: variation.label || '',
                        produced: parseInt(variation.produced, 10) || 0,
                    }))
                    .filter(variation => variation.produced > 0)
                : [];

            const producedAmount = lotVariations.length > 0
                ? lotVariations.reduce((sum, variation) => sum + variation.produced, 0)
                : (parseInt(productionState.totalProduced, 10) || 0);

            if (producedAmount <= 0) {
                return;
            }

            const detail = {
                productId: productionState.productId || lot.productId,
                lotId: productionState.lotId || lot.id || '',
                produced: producedAmount,
            };

            if (lotVariations.length > 0) {
                detail.variations = lotVariations.map(variation => ({
                    ...variation,
                    produced: variation.produced,
                }));
            }

            productionDetails.push(detail);
        });

        const entryId = Date.now().toString();
        const now = Timestamp.now();
        const newEntryData = {
            id: entryId,
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
            const lotToUpdate = resolveLotForDetail(detail, lots);
            if (lotToUpdate && lotToUpdate.id) {
                const lotRef = doc(db, `dashboards/${currentDashboard.id}/lots`, lotToUpdate.id);
                const newProduced = (lotToUpdate.produced || 0) + detail.produced;
                const updatePayload = {
                    produced: newProduced,
                    lastEditedBy: { uid: user.uid, email: user.email },
                    lastEditedAt: now,
                };

                if (Array.isArray(detail.variations) && detail.variations.length > 0) {
                    const variationDeltas = new Map();
                    detail.variations.forEach((variation, variationIndex) => {
                        const producedValue = parseInt(variation.produced, 10);
                        if (!Number.isFinite(producedValue) || producedValue === 0) {
                            return;
                        }
                        const variationKey = variation.variationKey || buildLotVariationKey(variation, variationIndex);
                        variationDeltas.set(
                            variationKey,
                            (variationDeltas.get(variationKey) || 0) + producedValue,
                        );
                    });

                    if (variationDeltas.size > 0) {
                        const updatedVariations = (Array.isArray(lotToUpdate.variations) ? lotToUpdate.variations : []).map((variation, variationIndex) => {
                            const key = buildLotVariationKey(variation, variationIndex);
                            if (!variationDeltas.has(key)) {
                                return variation;
                            }
                            const baseProduced = parseLotQuantityValue(variation.produced);
                            return {
                                ...variation,
                                produced: baseProduced + variationDeltas.get(key),
                            };
                        });
                        updatePayload.variations = updatedVariations;
                    }
                }

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
    }, [currentDashboard, isTraveteDashboard, traveteEntrySummary, traveteEntry, allProductionData, dateKey, lots, user, isEntryFormValid, showUrgent, urgentProduction, newEntry, goalPreview, productsForSelectedDate, regularPredictions]);
    
    
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
        const now = Timestamp.now();

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
                lastEditedAt: now,
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
                lastEditedAt: now,
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
      const now = Timestamp.now();

      const productionDeltas = new Map();
      const variationDeltas = new Map();
      const updatedProductions = Array.isArray(updatedData.productions) ? updatedData.productions : [];

      const registerProductionDelta = (detail, sign) => {
          if (!detail) return;

          const lot = resolveLotForDetail(detail, lots);
          const baseProduced = Number.isFinite(parseFloat(detail.produced))
              ? parseFloat(detail.produced)
              : sumDetailVariationProduced(detail.variations);
          const producedValue = Number.isFinite(baseProduced) ? baseProduced : 0;
          if (producedValue !== 0) {
              const key = lot ? `lot::${lot.id}` : `product::${detail.productId || ''}`;
              productionDeltas.set(key, (productionDeltas.get(key) || 0) + sign * producedValue);
          }

          if (lot && Array.isArray(detail.variations) && detail.variations.length > 0) {
              detail.variations.forEach((variation, variationIndex) => {
                  const producedVariation = parseInt(variation.produced, 10) || 0;
                  if (producedVariation === 0) {
                      return;
                  }
                  const variationKey = variation.variationKey || buildLotVariationKey(variation, variationIndex);
                  const compositeKey = buildCompositeVariationKey(lot.id, variationKey);
                  variationDeltas.set(
                      compositeKey,
                      (variationDeltas.get(compositeKey) || 0) + sign * producedVariation,
                  );
              });
          }
      };

      (originalEntry.productionDetails || []).forEach(detail => registerProductionDelta(detail, -1));

      updatedProductions.forEach(detail => registerProductionDelta(detail, 1));

      for (const [deltaKey, delta] of productionDeltas.entries()) {
          if (!Number.isFinite(delta) || delta === 0) continue;

          let lotToUpdate = null;
          if (deltaKey.startsWith('lot::')) {
              const lotId = deltaKey.slice(5);
              lotToUpdate = lots.find(lot => lot.id === lotId) || null;
          } else if (deltaKey.startsWith('product::')) {
              const productId = deltaKey.slice(9);
              lotToUpdate = lots.find(lot => lot.productId === productId) || null;
          }

          if (!lotToUpdate || !lotToUpdate.id) {
              continue;
          }

          const lotRef = doc(db, `dashboards/${currentDashboard.id}/lots`, lotToUpdate.id);
          const updatePayload = {
              produced: increment(delta),
              lastEditedBy: { uid: user.uid, email: user.email },
              lastEditedAt: now,
          };

          const variationDeltaForLot = new Map();
          variationDeltas.forEach((variationDelta, compositeKey) => {
              if (!Number.isFinite(variationDelta) || variationDelta === 0) {
                  return;
              }
              const [lotId, variationKey] = splitCompositeVariationKey(compositeKey);
              if (lotId === lotToUpdate.id) {
                  variationDeltaForLot.set(variationKey, (variationDeltaForLot.get(variationKey) || 0) + variationDelta);
              }
          });

          if (variationDeltaForLot.size > 0) {
              const updatedVariations = (Array.isArray(lotToUpdate.variations) ? lotToUpdate.variations : []).map((variation, variationIndex) => {
                  const key = buildLotVariationKey(variation, variationIndex);
                  if (!variationDeltaForLot.has(key)) {
                      return variation;
                  }
                  const baseProduced = parseLotQuantityValue(variation.produced);
                  const newProducedValue = Math.max(0, baseProduced + variationDeltaForLot.get(key));
                  return { ...variation, produced: newProducedValue };
              });
              updatePayload.variations = updatedVariations;
          }

          batch.update(lotRef, updatePayload);
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
                  lastEditedAt: now,
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

                const movementsQuery = query(
                    collection(db, 'stock/data/movements'),
                    where('sourceEntryId', '==', itemId)
                );
                const movementSnapshot = await getDocs(movementsQuery);
                const stockAdjustments = new Map();
                const movementRefsToDelete = [];

                movementSnapshot.forEach(movementDoc => {
                    const data = movementDoc.data();
                    const quantityValue = parseFloat(data.quantity);
                    if (!Number.isFinite(quantityValue) || quantityValue === 0) {
                        movementRefsToDelete.push(movementDoc.ref);
                        return;
                    }
                    const key = `${data.productId}::${data.variationId}`;
                    const direction = data.type === 'Saída' ? 1 : -1;
                    stockAdjustments.set(key, (stockAdjustments.get(key) || 0) + (direction * quantityValue));
                    movementRefsToDelete.push(movementDoc.ref);
                });

                if (stockAdjustments.size > 0) {
                    const stockProductMap = new Map();
                    stockProducts.forEach(product => {
                        if (product?.id) {
                            stockProductMap.set(product.id, product);
                        }
                    });

                    const productUpdates = new Map();
                    stockAdjustments.forEach((delta, key) => {
                        if (!Number.isFinite(delta) || delta === 0) return;
                        const [stockProductId, stockVariationId] = key.split('::');
                        const stockProduct = stockProductMap.get(stockProductId);
                        if (!stockProduct) return;
                        const variation = (stockProduct.variations || []).find(v => v.id === stockVariationId);
                        if (!variation) return;
                        if (!productUpdates.has(stockProductId)) {
                            productUpdates.set(stockProductId, new Map());
                        }
                        const variationUpdates = productUpdates.get(stockProductId);
                        const baseValue = variationUpdates.has(stockVariationId)
                            ? variationUpdates.get(stockVariationId)
                            : (Number.isFinite(parseFloat(variation.currentStock))
                                ? parseFloat(variation.currentStock)
                                : 0);
                        variationUpdates.set(stockVariationId, baseValue + delta);
                    });

                    productUpdates.forEach((variationMap, stockProductId) => {
                        const stockProduct = stockProductMap.get(stockProductId);
                        if (!stockProduct) return;
                        const updatedVariations = (stockProduct.variations || []).map(variation => {
                            if (!variationMap.has(variation.id)) return variation;
                            const newValue = roundToFourDecimals(variationMap.get(variation.id));
                            return { ...variation, currentStock: newValue };
                        });
                        batch.update(doc(db, `stock/data/products`, stockProductId), { variations: updatedVariations });
                    });
                }

                movementRefsToDelete.forEach(ref => batch.delete(ref));

                for (const detail of itemDoc.productionDetails) {
                    const lotToUpdate = resolveLotForDetail(detail, lots);
                    if (lotToUpdate && lotToUpdate.id) {
                        const newProduced = Math.max(0, (lotToUpdate.produced || 0) - detail.produced);
                        const newStatus = (lotToUpdate.status.startsWith('completed') && newProduced < lotToUpdate.target) ? 'ongoing' : lotToUpdate.status;
                        const updatePayload = { produced: newProduced, status: newStatus };

                        if (Array.isArray(detail.variations) && detail.variations.length > 0) {
                            const variationDeltas = new Map();
                            detail.variations.forEach((variation, variationIndex) => {
                                const producedValue = parseInt(variation.produced, 10);
                                if (!Number.isFinite(producedValue) || producedValue === 0) {
                                    return;
                                }
                                const key = variation.variationKey || buildLotVariationKey(variation, variationIndex);
                                variationDeltas.set(key, (variationDeltas.get(key) || 0) - producedValue);
                            });
                            if (variationDeltas.size > 0) {
                                const updatedVariations = (Array.isArray(lotToUpdate.variations) ? lotToUpdate.variations : []).map((variation, variationIndex) => {
                                    const key = buildLotVariationKey(variation, variationIndex);
                                    if (!variationDeltas.has(key)) {
                                        return variation;
                                    }
                                    const baseProduced = parseLotQuantityValue(variation.produced);
                                    const adjusted = Math.max(0, baseProduced + variationDeltas.get(key));
                                    return { ...variation, produced: adjusted };
                                });
                                updatePayload.variations = updatedVariations;
                            }
                        }

                        batch.update(doc(db, `dashboards/${currentDashboard.id}/lots`, lotToUpdate.id), updatePayload);
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

          if (Array.isArray(originalDoc.productionDetails) && originalDoc.productionDetails.length > 0) {
              applyBillOfMaterialsMovements({
                  batch,
                  productionDetails: originalDoc.productionDetails,
                  productSources: [productsForSelectedDate, products],
                  stockProducts,
                  sourceEntryId: originalDoc.id,
                  user,
                  movementTimestamp: Timestamp.now(),
                  dashboardId,
              });
          }

          for (const detail of originalDoc.productionDetails) {
              const lotToUpdate = resolveLotForDetail(detail, lots);
              if (lotToUpdate && lotToUpdate.id) {
                  const newProduced = (lotToUpdate.produced || 0) + detail.produced;
                  const newStatus = (newProduced >= lotToUpdate.target) ? 'completed' : lotToUpdate.status;
                  const updatePayload = { produced: newProduced, status: newStatus };

                  if (Array.isArray(detail.variations) && detail.variations.length > 0) {
                      const variationDeltas = new Map();
                      detail.variations.forEach((variation, variationIndex) => {
                          const producedValue = parseInt(variation.produced, 10);
                          if (!Number.isFinite(producedValue) || producedValue === 0) {
                              return;
                          }
                          const key = variation.variationKey || buildLotVariationKey(variation, variationIndex);
                          variationDeltas.set(key, (variationDeltas.get(key) || 0) + producedValue);
                      });
                      if (variationDeltas.size > 0) {
                          const updatedVariations = (Array.isArray(lotToUpdate.variations) ? lotToUpdate.variations : []).map((variation, variationIndex) => {
                              const key = buildLotVariationKey(variation, variationIndex);
                              if (!variationDeltas.has(key)) {
                                  return variation;
                              }
                              const baseProduced = parseLotQuantityValue(variation.produced);
                              return { ...variation, produced: baseProduced + variationDeltas.get(key) };
                          });
                          updatePayload.variations = updatedVariations;
                      }
                  }

                  batch.update(doc(db, `dashboards/${dashboardId}/lots`, lotToUpdate.id), updatePayload);
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
    
    const handleSelectTvMode = useCallback(() => {
        setModalState({ type: 'tvSelector', data: null });
    }, []);
    
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
            return { allPredictions: [], currentGoalPreview: traveteEntrySummary.goalDisplay || '- // -' };
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
            const value = prediction.producible ?? prediction.remainingPieces ?? 0;
            return value > 0 ? value : 0;
        })
        .filter((value, index) => value > 0 || index === 0);
    return {
        allPredictions,
        currentGoalPreview: normalGoalSegments.length > 0
            ? normalGoalSegments.join(' / ')
            : '0',
    };
    }, [isTraveteDashboard, traveteEntrySummary.goalDisplay, newEntry.people, newEntry.availableTime, newEntry.productId, productsForSelectedDate, lots, urgentProduction, showUrgent]);

  
    useEffect(() => {
        if (isTraveteDashboard) {
            setPredictedLots([]);
            setGoalPreview(traveteEntrySummary.goalDisplay || '- // -');
            return;
        }

        const { allPredictions, currentGoalPreview } = calculatePredictions();
        setPredictedLots(allPredictions);
        setGoalPreview(currentGoalPreview);

        const regularPredictions = allPredictions.filter(prediction => !prediction.isUrgent);
        setNewEntry(prev => {
            const previousProductions = Array.isArray(prev.productions) ? prev.productions : [];
            const lookup = new Map();
            previousProductions.forEach(entry => {
                if (!entry) return;
                if (entry.key) {
                    lookup.set(entry.key, entry);
                }
                if (entry.lotId) {
                    lookup.set(`lot::${entry.lotId}`, entry);
                }
                if (entry.productId) {
                    lookup.set(`product::${entry.productId}`, entry);
                }
            });

            const nextProductions = regularPredictions.map((lot, index) => {
                const key = lot.id || `product-${lot.productId || index}`;
                const existing = lookup.get(key)
                    || (lot.id ? lookup.get(`lot::${lot.id}`) : null)
                    || (lot.productId ? lookup.get(`product::${lot.productId}`) : null)
                    || null;
                return buildProductionStateForLot(lot, existing, index);
            });

            return { ...prev, productions: nextProductions };
        });
    }, [isTraveteDashboard, traveteEntrySummary.goalDisplay, calculatePredictions]);

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
        if (!isTraveteDashboard) return [];
        return buildTraveteProcessedEntries(productionData, productMapForSelectedDate);
    }, [isTraveteDashboard, productionData, productMapForSelectedDate]);

    const summary = useMemo(() => {
        if (isTraveteDashboard) {
            if (traveteProcessedData.length === 0) {
                return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
            }

            const employeeStatsMap = new Map();
            const toFinite = (value, fallback = 0) => {
                if (typeof value === 'number') {
                    return Number.isFinite(value) ? value : fallback;
                }
                const parsed = parseFloat(value);
                return Number.isFinite(parsed) ? parsed : fallback;
            };

            traveteProcessedData.forEach(entry => {
                (entry.employees || []).forEach((emp, index) => {
                    const key = emp.employeeId ?? index;
                    const previous = employeeStatsMap.get(key) || {
                        produced: 0,
                        goal: 0,
                        lastEfficiency: 0,
                        cumulativeEfficiency: 0,
                    };

                    const cumulativeProducedValue = toFinite(emp.cumulativeProduced, previous.produced);
                    const producedValue = cumulativeProducedValue > 0
                        ? cumulativeProducedValue
                        : toFinite(emp.produced, previous.produced);
                    const cumulativeGoalValue = toFinite(emp.cumulativeMeta, previous.goal);
                    const goalValue = cumulativeGoalValue > 0
                        ? cumulativeGoalValue
                        : toFinite(emp.meta, previous.goal);
                    const efficiencyValue = toFinite(emp.efficiency, previous.lastEfficiency);
                    const cumulativeEfficiencyValue = toFinite(emp.cumulativeEfficiency, previous.cumulativeEfficiency);

                    employeeStatsMap.set(key, {
                        produced: Math.max(previous.produced, producedValue),
                        goal: Math.max(previous.goal, goalValue),
                        lastEfficiency: efficiencyValue,
                        cumulativeEfficiency: Math.max(previous.cumulativeEfficiency, cumulativeEfficiencyValue),
                    });
                });
            });

            const employeeStats = Array.from(employeeStatsMap.values());
            const totalProduced = employeeStats.reduce((sum, stat) => sum + (stat.produced || 0), 0);
            const totalGoal = employeeStats.reduce((sum, stat) => sum + (stat.goal || 0), 0);
            const lastHourEfficiency = employeeStats.length > 0
                ? parseFloat((employeeStats.reduce((sum, stat) => sum + (stat.lastEfficiency || 0), 0) / employeeStats.length).toFixed(2))
                : 0;
            const averageEfficiency = employeeStats.length > 0
                ? parseFloat((employeeStats.reduce((sum, stat) => sum + (stat.cumulativeEfficiency || 0), 0) / employeeStats.length).toFixed(2))
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

    const validTraveteProducts = useMemo(() => {
        if (!isTraveteDashboard) return [];
        if (!traveteEntry || !Array.isArray(traveteEntry.employeeEntries)) {
            return [];
        }

        const collected = [];

        traveteEntry.employeeEntries.forEach((employee) => {
            if (!employee) return;
            const machineType = employee.machineType;
            if (!machineType) return;

            const productsList = Array.isArray(employee.products) ? employee.products : [];
            productsList.forEach((productItem) => {
                if (!productItem || !productItem.lotId) return;

                const lot = lots.find(l => l.id === productItem.lotId) || null;
                if (!lot) return;

                const baseId = resolveTraveteLotBaseId(lot, productsForSelectedDate);
                if (!baseId) return;

                const variationMap = traveteVariationLookup.get(baseId);
                if (!variationMap) return;

                const variationProduct = variationMap.get(machineType);
                if (!variationProduct || variationProduct.standardTime === undefined || variationProduct.standardTime === null) {
                    return;
                }

                const parsedStandardTime = parseFloat(variationProduct.standardTime);
                if (Number.isNaN(parsedStandardTime) || parsedStandardTime <= 0) {
                    return;
                }

                collected.push({
                    ...productItem,
                    machineType,
                    standardTime: parsedStandardTime,
                });
            });
        });

        return collected;
    }, [
        isTraveteDashboard,
        traveteEntry,
        lots,
        productsForSelectedDate,
        traveteVariationLookup,
    ]);

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

    useEffect(() => {
        if (!isTraveteDashboard) return;
        if (!Array.isArray(validTraveteProducts) || validTraveteProducts.length === 0) {
            return;
        }

        setTraveteEntry(prev => {
            if (!prev || !Array.isArray(prev.employeeEntries)) {
                return prev;
            }

            let hasChanges = false;

            const nextEmployees = prev.employeeEntries.map((employee) => {
                if (!employee) return employee;
                const productsList = Array.isArray(employee.products) ? employee.products : [];
                if (productsList.length === 0) return employee;

                let employeeChanged = false;

                const nextProducts = productsList.map((productItem) => {
                    if (!productItem || !productItem.lotId) {
                        return productItem;
                    }

                    const match = validTraveteProducts.find(candidate => (
                        candidate.lotId === productItem.lotId
                        && candidate.machineType === employee.machineType
                    ));

                    if (!match) {
                        return productItem;
                    }

                    if (productItem.standardTime === match.standardTime) {
                        return productItem;
                    }

                    employeeChanged = true;
                    return { ...productItem, standardTime: match.standardTime };
                });

                if (!employeeChanged) {
                    return employee;
                }

                hasChanges = true;
                return { ...employee, products: nextProducts };
            });

            if (!hasChanges) {
                return prev;
            }

            return { ...prev, employeeEntries: nextEmployees };
        });
    }, [isTraveteDashboard, validTraveteProducts]);

    const availablePeriods = useMemo(() => FIXED_PERIODS.filter(p => !productionData.some(e => e.period === p)), [productionData]);
    const filteredLots = useMemo(() => [...lots].filter(l => lotFilter === 'ongoing' ? (l.status === 'ongoing' || l.status === 'future') : l.status.startsWith('completed')), [lots, lotFilter]);


    const handleInputChange = (e) => { const { name, value } = e.target; setNewEntry(prev => ({ ...prev, [name]: value, ...(name === 'productId' && { productions: [] }) })); };
    const handleUrgentChange = (e) => setUrgentProduction(prev => ({...prev, [e.target.name]: e.target.value}));
    const handleProductionTotalChange = (index, value) => {
        setNewEntry(prev => {
            const productions = Array.isArray(prev.productions) ? [...prev.productions] : [];
            if (index < 0 || index >= productions.length) {
                return prev;
            }
            const targetProduction = productions[index] || {};
            productions[index] = { ...targetProduction, totalProduced: value };
            return { ...prev, productions };
        });
    };
    const handleProductionVariationChange = (index, variationKey, value) => {
        setNewEntry(prev => {
            const productions = Array.isArray(prev.productions) ? [...prev.productions] : [];
            if (index < 0 || index >= productions.length) {
                return prev;
            }
            const targetProduction = productions[index];
            if (!targetProduction) {
                return prev;
            }
            const variations = Array.isArray(targetProduction.variations)
                ? targetProduction.variations.map(variation => {
                    if (variation.variationKey === variationKey || variation.variationId === variationKey) {
                        return { ...variation, produced: value };
                    }
                    return variation;
                })
                : [];
            const totalProduced = variations.reduce((sum, variation) => {
                const numeric = parseInt(variation.produced, 10);
                if (!Number.isFinite(numeric)) {
                    return sum;
                }
                return sum + Math.max(0, numeric);
            }, 0);
            productions[index] = {
                ...targetProduction,
                variations,
                totalProduced: totalProduced > 0 ? String(totalProduced) : '',
            };
            return { ...prev, productions };
        });
    };
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
            employeeEntries: updateTraveteEmployeeField({
                employees: prev.employeeEntries,
                employeeIndex: index,
                field,
                value,
                lots,
                products: productsForSelectedDate,
                variationLookup: traveteVariationLookup,
                resetManualOnMachineChange: true,
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
            employeeEntries: updateTraveteEmployeeProducts({
                employees: prev.employeeEntries,
                employeeIndex,
                productIndex,
                field,
                value,
                lots,
                products: productsForSelectedDate,
                variationLookup: traveteVariationLookup,
            }),
        }));
    };
    const handleTraveteAddProduct = (employeeIndex) => {
        setTraveteEntry(prev => ({
            ...prev,
            employeeEntries: appendTraveteProductRow(prev.employeeEntries, employeeIndex),
        }));
    };
    const handleTraveteRemoveProduct = (employeeIndex, productIndex) => {
        setTraveteEntry(prev => ({
            ...prev,
            employeeEntries: removeTraveteProductRow(prev.employeeEntries, employeeIndex, productIndex),
        }));
    };
    
    const normalizeBillOfMaterials = useCallback((items = []) => normalizeBillOfMaterialsItems(items), []);

    const handleNewProductBillOfMaterialsChange = useCallback((index, field, value) => {
        setNewProduct(prev => {
            const currentItems = Array.isArray(prev.billOfMaterials) ? [...prev.billOfMaterials] : [];
            const existingItem = currentItems[index] || createEmptyBillOfMaterialsItem();
            let nextItem = { ...existingItem };

            if (field === 'dashboardIds') {
                const sanitized = Array.isArray(value)
                    ? Array.from(new Set(
                        value
                            .map(id => (typeof id === 'string' ? id.trim() : ''))
                            .filter(Boolean),
                    ))
                    : [];
                nextItem.dashboardIds = sanitized;
            } else {
                nextItem = {
                    ...nextItem,
                    [field]: value,
                };
                if (field === 'stockProductId') {
                    nextItem.stockVariationId = '';
                    nextItem.dashboardIds = [];
                }
            }
            currentItems[index] = nextItem;
            return {
                ...prev,
                billOfMaterials: currentItems,
            };
        });
    }, [setNewProduct]);

    const handleAddNewProductBillOfMaterialsItem = useCallback(() => {
        setNewProduct(prev => ({
            ...prev,
            billOfMaterials: [...(prev.billOfMaterials || []), createEmptyBillOfMaterialsItem()],
        }));
    }, [setNewProduct]);

    const handleRemoveNewProductBillOfMaterialsItem = useCallback((index) => {
        setNewProduct(prev => {
            const currentItems = Array.isArray(prev.billOfMaterials) ? [...prev.billOfMaterials] : [];
            const filtered = currentItems.filter((_, itemIndex) => itemIndex !== index);
            return {
                ...prev,
                billOfMaterials: filtered,
            };
        });
    }, [setNewProduct]);

    const handleNewProductVariationChange = useCallback((index, field, value) => {
        setNewProduct(prev => {
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [createEmptyProductVariation()];
            const existingVariation = currentVariations[index] || createEmptyProductVariation();
            const updatedVariation = {
                ...existingVariation,
                [field]: value,
            };
            currentVariations[index] = updatedVariation;
            return {
                ...prev,
                variations: currentVariations,
            };
        });
    }, []);

    const handleNewProductVariationBillOfMaterialsChange = useCallback((variationIndex, itemIndex, field, value) => {
        setNewProduct(prev => {
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [createEmptyProductVariation()];
            const existingVariation = currentVariations[variationIndex] || createEmptyProductVariation();
            const currentItems = Array.isArray(existingVariation.billOfMaterials)
                ? [...existingVariation.billOfMaterials]
                : [];
            const existingItem = currentItems[itemIndex] || createEmptyBillOfMaterialsItem();
            let nextItem = { ...existingItem };

            if (field === 'dashboardIds') {
                const sanitized = Array.isArray(value)
                    ? Array.from(new Set(
                        value
                            .map(id => (typeof id === 'string' ? id.trim() : ''))
                            .filter(Boolean),
                    ))
                    : [];
                nextItem.dashboardIds = sanitized;
            } else {
                nextItem = {
                    ...nextItem,
                    [field]: value,
                };
                if (field === 'stockProductId') {
                    nextItem.stockVariationId = '';
                    nextItem.dashboardIds = [];
                }
            }

            currentItems[itemIndex] = nextItem;
            currentVariations[variationIndex] = {
                ...existingVariation,
                billOfMaterials: currentItems,
                usesDefaultBillOfMaterials: false,
            };

            return {
                ...prev,
                variations: currentVariations,
            };
        });
    }, []);

    const handleAddNewProductVariationBillOfMaterialsItem = useCallback((variationIndex) => {
        setNewProduct(prev => {
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [createEmptyProductVariation()];
            const existingVariation = currentVariations[variationIndex] || createEmptyProductVariation();
            const currentItems = Array.isArray(existingVariation.billOfMaterials)
                ? [...existingVariation.billOfMaterials]
                : [];
            currentVariations[variationIndex] = {
                ...existingVariation,
                billOfMaterials: [...currentItems, createEmptyBillOfMaterialsItem()],
                usesDefaultBillOfMaterials: false,
            };
            return {
                ...prev,
                variations: currentVariations,
            };
        });
    }, []);

    const handleRemoveNewProductVariationBillOfMaterialsItem = useCallback((variationIndex, itemIndex) => {
        setNewProduct(prev => {
            const fallbackHasItems = Array.isArray(prev.billOfMaterials) && prev.billOfMaterials.length > 0;
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [createEmptyProductVariation()];
            const existingVariation = currentVariations[variationIndex] || createEmptyProductVariation();
            const currentItems = Array.isArray(existingVariation.billOfMaterials)
                ? [...existingVariation.billOfMaterials]
                : [];
            const filtered = currentItems.filter((_, idx) => idx !== itemIndex);
            currentVariations[variationIndex] = {
                ...existingVariation,
                billOfMaterials: filtered,
                usesDefaultBillOfMaterials: filtered.length === 0 ? fallbackHasItems : false,
            };
            return {
                ...prev,
                variations: currentVariations,
            };
        });
    }, []);

    const handleAddNewProductVariation = useCallback(() => {
        setNewProduct(prev => ({
            ...prev,
            variations: [
                ...(Array.isArray(prev.variations) ? prev.variations : []),
                {
                    ...createEmptyProductVariation(),
                    billOfMaterials: Array.isArray(prev.billOfMaterials)
                        ? prev.billOfMaterials.map(item => ({ ...item }))
                        : [],
                    usesDefaultBillOfMaterials: Array.isArray(prev.billOfMaterials) && prev.billOfMaterials.length > 0,
                },
            ],
        }));
    }, []);

    const handleRemoveNewProductVariation = useCallback((index) => {
        setNewProduct(prev => {
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [];
            const remaining = currentVariations.filter((_, variationIndex) => variationIndex !== index);
            return {
                ...prev,
                variations: remaining.length > 0
                    ? remaining
                    : [{
                        ...createEmptyProductVariation(),
                        billOfMaterials: Array.isArray(prev.billOfMaterials)
                            ? prev.billOfMaterials.map(item => ({ ...item }))
                            : [],
                        usesDefaultBillOfMaterials: Array.isArray(prev.billOfMaterials) && prev.billOfMaterials.length > 0,
                    }],
            };
        });
    }, []);

    const handleEditingBillOfMaterialsChange = useCallback((index, field, value) => {
        setEditingProductData(prev => {
            const currentItems = Array.isArray(prev.billOfMaterials) ? [...prev.billOfMaterials] : [];
            const existingItem = currentItems[index] || createEmptyBillOfMaterialsItem();
            let nextItem = { ...existingItem };

            if (field === 'dashboardIds') {
                const sanitized = Array.isArray(value)
                    ? Array.from(new Set(
                        value
                            .map(id => (typeof id === 'string' ? id.trim() : ''))
                            .filter(Boolean),
                    ))
                    : [];
                nextItem.dashboardIds = sanitized;
            } else {
                nextItem = {
                    ...nextItem,
                    [field]: value,
                };
                if (field === 'stockProductId') {
                    nextItem.stockVariationId = '';
                    nextItem.dashboardIds = [];
                }
            }
            currentItems[index] = nextItem;
            return {
                ...prev,
                billOfMaterials: currentItems,
            };
        });
    }, [setEditingProductData]);

    const handleAddEditingBillOfMaterialsItem = useCallback(() => {
        setEditingProductData(prev => ({
            ...prev,
            billOfMaterials: [...(prev.billOfMaterials || []), createEmptyBillOfMaterialsItem()],
        }));
    }, [setEditingProductData]);

    const handleRemoveEditingBillOfMaterialsItem = useCallback((index) => {
        setEditingProductData(prev => {
            const currentItems = Array.isArray(prev.billOfMaterials) ? [...prev.billOfMaterials] : [];
            const filtered = currentItems.filter((_, itemIndex) => itemIndex !== index);
            return {
                ...prev,
                billOfMaterials: filtered,
            };
        });
    }, [setEditingProductData]);

    const handleEditingProductVariationChange = useCallback((index, field, value) => {
        setEditingProductData(prev => {
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [createEmptyProductVariation()];
            const existingVariation = currentVariations[index] || createEmptyProductVariation();
            const updatedVariation = {
                ...existingVariation,
                [field]: value,
            };
            currentVariations[index] = updatedVariation;
            return {
                ...prev,
                variations: currentVariations,
            };
        });
    }, []);

    const handleEditingProductVariationBillOfMaterialsChange = useCallback((variationIndex, itemIndex, field, value) => {
        setEditingProductData(prev => {
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [createEmptyProductVariation()];
            const existingVariation = currentVariations[variationIndex] || createEmptyProductVariation();
            const currentItems = Array.isArray(existingVariation.billOfMaterials)
                ? [...existingVariation.billOfMaterials]
                : [];
            const existingItem = currentItems[itemIndex] || createEmptyBillOfMaterialsItem();
            let nextItem = { ...existingItem };

            if (field === 'dashboardIds') {
                const sanitized = Array.isArray(value)
                    ? Array.from(new Set(
                        value
                            .map(id => (typeof id === 'string' ? id.trim() : ''))
                            .filter(Boolean),
                    ))
                    : [];
                nextItem.dashboardIds = sanitized;
            } else {
                nextItem = {
                    ...nextItem,
                    [field]: value,
                };
                if (field === 'stockProductId') {
                    nextItem.stockVariationId = '';
                    nextItem.dashboardIds = [];
                }
            }

            currentItems[itemIndex] = nextItem;
            currentVariations[variationIndex] = {
                ...existingVariation,
                billOfMaterials: currentItems,
                usesDefaultBillOfMaterials: false,
            };

            return {
                ...prev,
                variations: currentVariations,
            };
        });
    }, []);

    const handleAddEditingProductVariationBillOfMaterialsItem = useCallback((variationIndex) => {
        setEditingProductData(prev => {
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [createEmptyProductVariation()];
            const existingVariation = currentVariations[variationIndex] || createEmptyProductVariation();
            const currentItems = Array.isArray(existingVariation.billOfMaterials)
                ? [...existingVariation.billOfMaterials]
                : [];
            currentVariations[variationIndex] = {
                ...existingVariation,
                billOfMaterials: [...currentItems, createEmptyBillOfMaterialsItem()],
                usesDefaultBillOfMaterials: false,
            };
            return {
                ...prev,
                variations: currentVariations,
            };
        });
    }, []);

    const handleRemoveEditingProductVariationBillOfMaterialsItem = useCallback((variationIndex, itemIndex) => {
        setEditingProductData(prev => {
            const fallbackHasItems = Array.isArray(prev.billOfMaterials) && prev.billOfMaterials.length > 0;
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [createEmptyProductVariation()];
            const existingVariation = currentVariations[variationIndex] || createEmptyProductVariation();
            const currentItems = Array.isArray(existingVariation.billOfMaterials)
                ? [...existingVariation.billOfMaterials]
                : [];
            const filtered = currentItems.filter((_, idx) => idx !== itemIndex);
            currentVariations[variationIndex] = {
                ...existingVariation,
                billOfMaterials: filtered,
                usesDefaultBillOfMaterials: filtered.length === 0 ? fallbackHasItems : false,
            };
            return {
                ...prev,
                variations: currentVariations,
            };
        });
    }, []);

    const handleAddEditingProductVariation = useCallback(() => {
        setEditingProductData(prev => ({
            ...prev,
            variations: [
                ...(Array.isArray(prev.variations) ? prev.variations : []),
                {
                    ...createEmptyProductVariation(),
                    billOfMaterials: Array.isArray(prev.billOfMaterials)
                        ? prev.billOfMaterials.map(item => ({ ...item }))
                        : [],
                    usesDefaultBillOfMaterials: Array.isArray(prev.billOfMaterials) && prev.billOfMaterials.length > 0,
                },
            ],
        }));
    }, []);

    const handleRemoveEditingProductVariation = useCallback((index) => {
        setEditingProductData(prev => {
            const currentVariations = Array.isArray(prev.variations) ? [...prev.variations] : [];
            const remaining = currentVariations.filter((_, variationIndex) => variationIndex !== index);
            return {
                ...prev,
                variations: remaining.length > 0
                    ? remaining
                    : [{
                        ...createEmptyProductVariation(),
                        billOfMaterials: Array.isArray(prev.billOfMaterials)
                            ? prev.billOfMaterials.map(item => ({ ...item }))
                            : [],
                        usesDefaultBillOfMaterials: Array.isArray(prev.billOfMaterials) && prev.billOfMaterials.length > 0,
                    }],
            };
        });
    }, []);

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

            const sharedBillOfMaterials = normalizeBillOfMaterials(traveteProductForm.billOfMaterials || []);
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
                    billOfMaterials: sharedBillOfMaterials.map(item => ({ ...item })),
                    createdBy: { uid: user.uid, email: user.email },
                };
                batch.set(doc(db, `dashboards/${currentDashboard.id}/products`, id), productData);
            });

            await batch.commit();
            resetTraveteProductForm();
            return;
        }

        if (!newProduct.name || !newProduct.standardTime) return;
        const productBillOfMaterials = normalizeBillOfMaterials(newProduct.billOfMaterials || []);
        const preparedVariationsForSave = (newProduct.variations || []).map(variation => {
            const hasCustomItems = Array.isArray(variation?.billOfMaterials) && variation.billOfMaterials.length > 0;
            const shouldInheritDefault = !hasCustomItems && productBillOfMaterials.length > 0;
            return shouldInheritDefault
                ? { ...variation, usesDefaultBillOfMaterials: true }
                : variation;
        });
        const productVariations = normalizeProductVariationsForSave(preparedVariationsForSave, productBillOfMaterials);
        if (productVariations.length === 0) {
            alert('Adicione ao menos uma variação válida antes de salvar o produto.');
            return;
        }
        const id = Date.now().toString();
        const newProductData = {
            id,
            name: newProduct.name,
            standardTimeHistory: [{
                time: parseFloat(newProduct.standardTime),
                effectiveDate: new Date().toISOString(),
                changedBy: { uid: user.uid, email: user.email },
            }],
            billOfMaterials: productBillOfMaterials,
            variations: productVariations,
            createdBy: { uid: user.uid, email: user.email },
        };
        await setDoc(doc(db, `dashboards/${currentDashboard.id}/products`, id), newProductData);
        setNewProduct(createEmptyProductDraft());
    };

    const handleStartEditProduct = (product) => {
        if (!product) return;
        setEditingProductId(product.id);
        const history = product.standardTimeHistory || [];
        const latest = history.length > 0 ? history[history.length - 1].time : product.standardTime || '';
        const mappedBillOfMaterials = mapBillOfMaterialsToDraft(product.billOfMaterials || []);
        const mappedVariations = mapProductVariationsToDraft(product.id, product.variations || [], product.billOfMaterials || []);
        setEditingProductData({
            name: product.name,
            standardTime: latest,
            billOfMaterials: mappedBillOfMaterials,
            variations: mappedVariations,
        });
    };

    const cancelProductEditing = useCallback(() => {
        setEditingProductId(null);
        setEditingProductData(createEmptyProductDraft());
    }, [setEditingProductData, setEditingProductId]);

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
        
        const normalizedBillOfMaterials = normalizeBillOfMaterials(editingProductData.billOfMaterials || []);
        const preparedEditingVariations = (editingProductData.variations || []).map(variation => {
            const hasCustomItems = Array.isArray(variation?.billOfMaterials) && variation.billOfMaterials.length > 0;
            const shouldInheritDefault = !hasCustomItems && normalizedBillOfMaterials.length > 0;
            return shouldInheritDefault
                ? { ...variation, usesDefaultBillOfMaterials: true }
                : variation;
        });
        const normalizedVariations = normalizeProductVariationsForSave(preparedEditingVariations, normalizedBillOfMaterials);
        if (normalizedVariations.length === 0) {
            alert('Mantenha ao menos uma variação válida ao salvar o produto.');
            return;
        }

        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/products`, id), {
            name: editingProductData.name,
            standardTimeHistory: newHistory,
            billOfMaterials: normalizedBillOfMaterials,
            variations: normalizedVariations,
            lastEditedBy: { uid: user.uid, email: user.email },
        });

        setEditingProductId(null);
        setEditingProductData(createEmptyProductDraft());
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
    const handleNewLotVariationTargetChange = useCallback((variationId, value) => {
        setNewLot(prev => {
            const existing = Array.isArray(prev.variations) ? prev.variations : [];
            const updatedVariations = existing.map(variation => {
                if (variation.variationId !== variationId) {
                    return variation;
                }
                return { ...variation, target: normalizeLotInputValue(value) };
            });
            const total = computeLotTargetFromVariations(updatedVariations);
            return {
                ...prev,
                variations: updatedVariations,
                target: String(total),
            };
        });
    }, []);

    const handleEditingLotVariationTargetChange = useCallback((variationId, value) => {
        setEditingLotData(prev => {
            const existing = Array.isArray(prev.variations) ? prev.variations : [];
            const updatedVariations = existing.map(variation => {
                if (variation.variationId !== variationId) {
                    return variation;
                }
                return { ...variation, target: normalizeLotInputValue(value) };
            });
            const total = computeLotTargetFromVariations(updatedVariations);
            return {
                ...prev,
                variations: updatedVariations,
                target: String(total),
            };
        });
    }, []);

    const handleCancelLotEdit = useCallback(() => {
        setEditingLotId(null);
        setEditingLotData(createEmptyLotEditState());
    }, []);

    const handleAddLot = async (e) => {
        e.preventDefault();
        if (!currentDashboard) return;

        const hasVariations = Array.isArray(newLot.variations) && newLot.variations.length > 0;
        const variationPayload = hasVariations ? sanitizeLotVariationsForStorage(newLot.variations) : [];
        const totalTarget = hasVariations
            ? variationPayload.reduce((acc, variation) => acc + variation.target, 0)
            : parseLotQuantityValue(newLot.target);

        if (!newLot.productId || totalTarget <= 0) return;

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
        const machineTypePayload = (!isTraveteDashboard && product.machineType)
            ? { machineType: product.machineType }
            : {};

        const newLotData = {
            id,
            sequentialId: lotCounter,
            ...newLot,
            productId: product.id,
            productName: isTraveteDashboard ? (lotBaseMetadata.productBaseName || product.name) : product.name,
            target: totalTarget,
            produced: 0,
            status: 'future',
            order: Date.now(),
            observation: '',
            startDate: null,
            endDate: null,
            createdBy: { uid: user.uid, email: user.email },
            ...(isTraveteDashboard ? lotBaseMetadata : machineTypePayload),
        };
        if (variationPayload.length > 0) {
            newLotData.variations = variationPayload.map(variation => ({
                ...variation,
                produced: 0,
            }));
        }
        await setDoc(doc(db, `dashboards/${currentDashboard.id}/lots`, id), newLotData);
        await applyBillOfMaterialsForLotCreation({
            lotData: newLotData,
            productSources: [productsForSelectedDate, products],
            stockProducts,
            user,
            dashboardId: currentDashboard?.id,
        });
        setNewLot(createEmptyLotFormState());
    };
    const handleStartEditLot = (lot) => {
        const variationState = mapLotVariationsToFormState(lot?.variations || []);
        const totalFromVariations = variationState.length > 0
            ? computeLotTargetFromVariations(variationState)
            : parseLotQuantityValue(lot?.target);
        setEditingLotId(lot.id);
        setEditingLotData({
            target: String(totalFromVariations),
            customName: lot.customName || '',
            variations: variationState,
        });
    };
    const handleSaveLotEdit = async (lotId) => {
        const lot = lots.find(l => l.id === lotId);
        if(!lot) return;

        const hasVariations = Array.isArray(editingLotData.variations) && editingLotData.variations.length > 0;
        const normalizedVariations = hasVariations ? sanitizeLotVariationsForStorage(editingLotData.variations) : [];
        const newTarget = hasVariations
            ? normalizedVariations.reduce((acc, variation) => acc + variation.target, 0)
            : parseLotQuantityValue(editingLotData.target);
        const wasCompleted = lot.status.startsWith('completed');
        const isCompletingNow = newTarget > 0 && lot.produced >= newTarget && !wasCompleted;

        const updatePayload = {
            target: newTarget,
            customName: editingLotData.customName,
            lastEditedBy: { uid: user.uid, email: user.email },
            lastEditedAt: Timestamp.now(),
        };

        if (normalizedVariations.length > 0) {
            updatePayload.variations = normalizedVariations;
        }

        if (isCompletingNow) {
            updatePayload.status = 'completed';
            updatePayload.endDate = new Date().toISOString();
        } else if (wasCompleted && lot.produced < newTarget) {
            updatePayload.status = 'ongoing';
            updatePayload.endDate = null;
        }

        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/lots`, lotId), updatePayload);
        handleCancelLotEdit();
    };
    const newLotVariations = Array.isArray(newLot.variations) ? newLot.variations : [];
    const newLotHasVariations = newLotVariations.length > 0;
    const newLotTotalTarget = computeLotTargetFromVariations(newLotVariations);
    const canCreateLot = Boolean(newLot.productId) && (
        newLotHasVariations
            ? newLotTotalTarget > 0
            : parseLotQuantityValue(newLot.target) > 0
    );

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

    const navigationButtons = useMemo(() => {
        return [
            onNavigateToOperationalSequence
                ? {
                    key: 'operational-sequence',
                    label: 'Sequência Operacional',
                    icon: Layers,
                    onClick: onNavigateToOperationalSequence,
                }
                : null,
            onNavigateToStock
                ? {
                    key: 'stock-management',
                    label: 'Gerenciamento de Estoque',
                    icon: Warehouse,
                    onClick: onNavigateToStock,
                }
                : null,
            onNavigateToFichaTecnica
                ? {
                    key: 'ficha-tecnica',
                    label: 'Ficha Técnica',
                    icon: ClipboardList,
                    onClick: onNavigateToFichaTecnica,
                }
                : null,
            onNavigateToReports
                ? {
                    key: 'reports',
                    label: 'Relatórios',
                    icon: BarChart,
                    onClick: onNavigateToReports,
                }
                : null,
        ].filter(Boolean);
    }, [onNavigateToOperationalSequence, onNavigateToStock, onNavigateToReports, onNavigateToFichaTecnica]);

    const userActionButtons = useMemo(() => {
        const actions = [];
        actions.push({
            key: 'tv-mode',
            icon: Monitor,
            onClick: handleSelectTvMode,
            title: 'Modo TV',
            ariaLabel: 'Modo TV',
            baseClassName: 'p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700',
        });

        if (permissions.MANAGE_SETTINGS) {
            actions.push({
                key: 'settings',
                icon: Settings,
                onClick: () => setModalState({ type: 'adminSettings' }),
                title: 'Configurações',
                ariaLabel: 'Configurações',
            });
        }

        return actions;
    }, [handleSelectTvMode, permissions.MANAGE_SETTINGS, setModalState]);

    if (!currentDashboard) {
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p className="text-xl">Carregando quadros...</p></div>;
    }

    const handleToggleDashboardNav = () => {
        setIsNavOpen(prev => !prev);
    };

    const handleSelectDashboardFromNav = (dash, index) => {
        setCurrentDashboardIndex(index);
        setIsNavOpen(false);
    };

    const handleRenameDashboardRequest = (dash) => {
        setIsNavOpen(false);
        setModalState({
            type: 'dashboardAction',
            data: {
                mode: 'rename',
                initialName: dash.name,
                onConfirm: (newName) => handleRenameDashboard(dash.id, newName),
            },
        });
    };

    const handleDeleteDashboardRequest = (dash) => {
        setIsNavOpen(false);
        setModalState({
            type: 'confirmation',
            data: {
                title: 'Confirmar Exclusão',
                message: `Tem certeza que deseja excluir o quadro "${dash.name}"?`,
                onConfirm: () => handleDeleteDashboard(dash.id),
            },
        });
    };

    const handleCreateDashboardRequest = () => {
        setIsNavOpen(false);
        setModalState({
            type: 'dashboardAction',
            data: {
                mode: 'create',
                onConfirm: handleAddDashboard,
            },
        });
    };

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
            <PasswordModal isOpen={modalState.type === 'password'} onClose={closeModal} onSuccess={modalState.data?.onSuccess} />
            <ReasonModal isOpen={modalState.type === 'reason'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} />
            <AdminPanelModal isOpen={modalState.type === 'adminSettings'} onClose={closeModal} users={users} roles={roles} />
            <TvSelectorModal isOpen={modalState.type === 'tvSelector'} onClose={closeModal} onSelect={startTvMode} onStartCarousel={startTvMode} dashboards={dashboards} />
            <HeaderContainer>
                <GlobalNavigation
                    logoSrc={raceBullLogoUrl}
                    currentDashboard={currentDashboard}
                    dashboards={dashboards}
                    navRef={navRef}
                    isNavOpen={isNavOpen}
                    onToggleNav={handleToggleDashboardNav}
                    onSelectDashboard={handleSelectDashboardFromNav}
                    onMoveDashboard={(dash, direction) => handleMoveDashboard(dash.id, direction)}
                    onRenameDashboard={handleRenameDashboardRequest}
                    onDeleteDashboard={handleDeleteDashboardRequest}
                    onCreateDashboard={permissions.MANAGE_DASHBOARDS ? handleCreateDashboardRequest : undefined}
                    canManageDashboards={permissions.MANAGE_DASHBOARDS}
                    navigationButtons={navigationButtons}
                    userEmail={user.email}
                    onLogout={logout}
                    userActions={userActionButtons}
                    theme={theme}
                    onToggleTheme={toggleTheme}
                />
            </HeaderContainer>

            
            <main className="p-4 md:p-8 grid grid-cols-1 gap-8 responsive-main">
                 <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                     <div className="lg:col-span-1">
                         <CalendarView selectedDate={selectedDate} setSelectedDate={setSelectedDate} currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} calendarView={calendarView} setCalendarView={setCalendarView} allProductionData={allProductionData} />
                     </div>
                    <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:auto-rows-fr">
                        <SummaryCard
                            title="Resumo Mensal"
                            className="text-center"
                            titleClassName="text-lg font-semibold text-gray-700 dark:text-gray-200"
                            contentClassName="flex-1 mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300"
                        >
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
                        </SummaryCard>
                        <SummaryCard
                            title="Resumo do Dia"
                            className="text-center"
                            titleClassName="text-lg font-semibold text-gray-700 dark:text-gray-200"
                            contentClassName="flex-1 mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300"
                        >
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
                        </SummaryCard>
                    </div>
                 </section>
                 <h2 className="text-2xl font-bold border-b-2 border-blue-500 pb-2">Resultados de: {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</h2>
                 <LotReport lots={lots} products={productsForSelectedDate}/>
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-fr">
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
                                        const metaInfo = traveteEntrySummary.employeeSummaries[index] || {};
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
                                         <span className="font-bold text-base text-blue-700 dark:text-blue-200 text-center">{traveteEntrySummary.lotDisplay || '- // -'}</span>
                                     </div>
                                    <div className="flex flex-col justify-center items-center bg-blue-100 dark:bg-blue-900/50 p-3 rounded-md shadow-inner w-full md:w-64">
                                        <label className="text-sm font-medium text-gray-800 dark:text-gray-200">Meta Prevista</label>
                                        <span className={`font-bold text-xl ${travetePreviewPending ? 'text-yellow-500 dark:text-yellow-300' : 'text-blue-600 dark:text-blue-300'}`}>
                                            {traveteEntrySummary.goalDisplay || '- // -'}
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
                                            {sortedProductsForSelectedDate.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                         </select>
                                     </div>
                                 </div>
                                <div className="flex flex-col space-y-4">
                                    <div className="flex flex-wrap gap-4 items-start">
                                        {regularPredictions.map((lot, index) => {
                                            const productionState = newEntry.productions[index] || {};
                                            const variations = Array.isArray(productionState.variations) ? productionState.variations : [];
                                            const hasVariations = variations.length > 0;
                                            const lotLabel = lot.productName || lot.name || `Lote ${index + 1}`;
                                            return (
                                                <div
                                                    key={lot.id || lot.productId || `prediction-${index}`}
                                                    className="flex flex-col gap-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 min-w-[180px]"
                                                >
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">{lotLabel}</span>
                                                        {Number.isFinite(lot?.remainingPieces) && (
                                                            <span className="text-xs text-gray-500 dark:text-gray-400">Restante: {lot.remainingPieces}</span>
                                                        )}
                                                    </div>
                                                    {hasVariations ? (
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            {variations.map(variation => {
                                                                const variationLabel = variation.label && variation.label.trim().length > 0
                                                                    ? variation.label
                                                                    : 'Sem descrição';
                                                                return (
                                                                    <div
                                                                        key={variation.variationKey}
                                                                        className="p-2 rounded-md bg-white dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 space-y-1"
                                                                    >
                                                                        <div className="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-300">
                                                                            <span className="truncate" title={variationLabel}>{variationLabel}</span>
                                                                            <span>{variation.currentProduced || 0} / {variation.target || 0}</span>
                                                                        </div>
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            value={variation.produced || ''}
                                                                            onChange={(e) => handleProductionVariationChange(index, variation.variationKey, e.target.value)}
                                                                            className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                                        />
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col gap-1">
                                                            <label className="text-xs text-gray-500 dark:text-gray-400" htmlFor={`prod-input-${index}`}>
                                                                Quantidade Produzida
                                                            </label>
                                                            <input
                                                                id={`prod-input-${index}`}
                                                                type="number"
                                                                min="0"
                                                                value={productionState.totalProduced || ''}
                                                                onChange={(e) => handleProductionTotalChange(index, e.target.value)}
                                                                className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
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
                          <form onSubmit={handleAddLot} className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                  <div className="flex flex-col">
                                      <label htmlFor="newLotProduct">Produto</label>
                                      <select
                                          id="newLotProduct"
                                          name="productId"
                                          value={newLot.productId}
                                          onChange={event => {
                                              const value = event.target.value;
                                              setNewLot(prev => ({
                                                  ...prev,
                                                  productId: value,
                                                  target: '',
                                                  variations: [],
                                              }));
                                          }}
                                          required
                                          className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                      >
                                          <option value="">Selecione...</option>
                                          {isTraveteDashboard ? (
                                              traveteGroupedProducts.map(group => (
                                                  <option key={group.baseId} value={group.baseId}>
                                                      {group.baseName}
                                                  </option>
                                              ))
                                          ) : (
                                              [...products]
                                                  .sort((a, b) => a.name.localeCompare(b.name))
                                                  .map(p => (
                                                      <option key={p.id} value={p.id}>
                                                          {p.name}
                                                      </option>
                                                  ))
                                          )}
                                      </select>
                                  </div>
                                  {newLotHasVariations ? (
                                      <div className="flex flex-col md:col-span-2">
                                          <label className="text-sm font-medium mb-1">Meta total</label>
                                          <div className="p-2 rounded-md bg-gray-100 dark:bg-gray-700 font-semibold text-gray-800 dark:text-gray-100">
                                              {newLotTotalTarget} peças
                                          </div>
                                      </div>
                                  ) : (
                                      <div className="flex flex-col">
                                          <label htmlFor="newLotTarget">Quantidade</label>
                                          <input
                                              type="number"
                                              id="newLotTarget"
                                              name="target"
                                              min="0"
                                              value={newLot.target}
                                              onChange={event => setNewLot(prev => ({ ...prev, target: normalizeLotInputValue(event.target.value) }))}
                                              required={!newLotHasVariations}
                                              className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                          />
                                      </div>
                                  )}
                                  <div className="flex flex-col">
                                      <label htmlFor="newLotCustomName">Nome (Opcional)</label>
                                      <input
                                          type="text"
                                          id="newLotCustomName"
                                          name="customName"
                                          value={newLot.customName}
                                          onChange={event => setNewLot(prev => ({ ...prev, customName: event.target.value }))}
                                          className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                      />
                                  </div>
                                  <button
                                      type="submit"
                                      className="h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                      disabled={!canCreateLot}
                                  >
                                      Criar Lote
                                  </button>
                              </div>
                              {newLotHasVariations && (
                                  <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800/40">
                                      <span className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Grade de Produção</span>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                          {newLotVariations.map(variation => {
                                              const label = variation.label && variation.label.trim().length > 0
                                                  ? variation.label
                                                  : 'Sem descrição';
                                              return (
                                                  <div
                                                      key={variation.variationId}
                                                      className="p-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-2"
                                                  >
                                                      <div className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-200">
                                                          <span>{label}</span>
                                                          <span className="text-xs text-gray-500 dark:text-gray-400">Meta</span>
                                                      </div>
                                                      <input
                                                          type="number"
                                                          min="0"
                                                          value={variation.target}
                                                          onChange={event => handleNewLotVariationTargetChange(variation.variationId, event.target.value)}
                                                          className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                      />
                                                  </div>
                                              );
                                          })}
                                      </div>
                                      <div className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-200">
                                          Meta total: {newLotTotalTarget} peças
                                      </div>
                                  </div>
                              )}
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
                              const isEditingCurrentLot = editingLotId === lot.id;
                              const editingVariationState = isEditingCurrentLot
                                  ? (Array.isArray(editingLotData.variations) ? editingLotData.variations : [])
                                  : [];
                              const editingHasVariationsForLot = editingVariationState.length > 0;
                              const editingTotalTargetForLot = isEditingCurrentLot
                                  ? (editingHasVariationsForLot
                                      ? computeLotTargetFromVariations(editingVariationState)
                                      : parseLotQuantityValue(editingLotData.target))
                                  : 0;
                              const lotVariations = Array.isArray(lot.variations) ? lot.variations : [];
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
                                  <div className="mt-2 space-y-3">
                                      <div className="flex justify-between text-sm items-start flex-col sm:flex-row sm:items-center gap-2">
                                          <span className="font-medium">Progresso</span>
                                          {isEditingCurrentLot ? (
                                              <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                                                  <div className="flex items-center gap-2 text-sm">
                                                      <span>{lot.produced || 0} / </span>
                                                      {editingHasVariationsForLot ? (
                                                          <span className="font-semibold text-blue-600 dark:text-blue-300">{editingTotalTargetForLot}</span>
                                                      ) : (
                                                          <input
                                                              type="number"
                                                              min="0"
                                                              value={editingLotData.target}
                                                              onChange={event => setEditingLotData(prev => ({ ...prev, target: normalizeLotInputValue(event.target.value) }))}
                                                              className="p-1 w-24 rounded-md bg-gray-100 dark:bg-gray-700"
                                                          />
                                                      )}
                                                  </div>
                                                  <input
                                                      type="text"
                                                      value={editingLotData.customName}
                                                      onChange={event => setEditingLotData(prev => ({ ...prev, customName: event.target.value }))}
                                                      className="p-1 w-full sm:w-32 rounded-md bg-gray-100 dark:bg-gray-700"
                                                      placeholder="Nome"
                                                  />
                                                  <div className="flex items-center gap-2">
                                                      <button onClick={() => handleSaveLotEdit(lot.id)} className="text-green-600 hover:text-green-500" title="Salvar alterações">
                                                          <Save size={16} />
                                                      </button>
                                                      <button onClick={handleCancelLotEdit} className="text-red-500 hover:text-red-400" title="Cancelar edição">
                                                          <XCircle size={16} />
                                                      </button>
                                                  </div>
                                              </div>
                                          ) : (
                                              <span>{lot.produced || 0} / {lot.target || 0}</span>
                                          )}
                                      </div>
                                      <div className="w-full bg-gray-200 dark:bg-gray-600 h-2.5 rounded-full">
                                          <div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${((lot.produced||0)/(lot.target||1))*100}%`}}></div>
                                      </div>
                                      {isEditingCurrentLot && editingHasVariationsForLot && (
                                          <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-3 bg-white/60 dark:bg-gray-900/40 space-y-3">
                                              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Grade do lote</span>
                                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                  {editingVariationState.map(variation => {
                                                      const label = variation.label && variation.label.trim().length > 0 ? variation.label : 'Sem descrição';
                                                      const producedValue = parseLotQuantityValue(variation.produced);
                                                      return (
                                                          <div key={variation.variationId} className="p-3 rounded-md bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-2">
                                                              <div className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-200">
                                                                  <span>{label}</span>
                                                                  <span className="text-xs text-gray-500 dark:text-gray-400">Produzido: {producedValue}</span>
                                                              </div>
                                                              <input
                                                                  type="number"
                                                                  min="0"
                                                                  value={variation.target}
                                                                  onChange={event => handleEditingLotVariationTargetChange(variation.variationId, event.target.value)}
                                                                  className="w-full p-2 rounded-md bg-white dark:bg-gray-900"
                                                              />
                                                          </div>
                                                      );
                                                  })}
                                              </div>
                                              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Meta total: {editingTotalTargetForLot} peças</div>
                                          </div>
                                      )}
                                      {!isEditingCurrentLot && lotVariations.length > 0 && (
                                          <LotVariationSummary variations={lotVariations} />
                                      )}
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
                                                              const columnCount = permissions.MANAGE_PRODUCTS ? 6 : 5;
                                                              return (
                                                                  <React.Fragment key={variation.id}>
                                                                      <tr className="text-sm">
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
                                                                                          <button onClick={cancelProductEditing} title="Cancelar"><XCircle size={18} className="text-gray-500" /></button>
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
                                                                      {isEditing && (
                                                                          <tr className="bg-gray-50 dark:bg-gray-800/60">
                                                                              <td colSpan={columnCount} className="p-3">
                                                                                  <div className="space-y-4">
                                                                                      <div className="space-y-3">
                                                                                          <div className="flex items-center justify-between">
                                                                                              <h4 className="text-md font-medium">Tamanhos / Variações</h4>
                                                                                              <button
                                                                                                  type="button"
                                                                                                  onClick={handleAddEditingProductVariation}
                                                                                                  className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-500"
                                                                                              >
                                                                                                  Adicionar variação
                                                                                              </button>
                                                                                          </div>
                                                                                          <div className="space-y-3">
                                                                                              {(editingProductData.variations || []).map((variation, index) => (
                                                                                                  <div key={variation.id || index} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end border border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                                                                                      <div className="md:col-span-7">
                                                                                                          <label className="block text-sm font-medium mb-1">Descrição / Tamanho</label>
                                                                                                          <input
                                                                                                              type="text"
                                                                                                              value={variation.label}
                                                                                                              onChange={(event) => handleEditingProductVariationChange(index, 'label', event.target.value)}
                                                                                                              className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                                                                              placeholder="Ex.: P, M, G"
                                                                                                          />
                                                                                                      </div>
                                                                                                      <div className="md:col-span-4">
                                                                                                          <label className="block text-sm font-medium mb-1">Meta padrão</label>
                                                                                                          <input
                                                                                                              type="number"
                                                                                                              min="0"
                                                                                                              step="1"
                                                                                                              value={variation.defaultTarget}
                                                                                                              onChange={(event) => handleEditingProductVariationChange(index, 'defaultTarget', event.target.value)}
                                                                                                              className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                                                                              placeholder="Qtd"
                                                                                                          />
                                                                                                      </div>
                                                                                                      <div className="md:col-span-1 flex md:justify-center justify-end">
                                                                                                          <button
                                                                                                              type="button"
                                                                                                              onClick={() => handleRemoveEditingProductVariation(index)}
                                                                                                              disabled={(editingProductData.variations || []).length <= 1}
                                                                                                              className="p-2 rounded-full bg-red-500 text-white hover:bg-red-400 disabled:opacity-40"
                                                                                                              aria-label="Remover variação"
                                                                                                          >
                                                                                                              <Trash2 size={16} />
                                                                                                          </button>
                                                                                                      </div>
                                                                                                      <div className="md:col-span-12 space-y-2">
                                                                                                          <BillOfMaterialsEditor
                                                                                                              title="Ficha Técnica da variação"
                                                                                                              items={variation.billOfMaterials || []}
                                                                                                              onChangeItem={(itemIndex, field, value) => handleEditingProductVariationBillOfMaterialsChange(index, itemIndex, field, value)}
                                                                                                              onAddItem={() => handleAddEditingProductVariationBillOfMaterialsItem(index)}
                                                                                                              onRemoveItem={(itemIndex) => handleRemoveEditingProductVariationBillOfMaterialsItem(index, itemIndex)}
                                                                                                              stockProducts={stockProducts}
                                                                                                              stockCategoryMap={stockCategoryMap}
                                                                                                              dashboards={dashboards}
                                                                                                              currentDashboardId={currentDashboard?.id}
                                                                                                              emptyLabel="Nenhum componente vinculado para esta variação."
                                                                                                          />
                                                                                                          {variation.usesDefaultBillOfMaterials && (
                                                                                                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                                                                                                  Herdando a ficha técnica padrão até ser personalizada.
                                                                                                              </p>
                                                                                                          )}
                                                                                                      </div>
                                                                                                  </div>
                                                                                              ))}
                                                                                          </div>
                                                                                      </div>
                                                                                      <BillOfMaterialsEditor
                                                                                          title="Ficha Técnica"
                                                                                          items={editingProductData.billOfMaterials || []}
                                                                                          onChangeItem={handleEditingBillOfMaterialsChange}
                                                                                          onAddItem={handleAddEditingBillOfMaterialsItem}
                                                                                          onRemoveItem={handleRemoveEditingBillOfMaterialsItem}
                                                                                          stockProducts={stockProducts}
                                                                                          stockCategoryMap={stockCategoryMap}
                                                                                          emptyLabel="Nenhum componente vinculado ainda."
                                                                                          dashboards={dashboards}
                                                                                          currentDashboardId={currentDashboard?.id}
                                                                                      />
                                                                                  </div>
                                                                              </td>
                                                                          </tr>
                                                                      )}
                                                                  </React.Fragment>
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
                               <form onSubmit={handleAddProduct} className="space-y-4">
                                   <div>
                                       <label htmlFor="newProductName" className="block text-sm font-medium mb-1">Nome</label>
                                       <input
                                           type="text"
                                           id="newProductName"
                                           value={newProduct.name}
                                           onChange={e => setNewProduct(prev => ({ ...prev, name: e.target.value }))}
                                           required
                                           className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                       />
                                   </div>
                                   <div>
                                       <label htmlFor="newProductTime" className="block text-sm font-medium mb-1">Tempo Padrão (min)</label>
                                       <input
                                           type="number"
                                           id="newProductTime"
                                           value={newProduct.standardTime}
                                           onChange={e => setNewProduct(prev => ({ ...prev, standardTime: e.target.value }))}
                                           step="0.01"
                                           required
                                           className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                       />
                                   </div>
                                   <div className="space-y-3">
                                       <div className="flex items-center justify-between">
                                           <span className="text-sm font-medium">Tamanhos / Variações</span>
                                           <button
                                               type="button"
                                               onClick={handleAddNewProductVariation}
                                               className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-500"
                                           >
                                               Adicionar variação
                                           </button>
                                       </div>
                                       <div className="space-y-3">
                                           {(newProduct.variations || []).map((variation, index) => (
                                               <div key={variation.id || index} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end border border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                                   <div className="md:col-span-7">
                                                       <label className="block text-sm font-medium mb-1">Descrição / Tamanho</label>
                                                       <input
                                                           type="text"
                                                           value={variation.label}
                                                           onChange={(event) => handleNewProductVariationChange(index, 'label', event.target.value)}
                                                           className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                           placeholder="Ex.: P, M, G"
                                                       />
                                                   </div>
                                                   <div className="md:col-span-4">
                                                       <label className="block text-sm font-medium mb-1">Meta padrão</label>
                                                       <input
                                                           type="number"
                                                           min="0"
                                                           step="1"
                                                           value={variation.defaultTarget}
                                                           onChange={(event) => handleNewProductVariationChange(index, 'defaultTarget', event.target.value)}
                                                           className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"
                                                           placeholder="Qtd"
                                                       />
                                                   </div>
                                                   <div className="md:col-span-1 flex md:justify-center justify-end">
                                                       <button
                                                           type="button"
                                                           onClick={() => handleRemoveNewProductVariation(index)}
                                                           disabled={(newProduct.variations || []).length <= 1}
                                                           className="p-2 rounded-full bg-red-500 text-white hover:bg-red-400 disabled:opacity-40"
                                                           aria-label="Remover variação"
                                                       >
                                                           <Trash2 size={16} />
                                                       </button>
                                                   </div>
                                                   <div className="md:col-span-12 space-y-2">
                                                       <BillOfMaterialsEditor
                                                           title="Ficha Técnica da variação"
                                                           items={variation.billOfMaterials || []}
                                                           onChangeItem={(itemIndex, field, value) => handleNewProductVariationBillOfMaterialsChange(index, itemIndex, field, value)}
                                                           onAddItem={() => handleAddNewProductVariationBillOfMaterialsItem(index)}
                                                           onRemoveItem={(itemIndex) => handleRemoveNewProductVariationBillOfMaterialsItem(index, itemIndex)}
                                                           stockProducts={stockProducts}
                                                           stockCategoryMap={stockCategoryMap}
                                                           dashboards={dashboards}
                                                           currentDashboardId={currentDashboard?.id}
                                                           emptyLabel="Nenhum componente vinculado para esta variação."
                                                       />
                                                       {variation.usesDefaultBillOfMaterials && (
                                                           <p className="text-xs text-gray-500 dark:text-gray-400">
                                                               Herdando a ficha técnica padrão até ser personalizada.
                                                           </p>
                                                       )}
                                                   </div>
                                               </div>
                                           ))}
                                       </div>
                                   </div>
                                   <div className="space-y-3">
                                       <BillOfMaterialsEditor
                                           title="Ficha Técnica"
                                           items={newProduct.billOfMaterials || []}
                                           onChangeItem={handleNewProductBillOfMaterialsChange}
                                           onAddItem={handleAddNewProductBillOfMaterialsItem}
                                           onRemoveItem={handleRemoveNewProductBillOfMaterialsItem}
                                           stockProducts={stockProducts}
                                           stockCategoryMap={stockCategoryMap}
                                           emptyLabel="Nenhum componente vinculado ainda."
                                           dashboards={dashboards}
                                           currentDashboardId={currentDashboard?.id}
                                       />
                                   </div>
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
    const columnCount = permissions.MANAGE_PRODUCTS ? 5 : 4;

    return (
        <React.Fragment key={p.id}>
            <tr className={!didExistOnDate ? 'bg-red-50 dark:bg-red-900/20' : ''}>
                {editingProductId === p.id ? (
                    <>
                        <td className="p-2">
                            <input
                                type="text"
                                value={editingProductData.name}
                                onChange={e => handleEditingProductFieldChange('name', e.target.value)}
                                className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600"
                            />
                        </td>
                        <td className="p-2">
                            <input
                                type="number"
                                step="0.01"
                                value={editingProductData.standardTime}
                                onChange={e => handleEditingProductFieldChange('standardTime', e.target.value)}
                                className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600"
                            />
                        </td>
                        <td colSpan="2"></td>
                        {permissions.MANAGE_PRODUCTS && (
                            <td className="p-3">
                                <div className="flex gap-2 justify-center">
                                    <button onClick={() => handleSaveProduct(p.id)} title="Salvar"><Save size={18} className="text-green-500" /></button>
                                                                                              <button onClick={cancelProductEditing} title="Cancelar"><XCircle size={18} className="text-gray-500" /></button>
                                </div>
                            </td>
                        )}
                    </>
                ) : (
                    <>
                        <td className={`p-3 font-semibold ${!didExistOnDate ? 'text-red-500' : ''}`}>{p.name}{!didExistOnDate && ' (Não existia)'}</td>
                        <td className="p-3">
                            {historicalTime} min
                            {didExistOnDate && currentTime !== historicalTime && (
                                <span className="text-xs text-gray-500 ml-2">(Atual: {currentTime} min)</span>
                            )}
                        </td>
                        <td className="p-3 text-xs truncate">{p.createdBy?.email}</td>
                        <td className="p-3 text-xs truncate">{p.lastEditedBy?.email}</td>
                        {permissions.MANAGE_PRODUCTS && (
                            <td className="p-3">
                                <div className="flex gap-2 justify-center">
                                    <button onClick={() => handleStartEditProduct(p)} title="Editar"><Edit size={18} className="text-yellow-500 hover:text-yellow-400" /></button>
                                    <button onClick={() => handleDeleteProduct(p.id)} title="Excluir"><Trash2 size={18} className="text-red-500 hover:text-red-400" /></button>
                                </div>
                            </td>
                        )}
                    </>
                )}
            </tr>
            {editingProductId === p.id && (
                <tr className="bg-gray-50 dark:bg-gray-800/60">
                    <td colSpan={columnCount} className="p-3">
                        <BillOfMaterialsEditor
                            title="Ficha Técnica"
                            items={editingProductData.billOfMaterials || []}
                            onChangeItem={handleEditingBillOfMaterialsChange}
                            onAddItem={handleAddEditingBillOfMaterialsItem}
                            onRemoveItem={handleRemoveEditingBillOfMaterialsItem}
                            stockProducts={stockProducts}
                            stockCategoryMap={stockCategoryMap}
                            emptyLabel="Nenhum componente vinculado ainda."
                            dashboards={dashboards}
                            currentDashboardId={currentDashboard?.id}
                        />
                    </td>
                </tr>
            )}
        </React.Fragment>
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
            setProducts(snap.docs.map(docSnap => {
                const data = docSnap.data();
                const productId = data?.id || docSnap.id;
                const productBillOfMaterials = normalizeBillOfMaterialsItems(data?.billOfMaterials || []);
                const rawVariations = Array.isArray(data?.variations) ? data.variations : [];
                const sanitizedVariations = sanitizeProductVariationsArray(productId, rawVariations, productBillOfMaterials);
                return {
                    ...data,
                    id: productId,
                    billOfMaterials: productBillOfMaterials,
                    variations: sanitizedVariations,
                };
            }));
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
                const validTimeEntry = p.standardTimeHistory
                    .filter(h => new Date(h.effectiveDate) <= targetDate)
                    .pop();
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
        if (!isTraveteDashboard) return [];
        return buildTraveteProcessedEntries(productionData, productMapForSelectedDate);
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
                if (newTraveteEntry) {
                    const employees = Array.isArray(newTraveteEntry.employees) ? newTraveteEntry.employees : [];
                    const toFiniteNumber = value => {
                        if (typeof value === 'number') {
                            return Number.isFinite(value) ? value : 0;
                        }
                        const parsed = parseFloat(value);
                        return Number.isFinite(parsed) ? parsed : 0;
                    };
                    const totalProduced = employees.reduce((sum, emp) => sum + toFiniteNumber(emp.produced), 0);
                    const averageEfficiency = employees.length > 0
                        ? employees.reduce((sum, emp) => sum + toFiniteNumber(emp.efficiency), 0) / employees.length
                        : 0;
                    if (totalProduced > 0 && averageEfficiency < 65) {
                        setShowFullScreenAlert(true);
                    }
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
    const [dashboardsLoading, setDashboardsLoading] = useState(true);
    const [permissionsLoading, setPermissionsLoading] = useState(true);
    const [dataError, setDataError] = useState(null);

    useEffect(() => {
        localStorage.setItem('lastDashboardIndex', currentDashboardIndex);
    }, [currentDashboardIndex]);
    
    useEffect(() => {
        let unsubDashboards;
        let isActive = true;

        if (!user) {
            setDashboards([]);
            setUsersWithRoles([]);
            setUserPermissions({});
            setDashboardsLoading(false);
            setPermissionsLoading(false);
            setDataError(null);
            return () => {};
        }

        const buildEmptyPermissionsMap = () => Object.keys(ALL_PERMISSIONS).reduce((acc, key) => {
            acc[key] = false;
            return acc;
        }, {});

        setDashboards([]);
        setUsersWithRoles([]);
        setUserPermissions({});
        setDashboardsLoading(true);
        setPermissionsLoading(true);
        setDataError(null);

        const dashboardsQuery = query(collection(db, "dashboards"), orderBy("order"));

        const setupDataAndListeners = async () => {
            let dashboardsFetched = false;
            try {
                const initialDashboardsSnap = await getDocs(dashboardsQuery);
                dashboardsFetched = true;
                if (!isActive) return;

                if (initialDashboardsSnap.empty) {
                    console.log("Nenhum dashboard encontrado, criando dados iniciais...");
                    try {
                        const batch = writeBatch(db);
                        initialDashboards.forEach(dash => {
                            const docRef = doc(db, "dashboards", dash.id);
                            batch.set(docRef, dash);
                        });
                        await batch.commit();
                        console.log("Dashboards iniciais criados com sucesso.");
                        if (!isActive) return;
                        setDashboards(initialDashboards.map(dash => ({ ...dash })));
                    } catch (error) {
                        if (error?.code === 'permission-denied') {
                            console.warn("Sem permissão para criar dashboards iniciais. Prosseguindo em modo somente leitura.", error);
                            if (isActive) {
                                setDashboards([]);
                            }
                        } else {
                            throw error;
                        }
                    }
                } else {
                    const initialData = initialDashboardsSnap.docs.map(d => d.data());
                    if (!isActive) return;
                    setDashboards(initialData);
                }
                setDashboardsLoading(false);
            } catch (error) {
                console.error("ERRO CRÍTICO AO CARREGAR DASHBOARDS:", error);
                if (!isActive) return;

                if (dashboardsFetched && error?.code === 'permission-denied') {
                    console.warn("Sem permissão de escrita para criar dashboards padrão. Prosseguindo em modo somente leitura.", error);
                    setDashboards([]);
                    setDashboardsLoading(false);
                    setPermissionsLoading(false);
                } else {
                    setDataError('Não foi possível carregar os dashboards do usuário.');
                    setDashboardsLoading(false);
                    setPermissionsLoading(false);
                    return;
                }
            }

            unsubDashboards = onSnapshot(dashboardsQuery, (snap) => {
                if (!isActive) return;
                const fetchedDashboards = snap.docs.map(d => d.data());
                setDashboards(fetchedDashboards);
                setDashboardsLoading(false);
            }, (error) => {
                console.error("Erro no listener de Dashboards:", error);
                if (!isActive) return;
                setDashboardsLoading(false);
            });

            try {
                const [rolesSnap, usersSnap] = await Promise.all([
                    getDocs(collection(db, "roles")),
                    getDocs(collection(db, "users")),
                ]);
                if (!isActive) return;

                const rolesData = new Map(rolesSnap.docs.map(d => [d.id, d.data()]));
                const usersData = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

                const combinedUsers = usersData.map(u => ({ ...u, permissions: rolesData.get(u.uid)?.permissions || [] }));
                if (!isActive) return;
                setUsersWithRoles(combinedUsers);

                const currentUserPermissionsDoc = rolesData.get(user.uid);
                let permissionsList = currentUserPermissionsDoc?.permissions || [];

                if (currentUserPermissionsDoc?.role === 'admin') {
                    permissionsList = Object.keys(ALL_PERMISSIONS);
                }

                const permissionsMap = Object.keys(ALL_PERMISSIONS).reduce((acc, key) => {
                    acc[key] = permissionsList.includes(key);
                    return acc;
                }, {});

                if (!isActive) return;
                setUserPermissions(permissionsMap);
                setPermissionsLoading(false);
            } catch (error) {
                console.error("Erro ao carregar permissões ou usuários:", error);
                if (!isActive) return;
                setUsersWithRoles([]);
                setUserPermissions(buildEmptyPermissionsMap());
                setPermissionsLoading(false);
            }
        };

        setupDataAndListeners();

        return () => {
            isActive = false;
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

    if (dashboardsLoading || permissionsLoading) {
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p className="text-xl">Carregando dados do usuário...</p></div>;
    }

    if (dataError) {
        return (
            <div className="min-h-screen bg-gray-100 dark:bg-black flex flex-col justify-center items-center space-y-4 text-center">
                <p className="text-xl font-semibold">Não foi possível carregar os dados do usuário.</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{dataError}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                    Tentar novamente
                </button>
            </div>
        );
    }

    if (dashboards.length === 0) {
        return (
            <div className="min-h-screen bg-gray-100 dark:bg-black flex flex-col justify-center items-center space-y-2 text-center">
                <p className="text-xl font-semibold">Nenhum dashboard configurado.</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">Verifique se você possui permissões para visualizar os quadros ou contate um administrador.</p>
            </div>
        );
    }

    if (tvMode && currentApp === 'cronoanalise') {
        return <TvModeDisplay tvOptions={tvMode} stopTvMode={stopTvMode} dashboards={dashboards} />;
    }

    if (currentApp === 'stock') {
        return (
            <StockManagementApp
                onNavigateToCrono={() => setCurrentApp('cronoanalise')}
                onNavigateToFichaTecnica={() => setCurrentApp('ficha-tecnica')}
                onNavigateToReports={() => setCurrentApp('reports')}
            />
        );
    }

    if (currentApp === 'ficha-tecnica') {
        return (
            <FichaTecnicaModule
                dashboards={dashboards}
                onNavigateToCrono={() => setCurrentApp('cronoanalise')}
                onNavigateToStock={() => setCurrentApp('stock')}
                onNavigateToOperationalSequence={() => setCurrentApp('sequencia-operacional')}
                onNavigateToReports={() => setCurrentApp('reports')}
            />
        );
    }

    if (currentApp === 'sequencia-operacional') {
        return (
            <OperationalSequenceApp
                onNavigateToCrono={() => setCurrentApp('cronoanalise')}
                onNavigateToStock={() => setCurrentApp('stock')}
                onNavigateToFichaTecnica={() => setCurrentApp('ficha-tecnica')}
                onNavigateToReports={() => setCurrentApp('reports')}
                dashboards={dashboards}
                user={user}
            />
        );
    }

    if (currentApp === 'reports') {
        return (
            <ReportsModule
                dashboards={dashboards}
                onNavigateToCrono={() => setCurrentApp('cronoanalise')}
                onNavigateToStock={() => setCurrentApp('stock')}
                onNavigateToFichaTecnica={() => setCurrentApp('ficha-tecnica')}
                onNavigateToOperationalSequence={() => setCurrentApp('sequencia-operacional')}
            />
        );
    }

    return <CronoanaliseDashboard
        onNavigateToStock={() => setCurrentApp('stock')}
        onNavigateToOperationalSequence={() => setCurrentApp('sequencia-operacional')}
        onNavigateToReports={() => setCurrentApp('reports')}
        onNavigateToFichaTecnica={() => setCurrentApp('ficha-tecnica')}
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
