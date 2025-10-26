import React, { useState, useMemo, useCallback } from 'react';
import { FileText, Layers, Warehouse } from 'lucide-react';
import HeaderContainer from '../components/HeaderContainer';
import GlobalNavigation from '../components/GlobalNavigation';
import ReportExportControls, { DEFAULT_REPORT_FORMATS } from '../components/ReportExportControls';
import ExportSettingsModal from '../components/ExportSettingsModal';
import {
    raceBullLogoUrl,
} from './constants';
import {
    DEFAULT_EXPORT_SETTINGS,
    exportDashboardPerformancePDF,
    exportDashboardPerformanceXLSX,
    exportDashboardPerformanceCSV,
    exportSequenciaOperacionalPDF,
} from './shared';

const buildDefaultFiltersSummary = (dashboardName) => ({
    dashboardName,
});

const ReportsModule = ({
    dashboards = [],
    onNavigateToCrono,
    onNavigateToStock,
    onNavigateToOperationalSequence,
}) => {
    const [selectedDashboardId, setSelectedDashboardId] = useState(() => dashboards[0]?.id || '');
    const [productionFormat, setProductionFormat] = useState(DEFAULT_REPORT_FORMATS[0]?.value || 'pdf');
    const [stockFormat, setStockFormat] = useState(DEFAULT_REPORT_FORMATS[0]?.value || 'pdf');
    const [sequenceFormat, setSequenceFormat] = useState('pdf');
    const [isExportingProduction, setIsExportingProduction] = useState(false);
    const [isExportingStock, setIsExportingStock] = useState(false);
    const [isExportingSequence, setIsExportingSequence] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [exportSettings, setExportSettings] = useState(DEFAULT_EXPORT_SETTINGS);

    const selectedDashboard = useMemo(() => {
        if (!dashboards || dashboards.length === 0) {
            return null;
        }
        return dashboards.find((dashboard) => dashboard.id === selectedDashboardId) || dashboards[0];
    }, [dashboards, selectedDashboardId]);

    const resolvedExportSettings = useMemo(() => ({
        ...DEFAULT_EXPORT_SETTINGS,
        ...(exportSettings || {}),
        format: productionFormat,
    }), [exportSettings, productionFormat]);

    const navigationButtons = useMemo(() => {
        return [
            onNavigateToCrono
                ? {
                    key: 'production',
                    label: 'Produção',
                    icon: Layers,
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
            onNavigateToOperationalSequence
                ? {
                    key: 'operational-sequence',
                    label: 'Sequência',
                    icon: FileText,
                    onClick: onNavigateToOperationalSequence,
                }
                : null,
        ].filter(Boolean);
    }, [onNavigateToCrono, onNavigateToStock, onNavigateToOperationalSequence]);

    const handleOpenSettings = useCallback(() => {
        setIsSettingsModalOpen(true);
    }, []);

    const handleCloseSettings = useCallback(() => {
        setIsSettingsModalOpen(false);
    }, []);

    const handleSaveSettings = useCallback((settings) => {
        setExportSettings((prev) => ({
            ...prev,
            ...settings,
        }));
        setIsSettingsModalOpen(false);
    }, []);

    const handleExportProductionReport = useCallback(async (format = productionFormat) => {
        if (!selectedDashboard) {
            if (typeof window !== 'undefined') {
                window.alert('Selecione um quadro para exportar.');
            }
            return;
        }

        setIsExportingProduction(true);
        try {
            const exportFormat = format || productionFormat;
            const exportOptions = {
                dashboardName: selectedDashboard.name,
                filtersSummary: buildDefaultFiltersSummary(selectedDashboard.name),
                summary: {},
                monthlySummary: {},
                dailyEntries: [],
                traveteEntries: [],
                lotSummary: {},
                monthlyBreakdown: [],
                exportSettings: { ...resolvedExportSettings, format: exportFormat },
            };

            if (exportFormat === 'xlsx') {
                await exportDashboardPerformanceXLSX(exportOptions);
            } else if (exportFormat === 'csv') {
                await exportDashboardPerformanceCSV(exportOptions);
            } else {
                await exportDashboardPerformancePDF(exportOptions);
            }
        } catch (error) {
            console.error('Erro ao exportar relatório de produção:', error);
            if (typeof window !== 'undefined') {
                window.alert('Não foi possível gerar o relatório de produção.');
            }
        } finally {
            setIsExportingProduction(false);
        }
    }, [productionFormat, resolvedExportSettings, selectedDashboard]);

    const handleExportStockReport = useCallback(async (format = stockFormat) => {
        setIsExportingStock(true);
        try {
            const message = 'A exportação de estoque estará disponível em breve.';
            if (typeof window !== 'undefined') {
                window.alert(message);
            } else {
                console.info(message);
            }
            console.info('Stock report export requested', { format });
        } finally {
            setIsExportingStock(false);
        }
    }, [stockFormat]);

    const handleExportSequenceReport = useCallback(async (format = sequenceFormat) => {
        setIsExportingSequence(true);
        try {
            if (format === 'blank') {
                await exportSequenciaOperacionalPDF(
                    {
                        empresa: 'Race Bull',
                        modelo: '__________',
                        operacoes: [],
                    },
                    false,
                    { blankLineCount: 25 }
                );
                return;
            }

            await exportSequenciaOperacionalPDF(
                {
                    empresa: 'Race Bull',
                    modelo: 'Modelo Exemplo',
                    operacoes: [
                        { numero: 1, descricao: 'Operação Exemplo', maquina: 'Máquina Padrão', tempoMinutos: 1.5 },
                        { numero: 2, descricao: 'Inspeção', maquina: 'Bancada', tempoMinutos: 0.75 },
                    ],
                },
                true
            );
        } catch (error) {
            console.error('Erro ao exportar sequência operacional:', error);
            if (typeof window !== 'undefined') {
                window.alert('Não foi possível gerar o relatório da sequência operacional.');
            }
        } finally {
            setIsExportingSequence(false);
        }
    }, [sequenceFormat]);

    const sequenceFormats = useMemo(() => ([
        { value: 'pdf', label: 'Sequência Preenchida (PDF)' },
        { value: 'blank', label: 'Folha em Branco' },
    ]), []);

    return (
        <div className="responsive-root min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200">
            <HeaderContainer>
                <GlobalNavigation
                    logoSrc={raceBullLogoUrl}
                    title="Central de Relatórios"
                    subtitle="Escolha um módulo e exporte os relatórios disponíveis."
                    navigationButtons={navigationButtons}
                />
            </HeaderContainer>

            <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-12">
                <section className="rounded-2xl bg-white p-6 shadow-lg dark:bg-gray-900">
                    <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-xl font-semibold">Relatórios de Produção</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Exportar dados consolidados dos quadros selecionados.</p>
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Quadro
                                <select
                                    value={selectedDashboard?.id || ''}
                                    onChange={(event) => setSelectedDashboardId(event.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                >
                                    {(dashboards || []).map((dashboard) => (
                                        <option key={dashboard.id} value={dashboard.id}>
                                            {dashboard.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </header>

                    <div className="mt-6">
                        <ReportExportControls
                            variant="inline"
                            selectedFormat={productionFormat}
                            formats={DEFAULT_REPORT_FORMATS}
                            onFormatChange={setProductionFormat}
                            onExport={handleExportProductionReport}
                            onOpenSettings={handleOpenSettings}
                            isExporting={isExportingProduction}
                            disableWhileExporting
                        />
                    </div>
                </section>

                <section className="rounded-2xl bg-white p-6 shadow-lg dark:bg-gray-900">
                    <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-xl font-semibold">Relatórios de Estoque</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Centralize solicitações de exportação do módulo de estoque.</p>
                        </div>
                    </header>

                    <div className="mt-6">
                        <ReportExportControls
                            variant="inline"
                            selectedFormat={stockFormat}
                            formats={DEFAULT_REPORT_FORMATS}
                            onFormatChange={setStockFormat}
                            onExport={handleExportStockReport}
                            isExporting={isExportingStock}
                            disableWhileExporting
                        />
                    </div>
                </section>

                <section className="rounded-2xl bg-white p-6 shadow-lg dark:bg-gray-900">
                    <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-xl font-semibold">Relatórios de Sequência Operacional</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Gere PDFs preenchidos ou folhas em branco para as sequências.</p>
                        </div>
                    </header>

                    <div className="mt-6">
                        <ReportExportControls
                            variant="inline"
                            selectedFormat={sequenceFormat}
                            formats={sequenceFormats}
                            onFormatChange={setSequenceFormat}
                            onExport={handleExportSequenceReport}
                            isExporting={isExportingSequence}
                            disableWhileExporting
                            showFormatLabel={false}
                        />
                    </div>
                </section>
            </main>

            <ExportSettingsModal
                isOpen={isSettingsModalOpen}
                onClose={handleCloseSettings}
                settings={resolvedExportSettings}
                onSave={handleSaveSettings}
            />
        </div>
    );
};

export default ReportsModule;
