import React, { useState, useMemo, useCallback, useEffect } from 'react';
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

const MONTH_OPTIONS = [
    { value: '01', label: 'Janeiro' },
    { value: '02', label: 'Fevereiro' },
    { value: '03', label: 'Março' },
    { value: '04', label: 'Abril' },
    { value: '05', label: 'Maio' },
    { value: '06', label: 'Junho' },
    { value: '07', label: 'Julho' },
    { value: '08', label: 'Agosto' },
    { value: '09', label: 'Setembro' },
    { value: '10', label: 'Outubro' },
    { value: '11', label: 'Novembro' },
    { value: '12', label: 'Dezembro' },
];

const MONTH_LABEL_MAP = MONTH_OPTIONS.reduce((accumulator, option) => {
    accumulator[option.value] = option.label;
    return accumulator;
}, {});

const PERIOD_TYPE_OPTIONS = [
    { value: 'range', label: 'Intervalo personalizado' },
    { value: 'monthly', label: 'Mensal' },
    { value: 'yearly', label: 'Anual' },
];

const PERIOD_TYPE_LABEL_MAP = PERIOD_TYPE_OPTIONS.reduce((accumulator, option) => {
    accumulator[option.value] = option.label;
    return accumulator;
}, {});

const buildProductionFiltersSummary = (dashboardName, filters = {}, productOptions = []) => {
    const summary = {};

    if (dashboardName) {
        summary.dashboardName = dashboardName;
    }

    const productIds = Array.isArray(filters.products) ? filters.products.filter(Boolean) : [];
    if (productIds.length > 0) {
        const productLabelMap = new Map(
            (productOptions || []).map((option) => [String(option.value), option.label || String(option.value)])
        );
        summary.produtos = productIds.map((productId) => productLabelMap.get(String(productId)) || productId);
    }

    if (filters.periodType) {
        summary.periodicidade = PERIOD_TYPE_LABEL_MAP[filters.periodType] || filters.periodType;
    }

    if (filters.periodType === 'range') {
        if (filters.startDate) {
            summary.dataInicial = filters.startDate;
        }
        if (filters.endDate) {
            summary.dataFinal = filters.endDate;
        }
    }

    if (filters.periodType === 'monthly') {
        if (filters.month) {
            summary.mes = MONTH_LABEL_MAP[filters.month] || filters.month;
        }
        if (filters.year) {
            summary.ano = filters.year;
        }
    }

    if (filters.periodType === 'yearly' && filters.year) {
        summary.ano = filters.year;
    }

    if (typeof filters.includeTravetes === 'boolean') {
        summary.incluirTravetes = filters.includeTravetes ? 'Sim' : 'Não';
    }

    if (typeof filters.includeOnlyCompletedLots === 'boolean') {
        summary.somenteLotesConcluidos = filters.includeOnlyCompletedLots ? 'Sim' : 'Não';
    }

    return summary;
};

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
    const [selectedProductIds, setSelectedProductIds] = useState([]);
    const [selectedPeriodType, setSelectedPeriodType] = useState('range');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(() =>
        String(new Date().getMonth() + 1).padStart(2, '0')
    );
    const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
    const [includeTravetes, setIncludeTravetes] = useState(true);
    const [includeOnlyCompletedLots, setIncludeOnlyCompletedLots] = useState(false);

    useEffect(() => {
        setSelectedProductIds([]);
    }, [selectedDashboardId]);

    const selectedDashboard = useMemo(() => {
        if (!dashboards || dashboards.length === 0) {
            return null;
        }
        return dashboards.find((dashboard) => dashboard.id === selectedDashboardId) || dashboards[0];
    }, [dashboards, selectedDashboardId]);

    const availableProductOptions = useMemo(() => {
        if (!selectedDashboard) {
            return [];
        }

        const rawProducts =
            selectedDashboard.products ||
            selectedDashboard.productOptions ||
            selectedDashboard.availableProducts ||
            [];

        if (!Array.isArray(rawProducts)) {
            return [];
        }

        return rawProducts.map((product, index) => {
            if (!product || typeof product !== 'object') {
                const value = String(product ?? index);
                return { value, label: value };
            }

            const value =
                product.id ??
                product.value ??
                product.codigo ??
                product.codigoSap ??
                product.sku ??
                product.nome ??
                product.name ??
                index;

            const label =
                product.name ??
                product.nome ??
                product.label ??
                product.descricao ??
                product.description ??
                product.titulo ??
                product.title ??
                String(value);

            return {
                value: String(value),
                label: String(label),
            };
        });
    }, [selectedDashboard]);

    useEffect(() => {
        setSelectedProductIds((currentIds) =>
            currentIds.filter((id) => availableProductOptions.some((option) => option.value === id))
        );
    }, [availableProductOptions]);

    const yearOptions = useMemo(() => {
        const currentYearValue = new Date().getFullYear();
        return Array.from({ length: 6 }, (_, index) => String(currentYearValue - index));
    }, []);

    const productionFilters = useMemo(
        () => ({
            products: selectedProductIds,
            periodType: selectedPeriodType,
            startDate,
            endDate,
            month: selectedMonth,
            year: selectedYear,
            includeTravetes,
            includeOnlyCompletedLots,
        }),
        [
            selectedProductIds,
            selectedPeriodType,
            startDate,
            endDate,
            selectedMonth,
            selectedYear,
            includeTravetes,
            includeOnlyCompletedLots,
        ]
    );

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

    const handleExportProductionReport = useCallback(async (format = productionFormat, overrideFilters = null) => {
        if (!selectedDashboard) {
            if (typeof window !== 'undefined') {
                window.alert('Selecione um quadro para exportar.');
            }
            return;
        }

        setIsExportingProduction(true);
        try {
            const exportFormat = format || productionFormat;
            const filters = overrideFilters || productionFilters;
            const filtersSummary = buildProductionFiltersSummary(
                selectedDashboard.name,
                filters,
                availableProductOptions
            );
            const exportOptions = {
                dashboardName: selectedDashboard.name,
                filters,
                filtersSummary,
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
    }, [
        availableProductOptions,
        productionFilters,
        productionFormat,
        resolvedExportSettings,
        selectedDashboard,
    ]);

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
                        <div className="flex w-full flex-col gap-4">
                            <div className="grid w-full gap-4 md:grid-cols-2">
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

                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Produto(s)
                                    <select
                                        multiple
                                        value={selectedProductIds}
                                        onChange={(event) =>
                                            setSelectedProductIds(
                                                Array.from(event.target.selectedOptions).map((option) => option.value)
                                            )
                                        }
                                        disabled={availableProductOptions.length === 0}
                                        className="mt-1 block h-28 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                    >
                                        {availableProductOptions.length === 0 ? (
                                            <option value="" disabled>
                                                Nenhum produto disponível
                                            </option>
                                        ) : (
                                            availableProductOptions.map((product) => (
                                                <option key={product.value} value={product.value}>
                                                    {product.label}
                                                </option>
                                            ))
                                        )}
                                    </select>
                                </label>
                            </div>

                            <div className="grid w-full gap-4 md:grid-cols-3">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Periodicidade
                                    <select
                                        value={selectedPeriodType}
                                        onChange={(event) => setSelectedPeriodType(event.target.value)}
                                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                    >
                                        {PERIOD_TYPE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                {selectedPeriodType === 'range' && (
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Data inicial
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(event) => setStartDate(event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                        />
                                    </label>
                                )}

                                {selectedPeriodType === 'range' && (
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Data final
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(event) => setEndDate(event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                        />
                                    </label>
                                )}

                                {selectedPeriodType === 'monthly' && (
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Mês
                                        <select
                                            value={selectedMonth}
                                            onChange={(event) => setSelectedMonth(event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                        >
                                            {MONTH_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}

                                {selectedPeriodType === 'monthly' && (
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Ano
                                        <select
                                            value={selectedYear}
                                            onChange={(event) => setSelectedYear(event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                        >
                                            {yearOptions.map((year) => (
                                                <option key={year} value={year}>
                                                    {year}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}

                                {selectedPeriodType === 'yearly' && (
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Ano
                                        <select
                                            value={selectedYear}
                                            onChange={(event) => setSelectedYear(event.target.value)}
                                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                        >
                                            {yearOptions.map((year) => (
                                                <option key={year} value={year}>
                                                    {year}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={includeTravetes}
                                        onChange={(event) => setIncludeTravetes(event.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    Incluir travetes
                                </label>

                                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={includeOnlyCompletedLots}
                                        onChange={(event) => setIncludeOnlyCompletedLots(event.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    Somente lotes concluídos
                                </label>
                            </div>
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
