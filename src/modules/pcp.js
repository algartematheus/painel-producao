import React, { useMemo } from 'react';
import { Home, Warehouse, ClipboardList, Layers, BarChart, Package } from 'lucide-react';
import HeaderContainer from '../components/HeaderContainer';
import GlobalNavigation from '../components/GlobalNavigation';
import { raceBullLogoUrl } from './constants';
import { useAuth } from './auth';
import { GlobalStyles, usePersistedTheme } from './shared';

const PcpModule = ({
    onNavigateToCrono,
    onNavigateToStock,
    onNavigateToFichaTecnica,
    onNavigateToOperationalSequence,
    onNavigateToReports,
}) => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = usePersistedTheme();

    const navigationButtons = useMemo(() => ([
        onNavigateToCrono
            ? {
                key: 'crono',
                label: 'Quadro de Produção',
                icon: Home,
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
        onNavigateToFichaTecnica
            ? {
                key: 'ficha-tecnica',
                label: 'Ficha Técnica',
                icon: ClipboardList,
                onClick: onNavigateToFichaTecnica,
            }
            : null,
        onNavigateToOperationalSequence
            ? {
                key: 'operational-sequence',
                label: 'Sequência Operacional',
                icon: Layers,
                onClick: onNavigateToOperationalSequence,
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
    ].filter(Boolean)), [
        onNavigateToCrono,
        onNavigateToStock,
        onNavigateToFichaTecnica,
        onNavigateToOperationalSequence,
        onNavigateToReports,
    ]);

    return (
        <div className="responsive-root min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200">
            <GlobalStyles />
            <HeaderContainer>
                <GlobalNavigation
                    logoSrc={raceBullLogoUrl}
                    title="Planejamento e Controle da Produção"
                    subtitle="Gerencie o fluxo de produção da fábrica."
                    navigationButtons={navigationButtons}
                    userEmail={user?.email}
                    onLogout={logout}
                    logoutLabel="Sair"
                    logoutButtonClassName="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 text-red-500 w-full sm:w-auto justify-center"
                    hideLogoutLabelOnMobile={true}
                    theme={theme}
                    onToggleTheme={toggleTheme}
                />
            </HeaderContainer>

            <main className="responsive-main py-12">
                <section className="max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8 text-center space-y-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 mx-auto">
                        <Package size={32} />
                    </div>
                    <h1 className="text-2xl font-bold">Módulo de PCP</h1>
                    <p className="text-gray-600 dark:text-gray-300">
                        As funcionalidades do módulo de planejamento e controle da produção estarão disponíveis em breve.
                    </p>
                </section>
            </main>
        </div>
    );
};

export default PcpModule;
