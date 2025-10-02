import React, { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from 'react';
import { BarChart as RechartsBarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Sun, Moon, PlusCircle, List, Edit, Trash2, Save, XCircle, ChevronLeft, ChevronRight, MessageSquare, Layers, ChevronUp, ChevronDown, LogOut, Eye, EyeOff, Settings, ChevronDown as ChevronDownIcon, Package, Monitor, ArrowLeft, ArrowRight, UserCog, ShieldCheck, Users, BarChart, Film, Warehouse, Home, ArrowUpDown, Box, Trash, Folder, Calendar as CalendarIcon, User, MinusCircle } from 'lucide-react';

// --- ESTILOS GLOBAIS E ANIMAÇÕES ---
const GlobalStyles = () => (
    <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleUp { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .modal-backdrop { animation: fadeIn 0.2s ease-out forwards; }
        .modal-content { animation: scaleUp 0.2s ease-out forwards; }
        .dropdown-content { animation: slideDown 0.2s ease-out forwards; }
    `}</style>
);

// --- HOOK PARA CLICAR FORA ---
const useClickOutside = (ref, handler) => {
    useEffect(() => {
        const listener = (event) => {
            if (!ref.current || ref.current.contains(event.target)) return;
            handler(event);
        };
        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [ref, handler]);
};

// --- FUNÇÃO DE HASH ---
async function sha256Hex(message) {
    const data = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const raceBullLogoUrl = "https://firebasestorage.googleapis.com/v0/b/quadrodeproducao.firebasestorage.app/o/assets%2FLOGO%20PROPRIET%C3%81RIA.png?alt=media&token=a16d015f-e8ca-4b3c-b744-7cef3ab6504b";


// #######################################################################
// #                                                                     #
// #         INÍCIO: GERENCIADOR DE ESTOQUE (NOVA FUNCIONALIDADE)        #
// #                                                                     #
// #######################################################################

// --- ESTRUTURA DE DADOS E ESTADO GLOBAL (React Context) ---
const mockData = {
    users: [{ id: 'user1', name: 'Usuário Padrão' }, { id: 'user2', name: 'Admin' }],
    currentUser: 'user1',
    categories: [
        { id: 'cat1', name: 'Zíperes', createdBy: 'user1' },
        { id: 'cat2', name: 'Linhas', createdBy: 'user1' },
        { id: 'cat3', name: 'Etiquetas', createdBy: 'user1' },
        { id: 'cat4', name: 'Acabamento e Estoque', createdBy: 'user1' },
        { id: 'cat5', name: 'Tecidos', createdBy: 'user1' },
    ],
    products: [
        { 
            id: 'prod_tecido1', 
            name: 'Tecido Orfeu', 
            categoryId: 'cat5', 
            minStock: 20000, 
            leadTimeInMonths: 2,
            isDeleted: false,
            variations: [
                { id: 'var_t1a', name: 'Largura 1,57m', initialStock: 15000, currentStock: 8000 },
                { id: 'var_t1b', name: 'Largura 1,58m', initialStock: 15000, currentStock: 12500 }
            ]
        },
        { 
            id: 'prod1', 
            name: 'ZÍPER AZUL', 
            categoryId: 'cat1', 
            minStock: 5000, 
            leadTimeInMonths: 1,
            isDeleted: false,
            variations: [
                { id: 'var_z1a', name: '18cm', initialStock: 31000, currentStock: 17052 },
                { id: 'var_z1b', name: '16cm', initialStock: 28000, currentStock: 14031 },
            ]
        },
        { 
            id: 'prod3', 
            name: 'LINHA OCRE 660', 
            categoryId: 'cat2', 
            minStock: 30, 
            leadTimeInMonths: 0.5,
            isDeleted: false,
            variations: [
                 { id: 'var_l1a', name: '0.36', initialStock: 320, currentStock: 360 }
            ]
        },
        { id: 'prod5', name: 'TAG RACE BULL MASC. ADULTO', categoryId: 'cat4', minStock: 4000, isDeleted: true, leadTimeInMonths: 3, variations: [{id: 'var_tg1', name: 'Padrão', initialStock: 42315, currentStock: 18833}] },
    ],
    stockMovements: [
        { id: 'mov1', productId: 'prod1', variationId: 'var_z1a', quantity: 100, type: 'Saída', timestamp: new Date(2025, 9, 1, 10, 0, 0).toISOString(), user: 'user1' },
        { id: 'mov2', productId: 'prod1', variationId: 'var_z1b', quantity: 50, type: 'Saída', timestamp: new Date(2025, 9, 1, 11, 0, 0).toISOString(), user: 'user1' },
        { id: 'mov3', productId: 'prod3', variationId: 'var_l1a', quantity: 200, type: 'Entrada', timestamp: new Date(2025, 8, 30, 14, 0, 0).toISOString(), user: 'user2' },
    ],
    auditLog: [
        { id: 'log1', action: 'STOCK_UPDATED', details: { productName: 'ZÍPER AZUL (18cm)', change: -100, type: 'Saída' }, timestamp: new Date(2025, 9, 1, 10, 0, 0).toISOString(), user: 'user1' },
        { id: 'log2', action: 'PRODUCT_DELETED', details: { productName: 'TAG RACE BULL MASC. ADULTO' }, timestamp: new Date(2025, 8, 29, 10, 0, 0).toISOString(), user: 'user2' },
    ]
};

const StockContext = createContext();

const StockProvider = ({ children }) => {
  const [state, setState] = useState(mockData);

    const generateId = useCallback((prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, []);

    const getCategories = useCallback(() => [...state.categories].sort((a, b) => a.name.localeCompare(b.name)), [state.categories]);
    const getProducts = useCallback(() => [...state.products.filter(p => !p.isDeleted)].sort((a, b) => a.name.localeCompare(b.name)), [state.products]);
    const getDeletedProducts = useCallback(() => state.products.filter(p => p.isDeleted), [state.products]);

    const addCategory = useCallback((categoryName) => {
        const newCategoryId = generateId('cat');
        setState(prev => {
            if (prev.categories.some(c => c.name.toLowerCase() === categoryName.toLowerCase())) {
                return prev;
            }
            const newCategory = { id: newCategoryId, name: categoryName, createdBy: prev.currentUser };
            const newAuditLog = { id: generateId('log'), action: 'CATEGORY_CREATED', details: { categoryName }, timestamp: new Date().toISOString(), user: prev.currentUser };
            return { ...prev, categories: [...prev.categories, newCategory], auditLog: [...prev.auditLog, newAuditLog] };
        });
        return newCategoryId;
    }, [generateId]);

    const addProduct = useCallback((productData) => {
        setState(prev => {
            const newProduct = {
                id: generateId('prod'),
                ...productData,
                isDeleted: false,
                variations: productData.variations.map(v => ({
                    ...v,
                    id: generateId('var'),
                    currentStock: parseInt(v.initialStock, 10) || 0
                }))
            };
            const newAuditLog = { id: generateId('log'), action: 'PRODUCT_CREATED', details: { productName: newProduct.name }, timestamp: new Date().toISOString(), user: prev.currentUser };
            return { ...prev, products: [...prev.products, newProduct], auditLog: [...prev.auditLog, newAuditLog] };
        });
    }, [generateId]);

    const updateProduct = useCallback((productId, productData) => {
        setState(prev => {
            const products = prev.products.map(p => {
                if (p.id === productId) {
                    return {
                        ...p,
                        name: productData.name,
                        categoryId: productData.categoryId,
                        minStock: productData.minStock,
                        leadTimeInMonths: productData.leadTimeInMonths,
                    };
                }
                return p;
            });
            const updatedProduct = products.find(p => p.id === productId);
            const newAuditLog = { id: generateId('log'), action: 'PRODUCT_UPDATED', details: { productName: updatedProduct.name }, timestamp: new Date().toISOString(), user: prev.currentUser };
            return { ...prev, products, auditLog: [...prev.auditLog, newAuditLog] };
        });
    }, [generateId]);

    const deleteProduct = useCallback((productId) => {
        setState(prev => {
            const products = prev.products.map(p => p.id === productId ? { ...p, isDeleted: true } : p);
            const deletedProduct = products.find(p => p.id === productId);
            const newAuditLog = { id: generateId('log'), action: 'PRODUCT_DELETED', details: { productName: deletedProduct.name }, timestamp: new Date().toISOString(), user: prev.currentUser };
            return { ...prev, products, auditLog: [...prev.auditLog, newAuditLog] };
        });
    }, [generateId]);

    const restoreProduct = useCallback((productId) => {
        setState(prev => {
            const products = prev.products.map(p => p.id === productId ? { ...p, isDeleted: false } : p);
            const restoredProduct = products.find(p => p.id === productId);
            const newAuditLog = { id: generateId('log'), action: 'PRODUCT_RESTORED', details: { productName: restoredProduct.name }, timestamp: new Date().toISOString(), user: prev.currentUser };
            return { ...prev, products, auditLog: [...prev.auditLog, newAuditLog] };
        });
    }, [generateId]);

    const addStockMovement = useCallback(({ productId, variationId, quantity, type }) => {
        setState(prev => {
            let productName = '', variationName = '';
            const products = prev.products.map(p => {
                if (p.id === productId) {
                    productName = p.name;
                    const newVariations = p.variations.map(v => {
                        if (v.id === variationId) {
                            variationName = v.name;
                            const change = type === 'Entrada' ? parseInt(quantity, 10) : -parseInt(quantity, 10);
                            return { ...v, currentStock: v.currentStock + change };
                        }
                        return v;
                    });
                    return { ...p, variations: newVariations };
                }
                return p;
            });
            const newMovement = { id: generateId('mov'), productId, variationId, quantity, type, timestamp: new Date().toISOString(), user: prev.currentUser };
            const newAuditLog = { id: generateId('log'), action: 'STOCK_UPDATED', details: { productName: `${productName} (${variationName})`, change: type === 'Entrada' ? quantity : -quantity, type }, timestamp: new Date().toISOString(), user: prev.currentUser };
            return { ...prev, products, stockMovements: [...prev.stockMovements, newMovement], auditLog: [...prev.auditLog, newAuditLog] };
        });
    }, [generateId]);

    const setCurrentUser = useCallback((userId) => setState(prev => ({ ...prev, currentUser: userId })), []);

    const value = useMemo(() => ({
        ...state,
        setCurrentUser,
        getCategories,
        getProducts,
        getDeletedProducts,
        addCategory,
        addProduct,
        updateProduct,
        deleteProduct,
        restoreProduct,
        addStockMovement
    }), [state, setCurrentUser, getCategories, getProducts, getDeletedProducts, addCategory, addProduct, updateProduct, deleteProduct, restoreProduct, addStockMovement]);

    return <StockContext.Provider value={value}>{children}</StockContext.Provider>;
};

// --- HOOK DE ABSTRAÇÃO DE DADOS ---
const useStock = () => useContext(StockContext);

// --- COMPONENTES DA UI DE ESTOQUE ---
const StockHeader = ({ onNavigateToCrono }) => {
    const { users, currentUser, setCurrentUser } = useStock();
    return (
        <header className="bg-white dark:bg-gray-900 shadow-md p-4 flex justify-between items-center sticky top-0 z-40">
            <div className="flex items-center gap-4">
                <img src={raceBullLogoUrl} alt="Race Bull Logo" className="h-12 w-auto dark:invert" />
                <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white">Painel de Estoque</h1>
            </div>
            <div className="flex items-center gap-4">
                <button onClick={onNavigateToCrono} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2">
                    <Home size={20} />
                    <span className="hidden sm:inline">Quadro de Produção</span>
                </button>
                <div className="relative">
                    <select value={currentUser} onChange={(e) => setCurrentUser(e.target.value)} className="p-2 rounded-md bg-gray-100 dark:bg-gray-800 appearance-none">
                        {users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                    </select>
                </div>
            </div>
        </header>
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
        <aside className="w-64 bg-white dark:bg-gray-900 p-4 flex flex-col">
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

const StockDashboardPage = () => {
    const { getProducts, getCategories } = useStock();
    const allProducts = getProducts();
    const categories = getCategories();

    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [sortOrder, setSortOrder] = useState('asc'); // 'asc' or 'desc'

    const getTotalStock = (p) => p.variations.reduce((sum, v) => sum + v.currentStock, 0);

    const displayedProducts = useMemo(() => {
        let filteredProducts = allProducts;

        if (selectedCategoryId) {
            filteredProducts = allProducts.filter(p => p.categoryId === selectedCategoryId);
        }

        return [...filteredProducts].sort((a, b) => {
            if (sortOrder === 'asc') {
                return a.name.localeCompare(b.name);
            } else {
                return b.name.localeCompare(a.name);
            }
        });
    }, [allProducts, selectedCategoryId, sortOrder]);

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold mb-6">Visão Geral do Estoque</h1>

            {/* Controls: Filter and Sort */}
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
                            <th className="p-3 text-center">Estoque Final (Total)</th>
                            <th className="p-3 text-center">Estoque Mínimo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedProducts.map(p => {
                            const totalCurrentStock = getTotalStock(p);
                            const totalInitialStock = p.variations.reduce((sum, v) => sum + v.initialStock, 0);
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
            const dateStr = new Date(mov.timestamp).toDateString();
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
                    return (<button key={i} onClick={() => setSelectedDate(day)} className={`p-2 rounded-full text-sm relative ${isCurrentMonth ? '' : 'text-gray-400 dark:text-gray-600'} ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{day.getDate()}{hasData && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full"></span>}</button>)
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

const StockMovementsPage = () => {
    const { getProducts, getDeletedProducts, getCategories, addStockMovement, stockMovements } = useStock();
    
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [movement, setMovement] = useState({ productId: '', variationId: '', type: 'Saída', quantity: '' });
    
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [calendarView, setCalendarView] = useState('day');
    
    const categories = getCategories();
    const allProducts = getProducts();

    const filteredProducts = useMemo(() => {
        if (!selectedCategoryId) return allProducts;
        return allProducts.filter(p => p.categoryId === selectedCategoryId);
    }, [selectedCategoryId, allProducts]);

    const selectedProduct = useMemo(() => allProducts.find(p => p.id === movement.productId), [movement.productId, allProducts]);

    const filteredMovements = useMemo(() => {
        return [...stockMovements]
            .reverse()
            .filter(m => new Date(m.timestamp).toDateString() === selectedDate.toDateString());
    }, [stockMovements, selectedDate]);

    // Reset product/variation selection when category changes
    useEffect(() => {
        setMovement(m => ({ ...m, productId: '', variationId: '' }));
    }, [selectedCategoryId]);

    // Reset variation when product changes
    useEffect(() => {
        setMovement(m => ({ ...m, variationId: '' }));
    }, [movement.productId]);


    const handleSubmit = (e) => {
        e.preventDefault();
        if(!movement.productId || !movement.variationId || !movement.quantity || parseInt(movement.quantity) <= 0) return;
        addStockMovement({ ...movement, quantity: parseInt(movement.quantity) });
        setMovement({ ...movement, quantity: '' });
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
                        <button type="submit" className="w-full h-10 bg-blue-600 text-white rounded-md mt-2">Registrar</button>
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
                                </tr>
                            </thead>
                            <tbody>
                                {filteredMovements.length > 0 ? filteredMovements.map(m => {
                                    const product = allProducts.find(p => p.id === m.productId) || getDeletedProducts().find(p => p.id === m.productId);
                                    const variation = product?.variations.find(v => v.id === m.variationId);
                                    return (
                                        <tr key={m.id} className="border-b dark:border-gray-800">
                                            <td className="p-3">{new Date(m.timestamp).toLocaleTimeString('pt-BR')}</td>
                                            <td className="p-3">{product?.name || 'Excluído'} {variation && `(${variation.name})`}</td>
                                            <td className={`p-3 text-center font-semibold ${m.type === 'Entrada' ? 'text-green-500' : 'text-red-500'}`}>{m.type}</td>
                                            <td className="p-3 text-center">{m.quantity}</td>
                                        </tr>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan="4" className="text-center p-8 text-gray-500">Nenhuma movimentação para esta data.</td>
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

    const handleSubmit = (e) => {
        e.preventDefault();
        if (name.trim()) {
            const newId = addCategory(name.trim());
            onCategoryCreated(newId);
            setName('');
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[60] modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm modal-content">
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
    const { getCategories, addProduct, updateProduct, addCategory } = useStock();
    
    const initialProductState = { name: '', categoryId: '', minStock: '', leadTimeInMonths: '', variations: [{ name: '', initialStock: '' }] };
    const [productData, setProductData] = useState(initialProductState);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    
    const categories = getCategories();
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => {
        if (isOpen) {
            if (productToEdit) {
                setProductData({
                    name: productToEdit.name,
                    categoryId: productToEdit.categoryId,
                    minStock: productToEdit.minStock,
                    leadTimeInMonths: productToEdit.leadTimeInMonths || '',
                    variations: productToEdit.variations.map(v => ({...v})) // Make a copy
                });
            } else {
                setProductData({ ...initialProductState, categoryId: categories[0]?.id || '' });
            }
        }
    }, [isOpen, productToEdit]);

    if (!isOpen) return null;

    const handleChange = (e) => {
        const { name, value } = e.target;
        setProductData(prev => ({ ...prev, [name]: value }));
    };

    const handleVariationChange = (index, e) => {
        const { name, value } = e.target;
        const variations = [...productData.variations];
        variations[index][name] = value;
        setProductData(prev => ({...prev, variations}));
    };
    
    const addVariation = () => {
        setProductData(prev => ({...prev, variations: [...prev.variations, {name: '', initialStock: ''}]}));
    };
    
    const removeVariation = (index) => {
        if(productData.variations.length <= 1) return;
        const variations = [...productData.variations];
        variations.splice(index, 1);
        setProductData(prev => ({...prev, variations}));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const data = {
            ...productData,
            minStock: parseInt(productData.minStock),
            leadTimeInMonths: parseFloat(productData.leadTimeInMonths) || 0,
            variations: productData.variations.map(v => ({
                ...v,
                initialStock: parseInt(v.initialStock)
            }))
        };
        if (productToEdit) {
            updateProduct(productToEdit.id, data);
        } else {
            addProduct(data);
        }
        onClose();
    };

    const handleCategoryCreated = (newCategoryId) => {
      if(newCategoryId) {
        setProductData(prev => ({...prev, categoryId: newCategoryId}));
      }
      setIsCategoryModalOpen(false);
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop p-4">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-2xl modal-content max-h-[90vh] flex flex-col">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-grow">
                    <h2 className="text-2xl font-bold mb-2">{productToEdit ? 'Editar Produto' : 'Criar Novo Produto'}</h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="name">Nome do Produto</label>
                            <input id="name" name="name" type="text" value={productData.name} onChange={handleChange} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mt-1"/>
                        </div>
                         <div>
                            <label htmlFor="minStock">Estoque Mínimo (Total)</label>
                            <input id="minStock" name="minStock" type="number" min="0" value={productData.minStock} onChange={handleChange} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mt-1"/>
                        </div>
                        <div>
                            <label htmlFor="leadTimeInMonths">Tempo de Entrega (meses)</label>
                            <input id="leadTimeInMonths" name="leadTimeInMonths" type="number" step="0.5" min="0" value={productData.leadTimeInMonths} onChange={handleChange} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mt-1"/>
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
                                    <input name="initialStock" type="number" min="0" value={variation.initialStock} onChange={(e) => handleVariationChange(index, e)} required disabled={!!productToEdit} className="w-full p-2 rounded-md bg-white dark:bg-gray-700 disabled:opacity-50"/>
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


const StockProductsPage = () => {
    const { getProducts, getCategories, deleteProduct } = useStock();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    
    const products = getProducts();
    const categories = getCategories();
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
                            <th className="p-3 text-center">Estoque Atual (Total)</th>
                            <th className="p-3 text-center">Estoque Mínimo</th>
                            <th className="p-3 text-center">Tempo de Entrega (meses)</th>
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
                                <td className="p-3 text-center">{p.minStock.toLocaleString('pt-BR')}</td>
                                <td className="p-3 text-center">{(p.leadTimeInMonths || 0).toLocaleString('pt-BR')}</td>
                                <td className="p-3">
                                    <div className="flex gap-2 justify-center">
                                        <button onClick={() => handleOpenEditModal(p)} title="Editar"><Edit size={18} className="text-yellow-500 hover:text-yellow-400"/></button>
                                        <button onClick={() => deleteProduct(p.id)} title="Excluir"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>
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
    const { getDeletedProducts, restoreProduct, users, auditLog } = useStock();
    
    const products = getDeletedProducts();

    const findDeletionInfo = (productId) => {
        const product = products.find(p => p.id === productId);
        if (!product) return { user: 'N/A', date: 'N/A' };

        const log = [...auditLog].reverse().find(l => 
            l.action === 'PRODUCT_DELETED' && l.details.productName === product.name
        );
        
        if (!log) return { user: 'N/A', date: 'N/A' };
        
        const user = users.find(u => u.id === log.user);
        return {
            user: user ? user.name : 'Desconhecido',
            date: new Date(log.timestamp).toLocaleString('pt-BR')
        }
    };

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold mb-6">Lixeira</h1>
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                {products.map(p => {
                    const deletionInfo = findDeletionInfo(p.id);
                    return (
                        <div key={p.id} className="flex justify-between items-center p-4 border-b dark:border-gray-800">
                            <div>
                                <p className="font-bold">{p.name}</p>
                                <p className="text-sm text-gray-500">Excluído por: {deletionInfo.user} em {deletionInfo.date}</p>
                            </div>
                            <button onClick={() => restoreProduct(p.id)} className="p-2 bg-green-500 text-white rounded-md">Restaurar</button>
                        </div>
                    );
                })}
                {products.length === 0 && <p>A lixeira está vazia.</p>}
            </div>
        </div>
    );
};


const StockManagementApp = ({ onNavigateToCrono }) => {
    const [activePage, setActivePage] = useState('dashboard');

    const renderPage = () => {
        switch (activePage) {
            case 'dashboard': return <StockDashboardPage />;
            case 'movements': return <StockMovementsPage />;
            case 'products': return <StockProductsPage />;
            case 'trash': return <StockTrashPage />;
            default: return <StockDashboardPage />;
        }
    };

    return (
        <StockProvider>
            <div className="min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 font-sans flex flex-col">
                <StockHeader onNavigateToCrono={onNavigateToCrono} />
                <div className="flex flex-grow">
                    <StockSidebar activePage={activePage} setActivePage={setActivePage} />
                    <main className="flex-grow bg-gray-50 dark:bg-gray-800/50">
                        {renderPage()}
                    </main>
                </div>
            </div>
        </StockProvider>
    );
};

// #####################################################################
// #                                                                     #
// #          FIM: GERENCIADOR DE ESTOQUE (NOVA FUNCIONALIDADE)          #
// #                                                                     #
// #####################################################################



// #####################################################################
// #                                                                     #
// #         INÍCIO: CRONOANÁLISE DASHBOARD (CÓDIGO EXISTENTE)           #
// #                                                                     #
// #####################################################################

const initialDashboards = [
    { id: 'producao', name: 'Quadro da Produção' },
    { id: 'acabamento', name: 'Quadro do Acabamento' },
    { id: 'estoque', name: 'Quadro do Estoque' },
    { id: 'corte', name: 'Quadro do Corte' },
    { id: 'travete', name: 'Quadro do Travete' },
];

const FIXED_PERIODS = ["08:00", "09:00", "10:00", "11:00", "11:45", "14:00", "15:00", "16:00", "17:00"];

const ALL_PERMISSIONS = {
    MANAGE_DASHBOARDS: 'Gerenciar Quadros (Criar/Renomear/Excluir/Reordenar)',
    MANAGE_PRODUCTS: 'Gerenciar Produtos (Criar/Editar/Excluir)',
    MANAGE_LOTS: 'Gerenciar Lotes (Criar/Editar/Excluir/Reordenar)',
    ADD_ENTRIES: 'Adicionar Lançamentos de Produção',
    EDIT_ENTRIES: 'Editar Lançamentos de Produção',
    DELETE_ENTRIES: 'Excluir Lançamentos de Produção',
    VIEW_TRASH: 'Visualizar Lixeira',
    MANAGE_SETTINGS: 'Acessar e Gerenciar Configurações de Administrador',
};

const defaultRoles = {
    'admin': { id: 'admin', name: 'Administrador', permissions: Object.keys(ALL_PERMISSIONS) },
    'editor': { id: 'editor', name: 'Editor', permissions: ['MANAGE_PRODUCTS', 'MANAGE_LOTS', 'ADD_ENTRIES', 'EDIT_ENTRIES', 'DELETE_ENTRIES'] },
    'viewer': { id: 'viewer', name: 'Visualizador', permissions: [] },
};

const LS_PREFIX = 'cronoanalise_local_';
const LS_KEYS = {
    DASHBOARDS: `${LS_PREFIX}dashboards`,
    LAST_DASHBOARD_INDEX: `${LS_PREFIX}lastDashboardIndex`,
    PRODUCTS: (dashId) => `${LS_PREFIX}${dashId}_products`,
    LOTS: (dashId) => `${LS_PREFIX}${dashId}_lots`,
    PRODUCTION_DATA: (dashId) => `${LS_PREFIX}${dashId}_productionData`,
    ADMIN_CONFIG: `${LS_PREFIX}admin_config`,
    ROLES: `${LS_PREFIX}roles`,
    USERS: `${LS_PREFIX}users`,
    CURRENT_USER_EMAIL: `${LS_PREFIX}currentUserEmail`,
    TV_PREDICTIONS: (dashId) => `${LS_PREFIX}${dashId}_tv_predictions`,
    TRASH: `${LS_PREFIX}trash`
};

const loadArray = (key) => { try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : []; } catch (e) { console.error(e); return []; } };
const saveArray = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error(e); } };
const loadObject = (key, fallback = {}) => { try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : fallback; } catch (e) { console.error(e); return fallback; } };
const saveObject = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error(e); } };

const useLocalCollection = (key) => { 
    const [data, setData] = useState(() => key ? loadArray(key) : []);
    useEffect(() => { setData(key ? loadArray(key) : []); }, [key]);
    
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === key) setData(loadArray(key));
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, [key]);

    const save = useCallback((newData) => { if (key) { saveArray(key, newData); setData(newData); } }, [key]);
    return [data, save];
};
const useLocalConfig = (key, fallback = {}) => {
    const [config, setConfig] = useState(() => key ? loadObject(key, fallback) : fallback);
    useEffect(() => { setConfig(key ? loadObject(key, fallback) : fallback); }, [key]);
    
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === key) setConfig(loadObject(key, fallback));
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, [key, JSON.stringify(fallback)]);

    const save = useCallback((newConfig) => { if (key) { saveObject(key, newConfig); setConfig(newConfig); } }, [key]);
    return [config, save];
};

const useDashboards = () => {
    const [dashboards, setDashboards] = useState(() => loadArray(LS_KEYS.DASHBOARDS).length > 0 ? loadArray(LS_KEYS.DASHBOARDS) : initialDashboards);
    const saveDashboards = (newDashboards) => { saveArray(LS_KEYS.DASHBOARDS, newDashboards); setDashboards(newDashboards); };
    const addDashboard = (name) => {
        if (dashboards.some(d => d.name.toLowerCase() === name.toLowerCase())) { return false; }
        saveDashboards([...dashboards, { id: Date.now().toString(), name }]);
        return true;
    };
    const renameDashboard = (id, newName) => {
        if (dashboards.some(d => d.id !== id && d.name.toLowerCase() === newName.toLowerCase())) { return false; }
        saveDashboards(dashboards.map(d => d.id === id ? { ...d, name: newName } : d));
        return true;
    };
    const deleteDashboard = (id) => {
        if (dashboards.length <= 1) return;
        ['PRODUCTS', 'LOTS', 'PRODUCTION_DATA', 'TV_PREDICTIONS'].forEach(key => localStorage.removeItem(LS_KEYS[key](id)));
        saveDashboards(dashboards.filter(d => d.id !== id));
    };
    const moveDashboard = (id, direction) => {
        const index = dashboards.findIndex(d => d.id === id);
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex >= 0 && newIndex < dashboards.length) {
            const newDashboards = [...dashboards];
            const [item] = newDashboards.splice(index, 1);
            newDashboards.splice(newIndex, 0, item);
            saveDashboards(newDashboards);
        }
    };
    return [dashboards, addDashboard, renameDashboard, deleteDashboard, moveDashboard];
};

