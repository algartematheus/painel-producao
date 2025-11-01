import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, where, writeBatch } from 'firebase/firestore';
import { ClipboardList, Layers, Warehouse, FileText, Box, PlusCircle, Trash, Package } from 'lucide-react';
import HeaderContainer from '../components/HeaderContainer';
import GlobalNavigation from '../components/GlobalNavigation';
import ReportExportControls, { DEFAULT_REPORT_FORMATS } from '../components/ReportExportControls';
import { db } from '../firebase';
import { raceBullLogoUrl } from './constants';
import { useAuth } from './auth';
import { useClickOutside, usePersistedTheme } from './shared';

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

            return {
                stockProductId: typeof item?.stockProductId === 'string' ? item.stockProductId : '',
                stockVariationId: typeof item?.stockVariationId === 'string' ? item.stockVariationId : '',
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

const sanitizeProductVariations = (productId, rawVariations = [], fallbackBillOfMaterials = []) => {
    if (!Array.isArray(rawVariations) || rawVariations.length === 0) {
        return [];
    }

    const seenIds = new Set();
    const normalizedFallback = normalizeBillOfMaterialsItems(fallbackBillOfMaterials);

    return rawVariations.map((variation, index) => {
        const label = typeof variation?.label === 'string' ? variation.label.trim() : '';
        const baseId = (typeof variation?.id === 'string' && variation.id.trim().length > 0)
            ? variation.id.trim()
            : `${(typeof productId === 'string' ? productId : 'variation')}-${index + 1}`;

        let finalId = baseId;
        let dedupeCounter = 1;
        while (seenIds.has(finalId)) {
            dedupeCounter += 1;
            finalId = `${baseId}-${dedupeCounter}`;
        }
        seenIds.add(finalId);

        const hasCustomBillOfMaterials = Array.isArray(variation?.billOfMaterials);
        const normalizedBillOfMaterials = hasCustomBillOfMaterials
            ? normalizeBillOfMaterialsItems(variation.billOfMaterials)
            : normalizedFallback.map(item => ({ ...item }));

        const sanitizedVariation = {
            id: finalId,
            label,
            billOfMaterials: normalizedBillOfMaterials,
            usesDefaultBillOfMaterials: !hasCustomBillOfMaterials && normalizedBillOfMaterials.length > 0,
        };

        if (variation?.defaultTarget !== undefined) {
            const rawDefaultTarget = variation.defaultTarget;
            let defaultTarget = null;
            if (typeof rawDefaultTarget === 'number') {
                defaultTarget = rawDefaultTarget;
            } else if (typeof rawDefaultTarget === 'string' && rawDefaultTarget.trim().length > 0) {
                const parsed = parseFloat(rawDefaultTarget);
                defaultTarget = Number.isFinite(parsed) ? parsed : null;
            }

            if (defaultTarget === 0 || Number.isFinite(defaultTarget)) {
                sanitizedVariation.defaultTarget = defaultTarget;
            }
        }

        return sanitizedVariation;
    });
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

const DEFAULT_VARIATION_OPTION = '__default__';

const normalizeBillOfMaterials = (items = []) => normalizeBillOfMaterialsItems(items);

const buildStockLookupMaps = (stockProducts = []) => {
    const productMap = new Map();
    const variationMap = new Map();

    stockProducts.forEach((product) => {
        if (!product?.id) return;
        productMap.set(product.id, product);
        if (Array.isArray(product.variations)) {
            product.variations.forEach((variation) => {
                if (!variation?.id) return;
                variationMap.set(`${product.id}:${variation.id}`, variation);
            });
        }
    });

    return { productMap, variationMap };
};

const formatBillOfMaterialsItem = (item, productMap, variationMap, dashboardMap) => {
    const product = item?.stockProductId ? productMap.get(item.stockProductId) : null;
    const variationKey = item?.stockProductId && item?.stockVariationId
        ? `${item.stockProductId}:${item.stockVariationId}`
        : null;
    const variation = variationKey ? variationMap.get(variationKey) : null;

    const productName = product?.name || 'Produto não encontrado';
    const variationLabel = variation?.name || variation?.sku || variation?.code || (item.stockVariationId ? 'Variação não encontrada' : '');
    const quantityLabel = Number.isFinite(item?.quantityPerPiece)
        ? item.quantityPerPiece
        : item?.quantityPerPiece || 0;

    const sanitizedDashboardIds = Array.isArray(item?.dashboardIds)
        ? item.dashboardIds
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter(Boolean)
        : [];
    const dashboardLabel = sanitizedDashboardIds.length === 0
        ? 'Todos os quadros'
        : sanitizedDashboardIds
            .map(id => dashboardMap?.get(id)?.name || id)
            .join(', ');

    return {
        productName,
        variationLabel,
        quantityLabel,
        dashboardLabel,
    };
};

const FichaTecnicaModule = ({
    dashboards = [],
    onNavigateToCrono,
    onNavigateToStock,
    onNavigateToOperationalSequence,
    onNavigateToReports,
    onNavigateToPcp,
}) => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = usePersistedTheme();
    const [selectedDashboardId, setSelectedDashboardId] = useState(() => dashboards[0]?.id || '');
    const [productsByDashboard, setProductsByDashboard] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [refreshToken, setRefreshToken] = useState(0);

    const [stockProducts, setStockProducts] = useState([]);
    const [stockCategories, setStockCategories] = useState([]);

    const [editingProduct, setEditingProduct] = useState(null);
    const [editingItems, setEditingItems] = useState([]);
    const [editingVariationId, setEditingVariationId] = useState(DEFAULT_VARIATION_OPTION);
    const [isSaving, setIsSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const navRef = useRef(null);
    const [isNavOpen, setIsNavOpen] = useState(false);
    useClickOutside(navRef, () => setIsNavOpen(false));

    useEffect(() => {
        if (!dashboards.some(dashboard => dashboard.id === selectedDashboardId)) {
            setSelectedDashboardId(dashboards[0]?.id || '');
        }
    }, [dashboards, selectedDashboardId]);

    useEffect(() => {
        let isMounted = true;
        const loadProducts = async () => {
            if (!dashboards.length) {
                setProductsByDashboard({});
                return;
            }
            setIsLoading(true);
            setError(null);
            try {
                const results = await Promise.all(dashboards.map(async (dashboard) => {
                    const snap = await getDocs(collection(db, `dashboards/${dashboard.id}/products`));
                    const backfillPromises = [];
                    const products = snap.docs.map((docSnap) => {
                        const data = docSnap.data();
                        const productId = data?.id || docSnap.id;
                        const productBillOfMaterials = normalizeBillOfMaterialsItems(data?.billOfMaterials || []);
                        const rawVariations = Array.isArray(data?.variations) ? data.variations : [];
                        const { needsBackfill, variations: variationsForStorage } = buildVariationBillOfMaterialsBackfill(rawVariations, productBillOfMaterials);
                        if (needsBackfill) {
                            const productRef = doc(db, `dashboards/${dashboard.id}/products`, docSnap.id);
                            backfillPromises.push(
                                setDoc(productRef, { variations: variationsForStorage }, { merge: true }).catch((error) => {
                                    console.error('Erro ao aplicar backfill de ficha técnica por variação:', error);
                                }),
                            );
                        }
                        const sanitizedVariations = sanitizeProductVariations(productId, variationsForStorage, productBillOfMaterials);
                        return {
                            ...data,
                            id: productId,
                            billOfMaterials: productBillOfMaterials,
                            variations: sanitizedVariations,
                        };
                    });
                    if (backfillPromises.length > 0) {
                        await Promise.all(backfillPromises);
                    }
                    return {
                        dashboardId: dashboard.id,
                        products,
                    };
                }));
                if (!isMounted) return;
                const map = results.reduce((accumulator, entry) => {
                    accumulator[entry.dashboardId] = entry.products;
                    return accumulator;
                }, {});
                setProductsByDashboard(map);
            } catch (fetchError) {
                console.error('Erro ao carregar produtos das fichas técnicas:', fetchError);
                if (isMounted) {
                    setError('Não foi possível carregar as fichas técnicas.');
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };
        loadProducts();
        return () => {
            isMounted = false;
        };
    }, [dashboards, refreshToken]);

    useEffect(() => {
        const categoriesQuery = query(collection(db, 'stock/data/categories'), orderBy('name'));
        const productsQuery = query(collection(db, 'stock/data/products'), orderBy('name'));

        const unsubscribeCategories = onSnapshot(categoriesQuery, (snap) => {
            setStockCategories(snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
        });
        const unsubscribeProducts = onSnapshot(productsQuery, (snap) => {
            setStockProducts(snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
        });

        return () => {
            unsubscribeCategories();
            unsubscribeProducts();
        };
    }, []);

    useEffect(() => {
        setEditingProduct(null);
        setEditingItems([]);
        setEditingVariationId(DEFAULT_VARIATION_OPTION);
    }, [selectedDashboardId]);

    const stockCategoryMap = useMemo(() => {
        const map = new Map();
        stockCategories.forEach(category => {
            if (category?.id) {
                map.set(category.id, category);
            }
        });
        return map;
    }, [stockCategories]);

    const dashboardMap = useMemo(() => {
        const map = new Map();
        dashboards.forEach(dashboard => {
            if (dashboard?.id) {
                map.set(dashboard.id, dashboard);
            }
        });
        return map;
    }, [dashboards]);

    const { productMap, variationMap } = useMemo(
        () => buildStockLookupMaps(stockProducts),
        [stockProducts],
    );

    const currentDashboard = useMemo(
        () => dashboards.find(dashboard => dashboard.id === selectedDashboardId) || dashboards[0] || null,
        [dashboards, selectedDashboardId],
    );

    const products = useMemo(() => {
        const entries = productsByDashboard[selectedDashboardId] || [];
        return [...entries].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }, [productsByDashboard, selectedDashboardId]);

    const navigationButtons = useMemo(() => {
        return [
            onNavigateToCrono
                ? {
                    key: 'crono',
                    label: 'Quadro de Produção',
                    icon: Layers,
                    onClick: onNavigateToCrono,
                }
                : null,
            onNavigateToPcp
                ? {
                    key: 'pcp',
                    label: 'Gestão Produção x Estoque',
                    icon: Package,
                    onClick: onNavigateToPcp,
                }
                : null,
            onNavigateToStock
                ? {
                    key: 'stock',
                    label: 'Estoque',
                    icon: Warehouse,
                    onClick: onNavigateToStock,
                }
                : null,
            onNavigateToOperationalSequence
                ? {
                    key: 'operational-sequence',
                    label: 'Sequência',
                    icon: Box,
                    onClick: onNavigateToOperationalSequence,
                }
                : null,
            onNavigateToReports
                ? {
                    key: 'reports',
                    label: 'Relatórios',
                    icon: FileText,
                    onClick: onNavigateToReports,
                }
                : null,
        ].filter(Boolean);
    }, [onNavigateToCrono, onNavigateToOperationalSequence, onNavigateToReports, onNavigateToStock, onNavigateToPcp]);

    const exportTranslations = useMemo(() => ({
        triggerLabel: 'Relatórios',
        exportButton: 'Exportar Ficha Técnica',
        exportingButton: 'Gerando...',
        formatLabel: 'Formato da exportação',
    }), []);

    const [exportFormat, setExportFormat] = useState(DEFAULT_REPORT_FORMATS[0]?.value || 'pdf');
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = useCallback(async (format = exportFormat) => {
        setIsExporting(true);
        try {
            const message = 'A exportação das fichas técnicas estará disponível em breve.';
            if (typeof window !== 'undefined') {
                window.alert(message);
            } else {
                console.info(message);
            }
            console.info('Ficha técnica export request', { format });
        } finally {
            setIsExporting(false);
        }
    }, [exportFormat]);

    const handleSelectDashboard = useCallback((dashboard) => {
        if (!dashboard?.id) return;
        setSelectedDashboardId(dashboard.id);
        setIsNavOpen(false);
    }, []);

    const handleStartEditing = useCallback((product) => {
        if (!product) return;
        const normalizedProductBillOfMaterials = normalizeBillOfMaterialsItems(product.billOfMaterials || []);
        const sanitizedVariations = Array.isArray(product.variations)
            ? product.variations
            : [];
        setEditingProduct({
            ...product,
            dashboardId: selectedDashboardId,
            productId: product.id,
            productName: product.name,
            billOfMaterials: normalizedProductBillOfMaterials,
            variations: sanitizedVariations,
        });
        setEditingVariationId(DEFAULT_VARIATION_OPTION);
        setEditingItems(mapBillOfMaterialsToDraft(normalizedProductBillOfMaterials));
        setFeedback(null);
    }, [selectedDashboardId]);

    const handleChangeEditingItem = useCallback((index, field, value) => {
        setEditingItems(prev => {
            const next = Array.isArray(prev) ? [...prev] : [];
            const existing = next[index] || createEmptyBillOfMaterialsItem();
            let updated = { ...existing };
            if (field === 'dashboardIds') {
                const sanitized = Array.isArray(value)
                    ? Array.from(new Set(
                        value
                            .map(id => (typeof id === 'string' ? id.trim() : ''))
                            .filter(Boolean),
                    ))
                    : [];
                updated.dashboardIds = sanitized;
            } else {
                updated = {
                    ...updated,
                    [field]: value,
                };
                if (field === 'stockProductId') {
                    updated.stockVariationId = '';
                    updated.dashboardIds = [];
                }
            }
            next[index] = updated;
            return next;
        });
    }, []);

    const handleAddEditingItem = useCallback(() => {
        setEditingItems(prev => ([...(prev || []), createEmptyBillOfMaterialsItem()]));
    }, []);

    const handleRemoveEditingItem = useCallback((index) => {
        setEditingItems(prev => {
            const next = Array.isArray(prev) ? [...prev] : [];
            return next.filter((_, itemIndex) => itemIndex !== index);
        });
    }, []);

    const handleSelectEditingVariation = useCallback((variationId) => {
        setEditingVariationId(variationId);
        setEditingItems(() => {
            if (!editingProduct) {
                return [];
            }
            const fallback = Array.isArray(editingProduct.billOfMaterials)
                ? editingProduct.billOfMaterials
                : [];
            if (variationId === DEFAULT_VARIATION_OPTION) {
                return mapBillOfMaterialsToDraft(fallback);
            }
            const targetVariation = Array.isArray(editingProduct.variations)
                ? editingProduct.variations.find(variation => variation?.id === variationId)
                : null;
            const sourceItems = Array.isArray(targetVariation?.billOfMaterials) && targetVariation.billOfMaterials.length > 0
                ? targetVariation.billOfMaterials
                : fallback;
            return mapBillOfMaterialsToDraft(sourceItems);
        });
    }, [editingProduct]);

    const handleCancelEditing = useCallback(() => {
        setEditingProduct(null);
        setEditingItems([]);
        setEditingVariationId(DEFAULT_VARIATION_OPTION);
    }, []);

    const syncTraveteBillOfMaterials = useCallback(async ({
        baseProductId,
        baseProductName,
        defaultBillOfMaterials = null,
        variationBillOfMaterials = null,
        dashboardId: sourceDashboardId = '',
    }) => {
        const normalizedBaseId = typeof baseProductId === 'string' ? baseProductId.trim() : '';
        const normalizedBaseName = typeof baseProductName === 'string' ? baseProductName.trim() : '';
        const hasDefaultUpdate = Array.isArray(defaultBillOfMaterials);
        const hasVariationUpdate = Array.isArray(variationBillOfMaterials);
        const normalizedDashboardId = typeof sourceDashboardId === 'string' ? sourceDashboardId.trim() : '';

        if (!hasDefaultUpdate && !hasVariationUpdate) {
            return;
        }

        const traveteCollection = collection(db, 'dashboards/travete/products');
        const seenDocIds = new Set();
        const traveteDocs = [];

        const runQuery = async (field, value) => {
            if (!value) return;
            const traveteQuery = query(traveteCollection, where(field, '==', value));
            const snap = await getDocs(traveteQuery);
            snap.forEach((docSnap) => {
                if (!seenDocIds.has(docSnap.id)) {
                    seenDocIds.add(docSnap.id);
                    traveteDocs.push(docSnap);
                }
            });
        };

        if (normalizedBaseId) {
            await runQuery('baseProductId', normalizedBaseId);
        }

        if (traveteDocs.length === 0 && normalizedBaseName) {
            await runQuery('baseProductName', normalizedBaseName);
        }

        if (traveteDocs.length === 0) {
            return;
        }

        const timestamp = new Date().toISOString();
        const batch = writeBatch(db);
        let hasAnyUpdates = false;

        traveteDocs.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const payload = {};
            let docHasUpdates = false;

            if (hasDefaultUpdate) {
                payload.billOfMaterials = defaultBillOfMaterials.map(item => ({ ...item }));
                docHasUpdates = true;
            }

            const existingVariations = Array.isArray(data.variations) ? data.variations : [];
            if (existingVariations.length > 0 && (hasDefaultUpdate || (hasVariationUpdate && normalizedDashboardId))) {
                let variationsChanged = false;
                const nextVariations = existingVariations.map((variation) => {
                    const usesDefault = Boolean(variation?.usesDefaultBillOfMaterials);
                    const dashboards = Array.isArray(variation?.dashboardIds)
                        ? variation.dashboardIds
                            .map(id => (typeof id === 'string' ? id.trim() : ''))
                            .filter(Boolean)
                        : [];

                    if (usesDefault && hasDefaultUpdate) {
                        variationsChanged = true;
                        return {
                            ...variation,
                            billOfMaterials: defaultBillOfMaterials.map(item => ({ ...item })),
                        };
                    }

                    if (
                        hasVariationUpdate
                        && !usesDefault
                        && normalizedDashboardId
                        && dashboards.includes(normalizedDashboardId)
                    ) {
                        variationsChanged = true;
                        return {
                            ...variation,
                            billOfMaterials: variationBillOfMaterials.map(item => ({ ...item })),
                        };
                    }

                    return variation;
                });

                if (variationsChanged) {
                    payload.variations = nextVariations;
                    docHasUpdates = true;
                }
            }

            if (docHasUpdates) {
                if (user) {
                    payload.lastUpdatedAt = timestamp;
                    payload.lastUpdatedBy = { uid: user.uid, email: user.email };
                }
                batch.set(docSnap.ref, payload, { merge: true });
                hasAnyUpdates = true;
            }
        });

        if (hasAnyUpdates) {
            await batch.commit();
        }
    }, [user]);

    const handleSaveEditing = useCallback(async () => {
        if (!editingProduct) return;
        setIsSaving(true);
        setFeedback(null);
        try {
            const normalizedItems = normalizeBillOfMaterials(editingItems || []);
            const productRef = doc(db, `dashboards/${editingProduct.dashboardId}/products`, editingProduct.productId);

            if (editingVariationId === DEFAULT_VARIATION_OPTION) {
                const payload = { billOfMaterials: normalizedItems };
                if (user) {
                    const timestamp = new Date().toISOString();
                    payload.lastUpdatedAt = timestamp;
                    payload.lastUpdatedBy = { uid: user.uid, email: user.email };
                }
                await setDoc(productRef, payload, { merge: true });

                await syncTraveteBillOfMaterials({
                    baseProductId: editingProduct?.baseProductId || editingProduct?.productId || '',
                    baseProductName: editingProduct?.baseProductName || editingProduct?.productName || '',
                    defaultBillOfMaterials: normalizedItems,
                    dashboardId: editingProduct.dashboardId,
                });
            } else {
                const productSnap = await getDoc(productRef);
                if (!productSnap.exists()) {
                    throw new Error('Produto não encontrado para atualização.');
                }
                const productData = productSnap.data();
                const productBillOfMaterials = normalizeBillOfMaterialsItems(productData?.billOfMaterials || []);
                const rawVariations = Array.isArray(productData?.variations) ? productData.variations : [];
                const { variations: variationsForStorage } = buildVariationBillOfMaterialsBackfill(rawVariations, productBillOfMaterials);
                let variationItemsForSave = normalizedItems;
                const updatedVariations = variationsForStorage.map((variation) => {
                    const variationId = typeof variation?.id === 'string' ? variation.id : '';
                    if (variationId === editingVariationId) {
                        const itemsToPersist = normalizedItems.length === 0 && productBillOfMaterials.length > 0
                            ? productBillOfMaterials.map(item => ({ ...item }))
                            : normalizedItems;
                        variationItemsForSave = itemsToPersist;
                        return {
                            ...variation,
                            billOfMaterials: itemsToPersist,
                        };
                    }
                    return variation;
                });
                const payload = { variations: updatedVariations };
                if (user) {
                    const timestamp = new Date().toISOString();
                    payload.lastUpdatedAt = timestamp;
                    payload.lastUpdatedBy = { uid: user.uid, email: user.email };
                }
                await setDoc(productRef, payload, { merge: true });

                await syncTraveteBillOfMaterials({
                    baseProductId: productData?.baseProductId || editingProduct?.baseProductId || editingProduct?.productId || '',
                    baseProductName: productData?.baseProductName || editingProduct?.baseProductName || editingProduct?.productName || '',
                    variationBillOfMaterials: variationItemsForSave,
                    dashboardId: editingProduct.dashboardId,
                });
            }

            setEditingProduct(null);
            setEditingItems([]);
            setEditingVariationId(DEFAULT_VARIATION_OPTION);
            setFeedback({ type: 'success', message: 'Ficha técnica atualizada com sucesso.' });
            setRefreshToken(prev => prev + 1);
        } catch (saveError) {
            console.error('Erro ao salvar ficha técnica:', saveError);
            setFeedback({ type: 'error', message: 'Não foi possível salvar a ficha técnica.' });
        } finally {
            setIsSaving(false);
        }
    }, [editingItems, editingProduct, editingVariationId, syncTraveteBillOfMaterials, user]);

    const renderBillOfMaterialsList = useCallback((product) => {
        const defaultItems = Array.isArray(product.billOfMaterials) ? product.billOfMaterials : [];
        const variationEntries = Array.isArray(product.variations) ? product.variations : [];

        const renderItemsList = (items, keyPrefix) => {
            if (!Array.isArray(items) || items.length === 0) {
                return <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum componente cadastrado.</p>;
            }
            return (
                <ul className="space-y-2">
                    {items.map((item, index) => {
                        const { productName, variationLabel, quantityLabel, dashboardLabel } = formatBillOfMaterialsItem(item, productMap, variationMap, dashboardMap);
                        return (
                            <li key={`${keyPrefix}-${index}`} className="flex flex-wrap items-center justify-between rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm">
                                <div className="flex flex-col">
                                    <span className="font-medium">{productName}</span>
                                    {variationLabel && <span className="text-xs text-gray-500 dark:text-gray-400">Variação: {variationLabel}</span>}
                                    <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Quadros: {dashboardLabel}</span>
                                </div>
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{quantityLabel} / peça</span>
                            </li>
                        );
                    })}
                </ul>
            );
        };

        return (
            <div className="space-y-6">
                <div>
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Ficha técnica padrão</h4>
                    {renderItemsList(defaultItems, `${product.id}-default`)}
                </div>
                {variationEntries.length > 0 && (
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Fichas por variação</h4>
                        {variationEntries.map((variation, index) => {
                            const variationItems = Array.isArray(variation.billOfMaterials) ? variation.billOfMaterials : [];
                            const variationLabel = variation.label || `Variação ${index + 1}`;
                            const inheritsDefault = Boolean(variation.usesDefaultBillOfMaterials);
                            return (
                                <div key={variation.id || `${product.id}-variation-${index}`} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                                    <div className="mb-3 flex items-center justify-between">
                                        <span className="font-medium text-gray-800 dark:text-gray-100">{variationLabel}</span>
                                        {inheritsDefault && (
                                            <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Herdando ficha padrão</span>
                                        )}
                                    </div>
                                    {inheritsDefault && variationItems.length === 0
                                        ? <p className="text-sm text-gray-500 dark:text-gray-400">Sem componentes próprios, utilizando a ficha técnica padrão.</p>
                                        : renderItemsList(variationItems, `${product.id}-variation-${variation.id || index}`)}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }, [productMap, variationMap, dashboardMap]);

    return (
        <div className="responsive-root min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 font-sans flex flex-col">
            <HeaderContainer>
                <GlobalNavigation
                    logoSrc={raceBullLogoUrl}
                    title="Fichas Técnicas"
                    subtitle="Gerencie os componentes vinculados aos produtos de produção"
                    currentDashboard={currentDashboard}
                    dashboards={dashboards}
                    navRef={navRef}
                    isNavOpen={isNavOpen}
                    onToggleNav={() => setIsNavOpen(prev => !prev)}
                    onSelectDashboard={handleSelectDashboard}
                    navigationButtons={navigationButtons}
                    userEmail={user?.email}
                    onLogout={logout}
                    logoutLabel="Sair"
                    hideLogoutLabelOnMobile
                    theme={theme}
                    onToggleTheme={toggleTheme}
                >
                    <ReportExportControls
                        selectedFormat={exportFormat}
                        formats={DEFAULT_REPORT_FORMATS}
                        onFormatChange={setExportFormat}
                        onExport={handleExport}
                        isExporting={isExporting}
                        translations={exportTranslations}
                        disableWhileExporting
                    />
                </GlobalNavigation>
            </HeaderContainer>

            <main className="responsive-main flex-grow px-4 py-6 sm:px-6 lg:px-8">
                {feedback && (
                    <div
                        className={`mb-4 rounded-md border px-4 py-3 text-sm ${feedback.type === 'success'
                            ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}
                    >
                        {feedback.message}
                    </div>
                )}

                {error && (
                    <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/40 dark:text-red-300">
                        {error}
                    </div>
                )}

                {isLoading ? (
                    <div className="flex h-64 items-center justify-center">
                        <p className="text-lg">Carregando fichas técnicas...</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {products.map((product) => {
                            const isEditing = editingProduct?.productId === product.id;
                            return (
                                <section key={product.id} className="rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm">
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{product.name || 'Produto sem nome'}</h2>
                                            {product.baseProductName && (
                                                <p className="text-sm text-gray-500 dark:text-gray-400">Variação de: {product.baseProductName}</p>
                                            )}
                                            {product.standardTime !== undefined && (
                                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Tempo padrão atual: {product.standardTime}</p>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {!isEditing && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleStartEditing(product)}
                                                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                                >
                                                    <ClipboardList size={16} />
                                                    Editar Ficha Técnica
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-4 border-t border-gray-200 dark:border-gray-800 pt-4">
                                        {isEditing ? (
                                            <div className="space-y-4">
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <div>
                                                        <label className="block text-sm font-medium mb-1">Editar ficha técnica para</label>
                                                        <select
                                                            value={editingVariationId}
                                                            onChange={(event) => handleSelectEditingVariation(event.target.value)}
                                                            className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                                                        >
                                                            <option value={DEFAULT_VARIATION_OPTION}>Ficha técnica padrão do produto</option>
                                                            {(editingProduct?.variations || []).map((variation) => (
                                                                <option key={variation.id || variation.label} value={variation.id}>
                                                                    {variation.label || 'Sem descrição'}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                                <BillOfMaterialsEditor
                                                    items={editingItems}
                                                    onChangeItem={handleChangeEditingItem}
                                                    onAddItem={handleAddEditingItem}
                                                    onRemoveItem={handleRemoveEditingItem}
                                                    stockProducts={stockProducts}
                                                    stockCategoryMap={stockCategoryMap}
                                                    title={editingVariationId === DEFAULT_VARIATION_OPTION
                                                        ? 'Componentes da Ficha Técnica Padrão'
                                                        : 'Componentes da Ficha Técnica da Variação'}
                                                    addLabel="Adicionar componente"
                                                    dashboards={dashboards}
                                                    currentDashboardId={editingProduct?.dashboardId || selectedDashboardId}
                                                />
                                                {editingVariationId !== DEFAULT_VARIATION_OPTION && (() => {
                                                    const selectedVariation = (editingProduct?.variations || []).find(variation => variation?.id === editingVariationId);
                                                    if (selectedVariation?.usesDefaultBillOfMaterials) {
                                                        return (
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                                Esta variação herdará a ficha técnica padrão até que você salve alterações próprias.
                                                            </p>
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                                <div className="flex flex-wrap gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={handleSaveEditing}
                                                        disabled={isSaving}
                                                        className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        {isSaving ? 'Salvando...' : 'Salvar alterações'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleCancelEditing}
                                                        disabled={isSaving}
                                                        className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                                                    >
                                                        Cancelar
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            renderBillOfMaterialsList(product)
                                        )}
                                    </div>
                                </section>
                            );
                        })}

                        {products.length === 0 && (
                            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                                Nenhum produto cadastrado neste dashboard.
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

export default FichaTecnicaModule;
