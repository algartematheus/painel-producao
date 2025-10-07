import React, { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from 'react';
import { Sun, Moon, PlusCircle, List, Edit, Trash2, Save, XCircle, ChevronLeft, ChevronRight, MessageSquare, Layers, ChevronUp, ChevronDown, LogOut, Settings, ChevronDown as ChevronDownIcon, Package, Monitor, ArrowLeft, ArrowRight, UserCog, BarChart, Film, Warehouse, Home, ArrowUpDown, Box, Trash, MinusCircle, ShieldCheck, KeyRound } from 'lucide-react';
import { db, auth } from './firebase';
import {
    collection,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    writeBatch,
    query,
    orderBy,
    getDocs,
    addDoc,
    getDoc,
    serverTimestamp
} from 'firebase/firestore';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updatePassword,
} from 'firebase/auth';

// =====================================================================
// == CONSTANTES E FUNÇÕES AUXILIARES GLOBAIS ==
// =====================================================================
const raceBullLogoUrl = "https://firebasestorage.googleapis.com/v0/b/quadrodeproducao.firebasestorage.app/o/assets%2FLOGO%20PROPRIET%C3%81RIA.png?alt=media&token=a16d015f-e8ca-4b3c-b744-7cef3ab6504b";

const initialDashboards = [
    { id: 'producao', name: 'Quadro da Produção', order: 1 },
    { id: 'acabamento', name: 'Quadro do Acabamento', order: 2 },
    { id: 'estoque', name: 'Quadro do Estoque', order: 3 },
    { id: 'corte', name: 'Quadro do Corte', order: 4 },
    { id: 'travete', name: 'Quadro do Travete', order: 5 },
];

const FIXED_PERIODS = ["08:00", "09:00", "10:00", "11:00", "11:45", "14:00", "15:00", "16:00", "17:00"];

// Objeto de permissões reescrito sem o "spread operator" (...) para máxima compatibilidade.
const ALL_PERMISSIONS = {
    MANAGE_DASHBOARDS: 'Gerenciar Quadros (Criar/Renomear/Excluir/Reordenar)',
    MANAGE_PRODUCTS: 'Gerenciar Produtos (Cronoanálise)',
    MANAGE_LOTS: 'Gerenciar Lotes (Cronoanálise)',
    ADD_ENTRIES: 'Adicionar Lançamentos de Produção',
    EDIT_ENTRIES: 'Editar Lançamentos de Produção',
    DELETE_ENTRIES: 'Excluir Lançamentos de Produção',
    VIEW_TRASH: 'Visualizar Lixeira (Cronoanálise)',
    RESTORE_TRASH: 'Restaurar Itens da Lixeira (Cronoanálise)',
    MANAGE_SETTINGS: 'Acessar Painel de Administração',
    VIEW_STOCK_DASHBOARD: 'Ver Dashboard de Estoque',
    MANAGE_STOCK_MOVEMENTS: 'Gerenciar Lançamentos de Estoque',
    MANAGE_STOCK_PRODUCTS: 'Gerenciar Produtos de Estoque (Criar/Editar/Excluir)',
    VIEW_STOCK_TRASH: 'Visualizar Lixeira do Estoque',
    RESTORE_STOCK_TRASH: 'Restaurar Itens da Lixeira do Estoque'
};

const defaultRoles = {
    'admin': { id: 'admin', name: 'Administrador', permissions: Object.keys(ALL_PERMISSIONS) },
    'editor': { id: 'editor', name: 'Editor', permissions: [
        'MANAGE_PRODUCTS', 'MANAGE_LOTS', 'ADD_ENTRIES', 'EDIT_ENTRIES', 'DELETE_ENTRIES',
        'VIEW_STOCK_DASHBOARD', 'MANAGE_STOCK_MOVEMENTS', 'MANAGE_STOCK_PRODUCTS'
    ]},
    'stock_manager': { id: 'stock_manager', name: 'Gerente de Estoque', permissions: [
        'VIEW_STOCK_DASHBOARD', 'MANAGE_STOCK_MOVEMENTS', 'MANAGE_STOCK_PRODUCTS', 'VIEW_STOCK_TRASH', 'RESTORE_STOCK_TRASH'
    ]},
    'viewer': { id: 'viewer', name: 'Visualizador', permissions: ['VIEW_STOCK_DASHBOARD'] },
};


const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

async function sha256Hex(message) {
    const data = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}


