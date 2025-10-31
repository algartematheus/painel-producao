import React, { useState, useRef, useCallback } from 'react';
import { ChevronDown, FileDown, SlidersHorizontal } from 'lucide-react';
import { useClickOutside } from '../modules/shared';

const DEFAULT_FORMATS = [
    { value: 'pdf', label: 'PDF' },
    { value: 'xlsx', label: 'Excel (.xlsx)' },
    { value: 'csv', label: 'CSV' },
];

const ReportActionsDropdown = ({
    label = 'Relatórios',
    triggerClassName = 'flex items-center justify-center gap-2 w-full sm:w-auto px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white/80 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
    menuClassName = 'absolute right-0 mt-2 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-4 space-y-4 z-40',
    formats = DEFAULT_FORMATS,
    selectedFormat = 'pdf',
    onChangeFormat,
    onExport,
    onOpenSettings,
    isExporting = false,
    disableWhileExporting = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    useClickOutside(dropdownRef, () => setIsOpen(false), isOpen);

    const handleToggle = useCallback(() => {
        if (disableWhileExporting && isExporting) {
            return;
        }
        setIsOpen(prev => !prev);
    }, [disableWhileExporting, isExporting]);

    const handleChangeFormat = useCallback((event) => {
        onChangeFormat && onChangeFormat(event.target.value);
    }, [onChangeFormat]);

    const handleExport = useCallback(() => {
        if (onExport) {
            onExport();
        }
        setIsOpen(false);
    }, [onExport]);

    const handleOpenSettings = useCallback(() => {
        if (onOpenSettings) {
            onOpenSettings();
        }
        setIsOpen(false);
    }, [onOpenSettings]);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                onClick={handleToggle}
                className={triggerClassName}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                disabled={disableWhileExporting && isExporting}
            >
                <FileDown size={18} />
                <span className="hidden sm:inline text-sm font-medium">{label}</span>
                <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className={menuClassName} role="menu">
                    {onChangeFormat && (
                        <label className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <span className="font-semibold">Formato do relatório</span>
                            <select
                                value={selectedFormat}
                                onChange={handleChangeFormat}
                                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {formats.map((format) => (
                                    <option key={format.value} value={format.value}>
                                        {format.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    <div className="flex flex-col gap-2" role="group">
                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={isExporting}
                            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-500 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/40"
                        >
                            <FileDown size={18} />
                            {isExporting ? 'Gerando relatório...' : 'Exportar Relatório'}
                        </button>
                        {onOpenSettings && (
                            <button
                                type="button"
                                onClick={handleOpenSettings}
                                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700"
                            >
                                <SlidersHorizontal size={18} />
                                Seções do Relatório
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReportActionsDropdown;
