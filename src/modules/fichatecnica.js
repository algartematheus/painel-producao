import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { ClipboardList, Layers, Warehouse, FileText, Box, PlusCircle, Trash } from 'lucide-react';
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
});

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
}) => {
    const availableProducts = useMemo(
        () => stockProducts
            .filter(product => !product.isDeleted)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [stockProducts],
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

const normalizeBillOfMaterials = (items = []) => {
    return items
        .map((item) => {
            const parsedQuantity = parseFloat(item.quantityPerPiece);
            const safeQuantity = Number.isFinite(parsedQuantity) && parsedQuantity >= 0
                ? parseFloat(parsedQuantity.toFixed(4))
                : 0;
            return {
                stockProductId: item.stockProductId || '',
                stockVariationId: item.stockVariationId || '',
                quantityPerPiece: safeQuantity,
            };
        })
        .filter(item => item.stockProductId);
};

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

const formatBillOfMaterialsItem = (item, productMap, variationMap) => {
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

    return {
        productName,
        variationLabel,
        quantityLabel,
    };
};

const FichaTecnicaModule = ({
    dashboards = [],
    onNavigateToCrono,
    onNavigateToStock,
    onNavigateToOperationalSequence,
    onNavigateToReports,
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
                    return {
                        dashboardId: dashboard.id,
                        products: snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })),
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
    }, [onNavigateToCrono, onNavigateToOperationalSequence, onNavigateToReports, onNavigateToStock]);

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
        setEditingProduct({ dashboardId: selectedDashboardId, productId: product.id });
        const mappedItems = Array.isArray(product.billOfMaterials)
            ? product.billOfMaterials.map(item => ({
                stockProductId: item.stockProductId || '',
                stockVariationId: item.stockVariationId || '',
                quantityPerPiece: item.quantityPerPiece !== undefined && item.quantityPerPiece !== null
                    ? String(item.quantityPerPiece)
                    : '',
            }))
            : [];
        setEditingItems(mappedItems);
        setFeedback(null);
    }, [selectedDashboardId]);

    const handleChangeEditingItem = useCallback((index, field, value) => {
        setEditingItems(prev => {
            const next = Array.isArray(prev) ? [...prev] : [];
            const existing = next[index] || createEmptyBillOfMaterialsItem();
            const updated = {
                ...existing,
                [field]: value,
            };
            if (field === 'stockProductId') {
                updated.stockVariationId = '';
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

    const handleCancelEditing = useCallback(() => {
        setEditingProduct(null);
        setEditingItems([]);
    }, []);

    const handleSaveEditing = useCallback(async () => {
        if (!editingProduct) return;
        setIsSaving(true);
        setFeedback(null);
        try {
            const normalizedItems = normalizeBillOfMaterials(editingItems || []);
            const productRef = doc(db, `dashboards/${editingProduct.dashboardId}/products`, editingProduct.productId);
            const payload = {
                billOfMaterials: normalizedItems,
            };
            if (user) {
                payload.lastUpdatedAt = new Date().toISOString();
                payload.lastUpdatedBy = { uid: user.uid, email: user.email };
            }
            await setDoc(productRef, payload, { merge: true });
            setEditingProduct(null);
            setEditingItems([]);
            setFeedback({ type: 'success', message: 'Ficha técnica atualizada com sucesso.' });
            setRefreshToken(prev => prev + 1);
        } catch (saveError) {
            console.error('Erro ao salvar ficha técnica:', saveError);
            setFeedback({ type: 'error', message: 'Não foi possível salvar a ficha técnica.' });
        } finally {
            setIsSaving(false);
        }
    }, [editingItems, editingProduct, user]);

    const renderBillOfMaterialsList = useCallback((product) => {
        const items = Array.isArray(product.billOfMaterials) ? product.billOfMaterials : [];
        if (items.length === 0) {
            return <p className="text-sm text-gray-500">Nenhum componente cadastrado.</p>;
        }
        return (
            <ul className="space-y-2">
                {items.map((item, index) => {
                    const { productName, variationLabel, quantityLabel } = formatBillOfMaterialsItem(item, productMap, variationMap);
                    return (
                        <li key={`${product.id}-item-${index}`} className="flex flex-wrap items-center justify-between rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm">
                            <div className="flex flex-col">
                                <span className="font-medium">{productName}</span>
                                {variationLabel && <span className="text-xs text-gray-500">{variationLabel}</span>}
                            </div>
                            <span className="text-xs font-semibold">{quantityLabel} / peça</span>
                        </li>
                    );
                })}
            </ul>
        );
    }, [productMap, variationMap]);

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
                                                <BillOfMaterialsEditor
                                                    items={editingItems}
                                                    onChangeItem={handleChangeEditingItem}
                                                    onAddItem={handleAddEditingItem}
                                                    onRemoveItem={handleRemoveEditingItem}
                                                    stockProducts={stockProducts}
                                                    stockCategoryMap={stockCategoryMap}
                                                    title="Componentes da Ficha Técnica"
                                                    addLabel="Adicionar componente"
                                                />
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