// --- ESTILOS GLOBAIS E ANIMAÇÕES ---
const GlobalStyles = () => (
    <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleUp { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blinking-red {
            0% { background-color: transparent; }
            50% { background-color: rgba(239, 68, 68, 0.5); }
            100% { background-color: transparent; }
        }
        .blinking-red {
            animation: blinking-red 1s infinite;
        }
        .modal-backdrop { animation: fadeIn 0.2s ease-out forwards; }
        .modal-content { animation: scaleUp 0.2s ease-out forwards; }
        .dropdown-content { animation: slideDown 0.2s ease-out forwards; }
    `}</style>
);

// --- HOOKS CUSTOMIZADOS ---
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

const usePrevious = (value) => {
    const ref = useRef();
    useEffect(() => {
        ref.current = value;
    });
    return ref.current;
}


// #####################################################################
// #                                                                    #
// #                       INÍCIO: AUTENTICAÇÃO                         #
// #                                                                    #
// #####################################################################

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
    const logout = () => signOut(auth);

    const value = useMemo(() => ({
        user,
        loading,
        login,
        logout,
    }), [user, loading]);

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);

const LoginPage = () => {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await login(email, password);
        } catch (err) {
            setError('Falha no login. Verifique seu e-mail e senha.');
            console.error(err);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
            <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-lg dark:bg-gray-800">
                <div className="text-center">
                    <img src={raceBullLogoUrl} alt="Race Bull Logo" className="w-32 h-auto mx-auto mb-4 dark:invert" />
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Acessar Sistema</h2>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleLogin}>
                    <div className="rounded-md shadow-sm -space-y-px">
                        <div>
                            <input
                                id="email-address"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="relative block w-full px-3 py-2 text-gray-900 placeholder-gray-500 bg-gray-50 border border-gray-300 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                                placeholder="Email"
                            />
                        </div>
                        <div>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="relative block w-full px-3 py-2 text-gray-900 placeholder-gray-500 bg-gray-50 border border-gray-300 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                                placeholder="Senha"
                            />
                        </div>
                    </div>

                    {error && <p className="mt-2 text-sm text-center text-red-600">{error}</p>}

                    <div>
                        <button type="submit" className="group relative flex justify-center w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                            Entrar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};



// #######################################################################
// #                                                                      #
// #           INÍCIO: GERENCIADOR DE ESTOQUE (NOVA FUNCIONALIDADE)         #
// #                                                                      #
// #######################################################################

const StockContext = createContext();

const StockProvider = ({ children, permissions }) => {
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [stockMovements, setStockMovements] = useState([]);
    const { user } = useAuth();

    useEffect(() => {
        const unsubCategories = onSnapshot(collection(db, 'stock_categories'), snap => {
            setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubProducts = onSnapshot(collection(db, 'stock_products'), snap => {
            setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubMovements = onSnapshot(query(collection(db, 'stock_movements'), orderBy('timestamp', 'desc')), snap => {
            setStockMovements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        return () => {
            unsubCategories();
            unsubProducts();
            unsubMovements();
        };
    }, []);

    const addCategory = async (categoryName) => {
        if (!permissions.MANAGE_STOCK_PRODUCTS) return;
        const existing = categories.some(c => c.name.toLowerCase() === categoryName.toLowerCase());
        if (existing) {
            alert("Uma categoria com este nome já existe.");
            return null;
        }
        const newCategoryRef = await addDoc(collection(db, 'stock_categories'), {
            name: categoryName,
            createdBy: user.uid,
            createdAt: serverTimestamp()
        });
        return newCategoryRef.id;
    };

    const addProduct = async (productData) => {
        if (!permissions.MANAGE_STOCK_PRODUCTS) return;
        const variationsWithStock = productData.variations.map(v => ({
            ...v,
            id: generateId('var'),
            currentStock: parseInt(v.initialStock, 10) || 0
        }));
        await addDoc(collection(db, 'stock_products'), {
            ...productData,
            variations: variationsWithStock,
            isDeleted: false,
            createdBy: user.uid,
            createdAt: serverTimestamp()
        });
    };

    const updateProduct = async (productId, productData) => {
        if (!permissions.MANAGE_STOCK_PRODUCTS) return;
        const productRef = doc(db, 'stock_products', productId);
        await updateDoc(productRef, {
            name: productData.name,
            categoryId: productData.categoryId,
            minStock: productData.minStock,
            leadTimeInMonths: productData.leadTimeInMonths,
        });
    };
    
    const deleteProduct = async (productId) => {
        if (!permissions.MANAGE_STOCK_PRODUCTS) return;
        const productRef = doc(db, 'stock_products', productId);
        await updateDoc(productRef, { isDeleted: true });
    };

    const restoreProduct = async (productId) => {
        if (!permissions.RESTORE_STOCK_TRASH) return;
        const productRef = doc(db, 'stock_products', productId);
        await updateDoc(productRef, { isDeleted: false });
    };

    const addStockMovement = async ({ productId, variationId, quantity, type }) => {
        if (!permissions.MANAGE_STOCK_MOVEMENTS) return;
        const batch = writeBatch(db);
        const productRef = doc(db, 'stock_products', productId);
        const productDoc = await getDoc(productRef);

        if (productDoc.exists()) {
            const productData = productDoc.data();
            const newVariations = productData.variations.map(v => {
                if (v.id === variationId) {
                    const change = type === 'Entrada' ? parseInt(quantity, 10) : -parseInt(quantity, 10);
                    return { ...v, currentStock: v.currentStock + change };
                }
                return v;
            });
            batch.update(productRef, { variations: newVariations });

            const movementRef = doc(collection(db, 'stock_movements'));
            batch.set(movementRef, {
                productId,
                variationId,
                quantity: parseInt(quantity, 10),
                type,
                user: user.uid,
                userEmail: user.email,
                timestamp: new Date().toISOString()
            });
            await batch.commit();
        }
    };

    const value = useMemo(() => ({
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
        permissions,
    }), [categories, products, stockMovements, permissions]);

    return <StockContext.Provider value={value}>{children}</StockContext.Provider>;
};


const useStock = () => useContext(StockContext);

const StockHeader = ({ onNavigateToCrono }) => {
    const { logout } = useAuth();
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
                <button onClick={logout} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 text-red-500">
                    <LogOut size={20} />
                    <span className="hidden sm:inline">Sair</span>
                </button>
            </div>
        </header>
    );
};

const StockSidebar = ({ activePage, setActivePage }) => {
    const { permissions } = useStock();

    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: Home, permission: 'VIEW_STOCK_DASHBOARD' },
        { id: 'movements', label: 'Lançamentos', icon: ArrowUpDown, permission: 'MANAGE_STOCK_MOVEMENTS' },
        { id: 'products', label: 'Produtos', icon: Box, permission: 'MANAGE_STOCK_PRODUCTS' },
        { id: 'trash', label: 'Lixeira', icon: Trash, permission: 'VIEW_STOCK_TRASH' },
    ];

    const availableNavItems = navItems.filter(item => permissions[item.permission]);

    return (
        <aside className="w-64 bg-white dark:bg-gray-900 p-4 flex flex-col">
            <nav className="flex flex-col gap-2">
                {availableNavItems.map(item => (
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
    const { products: allProducts, categories } = useStock();

    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [sortOrder, setSortOrder] = useState('asc');

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
    const { products: allProducts, deletedProducts, categories, addStockMovement, stockMovements } = useStock();
    
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [movement, setMovement] = useState({ productId: '', variationId: '', type: 'Saída', quantity: '' });
    
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
        if (!selectedCategoryId) return allProducts;
        return allProducts.filter(p => p.categoryId === selectedCategoryId);
    }, [selectedCategoryId, allProducts]);

    const selectedProduct = useMemo(() => allProducts.find(p => p.id === movement.productId), [movement.productId, allProducts]);

    const filteredMovements = useMemo(() => {
        return [...stockMovements]
            .filter(m => new Date(m.timestamp).toDateString() === selectedDate.toDateString());
    }, [stockMovements, selectedDate]);

    useEffect(() => {
        setMovement(m => ({ ...m, productId: '', variationId: '' }));
    }, [selectedCategoryId]);

    useEffect(() => {
        setMovement(m => ({ ...m, variationId: '' }));
    }, [movement.productId]);


    const handleSubmit = (e) => {
        e.preventDefault();
        if(!isFormValid) return;
        addStockMovement({ ...movement, quantity: parseInt(movement.quantity) });
        setMovement({ ...movement, quantity: '', variationId: '', productId: '' });
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
                                 </tr>
                             </thead>
                             <tbody>
                                 {filteredMovements.length > 0 ? filteredMovements.map(m => {
                                     const product = allProducts.find(p => p.id === m.productId) || deletedProducts.find(p => p.id === m.productId);
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
    const { categories, addProduct, updateProduct } = useStock();
    
    const initialProductState = useMemo(() => ({ name: '', categoryId: '', minStock: '', leadTimeInMonths: '', variations: [{ name: '', initialStock: '' }] }), []);
    const [productData, setProductData] = useState(initialProductState);
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
    
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
                    variations: productToEdit.variations.map(v => ({...v}))
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
    const { deletedProducts, restoreProduct, permissions } = useStock();
    const canRestore = permissions.RESTORE_STOCK_TRASH;

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold mb-6">Lixeira</h1>
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                {deletedProducts.map(p => (
                     <div key={p.id} className="flex justify-between items-center p-4 border-b dark:border-gray-800">
                         <div>
                             <p className="font-bold">{p.name}</p>
                             {/* Informações de exclusão não estão sendo salvas neste modelo simplificado */}
                         </div>
                         {canRestore && <button onClick={() => restoreProduct(p.id)} className="p-2 bg-green-500 text-white rounded-md">Restaurar</button>}
                     </div>
                ))}
                {deletedProducts.length === 0 && <p>A lixeira está vazia.</p>}
            </div>
        </div>
    );
};


const StockManagementApp = ({ onNavigateToCrono, permissions }) => {
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
        <StockProvider permissions={permissions}>
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
// #                                                                      #
// #           FIM: GERENCIADOR DE ESTOQUE (NOVA FUNCIONALIDADE)          #
// #                                                                      #
// #####################################################################



// #####################################################################
// #                                                                      #
// #               INÍCIO: COMPONENTES DE MODAIS E AUXILIARES             #
// #                                                                      #
// #####################################################################

const DashboardActionModal = ({ isOpen, onClose, onConfirm, mode, initialName }) => {
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

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-30 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md modal-content">
                <h2 className="text-xl font-bold mb-4">{title || 'Confirmar Ação'}</h2>
                <p className="mb-6">{message || 'Você tem certeza?'}</p>
                <div className="flex justify-end gap-4">
                    <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600">Cancelar</button>
                    <button onClick={() => { onConfirm(); onClose(); }} className="px-4 py-2 rounded-md bg-red-600 text-white">Confirmar</button>
                </div>
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
        const correctPasswordHash = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918"; // "admin123"
        const inputHash = await sha256Hex(password);

        if (inputHash === correctPasswordHash) {
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
  
// =====================================================================
// === INÍCIO: NOVO PAINEL DE ADMINISTRAÇÃO COMPLETO ===
// =====================================================================

const ManageUsersTab = ({ roles, users }) => {
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserRole, setNewUserRole] = useState('viewer');

    const handleAddUser = async (e) => {
        e.preventDefault();
        if (!newUserEmail) {
            alert("Por favor, insira um e-mail.");
            return;
        }
        
        // AVISO: A criação de usuários no Firebase Auth requer um ambiente seguro (backend/Cloud Function).
        // Este código apenas adicionará o usuário às coleções 'users' e 'roles' no Firestore.
        // O usuário precisará ser criado no painel do Firebase Authentication manualmente.
        
        try {
            const userRef = doc(db, "users", newUserEmail); 
            await setDoc(userRef, { email: newUserEmail });

            const roleRef = doc(db, "roles", newUserEmail);
            await setDoc(roleRef, { role: newUserRole, permissions: roles[newUserRole].permissions });

            alert(`Usuário ${newUserEmail} adicionado com a função ${roles[newUserRole].name}. Crie a conta de login para este e-mail no painel do Firebase.`);
            setNewUserEmail('');
            setNewUserRole('viewer');
        } catch (error) {
            console.error("Erro ao adicionar usuário: ", error);
            alert(`Falha ao adicionar usuário. Verifique se o e-mail já existe. Detalhes: ${error.message}`);
        }
    };
    
    const handleDeleteUser = async (userEmail) => {
        if (!window.confirm(`Tem certeza que deseja excluir o usuário ${userEmail}? Suas permissões serão removidas.`)) {
            return;
        }

        // AVISO: A exclusão de usuários do Firebase Auth também requer um backend.
        // Este código removerá o usuário apenas do controle de permissões no Firestore.
        try {
            const batch = writeBatch(db);
            batch.delete(doc(db, "users", userEmail));
            batch.delete(doc(db, "roles", userEmail));
            await batch.commit();

            alert(`Usuário ${userEmail} foi removido do sistema de permissões.`);
        } catch (error) {
            console.error("Erro ao deletar usuário:", error);
            alert("Falha ao deletar usuário.");
        }
    };
    
    const handleRoleChange = async (userEmail, newRoleId) => {
        try {
            const roleRef = doc(db, "roles", userEmail);
            await setDoc(roleRef, {
                role: newRoleId,
                permissions: roles[newRoleId].permissions
            }, { merge: true });
            alert(`Função do usuário ${userEmail} atualizada.`);
        } catch (error) {
            console.error("Erro ao atualizar função:", error);
            alert("Falha ao atualizar função.");
        }
    };

    return (
        <div>
            <form onSubmit={handleAddUser} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-end gap-4 mb-6">
                <div className="flex-grow">
                    <label className="block text-sm font-medium">Email do Usuário</label>
                    <input
                        type="email"
                        value={newUserEmail}
                        onChange={e => setNewUserEmail(e.target.value)}
                        placeholder="usuario@email.com"
                        className="w-full p-2 mt-1 rounded-md bg-white dark:bg-gray-700"
                    />
                </div>
                <div className="flex-grow">
                    <label className="block text-sm font-medium">Função</label>
                    <select
                        value={newUserRole}
                        onChange={e => setNewUserRole(e.target.value)}
                        className="w-full p-2 mt-1 rounded-md bg-white dark:bg-gray-700"
                    >
                        {Object.values(roles).map(role => (
                            <option key={role.id} value={role.id}>{role.name}</option>
                        ))}
                    </select>
                </div>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md h-10">Adicionar Usuário</button>
            </form>
            
            <div className="space-y-2">
                {users.map(user => (
                    <div key={user.uid} className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg flex justify-between items-center">
                        <span className="font-semibold">{user.email}</span>
                        <div className="flex items-center gap-4">
                           <select
                                value={user.role}
                                onChange={e => handleRoleChange(user.email, e.target.value)}
                                className="p-1 rounded-md bg-white dark:bg-gray-700"
                           >
                               {Object.values(roles).map(role => (
                                   <option key={role.id} value={role.id}>{role.name}</option>
                               ))}
                           </select>
                            <button onClick={() => handleDeleteUser(user.email)} title="Excluir Usuário">
                                <Trash2 size={18} className="text-red-500 hover:text-red-400"/>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ManageRolesTab = ({ roles }) => {
    return (
        <div className="space-y-4">
            {Object.values(roles).map(role => (
                <div key={role.id} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <h3 className="text-lg font-bold">{role.name}</h3>
                    <p className="text-sm text-gray-500 mb-2">{role.permissions.length} permissões ativas</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        {Object.entries(ALL_PERMISSIONS).map(([key, description]) => (
                            <div key={key} className={`flex items-center gap-2 ${role.permissions.includes(key) ? '' : 'text-gray-400'}`}>
                                {role.permissions.includes(key)
                                    ? <ShieldCheck size={16} className="text-green-500" />
                                    : <XCircle size={16} className="text-red-500" />
                                }
                                <span>{description}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

const ChangePasswordTab = () => {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(false);

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setMessage('');
        setIsError(false);
        
        if (newPassword !== confirmPassword) {
            setMessage("As senhas não coincidem.");
            setIsError(true);
            return;
        }
        if (newPassword.length < 6) {
            setMessage("A senha deve ter no mínimo 6 caracteres.");
            setIsError(true);
            return;
        }

        try {
            await updatePassword(auth.currentUser, newPassword);
            setMessage("Senha alterada com sucesso!");
            setIsError(false);
            setNewPassword('');
            setConfirmPassword('');
        } catch (error) {
            console.error("Erro ao alterar senha:", error);
            setMessage("Erro ao alterar senha. Pode ser necessário fazer login novamente para completar esta ação.");
            setIsError(true);
        }
    };
    
    return (
        <div className="max-w-md mx-auto">
            <h3 className="text-xl font-semibold mb-4 text-center">Alterar Senha de Administrador</h3>
            <form onSubmit={handleChangePassword} className="space-y-4">
                 <div>
                    <label className="block text-sm font-medium">Nova Senha</label>
                    <input
                        type="password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        className="w-full p-2 mt-1 rounded-md bg-gray-100 dark:bg-gray-700"
                        required
                    />
                </div>
                 <div>
                    <label className="block text-sm font-medium">Confirmar Nova Senha</label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        className="w-full p-2 mt-1 rounded-md bg-gray-100 dark:bg-gray-700"
                        required
                    />
                </div>
                {message && (
                    <p className={`text-sm text-center ${isError ? 'text-red-500' : 'text-green-500'}`}>{message}</p>
                )}
                <button type="submit" className="w-full px-4 py-2 bg-green-600 text-white rounded-md">
                    Salvar Nova Senha
                </button>
            </form>
        </div>
    );
};


const AdminPanelModal = ({ isOpen, onClose, users, roles }) => {
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);
    const [activeTab, setActiveTab] = useState('users');

    if (!isOpen) return null;

    const tabs = [
        { id: 'users', label: 'Usuários', icon: UserCog },
        { id: 'roles', label: 'Funções', icon: ShieldCheck },
        { id: 'password', label: 'Senha', icon: KeyRound },
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col modal-content">
                <div className="flex justify-between items-center p-4 border-b dark:border-gray-700">
                    <h2 className="text-2xl font-bold flex items-center gap-2"><Settings/> Painel de Administração</h2>
                    <button onClick={onClose} title="Fechar"><XCircle /></button>
                </div>
                <div className="flex flex-grow overflow-hidden">
                    <aside className="w-1/4 p-4 border-r dark:border-gray-700">
                        <nav className="flex flex-col gap-2">
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-3 p-3 rounded-lg text-lg transition-colors ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                                >
                                    <tab.icon size={24} />
                                    {tab.label}
                                </button>
                            ))}
                        </nav>
                    </aside>
                    <main className="w-3/4 p-6 overflow-y-auto">
                        {activeTab === 'users' && <ManageUsersTab roles={roles} users={users} />}
                        {activeTab === 'roles' && <ManageRolesTab roles={roles} />}
                        {activeTab === 'password' && <ChangePasswordTab />}
                    </main>
                </div>
            </div>
        </div>
    );
};

// =====================================================================
// === FIM: NOVO PAINEL DE ADMINISTRAÇÃO COMPLETO ===
// =====================================================================
  
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
// #                                                                      #
// #               FIM: COMPONENTES DE MODAIS E AUXILIARES                #
// #                                                                      #
// #####################################################################



// #####################################################################
// #                                                                      #
// #               INÍCIO: COMPONENTES AUXILIARES DO DASHBOARD            #
// #                                                                      #
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
            return `${d.produced} un. (${product?.name || 'Produto Excluído'})`
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
// #                                                                      #
// #               FIM: COMPONENTES AUXILIARES DO DASHBOARD               #
// #                                                                      #
// #####################################################################



// #####################################################################
// #                                                                      #
// #           INÍCIO: CRONOANÁLISE DASHBOARD (CÓDIGO EXISTENTE)          #
// #                                                                      #
// #####################################################################

const CronoanaliseDashboard = ({ onNavigateToStock, user, permissions, startTvMode, dashboards, users, roles, currentDashboardIndex, setCurrentDashboardIndex }) => {
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
    
    const [products, setProducts] = useState([]);
    const [lots, setLots] = useState([]);
    const [allProductionData, setAllProductionData] = useState({});
    const [trashItems, setTrashItems] = useState([]);
    
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

        return () => {
            unsubProducts();
            unsubLots();
            unsubProdData();
            unsubTrash();
        };

    }, [user, currentDashboard]);


    
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
    const [showUrgent, setShowUrgent] = useState(false);
    const [urgentProduction, setUrgentProduction] = useState({ productId: '', produced: '' });
    const [isNavOpen, setIsNavOpen] = useState(false);
    const navRef = useRef();
    useClickOutside(navRef, () => setIsNavOpen(false));

    const closeModal = () => setModalState({ type: null, data: null });
    
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
    
    const productsForSelectedDate = useMemo(() => {
        const targetDate = new Date(selectedDate);
        targetDate.setHours(23, 59, 59, 999); 

        return products
            .map(p => {
                if (!p.standardTimeHistory || p.standardTimeHistory.length === 0) {
                    return null; 
                }
                const validTimeEntry = p.standardTimeHistory
                    .filter(h => new Date(h.effectiveDate) <= targetDate)
                    .pop();

                if (!validTimeEntry) {
                    return null; 
                }
                return { ...p, standardTime: validTimeEntry.time };
            })
            .filter(Boolean);
    }, [products, selectedDate]);
    
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
        const people = parseFloat(newEntry.people) || 0;
        const availableTime = parseFloat(newEntry.availableTime) || 0;
        let timeConsumedByUrgent = 0;
        let urgentPrediction = null;

        const currentProducts = productsForSelectedDate;

        if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) {
            const urgentProduct = currentProducts.find(p => p.id === urgentProduction.productId);
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
            const selectedProduct = currentProducts.find(p => p.id === newEntry.productId);
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
                        const productForLot = currentProducts.find(p => p.id === lot.productId);
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
    }, [newEntry.people, newEntry.availableTime, newEntry.productId, productsForSelectedDate, lots, urgentProduction, showUrgent]);

    useEffect(() => {
        const { allPredictions, currentGoalPreview } = calculatePredictions();
        setPredictedLots(allPredictions);
        setGoalPreview(currentGoalPreview);
    
        const expectedCount = allPredictions.filter(p => !p.isUrgent).length;
        if (newEntry.productions.length !== expectedCount) {
            setNewEntry(prev => ({ ...prev, productions: Array(expectedCount).fill('') }));
        }
    }, [calculatePredictions, newEntry.productions.length]);

    const productMapForSelectedDate = useMemo(() => 
        new Map(productsForSelectedDate.map(p => [p.id, p])), 
    [productsForSelectedDate]);
    
    const processedData = useMemo(() => {
        if (!productionData || productionData.length === 0) return [];
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
            const numericGoal = (item.goalDisplay || "0").split(' / ').reduce((acc, val) => acc + (parseInt(val.trim(), 10) || 0), 0);
            cumulativeProduction += totalProducedInPeriod;
            cumulativeGoal += numericGoal;
            cumulativeEfficiencySum += efficiency;
            const cumulativeEfficiency = parseFloat((cumulativeEfficiencySum / (index + 1)).toFixed(2));
            return { ...item, produced: totalProducedInPeriod, goal: numericGoal, producedForDisplay, efficiency, cumulativeProduction, cumulativeGoal, cumulativeEfficiency };
        });
    }, [productionData, productMapForSelectedDate]);

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
    const filteredLots = useMemo(() => [...lots].filter(l => lotFilter === 'ongoing' ? (l.status === 'ongoing' || l.status === 'future') : l.status.startsWith('completed')), [lots, lotFilter]);

    const isEntryFormValid = useMemo(() => {
        const hasProduction = newEntry.productions.some(p => (parseInt(p, 10) || 0) > 0);
        const hasUrgentProduction = showUrgent && urgentProduction.productId && (parseInt(urgentProduction.produced, 10) || 0) > 0;
        
        return (
            newEntry.period &&
            (parseFloat(newEntry.people) > 0) &&
            (parseFloat(newEntry.availableTime) > 0) &&
            newEntry.productId &&
            (hasProduction || hasUrgentProduction)
        );
    }, [newEntry, showUrgent, urgentProduction]);


    const handleAddEntry = useCallback(async (e) => {
        e.preventDefault();
        if (!isEntryFormValid || !currentDashboard) return;

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
        
        const newEntryData = { id: Date.now().toString(), period: newEntry.period, people: newEntry.people, availableTime: newEntry.availableTime, productionDetails, observation: '', goalDisplay: goalPreview, primaryProductId: newEntry.productId };
        
        const batch = writeBatch(db);
        const prodDataRef = doc(db, `dashboards/${currentDashboard.id}/productionData`, "data");

        const updatedDayData = [...(allProductionData[dateKey] || []), newEntryData];
        batch.set(prodDataRef, { [dateKey]: updatedDayData }, { merge: true });

        for (const detail of productionDetails) {
            const lotToUpdate = lots.find(l => l.productId === detail.productId);
            if(lotToUpdate){
                const lotRef = doc(db, `dashboards/${currentDashboard.id}/lots`, lotToUpdate.id);
                const newProduced = (lotToUpdate.produced || 0) + detail.produced;
                const updatePayload = { produced: newProduced };
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
        
        await batch.commit();
        
        setNewEntry({ period: '', people: '', availableTime: 60, productId: newEntry.productId, productions: [] });
        setUrgentProduction({productId: '', produced: ''});
        setShowUrgent(false);
    }, [isEntryFormValid, showUrgent, urgentProduction, predictedLots, newEntry, allProductionData, dateKey, lots, currentDashboard, goalPreview]);
    
    const handleInputChange = (e) => { const { name, value } = e.target; setNewEntry(prev => ({ ...prev, [name]: value, ...(name === 'productId' && { productions: [] }) })); };
    const handleUrgentChange = (e) => setUrgentProduction(prev => ({...prev, [e.target.name]: e.target.value}));
    const handleProductionChange = (index, value) => { const newProductions = [...newEntry.productions]; newProductions[index] = value; setNewEntry(prev => ({ ...prev, productions: newProductions })); };
    
    const handleAddProduct = async (e) => { 
        e.preventDefault(); 
        if (!newProduct.name || !newProduct.standardTime || !currentDashboard) return; 
        const id = Date.now().toString();
        const newProductData = { 
            id, 
            name: newProduct.name, 
            standardTimeHistory: [{
                time: parseFloat(newProduct.standardTime),
                effectiveDate: new Date().toISOString()
            }] 
        };
        await setDoc(doc(db, `dashboards/${currentDashboard.id}/products`, id), newProductData);
        setNewProduct({ name: '', standardTime: '' }); 
    };

    const handleStartEditProduct = (p) => { 
        setEditingProductId(p.id); 
        const currentTime = p.standardTimeHistory[p.standardTimeHistory.length - 1].time;
        setEditingProductData({ name: p.name, standardTime: currentTime }); 
    };

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
                effectiveDate: new Date().toISOString()
            });
        }
        
        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/products`, id), {
            name: editingProductData.name,
            standardTimeHistory: newHistory
        });
        
        setEditingProductId(null); 
    };

    const handleSaveObservation = async (entryId, observation) => {
        const updatedDayData = productionData.map(e => e.id === entryId ? { ...e, observation } : e);
        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/productionData`, "data"), { [dateKey]: updatedDayData });
    };
    const handleSaveLotObservation = async (lotId, observation) => {
        await updateDoc(doc(db, `dashboards/${currentDashboard.id}/lots`, lotId), { observation });
    };
    const handleAddLot = async (e) => {
        e.preventDefault();
        if (!newLot.productId || !newLot.target || !currentDashboard) return;
        const product = products.find(p => p.id === newLot.productId);
        if (!product) return;
        const id = Date.now().toString();
        const newLotData = {
            id,
            sequentialId: lotCounter,
            ...newLot,
            productId: product.id,
            productName: product.name,
            target: parseInt(newLot.target, 10),
            produced: 0,
            status: 'future',
            order: Date.now(),
            observation: '',
            startDate: null,
            endDate: null
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
        
        const updatePayload = { status: newStatus };
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
        <div className="min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 font-sans">
            <GlobalStyles/>
            <DashboardActionModal isOpen={modalState.type === 'dashboardAction'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} mode={modalState.data?.mode} initialName={modalState.data?.initialName}/>
            <ConfirmationModal isOpen={modalState.type === 'confirmation'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} title={modalState.data?.title} message={modalState.data?.message} />
            <ObservationModal isOpen={modalState.type === 'observation'} onClose={closeModal} entry={modalState.data} onSave={handleSaveObservation} />
            <LotObservationModal isOpen={modalState.type === 'lotObservation'} onClose={closeModal} lot={modalState.data} onSave={handleSaveLotObservation} />
            <PasswordModal isOpen={modalState.type === 'password'} onClose={closeModal} onSuccess={modalState.data?.onSuccess} adminConfig={{}} />
            <ReasonModal isOpen={modalState.type === 'reason'} onClose={closeModal} onConfirm={modalState.data?.onConfirm} />
            <AdminPanelModal isOpen={modalState.type === 'adminSettings'} onClose={closeModal} users={users} roles={roles} />
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
                                            {permissions.MANAGE_DASHBOARDS && (
                                                <div className="flex flex-col">
                                                    <button onClick={() => handleMoveDashboard(dash.id, 'up')} disabled={index === 0} className="disabled:opacity-20"><ChevronUp size={16} /></button>
                                                    <button onClick={() => handleMoveDashboard(dash.id, 'down')} disabled={index === dashboards.length - 1} className="disabled:opacity-20"><ChevronDown size={16} /></button>
                                                </div>
                                            )}
                                            <button onClick={() => { setCurrentDashboardIndex(index); setIsNavOpen(false); }} className="flex-grow text-left">{dash.name}</button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {permissions.MANAGE_DASHBOARDS && <button onClick={() => { setIsNavOpen(false); setModalState({ type: 'dashboardAction', data: { mode: 'rename', initialName: dash.name, onConfirm: (newName) => handleRenameDashboard(dash.id, newName) } })}} title="Renomear Quadro"><Edit size={16} className="text-yellow-500 hover:text-yellow-400" /></button>}
                                            {permissions.MANAGE_DASHBOARDS && <button onClick={() => { setIsNavOpen(false); setModalState({ type: 'confirmation', data: { title: 'Confirmar Exclusão', message: `Tem certeza que deseja excluir o quadro "${dash.name}"?`, onConfirm: () => handleDeleteDashboard(dash.id) } }); }} title="Excluir Quadro"><Trash2 size={16} className="text-red-500 hover:text-red-400" /></button>}
                                        </div>
                                    </div>
                                ))}
                                <div className="border-t my-2 dark:border-gray-600"></div>
                                {permissions.MANAGE_DASHBOARDS && <button onClick={() => { setIsNavOpen(false); setModalState({ type: 'dashboardAction', data: { mode: 'create', onConfirm: handleAddDashboard } })}} className="w-full text-left px-4 py-2 text-sm text-blue-600 dark:text-blue-400 font-semibold hover:bg-gray-100 dark:hover:bg-gray-700">+ Criar Novo Quadro</button>}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center space-x-2 sm:space-x-4">
                    <button onClick={onNavigateToStock} className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2">
                        <Warehouse size={20} />
                        <span className="hidden sm:inline">Gerenciamento de Estoque</span>
                    </button>
                    <span className='text-sm text-gray-500 dark:text-gray-400 hidden md:block'>{user.email}</span>
                    <button onClick={logout} title="Sair" className="p-2 rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-400 dark:hover:bg-red-900"><LogOut size={20} /></button>
                    <button onClick={handleSelectTvMode} title="Modo TV" className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700"><Monitor size={20} /></button>
                    {permissions.MANAGE_SETTINGS && <button onClick={() => setModalState({ type: 'adminSettings' })} title="Configurações" className="p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"><Settings size={20} /></button>}
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
                                                {permissions.EDIT_ENTRIES && <button onClick={() => {}} title="Editar Lançamento (desativado)" className="text-gray-400 cursor-not-allowed"><Edit size={18} /></button>}
                                                {permissions.DELETE_ENTRIES && <button onClick={() => handleDeleteEntry(d.id)} title="Excluir Lançamento"><Trash2 size={18} className="text-red-500 hover:text-red-400"/></button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {permissions.ADD_ENTRIES && <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
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
                                <div className="flex flex-col justify-center items-center bg-blue-100 dark:bg-blue-900/50 p-2 rounded-md shadow-inner h-full min-h-[60px] w-48">
                                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">Meta Prevista</label>
                                    <span className="font-bold text-xl text-blue-600 dark:text-blue-400">{goalPreview || '0'}</span>
                                </div>
                                <button type="submit" disabled={!isEntryFormValid} className="h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">Adicionar</button>
                            </div>
                        </div>
                    </form>
                </section>}
                
                 <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><Layers className="mr-2 text-blue-500"/> Controle de Lotes de Produção</h2>
                    {permissions.MANAGE_LOTS && <div className="mb-6 border-b pb-6 dark:border-gray-700">
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
                    </div>}
                     <div className="flex gap-2 mb-4 border-b pb-2 dark:border-gray-700 flex-wrap">
                        <button onClick={() => setLotFilter('ongoing')} className={`px-3 py-1 text-sm rounded-full ${lotFilter==='ongoing' ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:bg-gray-700'}`}>Em Andamento</button>
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
                        )}})}
                    </div>
                </section>

                 <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><Package className="mr-2 text-blue-500"/> Gerenciamento de Produtos</h2>
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
                                        {permissions.MANAGE_PRODUCTS && <th className="p-3 text-center">Ações</th>}
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                        {products.map(p => {
                                            const history = p.standardTimeHistory || [];
                                            const currentTime = history.length > 0 ? history[history.length - 1].time : 'N/A';

                                            const historicalEntry = history.filter(h => new Date(h.effectiveDate) <= selectedDate).pop();
                                            const didExistOnDate = !!historicalEntry;
                                            const historicalTime = historicalEntry ? historicalEntry.time : 'N/A';

                                            return (
                                            <tr key={p.id} className={!didExistOnDate ? 'bg-red-50 dark:bg-red-900/20' : ''}>
                                                {editingProductId === p.id ? (
                                                    <>
                                                        <td className="p-2"><input type="text" value={editingProductData.name} onChange={e => setEditingProductData({ ...editingProductData, name: e.target.value })} className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600" /></td>
                                                        <td className="p-2"><input type="number" step="0.01" value={editingProductData.standardTime} onChange={e => setEditingProductData({ ...editingProductData, standardTime: e.target.value })} className="w-full p-1 rounded bg-gray-100 dark:bg-gray-600" /></td>
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
                                                        {permissions.MANAGE_PRODUCTS && <td className="p-3">
                                                            <div className="flex gap-2 justify-center">
                                                                <button onClick={() => handleStartEditProduct(p)} title="Editar"><Edit size={18} className="text-yellow-500 hover:text-yellow-400" /></button>
                                                                <button onClick={() => handleDeleteProduct(p.id)} title="Excluir"><Trash2 size={18} className="text-red-500 hover:text-red-400" /></button>
                                                            </div>
                                                        </td>}
                                                    </>
                                                )}
                                            </tr>
                                        )})}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
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

