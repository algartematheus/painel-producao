import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Sun, Moon, PlusCircle, Package, List, Edit, Trash2, Save, XCircle, ChevronLeft, ChevronRight, MessageSquare, Layers, ChevronUp, ChevronDown, LogOut, Eye, EyeOff, Settings, ChevronDown as ChevronDownIcon } from 'lucide-react';
// Importações do Firebase
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
} from 'firebase/auth';
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    deleteDoc,
    onSnapshot,
    query,
    writeBatch,
    updateDoc,
    getDoc,
    addDoc
} from 'firebase/firestore';

// --- Função utilitária para hash ---
async function sha256Hex(message) {
    const enc = new TextEncoder();
    const data = enc.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}


// --- Logo ---
const raceBullLogoUrl = "https://firebasestorage.googleapis.com/v0/b/quadrodeproducao.firebasestorage.app/o/assets%2FLOGO%20PROPRIET%C3%81RIA.png?alt=media&token=a16d015f-e8ca-4b3c-b744-7cef3ab6504b";

// --- Configuração Segura do Firebase ---
const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
    measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

// Inicialização dos serviços do Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const projectId = firebaseConfig.projectId;

// --- Lista de Quadros ---
const dashboards = [
    { id: 'producao', name: 'Quadro da Produção' },
    { id: 'acabamento', name: 'Quadro do Acabamento' },
    { id: 'estoque', name: 'Quadro do Estoque' },
    { id: 'corte', name: 'Quadro do Corte' },
];

