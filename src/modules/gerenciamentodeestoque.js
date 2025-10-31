import React, { useState, useEffect, useMemo, useCallback, useContext, createContext, useRef } from 'react';
import { collection, doc, setDoc, updateDoc, onSnapshot, writeBatch, query, orderBy, Timestamp } from 'firebase/firestore';
import { PlusCircle, MinusCircle, Edit, Trash2, Home, ArrowUpDown, Box, Trash, ChevronLeft, ChevronRight, BarChart, ClipboardList } from 'lucide-react';
import { db } from '../firebase';
import HeaderContainer from '../components/HeaderContainer';
import GlobalNavigation from '../components/GlobalNavigation';
import ReportExportControls, { DEFAULT_REPORT_FORMATS } from '../components/ReportExportControls';
import { useAuth } from './auth';
import { raceBullLogoUrl } from './constants';
import {
  ConfirmationModal,
  useClickOutside,
  generateId,
  usePersistedTheme
} from './shared';
import { importStockFile, flattenSnapshotsToVariations } from './stockImporter';

const arrayBufferToBase64 = (arrayBuffer) => {
    if (!(arrayBuffer instanceof ArrayBuffer)) {
        return '';
    }

    if (typeof Buffer !== 'undefined') {
        return Buffer.from(arrayBuffer).toString('base64');
    }

    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
        let binary = '';
        const bytes = new Uint8Array(arrayBuffer);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
        }
        return window.btoa(binary);
    }

    throw new Error('Não foi possível converter o arquivo para base64 no ambiente atual.');
};

const normalizeReferenceCode = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
};

const StockContext = createContext();

