import React, { useState, useRef, useEffect } from 'react';
import { UserCog, ShieldCheck, KeyRound, Settings, XCircle, Trash2 } from 'lucide-react';

// =====================================================================
// == DADOS DE EXEMPLO (SEM FIREBASE) ==
// =====================================================================
const fakeRoles = {
    'admin': { id: 'admin', name: 'Administrador' },
    'editor': { id: 'editor', name: 'Editor' },
    'viewer': { id: 'viewer', name: 'Visualizador' },
};

const fakeUsers = [
    { uid: 'admin@local.com', email: 'admin@local.com', role: 'admin' },
    { uid: 'editor@local.com', email: 'editor@local.com', role: 'editor' },
];


// =====================================================================
// == PAINEL DE ADMINISTRAÇÃO ISOLADO ==
// =====================================================================

const useClickOutside = (ref, handler) => {
    useEffect(() => {
        const listener = (event) => {
            if (!ref.current || ref.current.contains(event.target)) return;
            handler(event);
        };
        document.addEventListener('mousedown', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
        };
    }, [ref, handler]);
};

const ManageUsersTab = ({ roles, users }) => {
    return (
        <div>
            <form onSubmit={(e) => e.preventDefault()} className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-end gap-4 mb-6">
                <div className="flex-grow">
                    <label className="block text-sm font-medium">Email do Usuário</label>
                    <input
                        type="email"
                        placeholder="usuario@email.com"
                        className="w-full p-2 mt-1 rounded-md bg-white dark:bg-gray-700"
                    />
                </div>
                <div className="flex-grow">
                    <label className="block text-sm font-medium">Função</label>
                    <select className="w-full p-2 mt-1 rounded-md bg-white dark:bg-gray-700">
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
                           <select defaultValue={user.role} className="p-1 rounded-md bg-white dark:bg-gray-700">
                               {Object.values(roles).map(role => (
                                   <option key={role.id} value={role.id}>{role.name}</option>
                               ))}
                           </select>
                            <button title="Excluir Usuário">
                                <Trash2 size={18} className="text-red-500 hover:text-red-400"/>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ManageRolesTab = () => (
    <div>
        <h2 className="text-xl font-semibold">Gerenciamento de Funções</h2>
        <p>A lógica para editar funções seria implementada aqui.</p>
    </div>
);

const ChangePasswordTab = () => {
    return (
        <div className="max-w-md mx-auto">
            <h3 className="text-xl font-semibold mb-4 text-center">Alterar Senha de Administrador</h3>
            <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
                 <div>
                    <label className="block text-sm font-medium">Nova Senha</label>
                    <input type="password" className="w-full p-2 mt-1 rounded-md bg-gray-100 dark:bg-gray-700" />
                </div>
                 <div>
                    <label className="block text-sm font-medium">Confirmar Nova Senha</label>
                    <input type="password" className="w-full p-2 mt-1 rounded-md bg-gray-100 dark:bg-gray-700" />
                </div>
                <button type="submit" className="w-full px-4 py-2 bg-green-600 text-white rounded-md">
                    Salvar Nova Senha
                </button>
            </form>
        </div>
    );
};

const AdminPanelModal = ({ isOpen, onClose }) => {
    const modalRef = useRef();
    useClickOutside(modalRef, () => onClose());
    const [activeTab, setActiveTab] = useState('users');

    if (!isOpen) return null;

    const tabs = [
        { id: 'users', label: 'Usuários', icon: UserCog },
        { id: 'roles', label: 'Funções', icon: ShieldCheck },
        { id: 'password', label: 'Senha', icon: KeyRound },
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
            <div ref={modalRef} className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
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
                        {activeTab === 'users' && <ManageUsersTab roles={fakeRoles} users={fakeUsers} />}
                        {activeTab === 'roles' && <ManageRolesTab />}
                        {activeTab === 'password' && <ChangePasswordTab />}
                    </main>
                </div>
            </div>
        </div>
    );
};


// =====================================================================
// == COMPONENTE APP PRINCIPAL ==
// =====================================================================

function App() {
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <div className="font-sans bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200 min-h-screen">
            <div className="p-8">
                <h1 className="text-2xl font-bold mb-4">Página de Teste</h1>
                <p>O resto da sua aplicação ficaria aqui.</p>
                <button 
                    onClick={() => setIsModalOpen(true)}
                    className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg"
                >
                    Abrir Painel de Administração
                </button>
            </div>
            
            <AdminPanelModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </div>
    );
}

export default App;