const TvModeDisplay = ({ tvOptions, stopTvMode, dashboards }) => {
    const [theme] = useState(() => localStorage.getItem('theme') || 'dark');
    const [transitioning, setTransitioning] = useState(false);
    useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

    const isCarousel = typeof tvOptions === 'object';
    const initialDashboardId = isCarousel ? tvOptions.dashboardIds[0] : tvOptions;

    const [currentDashboardId, setCurrentDashboardId] = useState(initialDashboardId);
    
    const [alertInfo, setAlertInfo] = useState({ period: null, type: null });

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
    
    const [products, setProducts] = useState([]);
    const [allProductionData, setAllProductionData] = useState({});
    
    useEffect(() => {
        if (!currentDashboard) return;

        const unsubProducts = onSnapshot(query(collection(db, `dashboards/${currentDashboard.id}/products`)), snap => {
            setProducts(snap.docs.map(d => d.data()));
        });
        const unsubProdData = onSnapshot(doc(db, `dashboards/${currentDashboard.id}/productionData`, "data"), snap => {
            setAllProductionData(snap.exists() ? snap.data() : {});
        });

        return () => {
            unsubProducts();
            unsubProdData();
        };

    }, [currentDashboard]);

    
    const today = useMemo(() => new Date(), []);
    
    const productsForToday = useMemo(() => {
        const targetDate = new Date(today);
        targetDate.setHours(23, 59, 59, 999);

        return products
            .map(p => {
                if (!p.standardTimeHistory || p.standardTimeHistory.length === 0) return null;
                const validTimeEntry = p.standardTimeHistory.filter(h => new Date(h.effectiveDate) <= targetDate).pop();
                if (!validTimeEntry) return null;
                return { ...p, standardTime: validTimeEntry.time };
            })
            .filter(Boolean);
    }, [products, today]);


    const dateKey = today.toISOString().slice(0, 10);
    const productionData = useMemo(() => allProductionData[dateKey] || [], [allProductionData, dateKey]);
    
    const productMapForToday = useMemo(() => new Map(productsForToday.map(p => [p.id, p])), [productsForToday]);

    const processedData = useMemo(() => {
        if (!productionData || productionData.length === 0) return [];
        let cumulativeProduction = 0, cumulativeGoal = 0, cumulativeEfficiencySum = 0;
        return [...productionData].sort((a,b)=>(a.period||"").localeCompare(b.period||"")).map((item, index) => {
            let totalTimeValue = 0, totalProducedInPeriod = 0;
            const producedForDisplay = (item.productionDetails || []).map(d => `${d.produced || 0}`).join(' / ');
            (item.productionDetails || []).forEach(detail => {
                const product = productMapForToday.get(detail.productId);
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
    }, [productionData, productMapForToday]);
    
    const prevProductionData = usePrevious(productionData);
    useEffect(() => {
        if (prevProductionData && productionData.length > prevProductionData.length) {
            const newEntry = processedData.find(d => !prevProductionData.some(pd => pd.id === d.id));
            if (newEntry && newEntry.produced < newEntry.goal) {
                setAlertInfo({ period: newEntry.period, type: 'emoji' });
                
                const blinkTimer = setTimeout(() => {
                    setAlertInfo({ period: newEntry.period, type: 'blink' });
                }, 5000);

                const clearTimer = setTimeout(() => {
                    setAlertInfo({ period: null, type: null });
                }, 10000);

                return () => {
                    clearTimeout(blinkTimer);
                    clearTimeout(clearTimer);
                };
            }
        }
    }, [productionData, prevProductionData, processedData]);


    const monthlySummary = useMemo(() => {
        const year = today.getFullYear();
        const month = today.getMonth();
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
            return { value: '-', isLaunched: false };
        };
        const getPeopleTimeValue = (period) => {
            const launched = dataByPeriod[period];
            if (launched) return `${launched.people} / ${launched.availableTime} min`;
            return '- / -';
        };
        const getAlteracaoValue = (period) => {
            const launched = dataByPeriod[period];
            if (launched && launched.productionDetails?.length > 0) {
                return launched.productionDetails.map(d => productMapForToday.get(d.productId)?.name).filter(Boolean).join(' / ');
            }
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
                            {currentDashboard.name.toUpperCase()} - {today.toLocaleDateString('pt-BR')}
                        </th></tr>
                        <tr><th className="p-2 text-left">Resumo</th>{FIXED_PERIODS.map(p => <th key={p} className="p-2 text-sm">{getPeopleTimeValue(p)}</th>)}</tr>
                        <tr><th className="p-2 text-left">Alteração</th>{FIXED_PERIODS.map(p => <th key={p} className="p-2 text-base">{getAlteracaoValue(p)}</th>)}</tr>
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
                                        let cellContent, cellClass = 'p-3 font-extrabold';
                                        if (row.key === 'meta') {
                                            const metaInfo = row.formatter(p);
                                            cellContent = metaInfo.value;
                                            if (cellContent !== '-') {
                                                cellClass += metaInfo.isLaunched ? ' text-blue-600' : ' text-yellow-500';
                                            }
                                        } else {
                                            cellContent = row.formatter(p);
                                            if (row.key === 'efficiency' && alertInfo.period === p && alertInfo.type === 'blink') {
                                                cellClass += ' blinking-red';
                                            }
                                            if (row.isColor && cellContent !== '-') {
                                                const numericVal = dataByPeriod[p]?.[row.key];
                                                cellClass += numericVal < 65 ? ' text-red-500' : ' text-green-600';
                                            }
                                        }
                                        return (
                                            <td key={p} className={cellClass}>
                                                {row.key === 'producedForDisplay' && alertInfo.period === p && alertInfo.type === 'emoji' && <span role="img" aria-label="Alerta">⚠️ </span>}
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
// #                                                                      #
// #               COMPONENTE RAIZ E LÓGICA DE NAVEGAÇÃO                  #
// #                                                                      #
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

        console.log("DEBUG: Usando dados de teste para compilação. A conexão com o Firebase está desativada.");

        // 1. Simula permissões de administrador para que toda a interface seja visível
        const allPermissionsMap = {};
        for (const key in ALL_PERMISSIONS) {
            allPermissionsMap[key] = true;
        }
        setUserPermissions(allPermissionsMap);

        // 2. Carrega os dashboards a partir da constante, em vez do Firebase
        setDashboards(initialDashboards);

        // 3. Carrega uma lista de usuários de exemplo para o painel de administração
        setUsersWithRoles([
            { uid: 'admin@racedbull.com', email: 'admin@racedbull.com', role: 'admin' },
            { uid: 'editor@exemplo.com', email: 'editor@exemplo.com', role: 'editor' }
        ]);
        
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
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p className="text-xl">Carregando dados de exemplo...</p></div>;
    }

    if (tvMode && currentApp === 'cronoanalise') {
        return <TvModeDisplay tvOptions={tvMode} stopTvMode={stopTvMode} dashboards={dashboards} />;
    }

    if (currentApp === 'stock') {
        return <StockManagementApp onNavigateToCrono={() => setCurrentApp('cronoanalise')} permissions={userPermissions} />;
    }
    
    return <CronoanaliseDashboard 
        onNavigateToStock={() => setCurrentApp('stock')}
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