export const StockProvider = ({ children }) => {
    const { user } = useAuth();
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [stockMovements, setStockMovements] = useState([]);
    const [loading, setLoading] = useState(true);

    // Listeners em tempo real para os dados do estoque no Firebase
    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        };
        setLoading(true);

        const unsubCategories = onSnapshot(query(collection(db, "stock/data/categories"), orderBy("name")), (snap) => {
            setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        const unsubProducts = onSnapshot(query(collection(db, "stock/data/products"), orderBy("name")), (snap) => {
            setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        const unsubMovements = onSnapshot(query(collection(db, "stock/data/movements"), orderBy("timestamp", "desc")), (snap) => {
            setStockMovements(snap.docs.map(d => {
                const data = d.data();
                return { 
                    id: d.id, 
                    ...data,
                    timestamp: data.timestamp ? data.timestamp.toDate() : new Date() 
                };
            }));
        });
        
        setLoading(false);

        return () => {
            unsubCategories();
            unsubProducts();
            unsubMovements();
        };
    }, [user]);

    // Funções para manipular os dados no Firebase, agora envolvidas em useCallback
    const addCategory = useCallback(async (categoryName) => {
        const newId = generateId('cat');
        const exists = categories.some(c => c.name.toLowerCase() === categoryName.toLowerCase());
        if (exists) {
            alert("Uma categoria com este nome já existe.");
            return null;
        }
        await setDoc(doc(db, "stock/data/categories", newId), { 
            name: categoryName, 
            createdBy: { uid: user.uid, email: user.email },
            createdAt: Timestamp.now(),
        });
        return newId;
    }, [user, categories]);

    const addProduct = useCallback(async (productData) => {
        const newId = generateId('prod');
        const newProduct = {
            ...productData,
            isDeleted: false,
            createdAt: Timestamp.now(),
            createdBy: { uid: user.uid, email: user.email },
            variations: productData.variations.map(v => ({
                ...v,
                id: generateId('var'),
                currentStock: parseInt(v.initialStock, 10) || 0
            }))
        };
        await setDoc(doc(db, "stock/data/products", newId), newProduct);
    }, [user]);

    const updateProduct = useCallback(async (productId, productData) => {
        const { id, variations = [], ...dataToUpdate } = productData;
        const productRef = doc(db, "stock/data/products", productId);
        const existingProduct = products.find(p => p.id === productId);
        const existingVariationsMap = new Map((existingProduct?.variations || []).map(v => [v.id, v]));

        const normalizedVariations = variations.map(variation => {
            const { isNew, ...rest } = variation;
            const parsedInitialStock = parseInt(rest.initialStock, 10) || 0;
            const existingVariation = rest.id ? existingVariationsMap.get(rest.id) : undefined;

            if (existingVariation) {
                return {
                    ...existingVariation,
                    ...rest,
                    initialStock: parsedInitialStock,
                    currentStock: existingVariation.currentStock
                };
            }

            const generatedId = rest.id || generateId('var');
            const inferredCurrentStock = typeof rest.currentStock === 'number' ? rest.currentStock : parsedInitialStock;

            return {
                ...rest,
                id: generatedId,
                initialStock: parsedInitialStock,
                currentStock: inferredCurrentStock
            };
        });

        await updateDoc(productRef, {
            ...dataToUpdate,
            variations: normalizedVariations,
            lastEditedBy: { uid: user.uid, email: user.email },
            lastEditedAt: Timestamp.now(),
        });
    }, [user, products]);

    const deleteProduct = useCallback(async (productId) => {
        await updateDoc(doc(db, "stock/data/products", productId), { 
            isDeleted: true,
            deletedAt: Timestamp.now(),
            deletedBy: { uid: user.uid, email: user.email },
        });
    }, [user]);

    const restoreProduct = useCallback(async (productId) => {
        await updateDoc(doc(db, "stock/data/products", productId), { 
            isDeleted: false,
            deletedAt: null,
            deletedBy: null,
        });
    }, []);

    const addStockMovement = useCallback(async ({ productId, variationId, quantity, type, metadata }) => {
        const batch = writeBatch(db);

        const newMovementId = generateId('mov');
        const movementRef = doc(db, "stock/data/movements", newMovementId);
        batch.set(movementRef, {
            productId,
            variationId,
            quantity: parseInt(quantity, 10),
            type,
            user: user.uid,
            userEmail: user.email,
            timestamp: Timestamp.now(),
            metadata: metadata
                ? {
                    ...metadata,
                    responsible: { uid: user.uid, email: user.email },
                    uploadedAt: Timestamp.now(),
                }
                : null,
        });

        const productRef = doc(db, "stock/data/products", productId);
        const productDoc = products.find(p => p.id === productId);
        if (productDoc) {
            const updatedVariations = productDoc.variations.map(v => {
                if (v.id === variationId) {
                    const change = type === 'Entrada' ? parseInt(quantity, 10) : -parseInt(quantity, 10);
                    return { ...v, currentStock: v.currentStock + change };
                }
                return v;
            });
            batch.update(productRef, { variations: updatedVariations });
        }

        await batch.commit();
    }, [user, products]);

    const deleteStockMovement = useCallback(async (movement) => {
        const { id, productId, variationId, quantity, type } = movement;
        if (!id) return;
        
        const batch = writeBatch(db);

        const movementRef = doc(db, "stock/data/movements", id);
        batch.delete(movementRef);

        const productRef = doc(db, "stock/data/products", productId);
        const productDoc = products.find(p => p.id === productId);
        if (productDoc) {
            const updatedVariations = productDoc.variations.map(v => {
                if (v.id === variationId) {
                    const change = type === 'Entrada' ? -parseInt(quantity, 10) : parseInt(quantity, 10);
                    return { ...v, currentStock: v.currentStock + change };
                }
                return v;
            });
            batch.update(productRef, { variations: updatedVariations });
        }

        await batch.commit();
    }, [products]);


    const value = useMemo(() => ({
        loading,
        categories,
        products: products.filter(p => !p.isDeleted),
        deletedProducts: products.filter(p => p.isDeleted),
        stockMovements,
        addCategory,
        addProduct,
        updateProduct,
        deleteProduct,
        restoreProduct,
        addStockMovement,
        deleteStockMovement,
    }), [
        loading, 
        categories, 
        products, 
        stockMovements,
        addCategory,
        addProduct,
        updateProduct,
        deleteProduct,
        restoreProduct,
        addStockMovement,
        deleteStockMovement
    ]);

    return <StockContext.Provider value={value}>{children}</StockContext.Provider>;
};

export const useStock = () => useContext(StockContext);

const StockHeader = ({
    onNavigateToCrono,
    onNavigateToReports,
    onNavigateToFichaTecnica,
    theme,
    toggleTheme,
    exportFormat,
    onChangeExportFormat,
    onExportReport,
    isExportingReport,
    exportTranslations,
    exportFormats = DEFAULT_REPORT_FORMATS,
}) => {
    const { user, logout } = useAuth();
    const navigationButtons = useMemo(() => ([
        onNavigateToCrono
            ? {
                key: 'crono',
                label: 'Quadro de Produção',
                icon: Home,
                onClick: onNavigateToCrono,
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
    ].filter(Boolean)), [onNavigateToCrono, onNavigateToReports, onNavigateToFichaTecnica]);

    return (
        <HeaderContainer zIndexClass="z-40">
            <GlobalNavigation
                logoSrc={raceBullLogoUrl}
                title="Painel de Estoque"
                navigationButtons={navigationButtons}
                userEmail={user?.email}
                onLogout={logout}
                logoutLabel="Sair"
                logoutButtonClassName="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 text-red-500 w-full sm:w-auto justify-center"
                hideLogoutLabelOnMobile={true}
                theme={theme}
                onToggleTheme={toggleTheme}
            >
                <ReportExportControls
                    selectedFormat={exportFormat}
                    formats={exportFormats}
                    onFormatChange={onChangeExportFormat}
                    onExport={onExportReport}
                    isExporting={isExportingReport}
                    translations={exportTranslations}
                    disableWhileExporting
                />
            </GlobalNavigation>
        </HeaderContainer>
    );
};

const StockSidebar = ({ activePage, setActivePage }) => {
    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: Home },
        { id: 'movements', label: 'Lançamentos', icon: ArrowUpDown },
        { id: 'products', label: 'Produtos', icon: Box },
        { id: 'trash', label: 'Lixeira', icon: Trash },
    ];
    return (
        <aside className="w-full lg:w-64 bg-white dark:bg-gray-900 p-4 flex flex-col flex-shrink-0">
            <nav className="flex flex-col gap-2">
                {navItems.map(item => (
                    <button key={item.id} onClick={() => setActivePage(item.id)}
                        className={`flex items-center gap-3 p-3 rounded-lg text-lg transition-colors ${activePage === item.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                        <item.icon size={24} />
                        {item.label}
                    </button>
                ))}
            </nav>
        </aside>
    );
};

const StockDashboardPage = ({ setConfirmation }) => {
    const { products, categories, loading } = useStock();
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [sortOrder, setSortOrder] = useState('asc');

    const getTotalStock = (p) => p.variations.reduce((sum, v) => sum + v.currentStock, 0);

    const displayedProducts = useMemo(() => {
        let filteredProducts = products;

        if (selectedCategoryId) {
            filteredProducts = products.filter(p => p.categoryId === selectedCategoryId);
        }

        return [...filteredProducts].sort((a, b) => {
            if (sortOrder === 'asc') {
                return a.name.localeCompare(b.name);
            } else {
                return b.name.localeCompare(a.name);
            }
        });
    }, [products, selectedCategoryId, sortOrder]);
    
    if (loading) return <div className="p-8 text-center">Carregando dados do estoque...</div>;

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold mb-6">Visão Geral do Estoque</h1>

            <div className="bg-white dark:bg-gray-900 p-4 mb-6 rounded-2xl shadow-lg flex flex-wrap items-center justify-between gap-4">
                <div className="flex-grow">
                    <label htmlFor="category-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Filtrar por Categoria</label>
                    <select
                        id="category-filter"
                        value={selectedCategoryId}
                        onChange={(e) => setSelectedCategoryId(e.target.value)}
                        className="mt-1 block w-full md:w-auto p-2 rounded-md bg-gray-100 dark:bg-gray-700 border-transparent focus:border-blue-500 focus:bg-white focus:ring-0"
                    >
                        <option value="">Todas as Categorias</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Ordenar por Nome</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <button
                            onClick={() => setSortOrder('asc')}
                            className={`px-4 py-2 rounded-l-md border border-gray-300 text-sm font-medium ${sortOrder === 'asc' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 hover:bg-gray-50'}`}
                        >
                            A-Z
                        </button>
                        <button
                            onClick={() => setSortOrder('desc')}
                            className={`-ml-px px-4 py-2 rounded-r-md border border-gray-300 text-sm font-medium ${sortOrder === 'desc' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 hover:bg-gray-50'}`}
                        >
                            Z-A
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                <table className="w-full">
                    <thead className="border-b-2 dark:border-gray-700">
                        <tr>
                            <th className="p-3 text-left">Produto</th>
                            <th className="p-3 text-center">Estoque Inicial (Total)</th>
                            <th className="p-3 text-center">Estoque Atual (Total)</th>
                            <th className="p-3 text-center">Estoque Mínimo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedProducts.map(p => {
                            const totalCurrentStock = getTotalStock(p);
                            const totalInitialStock = p.variations.reduce((sum, v) => sum + (v.initialStock || 0), 0);
                            const stockStatusColor = totalCurrentStock <= p.minStock ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500';
                            return (
                                <tr key={p.id} className="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                    <td className="p-3 font-medium">{p.name}</td>
                                    <td className="p-3 text-center">{totalInitialStock.toLocaleString('pt-BR')}</td>
                                    <td className={`p-3 text-center font-bold`}>
                                        <span className={`px-3 py-1 rounded-full ${stockStatusColor}`}>
                                            {totalCurrentStock.toLocaleString('pt-BR')}
                                        </span>
                                    </td>
                                    <td className="p-3 text-center">{p.minStock.toLocaleString('pt-BR')}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const StockCalendarView = ({ selectedDate, setSelectedDate, currentMonth, setCurrentMonth, calendarView, setCalendarView, stockMovements }) => {
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

    const movementsByDate = useMemo(() => {
        const map = new Map();
        stockMovements.forEach(mov => {
            const dateStr = mov.timestamp.toDateString();
            if (!map.has(dateStr)) {
                map.set(dateStr, []);
            }
            map.get(dateStr).push(mov);
        });
        return map;
    }, [stockMovements]);

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
                    const hasData = movementsByDate.has(day.toDateString());
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

const StockMovementsPage = ({ setConfirmation }) => {
    const { products, categories, addStockMovement, stockMovements, deleteStockMovement } = useStock();
    
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [movement, setMovement] = useState({ productId: '', variationId: '', type: 'Saída', quantity: '' });

    const [importType, setImportType] = useState('pdf');
    const [importedSnapshots, setImportedSnapshots] = useState([]);
    const [importedVariations, setImportedVariations] = useState([]);
    const [selectedImportIndex, setSelectedImportIndex] = useState(-1);
    const [importError, setImportError] = useState('');
    const [uploadMetadata, setUploadMetadata] = useState(null);
    const fileInputRef = useRef(null);

    const [selectedDate, setSelectedDate] = useState(new Date());
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [calendarView, setCalendarView] = useState('day');

    const isFormValid = useMemo(() => {
        return (
            movement.productId &&
            movement.variationId &&
            movement.quantity &&
            parseInt(movement.quantity, 10) > 0
        );
    }, [movement]);

    const filteredProducts = useMemo(() => {
        if (!selectedCategoryId) return products;
        return products.filter(p => p.categoryId === selectedCategoryId);
    }, [selectedCategoryId, products]);

    const selectedProduct = useMemo(() => products.find(p => p.id === movement.productId), [movement.productId, products]);

    const filteredMovements = useMemo(() => {
        return stockMovements
            .filter(m => m.timestamp.toDateString() === selectedDate.toDateString());
    }, [stockMovements, selectedDate]);

    const findMatchingVariation = useCallback((ref) => {
        const normalizedRef = normalizeReferenceCode(ref);
        if (!normalizedRef) {
            return null;
        }

        for (const product of products) {
            const variations = Array.isArray(product?.variations) ? product.variations : [];
            for (const variation of variations) {
                const normalizedVariation = normalizeReferenceCode(variation?.name);
                if (normalizedVariation && normalizedVariation === normalizedRef) {
                    return {
                        productId: product.id,
                        variationId: variation.id,
                        product,
                        variation,
                    };
                }
            }
        }

        return null;
    }, [products]);

    const applyImportedVariation = useCallback((variation) => {
        if (!variation) {
            return;
        }
        const match = findMatchingVariation(variation.ref);
        setMovement((prev) => ({
            ...prev,
            productId: match?.productId || '',
            variationId: match?.variationId || '',
            quantity: variation.total ? String(variation.total) : '',
        }));
        if (match?.product) {
            setSelectedCategoryId(match.product.categoryId || '');
        }
    }, [findMatchingVariation]);

    const handleApplyImported = useCallback((index) => {
        if (index < 0 || index >= importedVariations.length) {
            return;
        }
        setSelectedImportIndex(index);
        applyImportedVariation(importedVariations[index]);
    }, [importedVariations, applyImportedVariation]);

    const handleNextImported = useCallback(() => {
        if (!importedVariations.length) {
            return;
        }
        const nextIndex = Math.min(importedVariations.length - 1, selectedImportIndex + 1);
        handleApplyImported(nextIndex);
    }, [importedVariations, selectedImportIndex, handleApplyImported]);

    const handlePreviousImported = useCallback(() => {
        if (!importedVariations.length) {
            return;
        }
        const nextIndex = Math.max(0, selectedImportIndex - 1);
        handleApplyImported(nextIndex);
    }, [importedVariations, selectedImportIndex, handleApplyImported]);

    const handleResetImport = useCallback(() => {
        setImportedSnapshots([]);
        setImportedVariations([]);
        setSelectedImportIndex(-1);
        setImportError('');
        setUploadMetadata(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    const handleImportTypeChange = useCallback((event) => {
        setImportType(event.target.value);
        handleResetImport();
    }, [handleResetImport]);

    const acceptAttribute = useMemo(() => (
        importType === 'pdf'
            ? 'application/pdf,.pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx'
    ), [importType]);

    const handleFileChange = useCallback(async (event) => {
        const [file] = event.target.files || [];
        if (!file) {
            handleResetImport();
            return;
        }
        try {
            setImportError('');
            const buffer = await file.arrayBuffer();
            const snapshots = await importStockFile({ file, arrayBuffer: buffer, type: importType });
            const variations = flattenSnapshotsToVariations(snapshots);
            setImportedSnapshots(snapshots);
            setImportedVariations(variations);
            if (variations.length > 0) {
                setSelectedImportIndex(0);
                applyImportedVariation(variations[0]);
            } else {
                setSelectedImportIndex(-1);
            }
            setUploadMetadata({
                fileName: file.name,
                fileType: file.type || importType,
                fileSize: typeof file.size === 'number' ? file.size : buffer.byteLength || 0,
                fileBase64: arrayBufferToBase64(buffer),
                importType,
                snapshotSummary: snapshots.map((snapshot) => ({
                    productCode: snapshot.productCode,
                    variationCount: snapshot.variations.length,
                })),
            });
        } catch (error) {
            console.error('Erro ao importar arquivo de estoque', error);
            setImportError(error.message || 'Não foi possível importar o arquivo.');
            setImportedSnapshots([]);
            setImportedVariations([]);
            setSelectedImportIndex(-1);
            setUploadMetadata(null);
        }
    }, [importType, applyImportedVariation, handleResetImport]);

    const currentImportedVariation = useMemo(() => {
        if (selectedImportIndex < 0 || selectedImportIndex >= importedVariations.length) {
            return null;
        }
        return importedVariations[selectedImportIndex];
    }, [importedVariations, selectedImportIndex]);

    const currentImportMatch = useMemo(() => {
        if (!currentImportedVariation) {
            return null;
        }
        return findMatchingVariation(currentImportedVariation.ref);
    }, [currentImportedVariation, findMatchingVariation]);

    const formattedImportedSizes = useMemo(() => {
        if (!currentImportedVariation) {
            return '';
        }
        const entries = Object.entries(currentImportedVariation.tamanhos || {});
        if (!entries.length) {
            return '';
        }
        return entries.map(([size, value]) => `${size}: ${value}`).join(' | ');
    }, [currentImportedVariation]);

    useEffect(() => {
        setMovement((prev) => {
            if (!selectedCategoryId) {
                return prev;
            }
            const product = products.find(p => p.id === prev.productId);
            if (product && product.categoryId === selectedCategoryId) {
                return prev;
            }
            return { ...prev, productId: '', variationId: '' };
        });
    }, [selectedCategoryId, products]);

    useEffect(() => {
        setMovement((prev) => {
            if (!prev.productId) {
                return prev;
            }
            const product = products.find(p => p.id === prev.productId);
            if (!product) {
                return { ...prev, productId: '', variationId: '' };
            }
            const hasVariation = Array.isArray(product.variations)
                ? product.variations.some(v => v.id === prev.variationId)
                : false;
            if (hasVariation) {
                return prev;
            }
            return { ...prev, variationId: '' };
        });
    }, [movement.productId, products]);

    useEffect(() => {
        if (!importedVariations.length) {
            setSelectedImportIndex(-1);
        }
    }, [importedVariations]);


    const handleSubmit = async (e) => {
        e.preventDefault();
        if(!isFormValid) return;

        const metadataPayload = uploadMetadata
            ? {
                ...uploadMetadata,
                variationRef: currentImportedVariation?.ref || null,
                variationSizes: currentImportedVariation?.tamanhos || null,
            }
            : null;

        await addStockMovement({
            ...movement,
            quantity: parseInt(movement.quantity, 10),
            metadata: metadataPayload,
        });

        if (importedVariations.length && selectedImportIndex + 1 < importedVariations.length) {
            const nextIndex = selectedImportIndex + 1;
            setSelectedImportIndex(nextIndex);
            applyImportedVariation(importedVariations[nextIndex]);
        } else {
            setMovement((prev) => ({ productId: '', variationId: '', type: prev.type, quantity: '' }));
        }
    };

    const handleDeleteClick = (mov) => {
        setConfirmation({
            isOpen: true,
            title: "Confirmar Exclusão",
            message: `Tem certeza que deseja apagar este lançamento? A alteração de estoque (${mov.quantity} un.) será revertida.`,
            onConfirm: () => () => deleteStockMovement(mov)
        });
    };

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold mb-6">Lançamentos de Estoque</h1>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 flex flex-col gap-8">
                    <StockCalendarView
                        selectedDate={selectedDate}
                        setSelectedDate={setSelectedDate}
                        currentMonth={currentMonth}
                        setCurrentMonth={setCurrentMonth}
                        calendarView={calendarView}
                        setCalendarView={setCalendarView}
                        stockMovements={stockMovements}
                    />
                    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg flex flex-col gap-4">
                        <h2 className="text-xl font-semibold">Novo Lançamento</h2>

                        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-xl flex flex-col gap-3">
                            <div>
                                <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de arquivo</label>
                                <select
                                    value={importType}
                                    onChange={handleImportTypeChange}
                                    className="w-full p-2 rounded-md bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600"
                                >
                                    <option value="pdf">PDF</option>
                                    <option value="xlsx">Planilha (XLSX)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Arquivo de importação</label>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={acceptAttribute}
                                    onChange={handleFileChange}
                                    className="w-full text-sm text-gray-700 dark:text-gray-200 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                />
                            </div>
                            {importError && (
                                <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-md p-2">
                                    {importError}
                                </p>
                            )}
                            {importedVariations.length > 0 && (
                                <div className="border border-blue-200 dark:border-blue-700 rounded-lg p-3 bg-white dark:bg-gray-900/60 text-sm flex flex-col gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div>
                                            <p className="font-semibold text-blue-600 dark:text-blue-300">{currentImportedVariation?.ref}</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Quantidade total: {currentImportedVariation?.total ?? 0}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handlePreviousImported}
                                                disabled={selectedImportIndex <= 0}
                                                className="px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-40"
                                            >
                                                Anterior
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleNextImported}
                                                disabled={selectedImportIndex >= importedVariations.length - 1}
                                                className="px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-40"
                                            >
                                                Próximo
                                            </button>
                                        </div>
                                    </div>
                                    {formattedImportedSizes && (
                                        <p className="text-xs text-gray-600 dark:text-gray-300">{formattedImportedSizes}</p>
                                    )}
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {currentImportMatch?.product
                                            ? `Produto identificado: ${currentImportMatch.product.name}`
                                            : 'Nenhuma variação cadastrada corresponde a esta referência.'}
                                    </p>
                                    <div className="flex flex-wrap gap-2 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => handleApplyImported(selectedImportIndex)}
                                            className="px-3 py-1 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
                                        >
                                            Aplicar ao formulário
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleResetImport}
                                            className="px-3 py-1 text-xs font-semibold rounded-md bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                                        >
                                            Limpar importação
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                        {importedSnapshots.length} produtos detectados • {importedVariations.length} variações disponíveis
                                    </p>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block mb-1">Categoria</label>
                            <select value={selectedCategoryId} onChange={e => setSelectedCategoryId(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                <option value="">Todas as Categorias</option>
                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        
                        <div>
                            <label className="block mb-1">Produto</label>
                            <select value={movement.productId} onChange={e => setMovement({...movement, productId: e.target.value})} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                <option value="" disabled>Selecione um produto</option>
                                {filteredProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>

                        {selectedProduct && (
                             <div>
                                 <label className="block mb-1">Variação</label>
                                 <select value={movement.variationId} onChange={e => setMovement({...movement, variationId: e.target.value})} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                     <option value="" disabled>Selecione uma variação</option>
                                     {selectedProduct.variations.map(v => <option key={v.id} value={v.id}>{v.name} (Est: {v.currentStock})</option>)}
                                 </select>
                             </div>
                        )}
                        
                        <div>
                            <label className="block mb-1">Tipo</label>
                            <select value={movement.type} onChange={e => setMovement({...movement, type: e.target.value})} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                <option value="Saída">Saída</option>
                                <option value="Entrada">Entrada</option>
                            </select>
                        </div>
                        <div>
                            <label className="block mb-1">Quantidade</label>
                            <input type="number" min="1" value={movement.quantity} onChange={e => setMovement({...movement, quantity: e.target.value})} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700" />
                        </div>
                        <button 
                            type="submit" 
                            disabled={!isFormValid} 
                            className="w-full h-10 bg-blue-600 text-white rounded-md mt-2 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            Registrar
                        </button>
                    </form>
                </div>
                 <div className="lg:col-span-2 bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                     <h2 className="text-xl font-semibold mb-4">Histórico de Movimentações ({selectedDate.toLocaleDateString('pt-BR')})</h2>
                     <div className="max-h-[80vh] overflow-y-auto">
                         <table className="w-full">
                             <thead className="border-b-2 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900">
                                 <tr>
                                     <th className="p-3 text-left">Hora</th>
                                     <th className="p-3 text-left">Produto (Variação)</th>
                                     <th className="p-3 text-center">Tipo</th>
                                     <th className="p-3 text-center">Quantidade</th>
                                     <th className="p-3 text-left">Usuário</th>
                                     <th className="p-3 text-center">Ações</th>
                                 </tr>
                             </thead>
                             <tbody>
                                 {filteredMovements.length > 0 ? filteredMovements.map(m => {
                                     const product = products.find(p => p.id === m.productId);
                                     const variation = product?.variations.find(v => v.id === m.variationId);
                                     return (
                                         <tr key={m.id} className="border-b dark:border-gray-800">
                                             <td className="p-3">{m.timestamp.toLocaleTimeString('pt-BR')}</td>
                                             <td className="p-3">{product?.name || 'Excluído'} {variation && `(${variation.name})`}</td>
                                             <td className={`p-3 text-center font-semibold ${m.type === 'Entrada' ? 'text-green-500' : 'text-red-500'}`}>{m.type}</td>
                                             <td className="p-3 text-center">{m.quantity}</td>
                                             <td className="p-3 text-left text-xs truncate">{m.userEmail || 'N/A'}</td>
                                             <td className="p-3 text-center">
                                                 <button onClick={() => handleDeleteClick(m)} title="Apagar Lançamento">
                                                     <Trash2 size={18} className="text-red-500 hover:text-red-400"/>
                                                 </button>
                                             </td>
                                         </tr>
                                     );
                                 }) : (
                                     <tr>
                                         <td colSpan="6" className="text-center p-8 text-gray-500">Nenhuma movimentação para esta data.</td>
                                     </tr>
                                 )}
                             </tbody>
                         </table>
                     </div>
                 </div>
            </div>
        </div>
    );
};

const CategoryModal = ({ isOpen, onClose, onCategoryCreated }) => {
    const { addCategory } = useStock();
    const [name, setName] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (name.trim()) {
            const newId = await addCategory(name.trim());
            if (newId) {
                onCategoryCreated(newId);
                setName('');
                onClose();
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[60] modal-backdrop">
            <div 
                ref={modalRef} 
                onMouseDown={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm modal-content"
            >
                <form onSubmit={handleSubmit}>
                    <h2 className="text-xl font-bold mb-4">Criar Nova Categoria</h2>
                    <label htmlFor="category-name" className="block mb-2 text-sm font-medium">Nome da Categoria</label>
                    <input id="category-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4" autoFocus />
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-6 py-2 font-semibold rounded-md bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button>
                        <button type="submit" className="px-6 py-2 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">Criar</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const ProductModal = ({ isOpen, onClose, productToEdit }) => {
    const { categories, addProduct, updateProduct } = useStock();
    
    const initialProductState = useMemo(() => ({ name: '', categoryId: '', minStock: '', leadTimeInMonths: '', variations: [{ name: '', initialStock: '' }] }), []);
    const [productData, setProductData] = useState(initialProductState);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    const hasNewVariation = useMemo(() => {
        if (!productToEdit) return false;
        const existingIds = new Set((productToEdit.variations || []).map(v => v.id));
        return productData.variations.some(v => !existingIds.has(v.id));
    }, [productData.variations, productToEdit]);
    
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if (isOpen) {
            if (productToEdit) {
                setProductData({
                    id: productToEdit.id, // Manter o ID para edição
                    name: productToEdit.name,
                    categoryId: productToEdit.categoryId,
                    minStock: productToEdit.minStock,
                    leadTimeInMonths: productToEdit.leadTimeInMonths || '',
                    variations: productToEdit.variations.map(v => ({ ...v }))
                });
            } else {
                setProductData({ ...initialProductState, categoryId: categories[0]?.id || '' });
            }
        }
    }, [isOpen, productToEdit, categories, initialProductState]);

    useEffect(() => {
        if (!productToEdit) return;

        const newLeadTime = parseFloat(productData.leadTimeInMonths);
        const originalLeadTime = productToEdit.leadTimeInMonths;
        const originalMinStock = productToEdit.minStock;

        if (isNaN(newLeadTime) || newLeadTime <= 0 || isNaN(originalLeadTime) || originalLeadTime <= 0 || isNaN(originalMinStock) || originalMinStock <= 0) {
            return;
        }
        
        if (newLeadTime !== originalLeadTime) {
             const impliedConsumptionPerMonth = originalMinStock / originalLeadTime;
             const newMinStock = Math.round(impliedConsumptionPerMonth * newLeadTime);
             
             setProductData(prev => ({ ...prev, minStock: newMinStock.toString() }));
        }
    }, [productData.leadTimeInMonths, productToEdit]);


    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value } = e.target;
        setProductData(prev => ({ ...prev, [name]: value }));
    };

    const handleVariationChange = (index, e) => {
        const { name, value } = e.target;
        const variations = [...productData.variations];
        variations[index][name] = value;
        setProductData(prev => ({ ...prev, variations }));
    };

    const addVariation = () => {
        setProductData(prev => ({
            ...prev,
            variations: [
                ...prev.variations,
                productToEdit
                    ? { id: generateId('var'), name: '', initialStock: '', currentStock: 0, isNew: true }
                    : { name: '', initialStock: '' }
            ]
        }));
    };

    const removeVariation = (index) => {
        if (productData.variations.length <= 1) return;
        const variations = [...productData.variations];
        variations.splice(index, 1);
        setProductData(prev => ({ ...prev, variations }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const normalizedVariations = productData.variations.map(variation => {
            const { isNew, ...rest } = variation;
            const parsedInitialStock = parseInt(rest.initialStock, 10) || 0;
            const existingVariation = productToEdit?.variations.find(v => v.id === rest.id);

            if (existingVariation) {
                return {
                    ...existingVariation,
                    ...rest,
                    initialStock: parsedInitialStock,
                    currentStock: existingVariation.currentStock
                };
            }

            const generatedId = rest.id || generateId('var');

            return {
                ...rest,
                id: generatedId,
                initialStock: parsedInitialStock,
                currentStock: parsedInitialStock
            };
        });

        const data = {
            ...productData,
            minStock: parseInt(productData.minStock, 10) || 0,
            leadTimeInMonths: parseFloat(productData.leadTimeInMonths) || 0,
            variations: normalizedVariations
        };
        if (productToEdit) {
            await updateProduct(productToEdit.id, data);
        } else {
            await addProduct(data);
        }
        onClose();
    };

    const handleCategoryCreated = (newCategoryId) => {
      if(newCategoryId) {
        setProductData(prev => ({...prev, categoryId: newCategoryId}));
      }
      setIsCategoryModalOpen(false);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop p-4">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-2xl modal-content max-h-[90vh] flex flex-col">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-grow">
                    <h2 className="text-2xl font-bold mb-2">{productToEdit ? 'Editar Produto' : 'Criar Novo Produto'}</h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-1">
                            <label htmlFor="name">Nome do Produto</label>
                            <input id="name" name="name" type="text" value={productData.name} onChange={handleChange} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mt-1"/>
                        </div>
                         <div>
                            <label htmlFor="leadTimeInMonths">Tempo de Entrega (meses)</label>
                            <input id="leadTimeInMonths" name="leadTimeInMonths" type="number" step="0.5" min="0" value={productData.leadTimeInMonths} onChange={handleChange} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mt-1"/>
                        </div>
                        <div>
                            <label htmlFor="minStock">Estoque Mínimo (Total)</label>
                            <input id="minStock" name="minStock" type="number" min="0" value={productData.minStock} onChange={handleChange} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mt-1"/>
                        </div>
                    </div>
                     <div>
                        <label htmlFor="categoryId">Categoria</label>
                        <div className="flex items-center gap-2">
                            <select id="categoryId" name="categoryId" value={productData.categoryId} onChange={handleChange} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mt-1">
                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <button type="button" onClick={() => setIsCategoryModalOpen(true)} className="p-2 bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 mt-1"><PlusCircle size={20}/></button>
                        </div>
                    </div>

                    <div className="flex-grow overflow-y-auto pr-2">
                        <h3 className="text-lg font-semibold mt-4 mb-2">Variações do Produto</h3>
                        {productData.variations.map((variation, index) => (
                             <div key={index} className="grid grid-cols-12 gap-2 items-center mb-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-md">
                                 <div className="col-span-6">
                                     <label className="text-xs">Nome da Variação (Ex: Cor, Tamanho)</label>
                                     <input name="name" type="text" value={variation.name} onChange={(e) => handleVariationChange(index, e)} required className="w-full p-2 rounded-md bg-white dark:bg-gray-700"/>
                                 </div>
                                 <div className="col-span-5">
                                     <label className="text-xs">Estoque Inicial</label>
                                     <input name="initialStock" type="number" min="0" value={variation.initialStock} onChange={(e) => handleVariationChange(index, e)} required className="w-full p-2 rounded-md bg-white dark:bg-gray-700"/>
                                </div>
                                <div className="col-span-1">
                                     <label className="text-xs">&nbsp;</label>
                                     <button type="button" onClick={() => removeVariation(index)} disabled={productData.variations.length <= 1} className="p-2 text-red-500 disabled:opacity-30">
                                         <MinusCircle size={20} />
                                     </button>
                                </div>
                            </div>
                        ))}
                        <button type="button" onClick={addVariation} className="mt-2 text-sm text-blue-600 hover:underline">+ Adicionar Variação</button>
                        {hasNewVariation && (
                            <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
                                Adicionar uma nova variação recalcula o estoque total com base no estoque inicial informado para ela.
                            </p>
                        )}
                    </div>


                    <div className="flex justify-end gap-4 mt-4 pt-4 border-t dark:border-gray-700">
                        <button type="button" onClick={onClose} className="px-6 py-2 font-semibold rounded-md bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button>
                        <button type="submit" className="px-6 py-2 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">Salvar</button>
                    </div>
                </form>
            </div>
            <CategoryModal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} onCategoryCreated={handleCategoryCreated} />
        </div>
    );
};


const StockProductsPage = ({ setConfirmation }) => {
    const { products, categories, deleteProduct } = useStock();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    
    const getCategoryName = (id) => categories.find(c => c.id === id)?.name || 'N/A';
    const getTotalStock = (p) => p.variations.reduce((sum, v) => sum + v.currentStock, 0);

    const handleOpenCreateModal = () => {
        setEditingProduct(null);
        setIsModalOpen(true);
    };
    
    const handleOpenEditModal = (product) => {
        setEditingProduct(product);
        setIsModalOpen(true);
    };

    const handleDeleteClick = (product) => {
        setConfirmation({
            isOpen: true,
            title: `Excluir Produto`,
            message: `Tem certeza que deseja excluir "${product.name}"? O produto será movido para a lixeira.`,
            onConfirm: () => () => deleteProduct(product.id)
        });
    };

    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Gerenciamento de Produtos</h1>
                <button onClick={handleOpenCreateModal} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <PlusCircle size={20}/> Adicionar Novo Produto
                </button>
            </div>
            
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                <table className="w-full">
                    <thead className="border-b-2 dark:border-gray-700">
                        <tr>
                            <th className="p-3 text-left">Nome</th>
                            <th className="p-3 text-left">Categoria</th>
                            <th className="p-3 text-center">Estoque Atual</th>
                            <th className="p-3 text-left">Criado por</th>
                            <th className="p-3 text-left">Última Edição</th>
                            <th className="p-3 text-center">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {products.map(p => (
                            <tr key={p.id} className="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <td className="p-3 font-medium">
                                    {p.name}
                                    <div className="text-xs text-gray-500">
                                        {p.variations.map(v => `${v.name}: ${v.currentStock}`).join(' | ')}
                                    </div>
                                </td>
                                <td className="p-3">{getCategoryName(p.categoryId)}</td>
                                <td className="p-3 text-center font-bold">{getTotalStock(p).toLocaleString('pt-BR')}</td>
                                <td className="p-3 text-xs">{p.createdBy?.email || 'N/A'}</td>
                                <td className="p-3 text-xs">{p.lastEditedBy?.email || 'N/A'}</td>
                                <td className="p-3">
                                    <div className="flex gap-2 justify-center">
                                        <button onClick={() => handleOpenEditModal(p)} title="Editar"><Edit size={18} className="text-yellow-500 hover:text-yellow-400"/></button>
                                        <button onClick={() => handleDeleteClick(p)} title="Excluir"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <ProductModal 
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                productToEdit={editingProduct}
            />
        </div>
    );
};

const StockTrashPage = () => {
    const { deletedProducts, restoreProduct } = useStock();

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold mb-6">Lixeira de Estoque</h1>
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                {deletedProducts.map(p => {
                    return (
                        <div key={p.id} className="flex justify-between items-center p-4 border-b dark:border-gray-800">
                            <div>
                                <p className="font-bold">{p.name}</p>
                                <p className="text-sm text-gray-500">Excluído por: {p.deletedBy?.email || 'Desconhecido'} em: {p.deletedAt ? p.deletedAt.toDate().toLocaleString('pt-BR') : 'Data desconhecida'}</p>
                            </div>
                            <button onClick={() => restoreProduct(p.id)} className="p-2 bg-green-500 text-white rounded-md">Restaurar</button>
                        </div>
                    );
                })}
                {deletedProducts.length === 0 && <p>A lixeira está vazia.</p>}
            </div>
        </div>
    );
};


export const StockManagementApp = ({ onNavigateToCrono, onNavigateToReports, onNavigateToFichaTecnica }) => {
    const [activePage, setActivePage] = useState('dashboard');
    const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });
    const { theme, toggleTheme } = usePersistedTheme();
    const [stockExportFormat, setStockExportFormat] = useState(DEFAULT_REPORT_FORMATS[0]?.value || 'pdf');
    const [isExportingStockReport, setIsExportingStockReport] = useState(false);

    const stockExportTranslations = useMemo(() => ({
        triggerLabel: 'Relatórios',
        exportButton: 'Exportar',
        exportingButton: 'Gerando...',
        formatLabel: 'Formato do relatório',
    }), []);

    const handleExportStockReport = useCallback(async (format = stockExportFormat) => {
        setIsExportingStockReport(true);
        try {
            const message = 'A exportação de estoque estará disponível em breve.';
            if (typeof window !== 'undefined') {
                window.alert(message);
            } else {
                console.info(message);
            }
            console.info('Stock report export requested', { format });
        } finally {
            setIsExportingStockReport(false);
        }
    }, [stockExportFormat]);

    const renderPage = () => {
        const props = { setConfirmation };
        switch (activePage) {
            case 'dashboard': return <StockDashboardPage {...props} />;
            case 'movements': return <StockMovementsPage {...props} />;
            case 'products': return <StockProductsPage {...props} />;
            case 'trash': return <StockTrashPage {...props} />;
            default: return <StockDashboardPage {...props} />;
        }
    };

    const handleConfirm = () => {
        if (confirmation.onConfirm) {
            confirmation.onConfirm()();
        }
        setConfirmation({ isOpen: false });
    };

    return (
        <StockProvider>
            <div className="responsive-root min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 font-sans flex flex-col">
                <ConfirmationModal
                    isOpen={confirmation.isOpen}
                    onClose={() => setConfirmation({ isOpen: false, title: '', message: '', onConfirm: () => {} })}
                    onConfirm={handleConfirm}
                    title={confirmation.title}
                    message={confirmation.message}
                />
                <StockHeader
                    onNavigateToCrono={onNavigateToCrono}
                    onNavigateToFichaTecnica={onNavigateToFichaTecnica}
                    onNavigateToReports={onNavigateToReports}
                    theme={theme}
                    toggleTheme={toggleTheme}
                    exportFormat={stockExportFormat}
                    onChangeExportFormat={setStockExportFormat}
                    onExportReport={handleExportStockReport}
                    isExportingReport={isExportingStockReport}
                    exportTranslations={stockExportTranslations}
                    exportFormats={DEFAULT_REPORT_FORMATS}
                />
                <div className="flex flex-col lg:flex-row flex-grow">
                    <StockSidebar activePage={activePage} setActivePage={setActivePage} />
                    <main className="flex-grow bg-gray-50 dark:bg-gray-800/50 responsive-main">
                        {renderPage()}
                    </main>
                </div>
            </div>
        </StockProvider>
    );
};