// ... (Todos os componentes modais do CronoanaliseDashboard são mantidos aqui sem alteração)
const DashboardActionModal = ({ isOpen, onClose, onConfirm, mode, initialName = '' }) => {
    const [name, setName] = useState('');
    const title = mode === 'create' ? 'Criar Novo Quadro' : 'Renomear Quadro';
    const buttonText = mode === 'create' ? 'Criar' : 'Renomear';
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => { if (isOpen) setName(initialName); }, [isOpen, initialName]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (!name.trim()) return;
        onConfirm(name.trim());
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md modal-content">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">{title}</h2>
                    <button onClick={onClose} title="Fechar"><XCircle /></button>
                </div>
                <label htmlFor="dashboard-name" className="block mb-2 text-sm font-medium">Nome do Quadro</label>
                <input id="dashboard-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4" />
                <button onClick={handleConfirm} className="w-full h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">{buttonText}</button>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md modal-content">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">{title}</h2>
                    <button onClick={onClose} title="Fechar"><XCircle /></button>
                </div>
                <p className="mb-6">{message}</p>
                <div className="flex justify-end gap-4">
                    <button onClick={onClose} className="px-6 py-2 font-semibold rounded-md bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button>
                    <button onClick={() => { onConfirm(); onClose(); }} className="px-6 py-2 font-semibold rounded-md bg-red-600 text-white hover:bg-red-700">Confirmar</button>
                </div>
            </div>
        </div>
    );
};


