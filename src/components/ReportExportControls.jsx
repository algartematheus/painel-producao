import React, { useMemo, useCallback } from 'react';
import { FileDown, SlidersHorizontal } from 'lucide-react';
import ReportActionsDropdown from './ReportActionsDropdown';

export const DEFAULT_REPORT_FORMATS = [
    { value: 'pdf', label: 'PDF' },
    { value: 'xlsx', label: 'Excel (.xlsx)' },
    { value: 'csv', label: 'CSV' },
];

const DEFAULT_TRANSLATIONS = {
    triggerLabel: 'Relatórios',
    exportButton: 'Exportar Relatório',
    exportingButton: 'Gerando relatório...',
    settingsButton: 'Seções do Relatório',
    formatLabel: 'Formato do relatório',
};

const ReportExportControls = ({
    selectedFormat = DEFAULT_REPORT_FORMATS[0]?.value || 'pdf',
    formats = DEFAULT_REPORT_FORMATS,
    onFormatChange,
    onExport,
    onOpenSettings,
    isExporting = false,
    translations = {},
    variant = 'dropdown',
    className = '',
    disableWhileExporting = false,
    showFormatLabel = true,
}) => {
    const mergedTranslations = useMemo(
        () => ({ ...DEFAULT_TRANSLATIONS, ...translations }),
        [translations]
    );

    const handleFormatChange = useCallback(
        (value) => {
            if (onFormatChange) {
                onFormatChange(value);
            }
        },
        [onFormatChange]
    );

    const handleExport = useCallback(() => {
        if (onExport) {
            onExport(selectedFormat);
        }
    }, [onExport, selectedFormat]);

    const handleOpenSettings = useCallback(() => {
        if (onOpenSettings) {
            onOpenSettings();
        }
    }, [onOpenSettings]);

    if (variant === 'inline') {
        return (
            <div
                className={`flex flex-wrap items-center gap-3 ${className}`.trim()}
                data-testid="report-export-controls-inline"
            >
                {onFormatChange && (
                    <label className="flex flex-col text-xs sm:text-sm text-gray-700 dark:text-gray-300">
                        {showFormatLabel && (
                            <span className="font-semibold mb-1">{mergedTranslations.formatLabel}</span>
                        )}
                        <select
                            value={selectedFormat}
                            onChange={(event) => handleFormatChange(event.target.value)}
                            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {formats.map((format) => (
                                <option key={format.value} value={format.value}>
                                    {format.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                <button
                    type="button"
                    onClick={handleExport}
                    disabled={isExporting || !onExport}
                    className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <FileDown size={18} />
                    {isExporting ? mergedTranslations.exportingButton : mergedTranslations.exportButton}
                </button>

                {onOpenSettings && (
                    <button
                        type="button"
                        onClick={handleOpenSettings}
                        className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                        <SlidersHorizontal size={18} />
                        {mergedTranslations.settingsButton}
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className={className} data-testid="report-export-controls-dropdown">
            <ReportActionsDropdown
                label={mergedTranslations.triggerLabel}
                formats={formats}
                selectedFormat={selectedFormat}
                onChangeFormat={handleFormatChange}
                onExport={onExport ? handleExport : undefined}
                onOpenSettings={onOpenSettings ? handleOpenSettings : undefined}
                isExporting={isExporting}
                disableWhileExporting={disableWhileExporting}
            />
        </div>
    );
};

export default ReportExportControls;
