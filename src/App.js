import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Sun, Moon, PlusCircle, Package, List, Edit, Trash2, Save, XCircle, ChevronLeft, ChevronRight, MessageSquare, Layers, ChevronUp, ChevronDown, LogOut, Eye, EyeOff } from 'lucide-react';

// Importações do Firebase
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged
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
    getDoc
} from 'firebase/firestore';

// --- Configuração do Firebase ---
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAmt7kVZUO3J_KxWXH5GuWjIZ5BYu7HD98",
  authDomain: "quadrodeproducao.firebaseapp.com",
  projectId: "quadrodeproducao",
  storageBucket: "quadrodeproducao.firebasestorage.app",
  messagingSenderId: "1043513785567",
  appId: "1:1043513785567:web:083ab6a94b239cca3cbd6a",
  measurementId: "G-9XDEKDPCK9"
};

// Inicialização dos serviços do Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = firebaseConfig.projectId; // Usamos o Project ID para consistência

// --- COMPONENTES MODAIS ---

const ObservationModal = ({ isOpen, onClose, entry, onSave }) => {
    const [observation, setObservation] = useState('');
    useEffect(() => { if (entry) setObservation(entry.observation); }, [entry]);
    if (!isOpen) return null;
    const handleSave = () => { onSave(entry.id, observation); onClose(); };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Observação do Período ({entry.period})</h2><button onClick={onClose}><XCircle /></button></div>
                <textarea value={observation} onChange={e => setObservation(e.target.value)} rows="4" className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"></textarea>
                <button onClick={handleSave} className="w-full h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Salvar</button>
            </div>
        </div>
    );
};

const LotObservationModal = ({ isOpen, onClose, lot, onSave }) => {
    const [observation, setObservation] = useState('');
    useEffect(() => { if (lot) setObservation(lot.observation); }, [lot]);
    if (!isOpen) return null;
    const handleSave = () => { onSave(lot.id, observation); onClose(); };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Observação do Lote ({lot.productName} #{lot.sequentialId})</h2><button onClick={onClose}><XCircle /></button></div>
                <textarea value={observation} onChange={e => setObservation(e.target.value)} rows="4" className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4"></textarea>
                <button onClick={handleSave} className="w-full h-10 px-6 font-semibold rounded-md bg-green-500 text-white hover:bg-green-600">Salvar</button>
            </div>
        </div>
    );
};

const PasswordModal = ({ isOpen, onClose, onConfirm }) => {
    const [passwordInput, setPasswordInput] = useState('');
    if (!isOpen) return null;
    const handleConfirm = () => {
        // Esta senha ainda está fixa. Para produção, considere um sistema de gerenciamento de senhas mais robusto.
        if (passwordInput === '07060887') { onConfirm(); } 
        else { alert('Senha incorreta!'); }
        setPasswordInput('');
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">Confirmação de Senha</h2><button onClick={onClose}><XCircle /></button></div>
                <div>
                    <p className="mb-4">Para continuar, por favor insira a senha de administrador.</p>
                    <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full p-2 rounded-md bg-gray-100 dark:bg-gray-700 mb-4" />
                    <button onClick={handleConfirm} className="w-full h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">Confirmar</button>
                </div>
            </div>
        </div>
    );
};