const ObservationModal = ({ isOpen, onClose, entry, onSave }) => {
    const [observation, setObservation] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    useEffect(() => { if (entry) setObservation(entry.observation || ''); }, [entry]);
    if (!isOpen) return null;
    const handleSave = () => { onSave(entry.id, observation); onClose(); };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md modal-content">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Observação do Período ({entry?.period})</h2><button onClick={onClose} title="Fechar"><XCircle /></button></div>
                <textarea value={observation} onChange={e => setObservation(e.target.value)} rows="4" className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"></textarea>
                <button onClick={handleSave} className="w-full h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Salvar</button>
            </div>
        </div>
    );
};
const LotObservationModal = ({ isOpen, onClose, lot, onSave }) => {
    const [observation, setObservation] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    useEffect(() => { if (lot) setObservation(lot.observation || ''); }, [lot]);
    if (!isOpen) return null;
    const handleSave = () => { onSave(lot.id, observation); onClose(); };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md modal-content">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Observação do Lote ({lot?.productName} #{lot?.sequentialId})</h2><button onClick={onClose} title="Fechar"><XCircle /></button></div>
                <textarea value={observation} onChange={e => setObservation(e.target.value)} rows="4" className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"></textarea>
                <button onClick={handleSave} className="w-full h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Salvar</button>
            </div>
        </div>
    );
};
const PasswordModal = ({ isOpen, onClose, onSuccess, adminConfig }) => {
    const [passwordInput, setPasswordInput] = useState('');
    const [checking, setChecking] = useState(false);
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    useEffect(() => { if (!isOpen) { setPasswordInput(''); setChecking(false); } }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        setChecking(true);
        try {
            if (!adminConfig || !adminConfig.passwordHash) { onClose(); return; }
            const hash = await sha256Hex(passwordInput || '');
            if (hash === adminConfig.passwordHash) { if (onSuccess) onSuccess(); } 
            else { setPasswordInput(''); }
        } catch (e) { console.error(e); } 
        finally { setChecking(false); }
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md modal-content">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Confirmação de Senha</h2><button onClick={onClose} title="Fechar"><XCircle /></button></div>
                <div>
                    <p className="mb-4">Para continuar, por favor insira a senha de administrador.</p>
                    <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4" />
                    <button onClick={handleConfirm} disabled={checking} className="w-full h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">{checking ? 'Validando...' : 'Confirmar'}</button>
                </div>
            </div>
        </div>
    );
};
const ReasonModal = ({ isOpen, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    useEffect(() => { if (!isOpen) setReason(''); }, [isOpen]);
    if (!isOpen) return null;
    const handleConfirm = () => {
        if (!reason.trim()) return;
        if (onConfirm) onConfirm(reason.trim());
        onClose(); 
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md modal-content">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Motivo da Exclusão</h2><button onClick={onClose} title="Fechar"><XCircle /></button></div>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={5} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4" placeholder="Explique por que está removendo este item..." />
                <button onClick={handleConfirm} className="w-full h-10 px-6 font-semibold rounded-md bg-red-600 text-white hover:bg-red-700">Confirmar Exclusão</button>
            </div>
        </div>
    );
};

const TvSelectorModal = ({ isOpen, onClose, onSelect, onStartCarousel, dashboards }) => {
    const [carouselSeconds, setCarouselSeconds] = useState(10);
    const [selectedDashboards, setSelectedDashboards] = useState(() => dashboards.reduce((acc, dash) => ({ ...acc, [dash.id]: true }), {}));
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    const handleToggle = (id) => {
        setSelectedDashboards(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleStart = () => {
        const ids = Object.keys(selectedDashboards).filter(id => selectedDashboards[id]);
        if (ids.length > 0) {
            onStartCarousel({
                dashboardIds: ids,
                interval: carouselSeconds * 1000,
            });
        }
    };

    if (!isOpen) return null;

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
                                    onClick={() => onSelect(dash.id)}
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
                                    <input type="checkbox" checked={selectedDashboards[dash.id] || false} onChange={() => handleToggle(dash.id)} className="h-5 w-5 rounded"/>
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

const AdminPanelModal = ({ isOpen, onClose, adminConfig, setAdminConfig, users, setUsers, roles, setRoles }) => {
    const [activeTab, setActiveTab] = useState('users');
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    
    // States for Users Tab
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserRole, setNewUserRole] = useState('viewer');

    // States for Roles Tab
    const [newRoleName, setNewRoleName] = useState('');
    const [editingRole, setEditingRole] = useState(null);

    // States for Password Tab
    const [oldPass, setOldPass] = useState('');
    const [newPass, setNewPass] = useState('');
    const [confirmPass, setConfirmPass] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setOldPass('');
            setNewPass('');
            setConfirmPass('');
            setNewUserEmail('');
            setNewRoleName('');
            setEditingRole(null);
        }
    }, [isOpen]);
    
    // --- Handlers for Users ---
    const handleAddUser = () => {
        if (newUserEmail && !users.find(u => u.email === newUserEmail)) {
            setUsers([...users, { email: newUserEmail, roleId: newUserRole }]);
            setNewUserEmail('');
        }
    };
    const handleDeleteUser = (email) => {
        if (email === 'admin@local.com') return; // Cannot delete admin
        setUsers(users.filter(u => u.email !== email));
    };
    const handleUserRoleChange = (email, roleId) => {
        setUsers(users.map(u => u.email === email ? { ...u, roleId } : u));
    };

    // --- Handlers for Roles ---
    const handleAddRole = () => {
        if (newRoleName && !Object.values(roles).find(r => r.name === newRoleName)) {
            const newId = newRoleName.toLowerCase().replace(/\s+/g, '_');
            setRoles({ ...roles, [newId]: { id: newId, name: newRoleName, permissions: [] } });
            setNewRoleName('');
        }
    };
    const handleDeleteRole = (roleId) => {
        if (defaultRoles[roleId]) return; // Cannot delete default roles
        const newRoles = { ...roles };
        delete newRoles[roleId];
        setRoles(newRoles);
        // Reset users with this role to 'viewer'
        setUsers(users.map(u => u.roleId === roleId ? { ...u, roleId: 'viewer' } : u));
    };
    const handlePermissionChange = (roleId, permissionKey, isChecked) => {
        const role = roles[roleId];
        const newPermissions = isChecked
            ? [...role.permissions, permissionKey]
            : role.permissions.filter(p => p !== permissionKey);
        setRoles({ ...roles, [roleId]: { ...role, permissions: newPermissions } });
    };

    // --- Handlers for Password ---
    const handleSavePassword = async () => {
        const requiresOldPass = !!adminConfig?.passwordHash;
        if (requiresOldPass && !oldPass) return;
        if (!newPass || newPass !== confirmPass) return;
        
        if (requiresOldPass) {
            const oldHash = await sha256Hex(oldPass);
            if (oldHash !== adminConfig.passwordHash) {
                setOldPass('');
                return;
            }
        }
        const newHash = await sha256Hex(newPass);
        setAdminConfig({ ...adminConfig, passwordHash: newHash });
        onClose(); // Close on success
    };

    if (!isOpen) return null;

    const renderUsersTab = () => (
        <div>
            <h3 className="text-xl font-bold mb-4">Gerenciar Usuários</h3>
            <div className="grid grid-cols-3 gap-4 items-end mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="col-span-3 sm:col-span-1">
                    <label className="block text-sm font-medium mb-1">Email do Usuário</label>
                    <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="usuario@email.com" className="w-full p-2 rounded-md bg-white dark:bg-gray-700" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium mb-1">Função</label>
                    <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} className="w-full p-2 rounded-md bg-white dark:bg-gray-700">
                        {Object.values(roles).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                </div>
                <button onClick={handleAddUser} className="h-10 px-4 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">Adicionar Usuário</button>
            </div>
            <div className="space-y-2">
                {users.map(user => (
                    <div key={user.email} className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
                        <span className="font-medium">{user.email}</span>
                        <div className="flex items-center gap-4">
                            <select value={user.roleId} onChange={e => handleUserRoleChange(user.email, e.target.value)} disabled={user.email === 'admin@local.com'} className="p-1 rounded-md bg-white dark:bg-gray-600 disabled:opacity-70">
                                {Object.values(roles).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                            <button onClick={() => handleDeleteUser(user.email)} disabled={user.email === 'admin@local.com'} className="disabled:opacity-20"><Trash2 size={18} className="text-red-500 hover:text-red-400" /></button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderRolesTab = () => (
        <div>
            <h3 className="text-xl font-bold mb-4">Funções & Permissões</h3>
            <div className="flex gap-4 mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <input type="text" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Nome da nova função" className="flex-grow p-2 rounded-md bg-white dark:bg-gray-700" />
                <button onClick={handleAddRole} className="px-4 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">Adicionar Função</button>
            </div>
            <div className="space-y-4">
                {Object.values(roles).map(role => (
                    <div key={role.id} className="p-4 border dark:border-gray-700 rounded-lg">
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="text-lg font-bold">{role.name}</h4>
                            {!defaultRoles[role.id] && <button onClick={() => handleDeleteRole(role.id)}><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {Object.entries(ALL_PERMISSIONS).map(([key, label]) => (
                                <label key={key} className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
                                    <input type="checkbox" checked={role.permissions.includes(key)} onChange={e => handlePermissionChange(role.id, key, e.target.checked)} disabled={role.id === 'admin'} className="disabled:opacity-50" />
                                    <span className="text-sm">{label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
    
    const renderPasswordTab = () => (
        <div>
             <h3 className="text-xl font-bold mb-4">Alterar Senha de Administrador</h3>
             <div className="space-y-4 max-w-sm">
                {adminConfig?.passwordHash && (
                    <div><label className="block text-sm font-medium mb-1">Senha Atual</label><input type="password" value={oldPass} onChange={e=>setOldPass(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                )}
                <div><label className="block text-sm font-medium mb-1">Nova Senha</label><input type="password" value={newPass} onChange={e=>setNewPass(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                <div><label className="block text-sm font-medium mb-1">Confirmar Nova Senha</label><input type="password" value={confirmPass} onChange={e=>setConfirmPass(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                <button onClick={handleSavePassword} className="w-full h-10 px-6 font-semibold rounded-md bg-green-600 text-white hover:bg-green-700">Salvar Nova Senha</button>
             </div>
        </div>
    );

    const tabs = [
        { id: 'users', label: 'Usuários', icon: <Users/>, content: renderUsersTab() },
        { id: 'roles', label: 'Funções', icon: <ShieldCheck/>, content: renderRolesTab() },
        { id: 'password', label: 'Senha', icon: <EyeOff/>, content: renderPasswordTab() },
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col modal-content">
                <div className="flex justify-between items-center mb-4 pb-4 border-b dark:border-gray-700">
                    <h2 className="text-2xl font-bold flex items-center gap-2"><UserCog/> Painel de Administração</h2>
                    <button onClick={onClose} title="Fechar"><XCircle /></button>
                </div>
                <div className="flex-grow flex gap-6 overflow-hidden">
                    <div className="flex flex-col gap-1 border-r pr-6 dark:border-gray-700">
                        {tabs.map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)} 
                                className={`flex items-center gap-3 px-4 py-2 rounded-md text-left ${activeTab === tab.id ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                                {tab.icon}
                                <span className="font-semibold">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex-grow overflow-y-auto pr-2">
                        {tabs.find(t => t.id === activeTab)?.content}
                    </div>
                </div>
            </div>
        </div>
    );
};

const CronoanaliseDashboard = ({ onNavigateToStock, user, permissions, startTvMode, dashboards, addDashboard, renameDashboard, deleteDashboard, moveDashboard, users, setUsers, roles, setRoles, adminConfig, setAdminConfig, currentDashboardIndex, setCurrentDashboardIndex }) => {
    
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);
    const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
    
    useEffect(() => { if (currentDashboardIndex >= dashboards.length && dashboards.length > 0) { setCurrentDashboardIndex(dashboards.length - 1); } }, [dashboards, currentDashboardIndex, setCurrentDashboardIndex]);

    const currentDashboard = dashboards[currentDashboardIndex] || null;
    
    const productKey = useMemo(() => currentDashboard ? LS_KEYS.PRODUCTS(currentDashboard.id) : null, [currentDashboard]);
    const lotKey = useMemo(() => currentDashboard ? LS_KEYS.LOTS(currentDashboard.id) : null, [currentDashboard]);
    const productionDataKey = useMemo(() => currentDashboard ? LS_KEYS.PRODUCTION_DATA(currentDashboard.id) : null, [currentDashboard]);
    const tvPredictionsKey = useMemo(() => currentDashboard ? LS_KEYS.TV_PREDICTIONS(currentDashboard.id) : null, [currentDashboard]);
    
    const [products, saveProducts] = useLocalCollection(productKey);
    const [lots, saveLots] = useLocalCollection(lotKey);
    const [allProductionData, saveAllProductionData] = useLocalConfig(productionDataKey, {});
    const [tvPredictions, setTvPredictions] = useLocalConfig(tvPredictionsKey, {});
    
    const [trashItems, saveTrashItems] = useLocalCollection(LS_KEYS.TRASH);
    
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [calendarView, setCalendarView] = useState('day');
    
    const dateKey = selectedDate.toISOString().slice(0, 10);
    const productionData = useMemo(() => allProductionData[dateKey] || [], [allProductionData, dateKey]);
    
    const [lotCounter, setLotCounter] = useState(1);
    useEffect(() => { setLotCounter(lots.length > 0 ? Math.max(0, ...lots.map(l => l.sequentialId || 0)) + 1 : 1); }, [lots]);

    const [lotFilter, setLotFilter] = useState('ongoing');
    const [newLot, setNewLot] = useState({ productId: '', target: '', customName: '' });
    const [editingLotId, setEditingLotId] = useState(null);
    const [editingLotData, setEditingLotData] = useState({ target: '', customName: '' });
    const [newProduct, setNewProduct] = useState({ name: '', standardTime: '' });
    const [editingProductId, setEditingProductId] = useState(null);
    const [editingProductData, setEditingProductData] = useState({ name: '', standardTime: '' });
    
    const [newEntry, setNewEntry] = useState({ period: '', people: '', availableTime: 60, productId: '', productions: [] });
    
    const [goalPreview, setGoalPreview] = useState("0");
    const [predictedLots, setPredictedLots] = useState([]);
    const [modalState, setModalState] = useState({ type: null, data: null });
    const [editingEntryId, setEditingEntryId] = useState(null);
    const [editingEntryData, setEditingEntryData] = useState(null);
    const [showUrgent, setShowUrgent] = useState(false);
    const [urgentProduction, setUrgentProduction] = useState({ productId: '', produced: '' });
    const [isNavOpen, setIsNavOpen] = useState(false);
    const navRef = useRef();
    useClickOutside(navRef, () => setIsNavOpen(false));

    const closeModal = () => setModalState({ type: null, data: null });

    const executeSoftDelete = (reason, itemId, itemType, itemDoc) => {
        try {
            saveTrashItems([...trashItems, {
                id: Date.now().toString(), originalId: itemId, itemType: itemType, originalDoc: itemDoc,
                deletedByEmail: user.email, deletedAt: new Date().toISOString(), reason,
            }]);
            
            if (itemType === 'lot') saveLots(lots.filter(item => item.id !== itemId));
            else if (itemType === 'product') saveProducts(products.filter(item => item.id !== itemId));
            else if (itemType === 'entry') {
                const updatedLots = [...lots];
                itemDoc.productionDetails.forEach(detail => {
                    const lotIndex = updatedLots.findIndex(l => l.productId === detail.productId);
                    if (lotIndex !== -1) {
                        const lot = updatedLots[lotIndex];
                        const newProduced = Math.max(0, (lot.produced || 0) - detail.produced);
                        updatedLots[lotIndex] = { ...lot, produced: newProduced, status: (lot.status.startsWith('completed') && newProduced < lot.target) ? 'ongoing' : lot.status };
                    }
                });
                saveLots(updatedLots);
                const updatedEntries = productionData.filter(e => e.id !== itemId);
                saveAllProductionData({ ...allProductionData, [dateKey]: updatedEntries });
                const updatedTvPredictions = { ...tvPredictions };
                if (updatedTvPredictions[dateKey]?.[itemDoc.period]) { delete updatedTvPredictions[dateKey][itemDoc.period]; setTvPredictions(updatedTvPredictions); }
            }
        } catch (e) { console.error('Erro ao mover item para lixeira:', e); } 
        finally { closeModal(); }
    };
    
    const handleDeleteItemFlow = (itemId, itemType) => {
        let itemDoc;
        if (itemType === 'entry') itemDoc = productionData.find(i => i.id === itemId);
        else if (itemType === 'lot') itemDoc = lots.find(i => i.id === itemId);
        else if (itemType === 'product') itemDoc = products.find(i => i.id === itemId);
        if (!itemDoc) return;
        const onConfirmReason = (reason) => executeSoftDelete(reason, itemId, itemType, itemDoc);
        setModalState({ type: 'password', data: { onSuccess: () => setModalState({ type: 'reason', data: { onConfirm: onConfirmReason } }) } });
    };
    
    const handleDeleteLot = (lotId) => handleDeleteItemFlow(lotId, 'lot');
    const handleDeleteProduct = (productId) => handleDeleteItemFlow(productId, 'product');
    const handleDeleteEntry = (entryId) => handleDeleteItemFlow(entryId, 'entry');

    // --- LÓGICA DE GERENCIAMENTO DE QUADROS ---
    const handleAddDashboard = () => {
        setIsNavOpen(false);
        setModalState({ type: 'dashboardAction', data: { mode: 'create', onConfirm: (newName) => addDashboard(newName) } });
    };
    const handleRenameDashboard = (id, currentName) => {
        setIsNavOpen(false);
        setModalState({ type: 'dashboardAction', data: { mode: 'rename', initialName: currentName, onConfirm: (newName) => renameDashboard(id, newName) } });
    };
    const handleDeleteDashboard = (id, name) => {
        setIsNavOpen(false);
        setModalState({ type: 'password', data: { onSuccess: () => { setModalState({ type: 'confirmation', data: { title: 'Confirmar Exclusão', message: `Tem certeza que deseja excluir o quadro "${name}"? TODOS os dados (produtos, lotes, lançamentos) deste quadro serão perdidos permanentemente.`, onConfirm: () => deleteDashboard(id) } }); } } });
    };
    const handleMoveDashboard = (id, direction) => { moveDashboard(id, direction); };
    const handleSelectTvMode = () => setModalState({ type: 'tvSelector', data: null });

    useEffect(() => {
        if (editingEntryId) return;
        const isCurrentSelectionValid = products.some(p => p.id === newEntry.productId);
        if (!isCurrentSelectionValid && products.length > 0) setNewEntry(prev => ({ ...prev, productId: products[0].id, productions: [] }));
        else if (!isCurrentSelectionValid && products.length === 0) setNewEntry(prev => ({ ...prev, productId: '', productions: [] }));
    }, [lots, editingEntryId, newEntry.productId, products]);

    const calculatePredictions = useCallback(() => {
        const people = parseFloat(newEntry.people) || 0;
        const availableTime = parseFloat(newEntry.availableTime) || 0;
        let timeConsumedByUrgent = 0;
        let urgentPrediction = null;
        if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) {
            const urgentProduct = products.find(p => p.id === urgentProduction.productId);
            if (urgentProduct) {
                timeConsumedByUrgent = urgentProduct.standardTime * urgentProduction.produced;
                const urgentLot = lots.find(l => l.productId === urgentProduct.id);
                urgentPrediction = { ...(urgentLot || {}), productId: urgentProduct.id, productName: urgentProduct.name, producible: parseInt(urgentProduction.produced, 10), isUrgent: true };
            }
        }
        const totalAvailableMinutes = availableTime * people;
        const remainingTime = totalAvailableMinutes - timeConsumedByUrgent;
        let normalPredictions = [];
        if (remainingTime > 0) {
            const selectedProduct = products.find(p => p.id === newEntry.productId);
            if (selectedProduct && selectedProduct.standardTime > 0) {
                const activeLots = lots.filter(l => l.status === 'ongoing' || l.status === 'future').sort((a, b) => a.order - b.order);
                const startIndex = activeLots.findIndex(l => l.productId === newEntry.productId);
                if (startIndex === -1) {
                    const possiblePieces = Math.floor(remainingTime / selectedProduct.standardTime);
                    normalPredictions.push({ id: `nolot-${selectedProduct.id}`, productId: selectedProduct.id, productName: selectedProduct.name, producible: possiblePieces });
                } else {
                    let timeForNormal = remainingTime;
                    for (let i = startIndex; i < activeLots.length && timeForNormal > 0; i++) {
                        const lot = activeLots[i];
                        const productForLot = products.find(p => p.id === lot.productId);
                        if (productForLot && productForLot.standardTime > 0) {
                            const remainingPiecesInLot = Math.max(0, (lot.target || 0) - (lot.produced || 0));
                            const producible = Math.min(remainingPiecesInLot, Math.floor(timeForNormal / productForLot.standardTime));
                            if (producible > 0) { normalPredictions.push({ ...lot, producible, productName: productForLot.name }); timeForNormal -= producible * productForLot.standardTime; }
                        }
                    }
                }
            }
        }
        const allPredictions = urgentPrediction ? [urgentPrediction, ...normalPredictions] : normalPredictions;
        return { allPredictions, currentGoalPreview: allPredictions.map(p => p.producible || 0).join(' / ') || '0' };
    }, [newEntry.people, newEntry.availableTime, newEntry.productId, products, lots, urgentProduction, showUrgent]);

    useEffect(() => {
        const { allPredictions, currentGoalPreview } = calculatePredictions();
        setPredictedLots(allPredictions);
        setGoalPreview(currentGoalPreview);
    
        const expectedCount = allPredictions.filter(p => !p.isUrgent).length;
        if (newEntry.productions.length !== expectedCount) {
            setNewEntry(prev => ({ ...prev, productions: Array(expectedCount).fill('') }));
        }
    
        const people = parseFloat(newEntry.people) || 0;
        const availableTime = parseFloat(newEntry.availableTime) || 0;
        const isPeriodLaunched = !!productionData.find(e => e.period === newEntry.period);
        
        let newPredictionsForTv = JSON.parse(JSON.stringify(tvPredictions));
        let shouldUpdate = false;
    
        const isReadyForPrediction = newEntry.period && people > 0 && availableTime > 0 && newEntry.productId && !isPeriodLaunched;
    
        if (isReadyForPrediction) {
            const newPredictionForPeriod = {
                goalDisplay: currentGoalPreview,
                people,
                availableTime,
                primaryProductId: newEntry.productId,
                primaryProductName: products.find(p => p.id === newEntry.productId)?.name || '-',
            };
            
            if (JSON.stringify(newPredictionsForTv[dateKey]?.[newEntry.period]) !== JSON.stringify(newPredictionForPeriod)) {
                if (!newPredictionsForTv[dateKey]) newPredictionsForTv[dateKey] = {};
                newPredictionsForTv[dateKey][newEntry.period] = newPredictionForPeriod;
                shouldUpdate = true;
            }
        } 
        else if (newEntry.period && newPredictionsForTv[dateKey]?.[newEntry.period]) {
            delete newPredictionsForTv[dateKey][newEntry.period];
            if (Object.keys(newPredictionsForTv[dateKey]).length === 0) delete newPredictionsForTv[dateKey];
            shouldUpdate = true;
        }
    
        if (shouldUpdate) {
             setTimeout(() => setTvPredictions(newPredictionsForTv), 0);
        }
        
    }, [
        calculatePredictions, newEntry.productions.length, newEntry.period, newEntry.people, newEntry.availableTime, 
        newEntry.productId, dateKey, productionData, products, tvPredictions, setTvPredictions
    ]);
    
    
    const processedData = useMemo(() => {
        if (!productionData || productionData.length === 0) return [];
        let cumulativeProduction = 0, cumulativeGoal = 0, cumulativeEfficiencySum = 0;
        return [...productionData].sort((a, b) => (a.period || "").localeCompare(b.period || "")).map((item, index) => {
            let totalTimeValue = 0, totalProducedInPeriod = 0;
            const producedForDisplay = (item.productionDetails || []).map(d => `${d.produced || 0}`).join(' / ');
            (item.productionDetails || []).forEach(detail => {
                const product = products.find(p => p.id === detail.productId);
                if (product?.standardTime) { totalTimeValue += (detail.produced || 0) * product.standardTime; totalProducedInPeriod += (detail.produced || 0); }
            });
            const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
            const efficiency = totalAvailableTime > 0 ? parseFloat(((totalTimeValue / totalAvailableTime) * 100).toFixed(2)) : 0;
            const numericGoal = (item.goalDisplay || "0").split(' / ').reduce((acc, val) => acc + (parseInt(val.trim(), 10) || 0), 0);
            cumulativeProduction += totalProducedInPeriod;
            cumulativeGoal += numericGoal;
            cumulativeEfficiencySum += efficiency;
            const cumulativeEfficiency = parseFloat((cumulativeEfficiencySum / (index + 1)).toFixed(2));
            return { ...item, produced: totalProducedInPeriod, goal: numericGoal, producedForDisplay, efficiency, cumulativeProduction, cumulativeGoal, cumulativeEfficiency };
        });
    }, [productionData, products]);

    const summary = useMemo(() => {
        if (processedData.length === 0) return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
        const lastEntry = processedData.slice(-1)[0];
        return { totalProduced: lastEntry.cumulativeProduction, totalGoal: lastEntry.cumulativeGoal, lastHourEfficiency: lastEntry.efficiency, averageEfficiency: lastEntry.cumulativeEfficiency };
    }, [processedData]);

    const monthlySummary = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        let totalMonthlyProduction = 0, totalMonthlyGoal = 0, totalDailyAverageEfficiencies = 0, productiveDaysCount = 0;
        Object.keys(allProductionData).forEach(dateStr => {
            try {
                const date = new Date(dateStr + "T00:00:00");
                if(date.getFullYear() === year && date.getMonth() === month) {
                    const dayData = allProductionData[dateStr];
                    if (dayData && dayData.length > 0) {
                        productiveDaysCount++;
                        let dailyProduction = 0, dailyGoal = 0, dailyEfficiencySum = 0;
                        dayData.forEach(item => {
                            let periodProduction = 0, totalTimeValue = 0;
                            (item.productionDetails || []).forEach(detail => {
                                periodProduction += (detail.produced || 0);
                                const product = products.find(p => p.id === detail.productId);
                                if (product?.standardTime) totalTimeValue += (detail.produced || 0) * product.standardTime;
                            });
                            if (item.goalDisplay) dailyGoal += item.goalDisplay.split(' / ').reduce((acc, val) => acc + (parseInt(val.trim(), 10) || 0), 0);
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
    }, [allProductionData, currentMonth, products]);

    const availablePeriods = useMemo(() => FIXED_PERIODS.filter(p => !productionData.some(e => e.period === p)), [productionData]);
    const filteredLots = useMemo(() => [...lots].sort((a,b)=>a.order-b.order).filter(l => lotFilter === 'ongoing' ? (l.status === 'ongoing' || l.status === 'future') : l.status.startsWith('completed')), [lots, lotFilter]);

    const handleAddEntry = async (e) => {
        e.preventDefault();
        const productionDetails = [];
        if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) productionDetails.push({ productId: urgentProduction.productId, produced: parseInt(urgentProduction.produced, 10) });
        predictedLots.filter(p => !p.isUrgent).forEach((lot, index) => {
            const producedAmount = parseInt(newEntry.productions[index], 10) || 0;
            if (lot && producedAmount > 0) productionDetails.push({ productId: lot.productId, produced: producedAmount });
        });
        if (productionDetails.length === 0) return;
        const newEntryData = { id: Date.now().toString(), period: newEntry.period, people: newEntry.people, availableTime: newEntry.availableTime, productionDetails, observation: '', goalDisplay: goalPreview, primaryProductId: newEntry.productId };
        saveAllProductionData({ ...allProductionData, [dateKey]: [...productionData, newEntryData] });
        
        const updatedLots = [...lots];
        productionDetails.forEach(detail => {
            const lotIndex = updatedLots.findIndex(l => l.productId === detail.productId);
            if (lotIndex !== -1) {
                const lotToUpdate = updatedLots[lotIndex];
                const newProduced = (lotToUpdate.produced || 0) + detail.produced;
                
                const isStartingNow = lotToUpdate.status === 'future' && newProduced > 0;
                const isCompletingNow = newProduced >= lotToUpdate.target && !lotToUpdate.status.startsWith('completed');

                let newStatus = lotToUpdate.status;
                if (isCompletingNow) {
                    newStatus = 'completed';
                } else if (isStartingNow) {
                    newStatus = 'ongoing';
                }

                updatedLots[lotIndex] = { 
                    ...lotToUpdate, 
                    produced: newProduced, 
                    status: newStatus,
                    ...(isStartingNow && { startDate: new Date().toISOString() }),
                    ...(isCompletingNow && { endDate: new Date().toISOString() })
                };
            }
        });
        saveLots(updatedLots);
        
        const newPredictionsForTv = { ...tvPredictions };
        if (newPredictionsForTv[dateKey]?.[newEntry.period]) {
            delete newPredictionsForTv[dateKey][newEntry.period];
            if (Object.keys(newPredictionsForTv[dateKey]).length === 0) delete newPredictionsForTv[dateKey];
            setTvPredictions(newPredictionsForTv);
        }
        
        setNewEntry({ period: '', people: '', availableTime: 60, productId: newEntry.productId, productions: [] });
        setUrgentProduction({productId: '', produced: ''});
        setShowUrgent(false);
    };
    
    const handleInputChange = (e) => { const { name, value } = e.target; setNewEntry(prev => ({ ...prev, [name]: value, ...(name === 'productId' && { productions: [] }) })); };
    const handleUrgentChange = (e) => setUrgentProduction(prev => ({...prev, [e.target.name]: e.target.value}));
    const handleProductionChange = (index, value) => { const newProductions = [...newEntry.productions]; newProductions[index] = value; setNewEntry(prev => ({ ...prev, productions: newProductions })); };
    const handleAddProduct = (e) => { e.preventDefault(); if (!newProduct.name || !newProduct.standardTime) return; saveProducts([...products, { id: Date.now().toString(), ...newProduct, standardTime: parseFloat(newProduct.standardTime) }]); setNewProduct({ name: '', standardTime: '' }); };
    const handleStartEditProduct = (p) => { setEditingProductId(p.id); setEditingProductData({ name: p.name, standardTime: p.standardTime }); };
    const handleSaveProduct = (id) => { if (!editingProductData.name || !editingProductData.standardTime) return; saveProducts(products.map(p => p.id === id ? { ...p, name: editingProductData.name, standardTime: parseFloat(editingProductData.standardTime) } : p)); setEditingProductId(null); };
    const handleSaveObservation = (entryId, observation) => { const updatedEntries = productionData.map(e => e.id === entryId ? { ...e, observation } : e); saveAllProductionData({ ...allProductionData, [dateKey]: updatedEntries }); };
    const handleSaveLotObservation = (lotId, observation) => saveLots(lots.map(l => l.id === lotId ? { ...l, observation } : l));
    const handleAddLot = (e) => { e.preventDefault(); if (!newLot.productId || !newLot.target) return; const product = products.find(p => p.id === newLot.productId); if (!product) return; saveLots([...lots, { id: Date.now().toString(), sequentialId: lotCounter, ...newLot, productId: product.id, productName: product.name, target: parseInt(newLot.target, 10), produced: 0, status: 'future', order: Date.now(), observation: '', startDate: null, endDate: null }]); setNewLot({ productId: '', target: '', customName: '' }); };
    const handleStartEditLot = (lot) => { setEditingLotId(lot.id); setEditingLotData({ target: lot.target, customName: lot.customName }); };
    const handleSaveLotEdit = (lotId) => { 
        const updatedLots = lots.map(l => {
            if (l.id === lotId) {
                const newTarget = parseInt(editingLotData.target, 10);
                const wasCompleted = l.status.startsWith('completed');
                const isCompletingNow = l.produced >= newTarget && !wasCompleted;
    
                let newStatus = l.status;
                if (isCompletingNow) {
                    newStatus = 'completed';
                } else if (wasCompleted && l.produced < newTarget) {
                    newStatus = 'ongoing';
                }
    
                return { 
                    ...l, 
                    target: newTarget, 
                    customName: editingLotData.customName, 
                    status: newStatus,
                    ...(isCompletingNow && { endDate: new Date().toISOString() }),
                    ...((wasCompleted && l.produced < newTarget) && { endDate: null })
                };
            }
            return l;
        });
        saveLots(updatedLots);
        setEditingLotId(null);
    };
    const handleLotStatusChange = (lotId, newStatus) => {
        const updatedLots = lots.map(l => {
            if (l.id === lotId) {
                const updatedLot = { ...l, status: newStatus };
                const isCompleting = newStatus.startsWith('completed');
                const wasCompleted = l.status.startsWith('completed');
                if (isCompleting && !wasCompleted) {
                    updatedLot.endDate = new Date().toISOString();
                } else if (!isCompleting && wasCompleted) {
                    updatedLot.endDate = null;
                }
                return updatedLot;
            }
            return l;
        });
        saveLots(updatedLots);
    };
    const handleMoveLot = (lotId, direction) => {
        const sorted = lots.filter(l => ['ongoing', 'future'].includes(l.status)).sort((a, b) => a.order - b.order);
        const currentIndex = sorted.findIndex(l => l.id === lotId);
        if ((direction === 'up' && currentIndex > 0) || (direction === 'down' && currentIndex < sorted.length - 1)) {
            const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            const currentLot = sorted[currentIndex];
            const swapLot = sorted[swapIndex];
            saveLots(lots.map(l => { if (l.id === currentLot.id) return { ...l, order: swapLot.order }; if (l.id === swapLot.id) return { ...l, order: currentLot.order }; return l; }));
        }
    };
        
    if (!currentDashboard) {
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p className="text-xl">Carregando quadros...</p></div>;
    }

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 font-sans">
            <GlobalStyles/>
            <DashboardActionModal isOpen={modalState.type === 'dashboardAction'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} mode={modalState.data?.mode} initialName={modalState.data?.initialName}/>
            <ConfirmationModal isOpen={modalState.type === 'confirmation'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} title={modalState.data?.title} message={modalState.data?.message} />
            <ObservationModal isOpen={modalState.type === 'observation'} onClose={closeModal} entry={modalState.data} onSave={handleSaveObservation} />
            <LotObservationModal isOpen={modalState.type === 'lotObservation'} onClose={closeModal} lot={modalState.data} onSave={handleSaveLotObservation} />
            <PasswordModal isOpen={modalState.type === 'password'} onClose={closeModal} onSuccess={modalState.data?.onSuccess} adminConfig={adminConfig} />
            <ReasonModal isOpen={modalState.type === 'reason'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} />
            <AdminPanelModal isOpen={modalState.type === 'adminSettings'} onClose={closeModal} adminConfig={adminConfig} setAdminConfig={setAdminConfig} users={users} setUsers={setUsers} roles={roles} setRoles={setRoles} />
            <TvSelectorModal isOpen={modalState.type === 'tvSelector'} onClose={closeModal} onSelect={startTvMode} onStartCarousel={startTvMode} dashboards={dashboards} />

            <header className="bg-white dark:bg-gray-900 shadow-md p-4 flex justify-between items-center sticky top-0 z-20">
                <div className="flex items-center gap-4">
                    <img src={raceBullLogoUrl} alt="Race Bull Logo" className="h-12 w-auto dark:invert" />
                    <div ref={navRef} className="relative">
                        <button onClick={() => setIsNavOpen(!isNavOpen)} title="Mudar Quadro" className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white tracking-wider text-center">{currentDashboard.name}</h1>
                            <ChevronDownIcon size={20} className={`transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isNavOpen && (
                            <div className="absolute top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-xl py-2 z-30 dropdown-content">
                                {dashboards.map((dash, index) => (
                                    <div key={dash.id} className="flex items-center justify-between px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">
                                        <div className="flex items-center gap-2">
                                            <div className="flex flex-col">
                                                <button onClick={() => handleMoveDashboard(dash.id, 'up')} disabled={index === 0} className="disabled:opacity-20"><ChevronUp size={16} /></button>
                                                <button onClick={() => handleMoveDashboard(dash.id, 'down')} disabled={index === dashboards.length - 1} className="disabled:opacity-20"><ChevronDown size={16} /></button>
                                            </div>
                                            <button onClick={() => { setCurrentDashboardIndex(index); setIsNavOpen(false); }} className="flex-grow text-left">{dash.name}</button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => handleRenameDashboard(dash.id, dash.name)} title="Renomear Quadro"><Edit size={16} className="text-yellow-500 hover:text-yellow-400" /></button>
                                            <button onClick={() => handleDeleteDashboard(dash.id, dash.name)} title="Excluir Quadro"><Trash2 size={16} className="text-red-500 hover:text-red-400" /></button>
                                        </div>
                                    </div>
                                ))}
                                <div className="border-t my-2 dark:border-gray-600"></div>
                                <button onClick={handleAddDashboard} className="w-full text-left px-4 py-2 text-sm text-blue-600 dark:text-blue-400 font-semibold hover:bg-gray-100 dark:hover:bg-gray-700">+ Criar Novo Quadro</button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center space-x-2 sm:space-x-4">
                    <button onClick={onNavigateToStock} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2">
                        <Warehouse size={20} />
                        <span className="hidden sm:inline">Gerenciamento de Estoque</span>
                    </button>
                    <span className='text-sm text-gray-500 dark:text-gray-400 hidden md:block'>{user.email} (Local)</span>
                    <button onClick={handleSelectTvMode} title="Modo TV" className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700"><Monitor size={20} /></button>
                    <button onClick={() => setModalState({ type: 'adminSettings' })} title="Configurações de Admin Local" className="p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"><Settings size={20} /></button>
                    <button onClick={toggleTheme} title={theme === 'light' ? "Mudar para Tema Escuro" : "Mudar para Tema Claro"} className="p-2 rounded-full bg-gray-200 dark:bg-gray-700">{theme === 'light' ? <Moon size={20}/> : <Sun size={20}/>}</button>
                </div>
            </header>
            
            <main className="p-4 md:p-8 grid grid-cols-1 gap-8">
                 <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1">
                        <CalendarView selectedDate={selectedDate} setSelectedDate={setSelectedDate} currentMonth={currentMonth} setCurrentMonth={setCurrentMonth} calendarView={calendarView} setCalendarView={setCalendarView} allProductionData={allProductionData} />
                    </div>
                    <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
                        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-lg text-center"><h3 className="font-semibold">Resumo Mensal</h3><p>Produção: {monthlySummary.totalProduction.toLocaleString('pt-BR')} un.</p><p>Meta: {monthlySummary.totalGoal.toLocaleString('pt-BR')} un.</p><p>Eficiência Média: {monthlySummary.averageEfficiency}%</p></div>
                        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-lg text-center"><h3 className="font-semibold">Resumo do Dia</h3><p>Produção: {summary.totalProduced.toLocaleString('pt-BR')} un.</p><p>Meta: {summary.totalGoal.toLocaleString('pt-BR')} un.</p><p>Eficiência Média: {summary.averageEfficiency}%</p></div>
                    </div>
                </section>
                <h2 className="text-2xl font-bold border-b-2 border-blue-500 pb-2">Resultados de: {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</h2>
                <LotReport lots={lots} />
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard title="Produção Acumulada (Dia)" value={summary.totalProduced.toLocaleString('pt-BR')} unit="un." />
                    <StatCard title="Meta Acumulada (Dia)" value={summary.totalGoal.toLocaleString('pt-BR')} unit="un." />
                    <StatCard title="Eficiência da Última Hora" value={summary.lastHourEfficiency} unit="%" isEfficiency />
                    <StatCard title="Média de Eficiência (Dia)" value={summary.averageEfficiency} unit="%" isEfficiency />
                </section>
                
                 <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><List className="mr-2 text-blue-500"/> Detalhamento por Período</h2>
                    <div className="overflow-x-auto">
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
                                    <th className="p-3 text-center border-r dark:border-gray-600">Obs.</th>
                                    <th className="p-3 text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-x divide-gray-200 dark:divide-gray-600">
                                {processedData.map((d) => (
                                    <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                         <td className="p-3 text-left">{d.period}</td>
                                        <td className="p-3 text-center">{`${d.people} / ${d.availableTime} min`}</td>
                                        <td className="p-3 text-center">{d.goalDisplay}</td> 
                                        <td className="p-3 text-center">{d.producedForDisplay}</td> 
                                        <td className={`p-3 text-center font-semibold ${d.efficiency < 65 ? 'text-red-500' : 'text-green-600'}`}>{d.efficiency}%</td>
                                        <td className="p-3 text-center">{d.cumulativeGoal}</td>
                                        <td className="p-3 text-center">{d.cumulativeProduction}</td>
                                        <td className={`p-3 text-center font-semibold ${d.cumulativeEfficiency < 65 ? 'text-red-500' : 'text-green-600'}`}>{d.cumulativeEfficiency}%</td>
                                        <td className="p-3 text-center">
                                            <button onClick={() => setModalState({ type: 'observation', data: d })} title="Observação">
                                                <MessageSquare size={18} className={d.observation ? 'text-blue-500 hover:text-blue-400' : 'text-gray-500 hover:text-blue-400'}/>
                                            </button>
                                        </td>
                                        <td className="p-3">
                                            <div className="flex gap-2 justify-center">
                                                <button onClick={() => {}} title="Editar Lançamento"><Edit size={18} className="text-yellow-500 hover:text-yellow-400"/></button>
                                                <button onClick={() => handleDeleteEntry(d.id)} title="Excluir Lançamento"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><PlusCircle className="mr-2 text-blue-500"/> Adicionar Novo Lançamento</h2>
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
                                    {[...products].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>(<option key={p.id} value={p.id}>{p.name}</option>))}
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
                                <div className="flex flex-col justify-center items-center bg-blue-100 dark:bg-blue-900/50 p-2 rounded-md shadow-inner h-full min-h-[60px] w-48">
                                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">Meta Prevista</label>
                                    <span className="font-bold text-xl text-blue-600 dark:text-blue-400">{goalPreview || '0'}</span>
                                </div>
                                <button type="submit" className="h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">Adicionar</button>
                            </div>
                        </div>
                    </form>
                </section>
                
                <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><Layers className="mr-2 text-blue-500"/> Controle de Lotes de Produção</h2>
                    <div className="mb-6 border-b pb-6 dark:border-gray-700">
                        <h3 className="text-lg font-medium mb-4">Criar Novo Lote</h3>
                        <form onSubmit={handleAddLot} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                            <div className="flex flex-col">
                                <label htmlFor="newLotProduct">Produto</label>
                                <select id="newLotProduct" name="productId" value={newLot.productId} onChange={e => setNewLot({...newLot, productId: e.target.value})} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                    <option value="">Selecione...</option>
                                    {[...products].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>(<option key={p.id} value={p.id}>{p.name}</option>))}
                                </select>
                            </div>
                            <div className="flex flex-col"><label htmlFor="newLotTarget">Quantidade</label><input type="number" id="newLotTarget" name="target" value={newLot.target} onChange={e => setNewLot({...newLot, target: e.target.value})} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <div className="flex flex-col"><label htmlFor="newLotCustomName">Nome (Opcional)</label><input type="text" id="newLotCustomName" name="customName" value={newLot.customName} onChange={e => setNewLot({...newLot, customName: e.target.value})} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <button type="submit" className="h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Criar Lote</button>
                        </form>
                    </div>
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
                                        {!lot.status.startsWith('completed') && (
                                            <div className="flex flex-col"><button onClick={() => handleMoveLot(lot.id, 'up')} disabled={index===0} className="disabled:opacity-20"><ChevronUp size={16}/></button><button onClick={() => handleMoveLot(lot.id, 'down')} disabled={index===arr.length-1} className="disabled:opacity-20"><ChevronDown size={16}/></button></div>
                                        )}
                                        <div>
                                            <h4 className="font-bold text-lg">{lot.productName}{lot.customName?` - ${lot.customName}`:''}</h4>
                                            <p className="text-sm text-gray-500 dark:text-gray-400">Lote #{lot.sequentialId} | Prioridade: {index+1}</p>
                                            {(lot.startDate || lot.endDate) && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    {lot.startDate && `Início: ${new Date(lot.startDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                                                    {lot.endDate && ` | Fim: ${new Date(lot.endDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <select 
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
                                        </select>
                                        <div className="flex gap-2">
                                            <button onClick={()=>setModalState({type:'lotObservation', data:lot})} title="Observação">
                                                <MessageSquare size={18} className={lot.observation ? 'text-blue-500 hover:text-blue-400' : 'text-gray-500 hover:text-blue-400'}/>
                                            </button>
                                            <button onClick={()=>handleStartEditLot(lot)} title="Editar Lote"><Edit size={18} className="text-yellow-500 hover:text-yellow-400"/></button>
                                            <button onClick={()=>handleDeleteLot(lot.id)} title="Excluir Lote"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>
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
                        )})}
                    </div>
                </section>

                 <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><Package className="mr-2 text-blue-500"/> Gerenciamento de Produtos</h2>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div>
                            <h3 className="text-lg font-medium mb-4">Cadastrar Novo Produto</h3>
                            <form onSubmit={handleAddProduct} className="space-y-3">
                                <div><label htmlFor="newProductName">Nome</label><input type="text" id="newProductName" value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})} required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                                <div><label htmlFor="newProductTime">Tempo Padrão (min)</label><input type="number" id="newProductTime" value={newProduct.standardTime} onChange={e=>setNewProduct({...newProduct,standardTime:e.target.value})} step="0.01" required className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                                <button type="submit" className="w-full h-10 bg-green-600 text-white rounded-md">Salvar</button>
                            </form>
                        </div>
                        <div>
                            <h3 className="text-lg font-medium mb-4">Produtos Cadastrados ({products.length})</h3>
                            <div className="overflow-auto max-h-60 rounded-lg border dark:border-gray-700">
                                <table className="w-full text-left">
                                     <thead className="bg-gray-100 dark:bg-gray-700"><tr>
                                        <th className="p-3">Nome/Código</th>
                                        <th className="p-3">Tempo Padrão</th>
                                        <th className="p-3 text-center">Ações</th>
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                        {products.map(p=>(
                                            <tr key={p.id}>
                                                {editingProductId===p.id?(
                                                    <>
                                                        <td className="p-2"><input type="text" value={editingProductData.name} onChange={e=>setEditingProductData({...editingProductData,name:e.target.value})} className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600"/></td>
                                                        <td className="p-2"><input type="number" step="0.01" value={editingProductData.standardTime} onChange={e=>setEditingProductData({...editingProductData,standardTime:e.target.value})} className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600"/></td>
                                                        <td className="p-3">
                                                            <div className="flex gap-2 justify-center">
                                                                <button onClick={()=>handleSaveProduct(p.id)} title="Salvar"><Save size={18} className="text-green-500"/></button>
                                                                <button onClick={()=>setEditingProductId(null)} title="Cancelar"><XCircle size={18} className="text-gray-500"/></button>
                                                            </div>
                                                        </td>
                                                    </>
                                                ):(
                                                    <>
                                                        <td className="p-3 font-semibold">{p.name}</td>
                                                        <td className="p-3">{p.standardTime} min</td>
                                                        <td className="p-3">
                                                            <div className="flex gap-2 justify-center">
                                                                <button onClick={()=>handleStartEditProduct(p)} title="Editar"><Edit size={18} className="text-yellow-500 hover:text-yellow-400"/></button>
                                                                <button onClick={()=>handleDeleteProduct(p.id)} title="Excluir"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>
                                                            </div>
                                                        </td>
                                                    </>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </section>
                
                <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg mt-8">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><Trash2 className="mr-2 text-red-500 hover:text-red-400"/> Lixeira</h2>
                    <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                        {trashItems.length > 0 ? trashItems.map(item=>(<TrashItemDisplay key={item.id} item={item} products={products} user={user} />)) : <p>Lixeira vazia.</p>}
                    </div>
                </section>
            </main>
        </div>
    );
};

// ... (Todos os componentes auxiliares e de TV Mode do CronoanaliseDashboard são mantidos aqui)
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
                    return (<button key={i} onClick={() => setSelectedDate(day)} className={`p-2 rounded-full text-sm relative ${isCurrentMonth ? '' : 'text-gray-400 dark:text-gray-600'} ${isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>{day.getDate()}{hasData && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full"></span>}</button>)
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

const TrashItemDisplay = ({ item, products, user }) => {
    const date = new Date(item.deletedAt).toLocaleString('pt-BR');
    const commonHeader = (
        <>
            <p className="font-bold text-lg mb-1">{item.itemType === 'product' ? 'PRODUTO DELETADO' : (item.itemType === 'lot' ? 'LOTE DELETADO' : 'LANÇAMENTO DELETADO')}</p>
            <p className="text-sm">Deletado por: <span className="font-semibold">{user.email}</span> em <span className="font-semibold">{date}</span></p>
            <p className="mt-2">Motivo: <span className="italic font-medium">{item.reason || 'Nenhum motivo fornecido.'}</span></p>
        </>
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
        return (
            <div className="p-4 bg-red-50 dark:bg-red-900/30 rounded-lg border-2 border-red-500/50">
                {commonHeader}
                <div className="mt-3 p-3 bg-red-100 dark:bg-red-900/80 rounded-md">
                    <p className="font-bold">Detalhes do Produto:</p>
                    <p>Nome/Código: <span className="font-semibold">{doc.name}</span></p>
                    <p>Tempo Padrão: <span className="font-semibold">{doc.standardTime} min</span></p>
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
        const productionList = doc.productionDetails.map(d => `${d.produced} un. (${products.find(p => p.id === d.productId)?.name || 'Produto'})`).join(', ');

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

const LotReport = ({ lots }) => {
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

const TvModeDisplay = ({ tvOptions, stopTvMode, dashboards }) => {
    const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
    const [transitioning, setTransitioning] = useState(false);
    useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

    const isCarousel = typeof tvOptions === 'object';
    const initialDashboardId = isCarousel ? tvOptions.dashboardIds[0] : tvOptions;

    const [currentDashboardId, setCurrentDashboardId] = useState(initialDashboardId);

    const changeDashboard = useCallback((newId) => {
        setTransitioning(true);
        setTimeout(() => {
            setCurrentDashboardId(newId);
            setTransitioning(false);
        }, 300); // Duração da animação de fade-out
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
    
    const productKey = useMemo(() => currentDashboard ? LS_KEYS.PRODUCTS(currentDashboard.id) : null, [currentDashboard]);
    const productionDataKey = useMemo(() => currentDashboard ? LS_KEYS.PRODUCTION_DATA(currentDashboard.id) : null, [currentDashboard]);
    const tvPredictionsKey = useMemo(() => currentDashboard ? LS_KEYS.TV_PREDICTIONS(currentDashboard.id) : null, [currentDashboard]);
    
    const [products] = useLocalCollection(productKey);
    const [allProductionData] = useLocalConfig(productionDataKey, {});
    const [tvPredictions] = useLocalConfig(tvPredictionsKey, {});
    
    const today = useMemo(() => new Date(), []);
    const dateKey = today.toISOString().slice(0, 10);
    const productionData = useMemo(() => allProductionData[dateKey] || [], [allProductionData, dateKey]);
    const dailyPredictions = useMemo(() => tvPredictions[dateKey] || {}, [tvPredictions, dateKey]);

    const processedData = useMemo(() => {
        if (!productionData || productionData.length === 0) return [];
        let cumulativeProduction = 0, cumulativeGoal = 0, cumulativeEfficiencySum = 0;
        return [...productionData].sort((a,b)=>(a.period||"").localeCompare(b.period||"")).map((item, index) => {
            let totalTimeValue = 0, totalProducedInPeriod = 0;
            const producedForDisplay = (item.productionDetails || []).map(d => `${d.produced || 0}`).join(' / ');
            (item.productionDetails || []).forEach(detail => {
                const product = products.find(p => p.id === detail.productId);
                if (product?.standardTime) {
                    totalTimeValue += (detail.produced || 0) * product.standardTime;
                    totalProducedInPeriod += (detail.produced || 0);
                }
            });
            const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
            const efficiency = totalAvailableTime > 0 ? parseFloat(((totalTimeValue / totalAvailableTime) * 100).toFixed(2)) : 0;
            const numericGoal = (item.goalDisplay||"0").split(' / ').reduce((a,v)=>a+(parseInt(v.trim(),10)||0),0);
            cumulativeProduction += totalProducedInPeriod;
            cumulativeGoal += numericGoal;
            cumulativeEfficiencySum += efficiency;
            const cumulativeEfficiency = parseFloat((cumulativeEfficiencySum / (index + 1)).toFixed(2));
            return { ...item, produced:totalProducedInPeriod, goal:numericGoal, goalForDisplay: item.goalDisplay, producedForDisplay, efficiency, cumulativeProduction, cumulativeGoal, cumulativeEfficiency };
        });
    }, [productionData, products]);
    
    const monthlySummary = useMemo(() => {
        const year = today.getFullYear();
        const month = today.getMonth();
        let totalMonthlyProduction = 0, totalMonthlyGoal = 0, totalDailyAverageEfficiencies = 0, productiveDaysCount = 0;
        
        Object.keys(allProductionData).forEach(dateStr => {
            try {
                const date = new Date(dateStr + "T00:00:00");
                if(date.getFullYear() === year && date.getMonth() === month) {
                    const dayData = allProductionData[dateStr];
                    if (dayData && dayData.length > 0) {
                        productiveDaysCount++;
                        let dailyProduction = 0, dailyGoal = 0, dailyEfficiencySum = 0;
                        dayData.forEach(item => {
                            let periodProduction = 0, totalTimeValue = 0;
                            (item.productionDetails || []).forEach(detail => {
                                periodProduction += (detail.produced || 0);
                                const product = products.find(p => p.id === detail.productId);
                                if (product?.standardTime) totalTimeValue += (detail.produced || 0) * product.standardTime;
                            });
                            if (item.goalDisplay) dailyGoal += item.goalDisplay.split(' / ').reduce((acc, val) => acc + (parseInt(val.trim(), 10) || 0), 0);
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
    }, [allProductionData, today, products]);

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
        const dataByPeriod = processedData.reduce((acc, curr) => ({ ...acc, [curr.period]: curr }), {});
        
        const getMetaValue = (period) => {
            const launched = dataByPeriod[period];
            if (launched) return { value: launched.goalForDisplay, isLaunched: true };
            const predicted = dailyPredictions[period];
            if (predicted) return { value: predicted.goalDisplay, isLaunched: false };
            return { value: '-', isLaunched: false };
        };
        const getPeopleTimeValue = (period) => {
            const launched = dataByPeriod[period];
            if (launched) return `${launched.people} / ${launched.availableTime} min`;
            const predicted = dailyPredictions[period];
            if (predicted) return `${predicted.people} / ${predicted.availableTime} min`;
            return '- / -';
        };
        const getAlteracaoValue = (period) => {
            const launched = dataByPeriod[period];
            if (launched && launched.productionDetails?.length > 0) {
                return launched.productionDetails.map(d => products.find(p => p.id === d.productId)?.name).filter(Boolean).join(' / ');
            }
            const predicted = dailyPredictions[period];
            if (predicted) return predicted.primaryProductName;
            return '-';
        };
        const getProductionValue = (p) => dataByPeriod[p]?.producedForDisplay || '-';

        const TV_ROWS = [
            { key: 'meta', label: 'Meta', formatter: getMetaValue },
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
            <div className="overflow-x-auto w-full text-center p-6 border-4 border-blue-900 rounded-xl shadow-2xl bg-white dark:bg-gray-900">
                <table className="min-w-full table-fixed">
                    <thead className="text-white bg-blue-500 dark:bg-blue-600">
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
                            {currentDashboard.name.toUpperCase()} - {today.toLocaleDateString('pt-BR')}
                        </th></tr>
                        <tr><th className="p-2 text-left">Resumo</th>{FIXED_PERIODS.map(p => <th key={p} className="p-2 text-sm">{getPeopleTimeValue(p)}</th>)}</tr>
                        <tr><th className="p-2 text-left">Alteração</th>{FIXED_PERIODS.map(p => <th key={p} className="p-2 text-base">{getAlteracaoValue(p)}</th>)}</tr>
                        <tr><th className="p-3 text-left">Hora</th>{FIXED_PERIODS.map(p => <th key={p} className="p-3 text-3xl">{p}</th>)}</tr>
                    </thead>
                    <tbody className="text-2xl divide-y dark:divide-gray-700">
                        {TV_ROWS.map(row => (
                            <tr key={row.key} className={row.isMonthly ? 'bg-gray-100 dark:bg-gray-800' : ''}>
                                <td className="p-3 font-bold text-left sticky left-0 bg-gray-200 dark:bg-gray-800">{row.label}</td>
                                {row.isMonthly ? (
                                    <td colSpan={FIXED_PERIODS.length} className={`p-3 font-extrabold ${row.isColor ? (parseFloat(row.value) < 65 ? 'text-red-500' : 'text-green-600') : ''}`}>{row.value}</td>
                                ) : (
                                    FIXED_PERIODS.map(p => {
                                        let cellContent, cellClass = 'p-3 font-extrabold';
                                        if (row.key === 'meta') {
                                            const metaInfo = row.formatter(p);
                                            cellContent = metaInfo.value;
                                            if (cellContent !== '-') {
                                                cellClass += metaInfo.isLaunched ? ' text-blue-600 dark:text-blue-400' : ' text-yellow-500 dark:text-yellow-400';
                                            }
                                        } else {
                                            cellContent = row.formatter(p);
                                            if (row.isColor && cellContent !== '-') {
                                                const numericVal = dataByPeriod[p]?.[row.key];
                                                cellClass += numericVal < 65 ? ' text-red-500' : ' text-green-600';
                                            }
                                        }
                                        return <td key={p} className={cellClass}>{cellContent}</td>;
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
            <div className={`w-full transition-opacity duration-300 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
                {renderTvTable()}
            </div>
            <p className="text-sm text-gray-500 mt-4">Última atualização: {new Date().toLocaleTimeString('pt-BR')}</p>
        </div>
    );
};


// #####################################################################
// #                                                                     #
// #           COMPONENTE RAIZ E LÓGICA DE NAVEGAÇÃO                     #
// #                                                                     #
// #####################################################################

const App = () => {
    const [currentApp, setCurrentApp] = useState('cronoanalise'); // 'cronoanalise' ou 'stock'
    const [tvMode, setTvMode] = useState(null); 
    
    // Hooks do Cronoanalise
    const [dashboards, addDashboard, renameDashboard, deleteDashboard, moveDashboard] = useDashboards();
    const [adminConfig, setAdminConfig] = useLocalConfig(LS_KEYS.ADMIN_CONFIG);
    const [roles, setRoles] = useLocalConfig(LS_KEYS.ROLES, defaultRoles);
    const [users, setUsers] = useLocalCollection(LS_KEYS.USERS);
    const [currentUserEmail, setCurrentUserEmail] = useState(() => localStorage.getItem(LS_KEYS.CURRENT_USER_EMAIL) || 'admin@local.com');
    const [currentDashboardIndex, setCurrentDashboardIndex] = useState(() => {
        const savedIndex = localStorage.getItem(LS_KEYS.LAST_DASHBOARD_INDEX);
        return savedIndex ? parseInt(savedIndex, 10) : 0;
    });

    useEffect(() => {
        localStorage.setItem(LS_KEYS.LAST_DASHBOARD_INDEX, currentDashboardIndex);
    }, [currentDashboardIndex]);

    useEffect(() => {
        if (users.length === 0) {
            setUsers([{ email: 'admin@local.com', roleId: 'admin' }]);
        }
    }, [users, setUsers]);
    
    const currentUser = useMemo(() => users.find(u => u.email === currentUserEmail) || { email: currentUserEmail, roleId: 'viewer' }, [currentUserEmail, users]);
    const currentUserPermissions = useMemo(() => {
        const role = roles[currentUser.roleId];
        const permissions = {};
        for (const key in ALL_PERMISSIONS) {
            permissions[key] = !!role?.permissions.includes(key);
        }
        if (currentUserEmail === 'admin@local.com') {
            permissions.MANAGE_SETTINGS = true;
        }
        return permissions;
    }, [currentUser, roles, currentUserEmail]);

    const startTvMode = useCallback((options) => setTvMode(options), []);
    const stopTvMode = useCallback(() => setTvMode(null), []);
    
    // Renderização condicional
    if (tvMode && currentApp === 'cronoanalise') {
        return <TvModeDisplay tvOptions={tvMode} stopTvMode={stopTvMode} dashboards={dashboards} />;
    }

    if (currentApp === 'stock') {
        return <StockManagementApp onNavigateToCrono={() => setCurrentApp('cronoanalise')} />;
    }
    
    return <CronoanaliseDashboard 
        onNavigateToStock={() => setCurrentApp('stock')}
        user={currentUser}
        permissions={currentUserPermissions}
        startTvMode={startTvMode} 
        dashboards={dashboards}
        addDashboard={addDashboard}
        renameDashboard={renameDashboard}
        deleteDashboard={deleteDashboard}
        moveDashboard={moveDashboard}
        users={users}
        setUsers={setUsers}
        roles={roles}
        setRoles={setRoles}
        adminConfig={adminConfig}
        setAdminConfig={setAdminConfig}
        currentDashboardIndex={currentDashboardIndex}
        setCurrentDashboardIndex={setCurrentDashboardIndex}
    />;
};

export default App;