// --- COMPONENTES MODAIS ---
const ObservationModal = ({ isOpen, onClose, entry, onSave }) => {
    const [observation, setObservation] = useState('');
    useEffect(() => { if (entry) setObservation(entry.observation || ''); }, [entry]);
    if (!isOpen) return null;
    const handleSave = () => { onSave(entry.id, observation); onClose(); };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Observação do Período ({entry?.period})</h2><button onClick={onClose}><XCircle /></button></div>
                <textarea value={observation} onChange={e => setObservation(e.target.value)} rows="4" className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"></textarea>
                <button onClick={handleSave} className="w-full h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Salvar</button>
            </div>
        </div>
    );
};
const LotObservationModal = ({ isOpen, onClose, lot, onSave }) => {
    const [observation, setObservation] = useState('');
    useEffect(() => { if (lot) setObservation(lot.observation || ''); }, [lot]);
    if (!isOpen) return null;
    const handleSave = () => { onSave(lot.id, observation); onClose(); };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Observação do Lote ({lot?.productName} #{lot?.sequentialId})</h2><button onClick={onClose}><XCircle /></button></div>
                <textarea value={observation} onChange={e => setObservation(e.target.value)} rows="4" className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"></textarea>
                <button onClick={handleSave} className="w-full h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Salvar</button>
            </div>
        </div>
    );
};
const PasswordModal = ({ isOpen, onClose, onSuccess, adminConfig }) => {
    const [passwordInput, setPasswordInput] = useState('');
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setPasswordInput('');
            setChecking(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        setChecking(true);
        try {
            if (!adminConfig || !adminConfig.passwordHash) {
                alert('Configuração de administrador não encontrada. Peça para um administrador configurar a senha.');
                onClose();
                return;
            }
            const hash = await sha256Hex(passwordInput || '');
            if (hash === adminConfig.passwordHash) {
                if (onSuccess) onSuccess();
            } else {
                alert('Senha incorreta!');
                setPasswordInput('');
            }
        } catch (e) {
            console.error(e);
            alert('Erro ao validar senha.');
            onClose();
        } finally {
            setChecking(false);
        }
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Confirmação de Senha</h2><button onClick={onClose}><XCircle /></button></div>
                <div>
                    <p className="mb-4">Para continuar, por favor insira a senha de administrador.</p>
                    <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4" />
                    <button onClick={handleConfirm} disabled={checking} className="w-full h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">
                        {checking ? 'Validando...' : 'Confirmar'}
                    </button>
                </div>
            </div>
        </div>
    );
};
const ReasonModal = ({ isOpen, onClose, onConfirm }) => {
    const [reason, setReason] = useState('');
    useEffect(() => { if (!isOpen) setReason(''); }, [isOpen]);
    if (!isOpen) return null;
    const handleConfirm = () => {
        if (!reason.trim()) { alert('Informe o motivo para continuar.'); return; }
        if (onConfirm) onConfirm(reason.trim());
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Motivo da Exclusão</h2><button onClick={onClose}><XCircle /></button></div>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={5} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4" placeholder="Explique por que está removendo este item..." />
                <button onClick={handleConfirm} className="w-full h-10 px-6 font-semibold rounded-md bg-red-600 text-white hover:bg-red-700">Confirmar Exclusão</button>
            </div>
        </div>
    );
};
const AdminSettingsModal = ({ isOpen, onClose, setAdminConfig }) => {
    const [newPass, setNewPass] = useState('');
    const [confirmPass, setConfirmPass] = useState('');
    const [saving, setSaving] = useState(false);
    if (!isOpen) return null;
    const handleSave = async () => {
        if (!newPass) { alert('Insira a nova senha.'); return; }
        if (newPass !== confirmPass) { alert('As senhas não coincidem.'); return; }
        setSaving(true);
        try {
            const hash = await sha256Hex(newPass);
            const adminDocRef = doc(db, `artifacts/${projectId}/private/admin_config`, 'admin');
            await setDoc(adminDocRef, { passwordHash: hash });
            setAdminConfig({ passwordHash: hash });
            alert('Senha atualizada com sucesso.');
            onClose();
        } catch (e) {
            console.error(e);
            alert('Erro ao salvar nova senha.');
        } finally { setSaving(false); }
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Configurações de Admin</h2><button onClick={onClose}><XCircle /></button></div>
                <div className="space-y-2">
                    <input type="password" placeholder="Nova senha" value={newPass} onChange={(e) => setNewPass(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700" />
                    <input type="password" placeholder="Confirmar senha" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700" />
                    <button onClick={handleSave} disabled={saving} className="w-full h-10 px-6 font-semibold rounded-md bg-green-600 text-white hover:bg-green-700">
                        {saving ? 'Salvando...' : 'Salvar nova senha'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- TELA DE AUTENTICAÇÃO ---
const AuthScreen = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);
    const handleAuth = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
            await setPersistence(auth, persistence);
            await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            switch (err.code) {
                case 'auth/user-not-found':
                case 'auth/invalid-credential':
                case 'auth/wrong-password':
                    setError('Email ou senha inválidos.');
                    break;
                default:
                    setError('Ocorreu um erro. Tente novamente.');
                    break;
            }
        }
    };
    return (
        <div className="min-h-screen bg-gray-100 dark:bg-black flex flex-col justify-center items-center p-4">
            <div className="w-full max-w-md">
                <div className="flex justify-center items-center mb-8">
                    <img src={raceBullLogoUrl} alt="Race Bull Logo" className="h-24 w-auto dark:invert" />
                </div>
                <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-2xl">
                    <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-white mb-6">Acessar Painel</h2>
                    <form onSubmit={handleAuth} className="space-y-6">
                        <div>
                            <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Email</label>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1 w-full p-3 rounded-md bg-gray-100 dark:bg-gray-800 border-transparent focus:border-blue-500 focus:ring-0" />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Senha</label>
                            <div className="relative">
                                <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required className="mt-1 w-full p-3 rounded-md bg-gray-100 dark:bg-gray-800 border-transparent focus:border-blue-500 focus:ring-0" />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500">{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
                            </div>
                        </div>
                        <div className="flex items-center">
                            <input id="remember-me" name="remember-me" type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
                            <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900 dark:text-gray-300"> Manter-me conectado</label>
                        </div>
                        {error && <p className="text-sm text-red-500 text-center">{error}</p>}
                        <button type="submit" className="w-full h-12 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors">Entrar</button>
                    </form>
                </div>
            </div>
        </div>
    );
};

// --- COMPONENTE PRINCIPAL DO DASHBOARD ---
const CronoanaliseDashboard = ({ user }) => {
    // LÓGICA DE TEMA
    const [theme, setTheme] = useState(() => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) return savedTheme;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });
    useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') { root.classList.add('dark'); }
        else { root.classList.remove('dark'); }
        localStorage.setItem('theme', theme);
    }, [theme]);
    const toggleTheme = () => setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));

    // ESTADOS GERAIS
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [calendarView, setCalendarView] = useState('day');
    const [currentDashboardIndex, setCurrentDashboardIndex] = useState(0);
    const currentDashboard = dashboards[currentDashboardIndex];
    const [productionData, setProductionData] = useState({});
    const [products, setProducts] = useState([]);
    const [lots, setLots] = useState([]);
    const [lotCounter, setLotCounter] = useState(1);
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
    const [modalState, setModalState] = useState({ type: null, data: null, nextAction: null });
    const [editingEntryId, setEditingEntryId] = useState(null);
    const [editingEntryData, setEditingEntryData] = useState(null);
    const [showUrgent, setShowUrgent] = useState(false);
    const [urgentProduction, setUrgentProduction] = useState({ productId: '', produced: '' });
    const [isNavOpen, setIsNavOpen] = useState(false);
    const [adminConfig, setAdminConfig] = useState(null);
    const [trashItems, setTrashItems] = useState([]);

    // --- CARREGAMENTO DE DADOS ---
    useEffect(() => {
        if (!projectId) return;
        const trashQuery = query(collection(db, `artifacts/${projectId}/private/trash`));
        const unsubscribeTrash = onSnapshot(trashQuery, (snapshot) => {
            setTrashItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        
        let mounted = true;
        const loadAdminConfig = async () => {
            try {
                const adminDocRef = doc(db, `artifacts/${projectId}/private/admin_config`, 'admin');
                const adminSnap = await getDoc(adminDocRef);
                if (mounted && adminSnap.exists()) {
                    setAdminConfig(adminSnap.data());
                } else { setAdminConfig(null); }
            } catch (e) {
                console.error('Erro ao carregar admin config:', e);
                setAdminConfig(null);
            }
        };
        loadAdminConfig();
        return () => { 
            mounted = false;
            unsubscribeTrash();
        };
    }, []);

    useEffect(() => {
        if (!projectId) return;
        const basePath = `artifacts/${projectId}/public/data`;
        const productsQuery = query(collection(db, `${basePath}/${currentDashboard.id}_products`));
        const unsubscribeProducts = onSnapshot(productsQuery, (snapshot) => setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
        const lotsQuery = query(collection(db, `${basePath}/${currentDashboard.id}_lots`));
        const unsubscribeLots = onSnapshot(lotsQuery, (snapshot) => {
            const lotsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLots(lotsData);
            setLotCounter(lotsData.length > 0 ? Math.max(0, ...lotsData.map(l => l.sequentialId || 0)) + 1 : 1);
        });
        return () => { unsubscribeProducts(); unsubscribeLots(); };
    }, [currentDashboard.id]);

    useEffect(() => {
        if (!projectId) return;
        const dateKey = selectedDate.toISOString().slice(0, 10);
        const productionDataPath = `artifacts/${projectId}/public/data/${currentDashboard.id}_productionData`;
        const productionDocRef = doc(db, productionDataPath, dateKey);
        const unsubscribeProduction = onSnapshot(productionDocRef, (doc) => {
            setProductionData(prev => ({ ...prev, [dateKey]: (doc.exists() && doc.data().entries) ? doc.data().entries : [] }));
        });
        return () => unsubscribeProduction();
    }, [selectedDate, currentDashboard.id]);

    const handleLogout = () => signOut(auth);

    // --- LÓGICA DE EXCLUSÃO (SOFT-DELETE) E MODAIS ---
    const closeModal = () => setModalState({ type: null, data: null, nextAction: null });

    const executeSoftDelete = async (info, reason) => {
        console.log('executeSoftDelete iniciado com:', info, reason);
        try {
            const pathSegments = info.itemDocPath.split('/');
            const docId = pathSegments.pop();
            const collectionPath = pathSegments.join('/');
            const originalRef = doc(db, collectionPath, docId);

            const originalSnap = await getDoc(originalRef);
            if (!originalSnap.exists()) {
                alert('Documento não encontrado.');
                console.error("Documento não encontrado em:", info.itemDocPath);
                return;
            }
            const trashCollectionRef = collection(db, `artifacts/${projectId}/private/trash`);
            await addDoc(trashCollectionRef, {
                originalPath: info.itemDocPath,
                originalDoc: originalSnap.data(),
                deletedByEmail: user?.email || 'unknown',
                deletedAt: new Date().toISOString(),
                reason,
                itemType: info.itemType || null
            });
            
            console.log('Removendo originalRef:', originalRef.path);
            await deleteDoc(originalRef);

            alert('Item movido para Lixeira com sucesso.');
        } catch (e) {
            console.error('Erro ao mover item para lixeira:', e);
            alert('Erro ao excluir item.');
        } finally {
            closeModal();
        }
    };
    
    const handleDeleteLot = (lotId) => {
        const itemDocPath = `artifacts/${projectId}/public/data/${currentDashboard.id}_lots/${lotId}`;
        const itemData = { itemType: 'lot', itemId: lotId, itemDocPath };
        setModalState({
            type: 'password',
            data: itemData,
            nextAction: 'requestReason'
        });
    };

    const handleDeleteProduct = (productId) => {
        const itemDocPath = `artifacts/${projectId}/public/data/${currentDashboard.id}_products/${productId}`;
        const itemData = { itemType: 'product', itemId: productId, itemDocPath };
        setModalState({
            type: 'password',
            data: itemData,
            nextAction: 'requestReason'
        });
    };

    const handlePasswordSuccess = () => {
        if (modalState.nextAction === 'requestReason') {
            setModalState(prev => ({
                ...prev,
                type: 'reason',
                nextAction: 'executeDelete'
            }));
        } else if (typeof modalState.nextAction === 'function') {
            modalState.nextAction();
            closeModal();
        }
    };

    const handleDeleteEntry = (entryId, dateKey) => {
        const deleteAction = async () => {
            const dayDocRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_productionData`, dateKey);
            const dayDoc = await getDoc(dayDocRef);
            if (!dayDoc.exists()) return;
            const entries = dayDoc.data().entries || [];
            const entryToDelete = entries.find(e => e.id === entryId);
            if (!entryToDelete) return;

            const batch = writeBatch(db);
            entryToDelete.productionDetails.forEach(detail => {
                const lotToUpdate = lots.find(l => l.productId === detail.productId);
                if (lotToUpdate) {
                    const lotRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots`, lotToUpdate.id);
                    const newProduced = Math.max(0, (lotToUpdate.produced || 0) - detail.produced);
                    const newStatus = (lotToUpdate.produced >= lotToUpdate.target && newProduced < lotToUpdate.target) ? 'ongoing' : lotToUpdate.status;
                    batch.update(lotRef, { produced: newProduced, status: newStatus });
                }
            });
            const updatedEntries = entries.filter(e => e.id !== entryId);
            batch.set(dayDocRef, { entries: updatedEntries });
            await batch.commit();
            alert('Lançamento removido.');
        };

        setModalState({
            type: 'password',
            data: null,
            nextAction: deleteAction
        });
    };

    // --- DEMAIS LÓGICAS DO COMPONENTE ---
    useEffect(() => {
        if (editingEntryId) return;
        const firstActiveLot = lots.filter(l => l.status === 'ongoing' || l.status === 'future').sort((a, b) => a.order - b.order)[0];
        const isCurrentSelectionValidAndActive = lots.some(l => l.productId === newEntry.productId && (l.status === 'ongoing' || l.status === 'future'));
        if (firstActiveLot && !isCurrentSelectionValidAndActive) {
            setNewEntry(prev => ({ ...prev, productId: firstActiveLot.productId }));
        } else if (!firstActiveLot && !isCurrentSelectionValidAndActive) {
            setNewEntry(prev => ({...prev, productId: ''}));
        }
    }, [lots, editingEntryId, newEntry.productId]);
    useEffect(() => {
        let timeConsumedByUrgent = 0;
        let urgentPrediction = null;
        if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) {
            const urgentProduct = products.find(p => p.id === urgentProduction.productId);
            if (urgentProduct) {
                timeConsumedByUrgent = urgentProduct.standardTime * urgentProduction.produced;
                const urgentLot = lots.find(l => l.productId === urgentProduct.id);
                urgentPrediction = {
                    ...(urgentLot || {}),
                    productId: urgentProduct.id, productName: urgentProduct.name,
                    producible: parseInt(urgentProduction.produced, 10), isUrgent: true
                };
            }
        }
        const totalAvailableMinutes = (newEntry.availableTime || 0) * (newEntry.people || 0);
        const remainingTime = totalAvailableMinutes - timeConsumedByUrgent;
        let normalPredictions = [];
        if (remainingTime > 0) {
            const selectedProduct = products.find(p => p.id === newEntry.productId);
            if (selectedProduct) {
                const activeLots = lots.filter(l => l.status === 'ongoing' || l.status === 'future').sort((a, b) => a.order - b.order);
                const startIndex = activeLots.findIndex(l => l.productId === newEntry.productId);
                if (startIndex === -1) {
                    if (selectedProduct.standardTime > 0) {
                        const possiblePieces = Math.floor(remainingTime / selectedProduct.standardTime);
                        normalPredictions.push({ id: `nolot-${selectedProduct.id}`, productId: selectedProduct.id, productName: selectedProduct.name, producible: possiblePieces });
                    }
                } else {
                    let timeForNormal = remainingTime;
                    for (let i = startIndex; i < activeLots.length; i++) {
                        if (timeForNormal <= 0) break;
                        const lot = activeLots[i];
                        const productForLot = products.find(p => p.id === lot.productId);
                        if (productForLot && productForLot.standardTime > 0) {
                            const remainingPiecesInLot = Math.max(0, (lot.target || 0) - (lot.produced || 0));
                            const producible = Math.min(remainingPiecesInLot, Math.floor(timeForNormal / productForLot.standardTime));
                            if (producible > 0) {
                                normalPredictions.push({ ...lot, producible, productName: productForLot.name });
                                timeForNormal -= producible * productForLot.standardTime;
                                if (producible < remainingPiecesInLot) break;
                            }
                        }
                    }
                }
            }
        }
        const allPredictions = urgentPrediction ? [urgentPrediction, ...normalPredictions] : normalPredictions;
        setPredictedLots(allPredictions);
        setGoalPreview(allPredictions.map(p => p.producible || 0).join(' / ') || '0');
        setNewEntry(prev => ({ ...prev, productions: Array(normalPredictions.length).fill('') }));
    }, [newEntry.availableTime, newEntry.people, newEntry.productId, products, lots, urgentProduction, showUrgent]);
    const dailyProductionData = useMemo(() => {
        const dateKey = selectedDate.toISOString().slice(0, 10);
        return productionData[dateKey] || [];
    }, [selectedDate, productionData]);
    const processedData = useMemo(() => {
        if (!dailyProductionData || dailyProductionData.length === 0) return [];
        let cumulativeProduction = 0;
        let cumulativeGoal = 0;
        let cumulativeEfficiencySum = 0;
        const sortedData = [...dailyProductionData].sort((a, b) => (a.period || "").localeCompare(b.period || ""));
        return sortedData.map((item, index) => {
            let totalTimeValue = 0;
            let totalProducedInPeriod = 0;
            (item.productionDetails || []).forEach(detail => {
                const product = products.find(p => p.id === detail.productId);
                if (product && product.standardTime) {
                    totalTimeValue += (detail.produced || 0) * product.standardTime;
                    totalProducedInPeriod += (detail.produced || 0);
                }
            });
            const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
            const efficiency = totalAvailableTime > 0 ? parseFloat(((totalTimeValue / totalAvailableTime) * 100).toFixed(2)) : 0;
            let goalForDisplay = item.goalDisplay || "0";
            let producedForDisplay = (item.productionDetails || []).map(d => d.produced || 0).join(' / ');
            let numericGoal = goalForDisplay.split(' / ').reduce((acc, val) => acc + (parseInt(val.trim(), 10) || 0), 0);
            cumulativeProduction += totalProducedInPeriod;
            cumulativeGoal += numericGoal;
            cumulativeEfficiencySum += efficiency;
            const cumulativeEfficiency = parseFloat((cumulativeEfficiencySum / (index + 1)).toFixed(2));
            return { ...item, produced: totalProducedInPeriod, goal: numericGoal, goalForDisplay, producedForDisplay, efficiency, cumulativeProduction, cumulativeGoal, cumulativeEfficiency };
        });
    }, [dailyProductionData, products]);
    const summary = useMemo(() => {
        if (processedData.length === 0) return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
        const lastEntry = processedData[processedData.length - 1];
        return { totalProduced: lastEntry.cumulativeProduction, totalGoal: lastEntry.cumulativeGoal, lastHourEfficiency: lastEntry.efficiency, averageEfficiency: lastEntry.cumulativeEfficiency, };
    }, [processedData]);
    const monthlySummary = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        let totalMonthlyProduction = 0;
        let totalMonthlyGoal = 0;
        let totalDailyAverageEfficiencies = 0;
        let productiveDaysCount = 0;
        Object.keys(productionData).forEach(dateKey => {
            try {
                const date = new Date(dateKey + "T00:00:00");
                if(date.getFullYear() === year && date.getMonth() === month) {
                    const dayData = productionData[dateKey];
                    if (dayData && dayData.length > 0) {
                        productiveDaysCount++;
                        let dailyProduction = 0;
                        let dailyGoal = 0;
                        let dailyEfficiencySum = 0;
                        dayData.forEach(item => {
                            let periodProduction = 0;
                            let totalTimeValue = 0;
                            (item.productionDetails || []).forEach(detail => {
                                periodProduction += (detail.produced || 0);
                                const product = products.find(p => p.id === detail.productId);
                                if (product && product.standardTime) {
                                    totalTimeValue += (detail.produced || 0) * product.standardTime;
                                }
                            });
                            if (item.goalDisplay) {
                                dailyGoal += item.goalDisplay.split(' / ').reduce((acc, val) => acc + (parseInt(val.trim(), 10) || 0), 0);
                            }
                            dailyProduction += periodProduction;
                            const totalAvailableTime = (item.people || 0) * (item.availableTime || 0);
                            const periodEfficiency = totalAvailableTime > 0 ? (totalTimeValue / totalAvailableTime) * 100 : 0;
                            dailyEfficiencySum += periodEfficiency;
                        });
                        const dailyAverageEfficiency = dayData.length > 0 ? dailyEfficiencySum / dayData.length : 0;
                        totalDailyAverageEfficiencies += dailyAverageEfficiency;
                        totalMonthlyProduction += dailyProduction;
                        totalMonthlyGoal += dailyGoal;
                    }
                }
            } catch(e) { console.error("Data inválida no sumário mensal:", dateKey); }
        });
        const averageMonthlyEfficiency = productiveDaysCount > 0 ? parseFloat((totalDailyAverageEfficiencies / productiveDaysCount).toFixed(2)) : 0;
        return { totalProduction: totalMonthlyProduction, totalGoal: totalMonthlyGoal, averageEfficiency: averageMonthlyEfficiency, };
    }, [productionData, currentMonth, products]);
    const filteredLots = useMemo(() => {
        const sorted = [...lots].sort((a, b) => a.order - b.order);
        if (lotFilter === 'ongoing') return sorted.filter(lot => lot.status === 'ongoing' || lot.status === 'future');
        if (lotFilter === 'completed') return sorted.filter(lot => lot.status.startsWith('completed'));
        return [];
    }, [lots, lotFilter]);
    const handleAddEntry = async (e) => {
        e.preventDefault();
        const productionDetails = [];
        if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) {
            productionDetails.push({ productId: urgentProduction.productId, produced: parseInt(urgentProduction.produced, 10) });
        }
        const normalPredictedLots = predictedLots.filter(p => !p.isUrgent);
        newEntry.productions.forEach((produced, index) => {
            const lot = normalPredictedLots[index];
            const producedAmount = parseInt(produced, 10) || 0;
            if (lot && producedAmount > 0) { productionDetails.push({ productId: lot.productId, produced: producedAmount }); }
        });
        if (productionDetails.length === 0) { alert("Nenhuma produção foi inserida."); return; }
        const newEntryWithId = { id: Date.now().toString(), period: newEntry.period, people: newEntry.people, availableTime: newEntry.availableTime, productionDetails, observation: '', goalDisplay: goalPreview, primaryProductId: newEntry.productId, };
        const dateKey = selectedDate.toISOString().slice(0, 10);
        const dayDocRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_productionData/${dateKey}`);
        const dayDoc = await getDoc(dayDocRef);
        const currentEntries = dayDoc.exists() && dayDoc.data().entries ? dayDoc.data().entries : [];
        const batch = writeBatch(db);
        batch.set(dayDocRef, { entries: [...currentEntries, newEntryWithId] }, { merge: true });
        productionDetails.forEach(detail => {
            const lotToUpdate = lots.find(l => l.productId === detail.productId);
            if (lotToUpdate) {
                const lotRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots/${lotToUpdate.id}`);
                const newProduced = (lotToUpdate.produced || 0) + detail.produced;
                const newStatus = newProduced >= lotToUpdate.target ? 'completed' : 'ongoing';
                batch.update(lotRef, { produced: newProduced, status: lotToUpdate.status === 'future' ? 'ongoing' : newStatus });
            }
        });
        await batch.commit();
        setNewEntry({ period: '', people: '', availableTime: 60, productId: newEntry.productId, productions: [] });
        setUrgentProduction({productId: '', produced: ''});
        setShowUrgent(false);
    };
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'productId') {
            setNewEntry(prev => ({ ...prev, productId: value, productions: [] }));
        } else if (name === 'period') {
            const digits = value.replace(/\D/g, '').slice(0, 4);
            setNewEntry(prev => ({ ...prev, period: digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits }));
        } else {
            setNewEntry(prev => ({ ...prev, [name]: value === '' ? '' : parseFloat(value) || value }));
        }
    };
    const handleUrgentChange = (e) => {
        const { name, value } = e.target;
        setUrgentProduction(prev => ({...prev, [name]: value}));
    };
    const handleProductionChange = (index, value) => {
        const newProductions = [...newEntry.productions];
        newProductions[index] = value;
        setNewEntry(prev => ({ ...prev, productions: newProductions }));
    };
    const handleAddProduct = async (e) => {
        e.preventDefault();
        if (!newProduct.name || !newProduct.standardTime) return;
        const newProductData = { ...newProduct, standardTime: parseFloat(newProduct.standardTime) };
        const docRef = doc(collection(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_products`));
        await setDoc(docRef, newProductData);
        setNewProduct({ name: '', standardTime: '' });
    };
    const handleStartEditProduct = (product) => {
        setEditingProductId(product.id);
        setEditingProductData({ name: product.name, standardTime: product.standardTime });
    };
    const handleSaveProduct = async (id) => {
        const productRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_products`, id);
        await updateDoc(productRef, { ...editingProductData, standardTime: parseFloat(editingProductData.standardTime) });
        setEditingProductId(null);
    };
    const handleSaveObservation = async (entryId, observation) => {
        const dateKey = selectedDate.toISOString().slice(0, 10);
        const dayDocRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_productionData`, dateKey);
        const dayDoc = await getDoc(dayDocRef);
        if (dayDoc.exists()) {
            const updatedEntries = dayDoc.data().entries.map(e => e.id === entryId ? { ...e, observation } : e);
            await setDoc(dayDocRef, { entries: updatedEntries });
        }
    };
    const handleSaveLotObservation = async (lotId, observation) => {
        await updateDoc(doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots`, lotId), { observation });
    };
    const handleAddLot = async (e) => {
        e.preventDefault();
        if (!newLot.productId || !newLot.target) { alert("Selecione um produto e insira a quantidade."); return; }
        const product = products.find(p => p.id === newLot.productId);
        if (!product) return;
        const docRef = doc(collection(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots`));
        await setDoc(docRef, { sequentialId: lotCounter, productId: product.id, productName: product.name, customName: newLot.customName, target: parseInt(newLot.target, 10), produced: 0, status: 'future', order: Date.now(), observation: '', startDate: null, endDate: null });
        setNewLot({ productId: '', target: '', customName: '' });
    };
    const handleStartEditLot = (lot) => {
        setEditingLotId(lot.id);
        setEditingLotData({ target: lot.target, customName: lot.customName });
    };
    const handleSaveLotEdit = async (lotId) => {
        const lotRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots`, lotId);
        const lot = lots.find(l => l.id === lotId);
        const newTarget = parseInt(editingLotData.target, 10);
        let newStatus = lot.status;
        if (lot.produced >= newTarget) {
            if (!lot.status.startsWith('completed')) newStatus = 'completed';
        } else {
            if (lot.status.startsWith('completed')) newStatus = 'ongoing';
        }
        await updateDoc(lotRef, { target: newTarget, customName: editingLotData.customName, status: newStatus });
        setEditingLotId(null);
        setEditingLotData({ target: '', customName: ''});
    };
    const handleMoveLot = async (lotId, direction) => {
        const sortedActiveLots = lots.filter(l => l.status === 'ongoing' || l.status === 'future').sort((a, b) => a.order - b.order);
        const currentIndex = sortedActiveLots.findIndex(l => l.id === lotId);
        let swapIndex = -1;
        if (direction === 'up' && currentIndex > 0) swapIndex = currentIndex - 1;
        else if (direction === 'down' && currentIndex < sortedActiveLots.length - 1) swapIndex = currentIndex + 1;
        if (swapIndex !== -1) {
            const currentLot = sortedActiveLots[currentIndex];
            const swapLot = sortedActiveLots[swapIndex];
            const batch = writeBatch(db);
            batch.update(doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots`, currentLot.id), { order: swapLot.order });
            batch.update(doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots`, swapLot.id), { order: currentLot.order });
            await batch.commit();
        }
    };
    const handleLotStatusChange = async (lotId, newStatus) => {
        await updateDoc(doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots`, lotId), { status: newStatus });
    };
    const handleStartEditEntry = (entry) => { setEditingEntryId(entry.id); setEditingEntryData({ ...entry }); };
    const handleCancelEditEntry = () => { setEditingEntryId(null); setEditingEntryData(null); };
    const handleEditingEntryChange = (field, value) => {
        let formattedValue = value;
        if (field === 'period') {
            const digits = value.replace(/\D/g, '').slice(0, 4);
            formattedValue = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
        }
        const nextState = { ...editingEntryData, [field]: formattedValue === '' ? '' : parseFloat(formattedValue) || formattedValue };
        setEditingEntryData(nextState);
    };
    const handleEditingProductionChange = (index, value) => {
        const newDetails = [...editingEntryData.productionDetails];
        newDetails[index] = {...newDetails[index], produced: value === '' ? 0 : parseInt(value, 10) || 0 };
        setEditingEntryData(prev => ({...prev, productionDetails: newDetails}));
    };
    const handleSaveEntryEdit = async () => {
        const dateKey = selectedDate.toISOString().slice(0, 10);
        const dayDocRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_productionData`, dateKey);
        const dayDoc = await getDoc(dayDocRef);
        const originalEntries = dayDoc.exists() ? dayDoc.data().entries : [];
        const originalEntry = originalEntries.find(e => e.id === editingEntryId);
        const finalEntryData = { ...editingEntryData, productionDetails: editingEntryData.productionDetails.filter(d => d.produced > 0) };
        const productionDiff = {};
        originalEntry.productionDetails.forEach(detail => {
            productionDiff[detail.productId] = (productionDiff[detail.productId] || 0) - detail.produced;
        });
        finalEntryData.productionDetails.forEach(detail => {
            productionDiff[detail.productId] = (productionDiff[detail.productId] || 0) + detail.produced;
        });
        const batch = writeBatch(db);
        Object.keys(productionDiff).forEach(productId => {
            if (productionDiff[productId] !== 0) {
                const lotToUpdate = lots.find(l => l.productId === productId);
                if (lotToUpdate) {
                    const lotRef = doc(db, `artifacts/${projectId}/public/data/${currentDashboard.id}_lots`, lotToUpdate.id);
                    const newProduced = (lotToUpdate.produced || 0) + productionDiff[productId];
                    let newStatus = lotToUpdate.status;
                    if (newProduced >= lotToUpdate.target) {
                        if (!lotToUpdate.status.startsWith('completed')) newStatus = 'completed';
                    } else {
                        if (lotToUpdate.status.startsWith('completed')) newStatus = 'ongoing';
                    }
                    batch.update(lotRef, { produced: newProduced, status: newStatus });
                }
            }
        });
        const updatedEntries = originalEntries.map(entry => entry.id === editingEntryId ? finalEntryData : entry);
        batch.set(dayDocRef, { entries: updatedEntries });
        await batch.commit();
        handleCancelEditEntry();
    };

    const StatCard = ({ title, value, unit = '', isEfficiency = false }) => {
        const valueColor = isEfficiency ? (value < 65 ? 'text-red-500' : 'text-green-600') : 'text-gray-800 dark:text-white';
        return (
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                <h3 className="text-lg font-medium text-gray-500 dark:text-gray-400">{title}</h3>
                <p className={`text-4xl font-bold ${valueColor} mt-2`}>{value}<span className="text-2xl ml-2">{unit}</span></p>
            </div>
        );
    };
    const CalendarView = () => {
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
                        const hasData = !!(productionData[day.toISOString().slice(0, 10)] && productionData[day.toISOString().slice(0, 10)].length > 0);
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
                    <button onClick={() => handleNavigation(-1)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronLeft/></button>
                    {renderHeader()}
                    <button onClick={() => handleNavigation(1)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><ChevronRight/></button>
                </div>
                {calendarView === 'day' && renderDayView()}
                {calendarView === 'month' && renderMonthView()}
                {calendarView === 'year' && renderYearView()}
            </div>
        );
    };
    const handleDashboardChange = (index) => {
        setCurrentDashboardIndex(index);
        setIsNavOpen(false);
    };
    return (
        <div className="min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 font-sans">
            <ObservationModal isOpen={modalState.type === 'observation'} onClose={closeModal} entry={modalState.data} onSave={handleSaveObservation} />
            <LotObservationModal isOpen={modalState.type === 'lotObservation'} onClose={closeModal} lot={modalState.data} onSave={handleSaveLotObservation} />
            
            <PasswordModal
                isOpen={modalState.type === 'password'}
                onClose={closeModal}
                onSuccess={modalState.callback}
                adminConfig={adminConfig}
            />
            <ReasonModal 
                isOpen={modalState.type === 'reason'} 
                onClose={closeModal} 
                onConfirm={modalState.callback}
            />
            <AdminSettingsModal isOpen={modalState.type === 'adminSettings'} onClose={closeModal} setAdminConfig={setAdminConfig} />

            <header className="bg-white dark:bg-gray-900 shadow-md p-4 flex justify-between items-center sticky top-0 z-10">
                <div className="flex items-center gap-4">
                    <img src={raceBullLogoUrl} alt="Race Bull Logo" className="h-12 w-auto dark:invert" />
                    <div className="relative">
                        <button onClick={() => setIsNavOpen(!isNavOpen)} className="flex items-center gap-2 p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white tracking-wider text-center">{currentDashboard.name}</h1>
                            <ChevronDownIcon size={20} className={`transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {isNavOpen && (
                            <div className="absolute top-full mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl py-2 z-20">
                                {dashboards.map((dash, index) => ( <button key={dash.id} onClick={() => handleDashboardChange(index)} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700">{dash.name}</button> ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center space-x-2 sm:space-x-4">
                    <span className='text-sm text-gray-500 dark:text-gray-400 hidden md:block'>{user.email}</span>
                    <button onClick={() => setModalState({ type: 'adminSettings' })} title="Configurações" className="p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"><Settings size={20} /></button>
                    <button onClick={handleLogout} title="Sair" className="p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50"><LogOut size={20} /></button>
                    <button onClick={toggleTheme} title="Mudar Tema" className="p-2 rounded-full bg-gray-200 dark:bg-gray-700">{theme === 'light' ? <Moon size={20}/> : <Sun size={20}/>}</button>
                </div>
            </header>
            <main className="p-4 md:p-8 grid grid-cols-1 gap-8">
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1"><CalendarView /></div>
                    <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
                        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-lg text-center"><h3 className="font-semibold">Resumo Mensal</h3><p>Produção: {monthlySummary.totalProduction.toLocaleString('pt-BR')} un.</p><p>Meta: {monthlySummary.totalGoal.toLocaleString('pt-BR')} un.</p><p>Eficiência Média: {monthlySummary.averageEfficiency}%</p></div>
                        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-lg text-center"><h3 className="font-semibold">Resumo do Dia</h3><p>Produção: {summary.totalProduced.toLocaleString('pt-BR')} un.</p><p>Meta: {summary.totalGoal.toLocaleString('pt-BR')} un.</p><p>Eficiência Média: {summary.averageEfficiency}%</p></div>
                    </div>
                </section>
                <h2 className="text-2xl font-bold border-b-2 border-blue-500 pb-2">Resultados de: {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</h2>
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard title="Produção Acumulada (Dia)" value={summary.totalProduced.toLocaleString('pt-BR')} unit="un." />
                    <StatCard title="Meta Acumulada (Dia)" value={summary.totalGoal.toLocaleString('pt-BR')} unit="un." />
                    <StatCard title="Eficiência da Última Hora" value={summary.lastHourEfficiency} unit="%" isEfficiency />
                    <StatCard title="Média de Eficiência (Dia)" value={summary.averageEfficiency} unit="%" isEfficiency />
                </section>
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                        <h2 className="text-xl font-semibold mb-4">Produção vs. Meta por Hora</h2>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={processedData}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2}/>
                                <XAxis dataKey="period" /><YAxis />
                                <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#334155' : '#fff', border: 'none', borderRadius: '0.5rem' }} />
                                <Legend /><Bar dataKey="produced" fill="#3b82f6" name="Produzido" /><Bar dataKey="goal" fill="#818cf8" name="Meta" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                        <h2 className="text-xl font-semibold mb-4">Eficiência por Hora e Acumulada</h2>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={processedData}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2}/>
                                <XAxis dataKey="period" /><YAxis domain={[0, 'dataMax + 10']}/>
                                <Tooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#334155' : '#fff', border: 'none', borderRadius: '0.5rem' }} />
                                <Legend /><Line type="monotone" dataKey="efficiency" stroke="#10b981" name="Eficiência/h (%)" strokeWidth={2} /><Line type="monotone" dataKey="cumulativeEfficiency" stroke="#f97316" name="Eficiência Acumulada (%)" strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </section>
                <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><List className="mr-2 text-blue-500"/> Detalhamento por Período</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 dark:bg-gray-700"><tr>
                                <th className="p-3">Período</th><th className="p-3">Pessoas / Tempo</th><th>Meta</th><th className="p-3">Produção</th><th>Eficiência</th>
                                <th className="p-3">Meta Acum.</th><th className="p-3">Prod. Acum.</th><th className="p-3">Efic. Acum.</th>
                                <th className="p-3">Obs.</th><th className="p-3">Ações</th>
                            </tr></thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                {processedData.map((d) => (
                                    <tr key={d.id}>
                                        {editingEntryId === d.id ? (
                                            <>
                                                <td className="p-1"><input type="text" value={editingEntryData.period} onChange={(e) => handleEditingEntryChange('period', e.target.value)} className="w-20 p-1 rounded bg-gray-100 dark:bg-gray-600" /></td>
                                                <td className="p-1">
                                                    <div className="flex gap-2 items-center">
                                                        <div className="flex flex-col"><label className="text-xs text-gray-500 dark:text-gray-400">Pessoas</label><input type="number" value={editingEntryData.people} onChange={(e) => handleEditingEntryChange('people', e.target.value)} className="w-20 p-1 rounded bg-gray-100 dark:bg-gray-600"/></div>
                                                        <div className="flex flex-col"><label className="text-xs text-gray-500 dark:text-gray-400">Tempo (min)</label><input type="number" value={editingEntryData.availableTime} onChange={(e) => handleEditingEntryChange('availableTime', e.target.value)} className="w-20 p-1 rounded bg-gray-100 dark:bg-gray-600"/></div>
                                                    </div>
                                                </td>
                                                <td>...</td>
                                                <td className="p-1">
                                                    <div className="flex gap-1">
                                                        {editingEntryData.productionDetails.map((detail, index) => (<input key={index} type="number" value={detail.produced} onChange={(e) => handleEditingProductionChange(index, e.target.value)} className="w-16 p-1 rounded bg-gray-100 dark:bg-gray-600" placeholder={products.find(p=>p.id === detail.productId)?.name} />))}
                                                    </div>
                                                </td>
                                                <td>...</td><td>...</td><td>...</td><td>...</td><td>...</td>
                                                <td className="p-3 flex gap-2">
                                                    <button onClick={handleSaveEntryEdit} className="text-green-500 hover:text-green-400"><Save size={18}/></button>
                                                    <button onClick={handleCancelEditEntry} className="text-gray-500 hover:text-gray-400"><XCircle size={18}/></button>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="p-3">{d.period}</td>
                                                <td className="p-3 text-center">{`${d.people} / ${d.availableTime} min`}</td>
                                                <td>{d.goalForDisplay}</td>
                                                <td className="p-3">{d.producedForDisplay}</td>
                                                <td className={`font-semibold ${d.efficiency < 65 ? 'text-red-500' : 'text-green-600'}`}>{d.efficiency}%</td>
                                                <td>{d.cumulativeGoal}</td>
                                                <td>{d.cumulativeProduction}</td>
                                                <td className={`font-semibold ${d.cumulativeEfficiency < 65 ? 'text-red-500' : 'text-green-600'}`}>{d.cumulativeEfficiency}%</td>
                                                <td className="p-3"><button onClick={() => setModalState({ type: 'observation', data: d })} className="text-gray-500 hover:text-blue-500"><MessageSquare size={18}/></button></td>
                                                <td className="p-3 flex gap-2">
                                                    <button onClick={() => handleStartEditEntry(d)} className="text-gray-500 hover:text-yellow-500"><Edit size={18}/></button>
                                                    <button onClick={() => handleDeleteEntry(d.id, selectedDate.toISOString().slice(0, 10))} className="text-gray-500 hover:text-red-500"><Trash2 size={18}/></button>
                                                </td>
                                            </>
                                        )}
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
                            <div className="flex flex-col"><label>Período</label><input type="text" name="period" value={newEntry.period} onChange={handleInputChange} placeholder="ex: 12:00" required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <div className="flex flex-col"><label>Nº Pessoas</label><input type="number" name="people" value={newEntry.people} onChange={handleInputChange} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <div className="flex flex-col"><label>Tempo Disp.</label><input type="number" name="availableTime" value={newEntry.availableTime} onChange={handleInputChange} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <div className="flex flex-col"><label>Produto (Prioridade)</label>
                                <select name="productId" value={newEntry.productId} onChange={handleInputChange} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                    <option value="">Selecione...</option>
                                    {[...products].sort((a, b) => a.name.localeCompare(b.name)).map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                                </select>
                            </div>
                        </div>
                        <div className="mt-4">
                            <button type="button" onClick={() => setShowUrgent(prev => !prev)} className="text-sm text-blue-500 hover:underline mb-2 flex items-center gap-1">
                                <PlusCircle size={14} />{showUrgent ? 'Remover item fora de ordem' : 'Adicionar item fora de ordem'}
                            </button>
                            {showUrgent && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-blue-50 dark:bg-gray-800 rounded-lg">
                                    <div className="flex flex-col"><label>Lote Urgente</label>
                                        <select name="productId" value={urgentProduction.productId} onChange={handleUrgentChange} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                            <option value="">Selecione o lote...</option>
                                            {lots.filter(l=> l.status === 'ongoing' || l.status === 'future').map(l => (<option key={l.id} value={l.productId}>{l.productName}{l.customName ? ` - ${l.customName}` : ''}</option>))}
                                        </select>
                                    </div>
                                    <div className="flex flex-col"><label>Produzido (Urgente)</label><input type="number" name="produced" value={urgentProduction.produced} onChange={handleUrgentChange} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 items-end mt-4">
                            {predictedLots.filter(p => !p.isUrgent).map((lot, index) => (
                                <div key={lot.id || index} className="flex flex-col">
                                    <label className="text-sm truncate">Produzido ({lot.productName})</label>
                                    <input type="number" value={newEntry.productions[index] || ''} onChange={(e) => handleProductionChange(index, e.target.value)} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700" />
                                </div>
                            ))}
                            <div className="flex flex-col p-2 rounded-md bg-blue-50 dark:bg-gray-700 text-center"><label>Meta Prevista</label><span className="font-bold text-lg text-blue-600 dark:text-blue-400">{goalPreview || '0'}</span></div>
                            <button type="submit" className="h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 md:col-start-[-2]">Adicionar</button>
                        </div>
                    </form>
                </section>
                <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
                    <h2 className="text-xl font-semibold mb-4 flex items-center"><Layers className="mr-2 text-blue-500"/> Controle de Lotes de Produção</h2>
                    <div className="mb-6 border-b pb-6 dark:border-gray-700">
                        <h3 className="text-lg font-medium mb-4">Criar Novo Lote</h3>
                        <form onSubmit={handleAddLot} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                            <div className="flex flex-col"><label htmlFor="lotProduct" className="text-sm mb-1 text-gray-600 dark:text-gray-400">Produto</label>
                                <select id="lotProduct" value={newLot.productId} onChange={e => setNewLot({...newLot, productId: e.target.value})} required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                    <option value="">Selecione...</option>
                                    {[...products].sort((a, b) => a.name.localeCompare(b.name)).map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                                </select>
                            </div>
                            <div className="flex flex-col"><label htmlFor="lotTarget" className="text-sm mb-1 text-gray-600 dark:text-gray-400">Quantidade Total</label><input type="number" id="lotTarget" value={newLot.target} onChange={e => setNewLot({...newLot, target: e.target.value})} placeholder="ex: 1500" required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <div className="flex flex-col"><label htmlFor="lotCustomName" className="text-sm mb-1 text-gray-600 dark:text-gray-400">Nome do Lote (Opcional)</label><input type="text" id="lotCustomName" value={newLot.customName} onChange={e => setNewLot({...newLot, customName: e.target.value})} placeholder="ex: Lote 01" className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <button type="submit" className="h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Criar Lote</button>
                        </form>
                    </div>
                    <div className="flex gap-2 mb-4 border-b pb-2 dark:border-gray-700 flex-wrap">
                        <button onClick={() => setLotFilter('ongoing')} className={`px-3 py-1 text-sm rounded-full ${lotFilter==='ongoing' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>Em Andamento</button>
                        <button onClick={() => setLotFilter('completed')} className={`px-3 py-1 text-sm rounded-full ${lotFilter==='completed' ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}>Concluídos</button>
                    </div>
                    <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                        {filteredLots.map((lot, index, arr) => {
                            let lotBgClass = 'bg-gray-50 dark:bg-gray-700';
                            if (lot.status === 'completed') { lotBgClass = 'bg-green-100 dark:bg-green-900/50'; }
                            else if (lot.status === 'completed_missing' || lot.status === 'completed_exceeding') { lotBgClass = 'bg-gradient-to-r from-green-100 to-red-100 dark:from-green-900/50 dark:to-red-900/50'; }
                            return (
                                <div key={lot.id} className={`${lotBgClass} p-4 rounded-lg`}>
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-2">
                                            {(lot.status === 'ongoing' || lot.status === 'future') && (
                                                <div className="flex flex-col">
                                                    <button onClick={() => handleMoveLot(lot.id, 'up')} disabled={index === 0} className="disabled:opacity-20 disabled:cursor-not-allowed"><ChevronUp size={16}/></button>
                                                    <button onClick={() => handleMoveLot(lot.id, 'down')} disabled={index === arr.length - 1} className="disabled:opacity-20 disabled:cursor-not-allowed"><ChevronDown size={16}/></button>
                                                </div>
                                            )}
                                            <div>
                                                <h4 className="font-bold text-lg">{lot.productName}{lot.customName ? ` - ${lot.customName}` : ''}</h4>
                                                <p className="text-sm text-gray-500 dark:text-gray-400">Lote #{lot.sequentialId} | Prioridade: {index + 1}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <select value={lot.status} onChange={(e) => handleLotStatusChange(lot.id, e.target.value)} className="text-xs font-semibold p-1 rounded-full bg-gray-200 dark:bg-gray-600 border-none appearance-none text-center">
                                                { (lot.status === 'ongoing' || lot.status === 'future') ? ( <> <option value={lot.status}>{lot.status === 'future' ? 'Na Fila' : 'Em Andamento'}</option> <option value="completed">Concluir</option> <option value="completed_missing">Concluir com Falta</option> <option value="completed_exceeding">Concluir com Sobra</option> </> ) : ( <> <option value="completed">Concluído</option> <option value="completed_missing">Com Falta</option> <option value="completed_exceeding">Com Sobra</option> <option value="ongoing">Reabrir (Em Andamento)</option> </> )}
                                            </select>
                                            <div className="flex gap-2">
                                                <button onClick={() => setModalState({ type: 'lotObservation', data: lot })} className="text-gray-500 hover:text-blue-500"><MessageSquare size={18}/></button>
                                                <button onClick={() => handleStartEditLot(lot)} className="text-gray-500 hover:text-yellow-500"><Edit size={18}/></button>
                                                <button onClick={() => handleDeleteLot(lot.id)} className="text-gray-500 hover:text-red-500"><Trash2 size={18}/></button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-2">
                                        <div className="flex justify-between text-sm mb-1 items-center">
                                            <span>Progresso</span>
                                            {editingLotId === lot.id ? (
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span>{lot.produced || 0} / </span>
                                                    <input type="number" value={editingLotData.target} onChange={e => setEditingLotData({...editingLotData, target: e.target.value})} className="p-1 text-sm rounded-md bg-white dark:bg-gray-600 w-24 text-right"/>
                                                    <input type="text" placeholder="Nome do Lote" value={editingLotData.customName} onChange={e => setEditingLotData({...editingLotData, customName: e.target.value})} className="p-1 text-sm rounded-md bg-white dark:bg-gray-600 w-32"/>
                                                    <button onClick={() => handleSaveLotEdit(lot.id)} className="text-green-500 hover:text-green-400"><Save size={16}/></button>
                                                    <button onClick={() => setEditingLotId(null)} className="text-gray-500 hover:text-gray-400"><XCircle size={16}/></button>
                                                </div>
                                            ) : ( <span>{lot.produced || 0} / {(lot.target || 0).toLocaleString('pt-BR')}</span> )}
                                        </div>
                                        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2.5">
                                            <div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${((lot.produced||0)/(lot.target || 1))*100}%`}}></div>
                                        </div>
                                    </div>
                                </div>
                            )})}
                    </div>
                </section>
                <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <h2 className="text-xl font-semibold mb-4 flex items-center"><Package className="mr-2 text-blue-500"/> Cadastrar Novo Produto</h2>
                        <form onSubmit={handleAddProduct} className="space-y-4">
                            <div className="flex flex-col"><label>Nome do Produto</label><input type="text" name="name" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} placeholder="ex: Peça X-15" required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <div className="flex flex-col"><label>Tempo Padrão (minutos)</label><input type="number" step="0.01" name="standardTime" value={newProduct.standardTime} onChange={e => setNewProduct({...newProduct, standardTime: e.target.value})} placeholder="ex: 1.25" required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/></div>
                            <button type="submit" className="w-full h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Salvar Produto</button>
                        </form>
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold mb-4 flex items-center"><List className="mr-2 text-blue-500"/> Produtos Cadastrados</h2>
                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2">
                            {[...products].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                <div key={p.id} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg flex items-center justify-between">
                                    {editingProductId === p.id ? (
                                        <>
                                            <input type="text" value={editingProductData.name} onChange={e => setEditingProductData({...editingProductData, name: e.target.value})} className="p-1 rounded-md bg-white dark:bg-gray-600 w-2/5"/>
                                            <input type="number" step="0.01" value={editingProductData.standardTime} onChange={e => setEditingProductData({...editingProductData, standardTime: e.target.value})} className="p-1 rounded-md bg-white dark:bg-gray-600 w-1/4"/>
                                            <div className="flex gap-2">
                                                <button onClick={() => handleSaveProduct(p.id)} className="text-green-500 hover:text-green-400"><Save size={18}/></button>
                                                <button onClick={() => setEditingProductId(null)} className="text-gray-500 hover:text-gray-400"><XCircle size={18}/></button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div><span className="font-semibold">{p.name}</span><span className="text-sm text-gray-500 dark:text-gray-400 ml-2">({p.standardTime} min)</span></div>
                                            <div className="flex gap-2">
                                                <button onClick={() => handleStartEditProduct(p)} className="text-gray-500 hover:text-yellow-500"><Edit size={18}/></button>
                                                <button onClick={() => handleDeleteProduct(p.id)} className="text-gray-500 hover:text-red-500"><Trash2 size={18}/></button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
                
                <section className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg mt-8">
                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                        <Trash2 className="mr-2 text-red-500"/> Lixeira
                    </h2>
                    <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                        {trashItems.length === 0 && (
                            <p className="text-gray-500">Nenhum item na lixeira.</p>
                        )}
                        {trashItems.map(item => (
                            <div key={item.id} className="p-4 bg-red-50 dark:bg-red-900/30 rounded-lg">
                                <h4 className="font-bold">{item.itemType} (deletado por {item.deletedByEmail})</h4>
                                <p><strong>Data:</strong> {new Date(item.deletedAt).toLocaleString('pt-BR')}</p>
                                <p><strong>Motivo:</strong> {item.reason}</p>
                                <pre className="text-xs mt-2 bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                                    {JSON.stringify(item.originalDoc, null, 2)}
                                </pre>
                            </div>
                        ))}
                    </div>
                </section>

            </main>
        </div>
    );
};

// Componente Raiz que gerencia a autenticação
const App = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);
    if (loading) {
        return <div className="min-h-screen bg-gray-100 dark:bg-black flex justify-center items-center"><p>Carregando...</p></div>;
    }
    return user ? <CronoanaliseDashboard user={user} /> : <AuthScreen />;
};

export default App;