// --- TELA DE AUTENTICAÇÃO ---
const AuthScreen = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const handleAuth = async (e) => {
        e.preventDefault();
        setError('');
        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (err) {
            switch (err.code) {
                case 'auth/user-not-found':
                    setError('Nenhum usuário encontrado com este email.');
                    break;
                case 'auth/wrong-password':
                    setError('Senha incorreta.');
                    break;
                case 'auth/email-already-in-use':
                    setError('Este email já está sendo utilizado.');
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
                 <div className="flex justify-center items-center gap-4 mb-8">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white tracking-wider">QUADRO DE PRODUÇÃO</h1>
                </div>
                <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-2xl">
                    <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-white mb-6">
                        {isLogin ? 'Acessar Painel' : 'Criar Conta'}
                    </h2>
                    <form onSubmit={handleAuth} className="space-y-6">
                        <div>
                            <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Email</label>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1 w-full p-3 rounded-md bg-gray-100 dark:bg-gray-800 border-transparent focus:border-blue-500 focus:ring-0" />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Senha</label>
                             <div className="relative">
                                <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required className="mt-1 w-full p-3 rounded-md bg-gray-100 dark:bg-gray-800 border-transparent focus:border-blue-500 focus:ring-0" />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500">
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                        </div>
                        {error && <p className="text-sm text-red-500 text-center">{error}</p>}
                        <button type="submit" className="w-full h-12 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                            {isLogin ? 'Entrar' : 'Criar Conta'}
                        </button>
                    </form>
                    <div className="mt-6 text-center">
                        <button onClick={() => setIsLogin(!isLogin)} className="text-sm text-blue-500 hover:underline">
                            {isLogin ? 'Não tem uma conta? Crie uma agora' : 'Já tem uma conta? Faça login'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- COMPONENTE PRINCIPAL DO DASHBOARD ---
const CronoanaliseDashboard = ({ user }) => {
  const [theme, setTheme] = useState('light');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarView, setCalendarView] = useState('day');

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
  const [modalState, setModalState] = useState({ type: null, data: null, callback: null });
  
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editingEntryData, setEditingEntryData] = useState(null);

  const [showUrgent, setShowUrgent] = useState(false);
  const [urgentProduction, setUrgentProduction] = useState({productId: '', produced: ''});

  // --- Lógica de Carregamento de Dados do Firebase ---
  useEffect(() => {
    // Carregar Produtos
    const productsQuery = query(collection(db, 'artifacts', appId, 'public/data/products'));
    const unsubscribeProducts = onSnapshot(productsQuery, (snapshot) => {
        const productsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setProducts(productsData);
    });

    // Carregar Lotes
    const lotsQuery = query(collection(db, 'artifacts', appId, 'public/data/lots'));
    const unsubscribeLots = onSnapshot(lotsQuery, (snapshot) => {
        const lotsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setLots(lotsData);
        if (lotsData.length > 0) {
            const maxId = Math.max(...lotsData.map(l => l.sequentialId || 0));
            setLotCounter(maxId + 1);
        } else {
            setLotCounter(1);
        }
    });

    return () => {
        unsubscribeProducts();
        unsubscribeLots();
    };
}, []);

// Carregar Dados de Produção para o dia selecionado
useEffect(() => {
    const dateKey = selectedDate.toISOString().slice(0, 10);
    const productionDocRef = doc(db, 'artifacts', appId, 'public/data/productionData', dateKey);
    const unsubscribeProduction = onSnapshot(productionDocRef, (doc) => {
        const entries = doc.exists() ? doc.data().entries : [];
        setProductionData(prev => ({ ...prev, [dateKey]: entries }));
    });

    return () => unsubscribeProduction();
}, [selectedDate]);


const handleLogout = () => {
    signOut(auth);
};
 
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  // Efeito para pré-selecionar o produto do primeiro lote da fila
  useEffect(() => {
    if (editingEntryId) return; // Não muda a seleção durante a edição de uma entrada
    const firstActiveLot = lots
        .filter(l => l.status === 'ongoing' || l.status === 'future')
        .sort((a, b) => a.order - b.order)[0];

    const isCurrentSelectionValidAndActive = lots.some(l => l.productId === newEntry.productId && (l.status === 'ongoing' || l.status === 'future'));

    if (firstActiveLot && !isCurrentSelectionValidAndActive) {
      setNewEntry(prev => ({ ...prev, productId: firstActiveLot.productId }));
    } else if (!firstActiveLot && !isCurrentSelectionValidAndActive) {
      // Limpa a seleção se não houver lotes ativos
      setNewEntry(prev => ({...prev, productId: ''}));
    }
  }, [lots, editingEntryId, newEntry.productId]);
 
  // Efeito para calcular a meta prevista dinâmica
  useEffect(() => {
    // 1. Calculate time consumed by urgent item
    let timeConsumedByUrgent = 0;
    let urgentPrediction = null;

    if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) {
        const urgentProduct = products.find(p => p.id === urgentProduction.productId);
        if (urgentProduct) {
            timeConsumedByUrgent = urgentProduct.standardTime * urgentProduction.produced;
            const urgentLot = lots.find(l => l.productId === urgentProduct.id);
            urgentPrediction = {
                ...(urgentLot || {}),
                productId: urgentProduct.id,
                productName: urgentProduct.name,
                producible: parseInt(urgentProduction.produced, 10),
                isUrgent: true
            };
        }
    }

    // 2. Calculate remaining time for normal prediction
    const totalAvailableMinutes = (newEntry.availableTime || 0) * (newEntry.people || 0);
    const remainingTime = totalAvailableMinutes - timeConsumedByUrgent;

    let normalPredictions = [];
    if (remainingTime > 0) {
        const selectedProduct = products.find(p => p.id === newEntry.productId);
        if (selectedProduct) {
            const activeLots = lots
                .filter(l => l.status === 'ongoing' || l.status === 'future')
                .sort((a, b) => a.order - b.order);
            const startIndex = activeLots.findIndex(l => l.productId === newEntry.productId);

            if (startIndex === -1) {
                if (selectedProduct.standardTime > 0) {
                    const possiblePieces = Math.floor(remainingTime / selectedProduct.standardTime);
                    normalPredictions.push({
                        id: `nolot-${selectedProduct.id}`,
                        productId: selectedProduct.id,
                        productName: selectedProduct.name,
                        producible: possiblePieces
                    });
                }
            } else {
                let timeForNormal = remainingTime;
                for (let i = startIndex; i < activeLots.length; i++) {
                    if (timeForNormal <= 0) break;
                    const lot = activeLots[i];
                    const productForLot = products.find(p => p.id === lot.productId);

                    if (productForLot && productForLot.standardTime > 0) {
                        const remainingPiecesInLot = Math.max(0, lot.target - lot.produced);
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
    setNewEntry(prev => ({
      ...prev,
      productions: Array(normalPredictions.length).fill('')
    }));

  }, [newEntry.availableTime, newEntry.people, newEntry.productId, products, lots, urgentProduction, showUrgent]);

  const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'));

  const dailyProductionData = useMemo(() => {
    const dateKey = selectedDate.toISOString().slice(0, 10);
    return productionData[dateKey] || [];
  }, [selectedDate, productionData]);

  const processedData = useMemo(() => {
    let cumulativeProduction = 0;
    let cumulativeGoal = 0;
    let cumulativeEfficiencySum = 0;
   
    const sortedData = [...dailyProductionData].sort((a, b) => a.period.localeCompare(b.period));

    return sortedData.map((item, index) => {
        let totalTimeValue = 0;
        let totalProducedInPeriod = 0;

        item.productionDetails.forEach(detail => {
            const product = products.find(p => p.id === detail.productId);
            if (product) {
                totalTimeValue += detail.produced * product.standardTime;
                totalProducedInPeriod += detail.produced;
            }
        });

        const totalAvailableTime = item.people * item.availableTime;
        const efficiency = totalAvailableTime > 0 ? parseFloat(((totalTimeValue / totalAvailableTime) * 100).toFixed(2)) : 0;
       
        let goalForDisplay;
        let producedForDisplay;
        let numericGoal;
       
        producedForDisplay = item.productionDetails.map(d => d.produced).join(' / ');

        if (item.goalDisplay) {
            goalForDisplay = item.goalDisplay;
            numericGoal = item.goalDisplay.split(' / ').reduce((acc, val) => acc + (parseInt(val.trim(), 10) || 0), 0);
        } else {
            const firstProduct = products.find(p => p.id === item.productionDetails[0]?.productId);
            numericGoal = firstProduct?.standardTime > 0 ? Math.round(totalAvailableTime / firstProduct.standardTime) : 0;
            goalForDisplay = numericGoal;
        }


        cumulativeProduction += totalProducedInPeriod;
        cumulativeGoal += numericGoal;
        cumulativeEfficiencySum += efficiency;
        const cumulativeEfficiency = parseFloat((cumulativeEfficiencySum / (index + 1)).toFixed(2));

        return { 
            ...item, 
            produced: totalProducedInPeriod, 
            goal: numericGoal,
            goalForDisplay,
            producedForDisplay,
            efficiency, 
            cumulativeProduction, 
            cumulativeGoal, 
            cumulativeEfficiency 
        };
    });
  }, [dailyProductionData, products]);
 
  const summary = useMemo(() => {
    if (processedData.length === 0) return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
    const lastEntry = processedData[processedData.length - 1];
    return {
      totalProduced: lastEntry.cumulativeProduction,
      totalGoal: lastEntry.cumulativeGoal,
      lastHourEfficiency: lastEntry.efficiency,
      averageEfficiency: lastEntry.cumulativeEfficiency,
    };
  }, [processedData]);
 
    const monthlySummary = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        let totalMonthlyProduction = 0;
        let totalMonthlyGoal = 0;
        let totalDailyAverageEfficiencies = 0;
        let productiveDaysCount = 0;

        // Itera sobre as chaves de productionData para encontrar dias produtivos
        Object.keys(productionData).forEach(dateKey => {
            const date = new Date(dateKey);
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

                        item.productionDetails.forEach(detail => {
                            periodProduction += detail.produced;
                            const product = products.find(p => p.id === detail.productId);
                            if (product) totalTimeValue += detail.produced * product.standardTime;
                        });
                    
                        if (item.goalDisplay) {
                            dailyGoal += item.goalDisplay.split(' / ').reduce((acc, val) => acc + (parseInt(val.trim(), 10) || 0), 0);
                        } else {
                            const firstProduct = products.find(p => p.id === item.productionDetails[0]?.productId);
                             if(firstProduct?.standardTime > 0) {
                                dailyGoal += Math.round((item.people * item.availableTime) / firstProduct.standardTime);
                            }
                        }

                        dailyProduction += periodProduction;

                        const totalAvailableTime = item.people * item.availableTime;
                        const periodEfficiency = totalAvailableTime > 0 ? (totalTimeValue / totalAvailableTime) * 100 : 0;
                        dailyEfficiencySum += periodEfficiency;
                    });
                
                    const dailyAverageEfficiency = dayData.length > 0 ? dailyEfficiencySum / dayData.length : 0;
                    totalDailyAverageEfficiencies += dailyAverageEfficiency;

                    totalMonthlyProduction += dailyProduction;
                    totalMonthlyGoal += dailyGoal;
                }
            }
        });


        const averageMonthlyEfficiency = productiveDaysCount > 0 ? parseFloat((totalDailyAverageEfficiencies / productiveDaysCount).toFixed(2)) : 0;

        return {
            totalProduction: totalMonthlyProduction,
            totalGoal: totalMonthlyGoal,
            averageEfficiency: averageMonthlyEfficiency,
        };
    }, [productionData, currentMonth, products]);

    const filteredLots = useMemo(() => {
        const sorted = [...lots].sort((a, b) => a.order - b.order);
        if (lotFilter === 'ongoing') {
            return sorted.filter(lot => lot.status === 'ongoing' || lot.status === 'future');
        }
        if (lotFilter === 'completed') {
            return sorted.filter(lot => lot.status.startsWith('completed'));
        }
        return [];
    }, [lots, lotFilter]);

  const handleAddEntry = async (e) => {
    e.preventDefault();
    const productionDetails = [];
    if (showUrgent && urgentProduction.productId && urgentProduction.produced > 0) {
        productionDetails.push({ productId: parseInt(urgentProduction.productId), produced: parseInt(urgentProduction.produced, 10) });
    }
    const normalPredictedLots = predictedLots.filter(p => !p.isUrgent);
    newEntry.productions.forEach((produced, index) => {
        const lot = normalPredictedLots[index];
        const producedAmount = parseInt(produced, 10) || 0;
        if (lot && producedAmount > 0) { productionDetails.push({ productId: lot.productId, produced: producedAmount }); }
    });
    if (productionDetails.length === 0) { alert("Nenhuma produção foi inserida."); return; }

    const newEntryWithId = { 
        id: Date.now().toString(), 
        period: newEntry.period, people: newEntry.people, availableTime: newEntry.availableTime,
        productionDetails, observation: '', goalDisplay: goalPreview, primaryProductId: newEntry.productId,
    };

    const dateKey = selectedDate.toISOString().slice(0, 10);
    const dayDocRef = doc(db, 'artifacts', appId, 'public/data/productionData', dateKey);
    const dayDoc = await getDoc(dayDocRef);
    const currentEntries = dayDoc.exists() ? dayDoc.data().entries : [];
    
    const batch = writeBatch(db);
    batch.set(dayDocRef, { entries: [...currentEntries, newEntryWithId] }, { merge: true });

    productionDetails.forEach(detail => {
        const lotToUpdate = lots.find(l => l.productId === detail.productId);
        if (lotToUpdate) {
            const lotRef = doc(db, 'artifacts', appId, 'public/data/lots', lotToUpdate.id);
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
        setNewEntry(prev => ({ ...prev, productId: value ? parseInt(value, 10) : '', productions: [] }));
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
    const newProductData = { 
        ...newProduct, 
        standardTime: parseFloat(newProduct.standardTime) 
    };
    const docRef = doc(collection(db, 'artifacts', appId, 'public/data/products'));
    await setDoc(docRef, newProductData);
    setNewProduct({ name: '', standardTime: '' });
  };

  const handleStartEditProduct = (product) => {
      setEditingProductId(product.id);
      setEditingProductData({ name: product.name, standardTime: product.standardTime });
  };
 
  const handleSaveProduct = async (id) => {
    const productRef = doc(db, 'artifacts', appId, 'public/data/products', id);
    await updateDoc(productRef, { 
        ...editingProductData, 
        standardTime: parseFloat(editingProductData.standardTime) 
    });
    setEditingProductId(null);
  };
 
  const handleDeleteProduct = async (id) => {
    if(window.confirm("Tem certeza?")) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public/data/products', id));
    }
  };
 
  const handleDeleteEntry = async (entryId, dateKey) => {
      const dayDocRef = doc(db, 'artifacts', appId, 'public/data/productionData', dateKey);
      const dayDoc = await getDoc(dayDocRef);
      if (!dayDoc.exists()) return;
      
      const entries = dayDoc.data().entries || [];
      const entryToDelete = entries.find(e => e.id === entryId);
      if (!entryToDelete) return;
      
      const batch = writeBatch(db);
      
      entryToDelete.productionDetails.forEach(detail => {
          const lotToUpdate = lots.find(l => l.productId === detail.productId);
          if (lotToUpdate) {
              const lotRef = doc(db, 'artifacts', appId, 'public/data/lots', lotToUpdate.id);
              const newProduced = Math.max(0, (lotToUpdate.produced || 0) - detail.produced);
              const newStatus = (lotToUpdate.produced >= lotToUpdate.target && newProduced < lotToUpdate.target) ? 'ongoing' : lotToUpdate.status;
              batch.update(lotRef, { produced: newProduced, status: newStatus });
          }
      });
      
      const updatedEntries = entries.filter(e => e.id !== entryId);
      batch.set(dayDocRef, { entries: updatedEntries });
      
      await batch.commit();
  };

  const handleSaveObservation = async (entryId, observation) => {
      const dateKey = selectedDate.toISOString().slice(0, 10);
      const dayDocRef = doc(db, 'artifacts', appId, 'public/data/productionData', dateKey);
      const dayDoc = await getDoc(dayDocRef);
      if (dayDoc.exists()) {
          const updatedEntries = dayDoc.data().entries.map(e => e.id === entryId ? { ...e, observation } : e);
          await setDoc(dayDocRef, { entries: updatedEntries });
      }
  };

  const handleSaveLotObservation = async (lotId, observation) => {
    await updateDoc(doc(db, 'artifacts', appId, 'public/data/lots', lotId), { observation });
  };
 
    const handleAddLot = async (e) => {
        e.preventDefault();
        if (!newLot.productId || !newLot.target) { alert("Selecione um produto e insira a quantidade."); return; }
        const product = products.find(p => p.id === newLot.productId);
        if (!product) return;

        const docRef = doc(collection(db, 'artifacts', appId, 'public/data/lots'));
        await setDoc(docRef, {
            sequentialId: lotCounter,
            productId: product.id,
            productName: product.name,
            customName: newLot.customName,
            target: parseInt(newLot.target, 10),
            produced: 0,
            status: 'future',
            order: Date.now(),
            observation: '',
            startDate: null,
            endDate: null,
        });

        setNewLot({ productId: '', target: '', customName: '' });
    };

    const handleDeleteLot = async (lotId) => {
        await deleteDoc(doc(db, 'artifacts', appId, 'public/data/lots', lotId));
    };

    const handleStartEditLot = (lot) => {
        setEditingLotId(lot.id);
        setEditingLotData({ target: lot.target, customName: lot.customName });
    };

    const handleSaveLotEdit = async (lotId) => {
        const lotRef = doc(db, 'artifacts', appId, 'public/data/lots', lotId);
        const lot = lots.find(l => l.id === lotId);
        const newTarget = parseInt(editingLotData.target, 10);
        
        let newStatus = lot.status;
        if (lot.produced >= newTarget) {
            if (!lot.status.startsWith('completed')) newStatus = 'completed';
        } else {
            if (lot.status.startsWith('completed')) newStatus = 'ongoing';
        }

        await updateDoc(lotRef, { 
            target: newTarget, 
            customName: editingLotData.customName,
            status: newStatus 
        });
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
            batch.update(doc(db, 'artifacts', appId, 'public/data/lots', currentLot.id), { order: swapLot.order });
            batch.update(doc(db, 'artifacts', appId, 'public/data/lots', swapLot.id), { order: currentLot.order });
            await batch.commit();
        }
    };

    const handleLotStatusChange = async (lotId, newStatus) => {
        await updateDoc(doc(db, 'artifacts', appId, 'public/data/lots', lotId), { status: newStatus });
    };

    const recalculatePredictions = (entryData, allProducts, allLots, originalEntry = null) => {
        const totalAvailableMinutes = (entryData.people || 0) * (entryData.availableTime || 0);
        if (totalAvailableMinutes <= 0) return [];
    
        const lotsBeforeEntry = originalEntry 
            ? allLots.map(lot => {
                const originalDetail = originalEntry.productionDetails.find(d => d.productId === lot.productId);
                if (originalDetail) {
                    return { ...lot, produced: Math.max(0, lot.produced - originalDetail.produced) };
                }
                return { ...lot };
            })
            : allLots.map(l => ({...l}));
    
        const activeLots = lotsBeforeEntry.filter(l => l.status === 'ongoing' || l.status === 'future').sort((a, b) => a.order - b.order);
        
        const primaryProductId = entryData.primaryProductId || (activeLots[0] ? activeLots[0].productId : null);
        let primaryLotIndex = activeLots.findIndex(l => l.productId === primaryProductId);
        if (primaryLotIndex === -1 && activeLots.length > 0) primaryLotIndex = 0;

    
        let timeConsumed = 0;
        const predictions = [];
        
        (entryData.productionDetails || []).forEach(detail => {
            const lotIndex = activeLots.findIndex(l => l.productId === detail.productId);
            if (lotIndex < primaryLotIndex || (lotIndex === -1 && detail.productId !== primaryProductId)) {
                const product = allProducts.find(p => p.id === detail.productId);
                if (product) {
                    timeConsumed += (detail.produced || 0) * product.standardTime;
                    predictions.push({ productId: detail.productId, productName: product.name, producible: detail.produced });
                }
            }
        });
    
        let remainingTime = totalAvailableMinutes - timeConsumed;
    
        if (remainingTime > 0 && primaryLotIndex !== -1) {
            (entryData.productionDetails || []).forEach(detail => {
                const lotIndex = activeLots.findIndex(l => l.productId === detail.productId);
                if (lotIndex >= primaryLotIndex) {
                    const product = allProducts.find(p => p.id === detail.productId);
                    if (product) {
                        const producao = detail.produced || 0;
                        timeConsumed += producao * product.standardTime;
                        
                        const existingPrediction = predictions.find(p => p.productId === detail.productId);
                        if(existingPrediction) { existingPrediction.producible = producao; } 
                        else { predictions.push({ productId: detail.productId, productName: product.name, producible: producao }); }
                    }
                }
            });
            remainingTime = totalAvailableMinutes - timeConsumed;

            for (let i = primaryLotIndex; i < activeLots.length; i++) {
                if (remainingTime <= 0) break;
                const lot = activeLots[i];
                const product = allProducts.find(p => p.id === lot.productId);

                if (product && product.standardTime > 0) {
                    const alreadyProducedInEntry = (entryData.productionDetails.find(d => d.productId === lot.productId) || {}).produced || 0;
                    const originalProducedInEntry = (originalEntry?.productionDetails.find(d=>d.productId === lot.productId)?.produced || 0);
                    const remainingInLot = lot.target - (lot.produced - originalProducedInEntry + alreadyProducedInEntry);
                    
                    const producible = Math.min(Math.max(0, remainingInLot), Math.floor(remainingTime / product.standardTime));

                    if (producible > 0) {
                         const existingPrediction = predictions.find(p => p.productId === lot.productId);
                         if(existingPrediction) { existingPrediction.producible += producible; } 
                         else { predictions.push({ productId: lot.productId, productName: product.name, producible }); }
                        remainingTime -= producible * product.standardTime;
                    }
                }
            }
        }
    
        return predictions;
    };
    
    // --- Funções de Edição de Lançamento ---
    const handleStartEditEntry = (entry) => {
        setEditingEntryId(entry.id);
        setEditingEntryData({ ...entry });
    };

    const handleCancelEditEntry = () => {
        setEditingEntryId(null);
        setEditingEntryData(null);
    };

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
        const dayDocRef = doc(db, 'artifacts', appId, 'public/data/productionData', dateKey);
        const dayDoc = await getDoc(dayDocRef);
        const originalEntries = dayDoc.exists() ? dayDoc.data().entries : [];
        const originalEntry = originalEntries.find(e => e.id === editingEntryId);

        const predictions = recalculatePredictions(editingEntryData, products, lots, originalEntry);
        const newGoalDisplay = predictions.map(p => p.producible).join(' / ') || '0';
        
        const finalEntryData = { 
            ...editingEntryData, 
            goalDisplay: newGoalDisplay,
            productionDetails: editingEntryData.productionDetails.filter(d => d.produced > 0)
        };

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
                const lotToUpdate = lots.find(l => l.productId === parseInt(productId));
                if (lotToUpdate) {
                    const lotRef = doc(db, 'artifacts', appId, 'public/data/lots', lotToUpdate.id);
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


  const closeModal = () => setModalState({ type: null, data: null, callback: null });

  const StatCard = ({ title, value, unit = '', isEfficiency = false }) => {
    const valueColor = isEfficiency 
        ? (value < 65 ? 'text-red-500' : 'text-green-600') 
        : 'text-gray-800 dark:text-white';

    return (
        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg">
            <h3 className="text-lg font-medium text-gray-500 dark:text-gray-400">{title}</h3>
            <p className={`text-4xl font-bold ${valueColor} mt-2`}>
                {value}<span className="text-2xl ml-2">{unit}</span>
            </p>
        </div>
    );
  };
 
  const CalendarView = () => {
    const handleNavigation = (offset) => {
        if (calendarView === 'day') {
            setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
        } else if (calendarView === 'month') {
            setCurrentMonth(prev => new Date(prev.getFullYear() + offset, prev.getMonth(), 1));
        } else if (calendarView === 'year') {
            setCurrentMonth(prev => new Date(prev.getFullYear() + offset * 10, prev.getMonth(), 1));
        }
    };

    const handleHeaderClick = () => {
        if (calendarView === 'day') setCalendarView('month');
        if (calendarView === 'month') setCalendarView('year');
    };

    const handleMonthSelect = (monthIndex) => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), monthIndex, 1));
        setCalendarView('day');
    };
   
    const handleYearSelect = (year) => {
        setCurrentMonth(new Date(year, currentMonth.getMonth(), 1));
        setCalendarView('month');
    };

    const renderHeader = () => {
        let text = '';
        if (calendarView === 'day') text = currentMonth.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        else if (calendarView === 'month') text = currentMonth.getFullYear();
        else {
            const startYear = Math.floor(currentMonth.getFullYear() / 10) * 10;
            text = `${startYear} - ${startYear + 9}`;
        }
        return <button onClick={handleHeaderClick} className="text-xl font-semibold hover:text-blue-500">{text}</button>;
    };

    const renderDayView = () => {
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        const startDate = new Date(startOfMonth);
        startDate.setDate(startDate.getDate() - startOfMonth.getDay());
        const days = Array.from({ length: 42 }, (_, i) => {
            const day = new Date(startDate);
            day.setDate(day.getDate() + i);
            return day;
        });
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
        return (
            <div className="grid grid-cols-4 gap-2 text-center">
                {months.map((month, i) => (
                    <button key={month} onClick={() => handleMonthSelect(i)} className="p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">{month}</button>
                ))}
            </div>
        );
    };

    const renderYearView = () => {
        const startYear = Math.floor(currentMonth.getFullYear() / 10) * 10;
        const years = Array.from({ length: 10 }, (_, i) => startYear + i);
        return (
             <div className="grid grid-cols-4 gap-2 text-center">
                 {years.map(year => (
                     <button key={year} onClick={() => handleYearSelect(year)} className="p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">{year}</button>
                 ))}
            </div>
        );
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
 
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 font-sans">
      <ObservationModal isOpen={modalState.type === 'observation'} onClose={closeModal} entry={modalState.data} onSave={handleSaveObservation} />
      <LotObservationModal isOpen={modalState.type === 'lotObservation'} onClose={closeModal} lot={modalState.data} onSave={handleSaveLotObservation} />
      <PasswordModal isOpen={modalState.type === 'password'} onClose={closeModal} onConfirm={() => { modalState.callback(); closeModal(); }} />
     
      <header className="bg-white dark:bg-gray-900 shadow-md p-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-4"><h1 className="text-2xl font-bold text-gray-800 dark:text-white tracking-wider">QUADRO DE PRODUÇÃO</h1></div>
        <div className="flex items-center space-x-4">
            <span className='text-sm text-gray-500 dark:text-gray-400 hidden sm:block'>{user.email}</span>
            <button onClick={handleLogout} title="Sair" className="p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50">
                <LogOut size={20} />
            </button>
            <button onClick={toggleTheme} title="Mudar Tema" className="p-2 rounded-full bg-gray-200 dark:bg-gray-700">{theme === 'light' ? <Moon size={20}/> : <Sun size={20}/>}</button>
        </div>
      </header>

      <main className="p-4 md:p-8 grid grid-cols-1 gap-8">
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1"><CalendarView /></div>
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
                <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-lg text-center"><h3 className="font-semibold">Resumo Semanal</h3><p className="text-gray-400 text-sm mt-2">Em breve</p></div>
                <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-lg text-center"><h3 className="font-semibold">Resumo Mensal</h3><p className="text-gray-400 text-sm mt-2">Em breve</p></div>
            </div>
        </section>

        <h2 className="text-2xl font-bold border-b-2 border-blue-500 pb-2">Resultados de: {selectedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</h2>
       
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Produção Acumulada (Mês)" value={monthlySummary.totalProduction.toLocaleString('pt-BR')} unit="un." />
          <StatCard title="Meta Acumulada (Mês)" value={monthlySummary.totalGoal.toLocaleString('pt-BR')} unit="un." />
          <StatCard title="Eficiência da Última Hora (Dia)" value={summary.lastHourEfficiency} unit="%" isEfficiency />
          <StatCard title="Média de Eficiência (Mês)" value={monthlySummary.averageEfficiency} unit="%" isEfficiency />
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
                                    <td className="p-1">
                                        <input 
                                            type="text" 
                                            value={editingEntryData.period} 
                                            onChange={(e) => handleEditingEntryChange('period', e.target.value)}
                                            className="w-20 p-1 rounded bg-gray-100 dark:bg-gray-600"
                                        />
                                    </td>
                                    <td className="p-1">
                                        <div className="flex gap-2 items-center">
                                            <div className="flex flex-col">
                                                <label className="text-xs text-gray-500 dark:text-gray-400">Pessoas</label>
                                                <input type="number" value={editingEntryData.people} onChange={(e) => handleEditingEntryChange('people', e.target.value)} className="w-20 p-1 rounded bg-gray-100 dark:bg-gray-600"/>
                                            </div>
                                            <div className="flex flex-col">
                                                <label className="text-xs text-gray-500 dark:text-gray-400">Tempo (min)</label>
                                                <input type="number" value={editingEntryData.availableTime} onChange={(e) => handleEditingEntryChange('availableTime', e.target.value)} className="w-20 p-1 rounded bg-gray-100 dark:bg-gray-600"/>
                                            </div>
                                        </div>
                                    </td>
                                    <td>...</td>
                                    <td className="p-1">
                                        <div className="flex gap-1">
                                        {editingEntryData.productionDetails.map((detail, index) => (
                                            <input 
                                                key={index}
                                                type="number"
                                                value={detail.produced}
                                                onChange={(e) => handleEditingProductionChange(index, e.target.value)}
                                                className="w-16 p-1 rounded bg-gray-100 dark:bg-gray-600"
                                                placeholder={products.find(p=>p.id === detail.productId)?.name}
                                            />
                                        ))}
                                        </div>
                                    </td>
                                    <td>...</td>
                                    <td>...</td>
                                    <td>...</td>
                                    <td>...</td>
                                    <td>...</td>
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
                                        <button onClick={() => setModalState({ type: 'password', callback: () => handleDeleteEntry(d.id, selectedDate.toISOString().slice(0, 10)) })} className="text-gray-500 hover:text-red-500"><Trash2 size={18}/></button>
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                        <PlusCircle size={14} />
                        {showUrgent ? 'Remover item fora de ordem' : 'Adicionar item fora de ordem'}
                    </button>
                    {showUrgent && (
                        <div className="grid grid-cols-2 gap-4 p-3 bg-blue-50 dark:bg-gray-800 rounded-lg">
                             <div className="flex flex-col"><label>Lote Urgente</label>
                                <select name="productId" value={urgentProduction.productId} onChange={handleUrgentChange} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700">
                                    <option value="">Selecione o lote...</option>
                                    {lots.filter(l=> l.status === 'ongoing' || l.status === 'future').map(l => (
                                        <option key={l.id} value={l.productId}>{l.productName}{l.customName ? ` - ${l.customName}` : ''}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex flex-col"><label>Produzido (Urgente)</label>
                                <input type="number" name="produced" value={urgentProduction.produced} onChange={handleUrgentChange} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/>
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 items-end mt-4">
                    {predictedLots.filter(p => !p.isUrgent).map((lot, index) => (
                        <div key={lot.id || index} className="flex flex-col">
                            <label className="text-sm truncate">Produzido ({lot.productName})</label>
                            <input type="number" value={newEntry.productions[index] || ''} onChange={(e) => handleProductionChange(index, e.target.value)} className="p-2 rounded-md bg-gray-100 dark:bg-gray-700" />
                        </div>
                     ))}
                    <div className="flex flex-col p-2 rounded-md bg-blue-50 dark:bg-gray-700 text-center"><label>Meta Prevista</label><span className="font-bold text-lg text-blue-600 dark:text-blue-400">{goalPreview || '0'}</span></div>
                    <button type="submit" className="h-10 px-6 font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 col-start-[-2]">Adicionar</button>
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
                    <div className="flex flex-col"><label htmlFor="lotTarget" className="text-sm mb-1 text-gray-600 dark:text-gray-400">Quantidade Total</label>
                        <input type="number" id="lotTarget" value={newLot.target} onChange={e => setNewLot({...newLot, target: e.target.value})} placeholder="ex: 1500" required className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/>
                    </div>
                    <div className="flex flex-col"><label htmlFor="lotCustomName" className="text-sm mb-1 text-gray-600 dark:text-gray-400">Nome do Lote (Opcional)</label>
                        <input type="text" id="lotCustomName" value={newLot.customName} onChange={e => setNewLot({...newLot, customName: e.target.value})} placeholder="ex: Lote 01" className="p-2 rounded-md bg-gray-100 dark:bg-gray-700"/>
                    </div>
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
                    if (lot.status === 'completed') {
                        lotBgClass = 'bg-green-100 dark:bg-green-900/50';
                    } else if (lot.status === 'completed_missing' || lot.status === 'completed_exceeding') {
                        lotBgClass = 'bg-gradient-to-r from-green-100 to-red-100 dark:from-green-900/50 dark:to-red-900/50';
                    }

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
                                <select 
                                    value={lot.status} 
                                    onChange={(e) => handleLotStatusChange(lot.id, e.target.value)}
                                    className="text-xs font-semibold p-1 rounded-full bg-gray-200 dark:bg-gray-600 border-none appearance-none text-center"
                                >
                                    { (lot.status === 'ongoing' || lot.status === 'future') ? (
                                        <>
                                            <option value={lot.status}>{lot.status === 'future' ? 'Na Fila' : 'Em Andamento'}</option>
                                            <option value="completed">Concluir</option>
                                            <option value="completed_missing">Concluir com Falta</option>
                                            <option value="completed_exceeding">Concluir com Sobra</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="completed">Concluído</option>
                                            <option value="completed_missing">Com Falta</option>
                                            <option value="completed_exceeding">Com Sobra</option>
                                            <option value="ongoing">Reabrir (Em Andamento)</option> 
                                        </>
                                    )}
                                </select>
                                 <div className="flex gap-2">
                                     <button onClick={() => setModalState({ type: 'lotObservation', data: lot })} className="text-gray-500 hover:text-blue-500"><MessageSquare size={18}/></button>
                                     <button onClick={() => handleStartEditLot(lot)} className="text-gray-500 hover:text-yellow-500"><Edit size={18}/></button>
                                     <button onClick={() => setModalState({ type: 'password', callback: () => handleDeleteLot(lot.id) })} className="text-gray-500 hover:text-red-500"><Trash2 size={18}/></button>
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
                                ) : (
                                    <span>{lot.produced || 0} / {lot.target.toLocaleString('pt-BR')}</span>
                                )}
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2.5">
                                <div className="bg-blue-600 h-2.5 rounded-full" style={{width: `${((lot.produced||0)/lot.target)*100}%`}}></div>
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

