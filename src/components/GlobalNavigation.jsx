import React from 'react';
import { ChevronDown, ChevronUp, Edit, Trash2, Sun, Moon, LogOut } from 'lucide-react';

const GlobalNavigation = ({
    logoSrc,
    logoAlt = 'Logo',
    title,
    subtitle,
    currentDashboard,
    dashboards = [],
    navRef,
    isNavOpen = false,
    onToggleNav,
    onSelectDashboard,
    onMoveDashboard,
    onRenameDashboard,
    onDeleteDashboard,
    onCreateDashboard,
    canManageDashboards = false,
    navigationButtons = [],
    children,
    userEmail,
    onLogout,
    logoutLabel,
    logoutButtonClassName = 'p-2 rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-400 dark:hover:bg-red-900',
    logoutIcon: LogoutIcon = LogOut,
    hideLogoutLabelOnMobile = false,
    userActions = [],
    theme,
    onToggleTheme,
    themeToggleClassName = 'p-2 rounded-full bg-gray-200 dark:bg-gray-700',
}) => {
    const showDashboardSelector = Boolean(currentDashboard && dashboards.length > 0);
    const resolvedTitle = title || currentDashboard?.name || '';

    const renderNavigationButtons = () => {
        return navigationButtons
            .filter((button) => button && typeof button.onClick === 'function')
            .map(({ key, label, icon: IconComponent, onClick, disabled, ariaLabel, alwaysShowLabel = false, className = '', baseClassName = 'p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 w-full sm:w-auto justify-center' }) => (
                <button
                    key={key}
                    onClick={onClick}
                    disabled={disabled}
                    aria-label={ariaLabel || label}
                    className={`${baseClassName} disabled:opacity-60 disabled:cursor-not-allowed ${className}`.trim()}
                >
                    {IconComponent && <IconComponent size={20} />}
                    {label && (
                        <span className={alwaysShowLabel ? '' : 'hidden sm:inline'}>{label}</span>
                    )}
                </button>
            ));
    };

    const renderDashboardDropdown = () => {
        if (!showDashboardSelector) {
            return resolvedTitle ? (
                <div className="flex flex-col">
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white tracking-wider">{resolvedTitle}</h1>
                    {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
                </div>
            ) : null;
        }

        return (
            <div ref={navRef} className="relative w-full md:w-auto">
                <button
                    onClick={onToggleNav}
                    title="Mudar Quadro"
                    className="flex w-full items-center justify-between gap-2 p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                    <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white tracking-wider text-center">
                        {currentDashboard?.name}
                    </h1>
                    <ChevronDown size={20} className={`transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                </button>
                {isNavOpen && (
                    <div className="absolute top-full mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-xl py-2 z-30 dropdown-content">
                        {dashboards.map((dash, index) => {
                            const isFirst = index === 0;
                            const isLast = index === dashboards.length - 1;
                            return (
                                <div
                                    key={dash.id}
                                    className="flex items-center justify-between px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    <div className="flex items-center gap-2">
                                        {canManageDashboards && (
                                            <div className="flex flex-col">
                                                <button
                                                    onClick={() => onMoveDashboard && onMoveDashboard(dash, 'up', index)}
                                                    disabled={isFirst}
                                                    className="disabled:opacity-20"
                                                >
                                                    <ChevronUp size={16} />
                                                </button>
                                                <button
                                                    onClick={() => onMoveDashboard && onMoveDashboard(dash, 'down', index)}
                                                    disabled={isLast}
                                                    className="disabled:opacity-20"
                                                >
                                                    <ChevronDown size={16} />
                                                </button>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => onSelectDashboard && onSelectDashboard(dash, index)}
                                            className="flex-grow text-left"
                                        >
                                            {dash.name}
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {canManageDashboards && (
                                            <>
                                                <button
                                                    onClick={() => onRenameDashboard && onRenameDashboard(dash, index)}
                                                    title="Renomear Quadro"
                                                >
                                                    <Edit size={16} className="text-yellow-500 hover:text-yellow-400" />
                                                </button>
                                                <button
                                                    onClick={() => onDeleteDashboard && onDeleteDashboard(dash, index)}
                                                    title="Excluir Quadro"
                                                >
                                                    <Trash2 size={16} className="text-red-500 hover:text-red-400" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {canManageDashboards && onCreateDashboard && (
                            <>
                                <div className="border-t my-2 dark:border-gray-600"></div>
                                <button
                                    onClick={onCreateDashboard}
                                    className="w-full text-left px-4 py-2 text-sm text-blue-600 dark:text-blue-400 font-semibold hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    + Criar Novo Quadro
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex w-full flex-col gap-4 md:grid md:grid-cols-[auto,1fr,auto] md:items-center md:gap-6">
            <div className="flex flex-wrap items-center gap-4 md:flex-nowrap">
                {logoSrc && <img src={logoSrc} alt={logoAlt} className="h-12 w-auto dark:invert" />}
                {renderDashboardDropdown()}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 md:justify-center">
                {renderNavigationButtons()}
                {children}
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 sm:gap-3 md:justify-end">
                {userEmail && (
                    <span className="hidden text-sm text-gray-500 dark:text-gray-400 md:inline">{userEmail}</span>
                )}
                {userActions.map(({ key, icon: ActionIcon, label, onClick, className = '', baseClassName = 'p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600', title, ariaLabel, disabled, hideLabelOnMobile = true }) => (
                    <button
                        key={key}
                        onClick={onClick}
                        disabled={disabled}
                        className={`${baseClassName} disabled:opacity-60 disabled:cursor-not-allowed ${className}`.trim()}
                        title={title || label}
                        aria-label={ariaLabel || label}
                    >
                        {ActionIcon && <ActionIcon size={20} />}
                        {label && (
                            <span className={hideLabelOnMobile ? 'hidden sm:inline' : ''}>{label}</span>
                        )}
                    </button>
                ))}
                {onToggleTheme && (
                    <button
                        onClick={onToggleTheme}
                        className={themeToggleClassName}
                        title={theme === 'light' ? 'Mudar para Tema Escuro' : 'Mudar para Tema Claro'}
                        aria-label={theme === 'light' ? 'Mudar para Tema Escuro' : 'Mudar para Tema Claro'}
                    >
                        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                    </button>
                )}
                {onLogout && (
                    <button
                        onClick={onLogout}
                        className={`${logoutButtonClassName}`}
                        title={logoutLabel || 'Sair'}
                        aria-label={logoutLabel || 'Sair'}
                    >
                        <LogoutIcon size={20} />
                        {logoutLabel && (
                            <span className={hideLogoutLabelOnMobile ? 'hidden sm:inline' : ''}>{logoutLabel}</span>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
};

export default GlobalNavigation;
