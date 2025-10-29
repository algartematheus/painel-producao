import React, { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { auth } from '../firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from 'firebase/auth';
import { raceBullLogoUrl } from './constants';

const isBrowserStorageAvailable = () => {
    if (typeof window === 'undefined') {
        return false;
    }
    try {
        const testKey = '__storage_test__';
        window.localStorage.setItem(testKey, testKey);
        window.localStorage.removeItem(testKey);
        return true;
    } catch (error) {
        console.warn('LocalStorage is not available.', error);
        return false;
    }
};

const safeLocalStorageGetItem = (key) => {
    if (!isBrowserStorageAvailable()) {
        return { value: null, available: false };
    }
    try {
        return { value: window.localStorage.getItem(key), available: true };
    } catch (error) {
        console.warn(`Failed to read "${key}" from localStorage.`, error);
        return { value: null, available: false };
    }
};

const safeLocalStorageSetItem = (key, value) => {
    if (!isBrowserStorageAvailable()) {
        return false;
    }
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`Failed to write "${key}" to localStorage.`, error);
        return false;
    }
};

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

    const login = async (email, password, persistenceType) => {
        if (persistenceType) {
            await setPersistence(auth, persistenceType);
        }
        return signInWithEmailAndPassword(auth, email, password);
    };
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

export const LoginPage = () => {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const initialStorageStatus = useMemo(() => {
        const { value, available } = safeLocalStorageGetItem('rememberLoginPersistence');
        if (value === null) {
            return { remember: true, available };
        }
        return { remember: value === 'true', available };
    }, []);
    const [rememberMe, setRememberMe] = useState(initialStorageStatus.remember);
    const [storageAvailable, setStorageAvailable] = useState(initialStorageStatus.available);

    useEffect(() => {
        if (!storageAvailable) {
            return;
        }
        const success = safeLocalStorageSetItem('rememberLoginPersistence', rememberMe ? 'true' : 'false');
        if (!success) {
            setStorageAvailable(false);
        }
    }, [rememberMe, storageAvailable]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await login(
                email,
                password,
                rememberMe ? browserLocalPersistence : browserSessionPersistence
            );
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

                    <div className="flex items-center justify-between">
                        <label className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                            <input
                                type="checkbox"
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                checked={rememberMe}
                                onChange={(e) => setRememberMe(e.target.checked)}
                                disabled={!storageAvailable}
                            />
                            <span className="ml-2">
                                Manter-me conectado
                                {!storageAvailable && (
                                    <span className="ml-2 text-xs text-red-500">(Preferência indisponível)</span>
                                )}
                            </span>
                        </label>
                    </div>

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


