import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { FileText, Layers, Warehouse, ClipboardList, Package } from 'lucide-react';
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
    exportStockReportPDF,
    exportStockReportXLSX,
    exportStockReportCSV,
} from './shared';
import {
    fetchDashboardPerformanceIndicators,
    fetchStockCategories,
    fetchStockReportAggregates,
} from './reportData';

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

const buildStockFiltersSummary = (filters = {}, categoryOptions = []) => {
    const summary = {};

    const categoryIds = Array.isArray(filters.categories)
        ? filters.categories.map((value) => String(value)).filter(Boolean)
        : [];
    if (categoryIds.length > 0) {
        const categoryMap = new Map(
            (categoryOptions || []).map((option) => [
                String(option.value),
                option.label || String(option.value),
            ])
        );
        summary.categorias = categoryIds.map((categoryId) => categoryMap.get(categoryId) || categoryId);
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
            const normalizedMonth = String(filters.month).padStart(2, '0');
            summary.mes = MONTH_LABEL_MAP[normalizedMonth] || normalizedMonth;
        }
        if (filters.year) {
            summary.ano = filters.year;
        }
    }

    if (filters.periodType === 'yearly' && filters.year) {
        summary.ano = filters.year;
    }

    return summary;
};

const ReportsModule = ({
    dashboards = [],
    onNavigateToCrono,
    onNavigateToStock,
    onNavigateToOperationalSequence,
    onNavigateToFichaTecnica,
    onNavigateToPcp,
}) => {
    const [selectedDashboardId, setSelectedDashboardId] = useState(() => dashboards[0]?.id || '');
    const [productionFormat, setProductionFormat] = useState(DEFAULT_REPORT_FORMATS[0]?.value || 'pdf');
    const [stockFormat, setStockFormat] = useState(DEFAULT_REPORT_FORMATS[0]?.value || 'pdf');
    const [isExportingProduction, setIsExportingProduction] = useState(false);
    const [isExportingStock, setIsExportingStock] = useState(false);
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
    const [stockSelectedCategoryIds, setStockSelectedCategoryIds] = useState([]);
    const [stockPeriodType, setStockPeriodType] = useState('monthly');
    const [stockStartDate, setStockStartDate] = useState('');
    const [stockEndDate, setStockEndDate] = useState('');
    const [stockSelectedMonth, setStockSelectedMonth] = useState(() =>
        String(new Date().getMonth() + 1).padStart(2, '0')
    );
    const [stockSelectedYear, setStockSelectedYear] = useState(() => String(new Date().getFullYear()));
    const [stockCategoryOptions, setStockCategoryOptions] = useState([]);
    const [isLoadingStockCategories, setIsLoadingStockCategories] = useState(false);

    useEffect(() => {
        setSelectedProductIds([]);
    }, [selectedDashboardId]);

    useEffect(() => {
        let isMounted = true;
        setIsLoadingStockCategories(true);
        fetchStockCategories()
            .then((categories) => {
                if (!isMounted) {
                    return;
                }
                const options = (categories || []).map((category) => ({
                    value: String(category.id),
                    label: category.name || String(category.id),
                }));
                setStockCategoryOptions(options);
            })
            .catch((error) => {
                console.error('Erro ao carregar categorias de estoque:', error);
            })
            .finally(() => {
                if (isMounted) {
                    setIsLoadingStockCategories(false);
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

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

    useEffect(() => {
        setStockSelectedCategoryIds((currentIds) =>
            currentIds.filter((id) => stockCategoryOptions.some((option) => option.value === id))
        );
    }, [stockCategoryOptions]);

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

    const stockFilters = useMemo(
        () => ({
            categories: stockSelectedCategoryIds,
            periodType: stockPeriodType,
            startDate: stockStartDate,
            endDate: stockEndDate,
            month: stockSelectedMonth,
            year: stockSelectedYear,
        }),
        [
            stockSelectedCategoryIds,
            stockPeriodType,
            stockStartDate,
            stockEndDate,
            stockSelectedMonth,
            stockSelectedYear,
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
            onNavigateToPcp
                ? {
                    key: 'pcp',
                    label: 'Gestão Produção x Estoque',
                    icon: Package,
                    onClick: onNavigateToPcp,
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
                    label: 'Sequência',
                    icon: FileText,
                    onClick: onNavigateToOperationalSequence,
                }
                : null,
        ].filter(Boolean);
    }, [onNavigateToCrono, onNavigateToStock, onNavigateToOperationalSequence, onNavigateToFichaTecnica, onNavigateToPcp]);

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
            const aggregatedData = await fetchDashboardPerformanceIndicators({
                dashboardId: selectedDashboard.id,
                filters,
            });
            const appliedFilters = aggregatedData?.appliedFilters || filters;
            const filtersSummary = buildProductionFiltersSummary(
                selectedDashboard.name,
                appliedFilters,
                availableProductOptions
            );
            const exportOptions = {
                dashboardName: selectedDashboard.name,
                filters: appliedFilters,
                filtersSummary,
                summary: aggregatedData?.summary || {},
                monthlySummary: aggregatedData?.monthlySummary || {},
                dailyEntries: aggregatedData?.dailyEntries || [],
                traveteEntries: aggregatedData?.traveteEntries || [],
                lotSummary: aggregatedData?.lotSummary || {},
                monthlyBreakdown: aggregatedData?.monthlyBreakdown || [],
                isTraveteDashboard: aggregatedData?.isTraveteDashboard || false,
                selectedDate: aggregatedData?.selectedDate,
                currentMonth: aggregatedData?.currentMonth,
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
            const exportFormat = format || stockFormat;
            const filters = {
                ...stockFilters,
                categories: [...(stockFilters.categories || [])],
            };

            const stockData = await fetchStockReportAggregates(filters);
            const resolvedFiltersSummary = stockData?.filtersSummary
                && Object.keys(stockData.filtersSummary).length > 0
                ? stockData.filtersSummary
                : buildStockFiltersSummary(stockData?.appliedFilters || filters, stockCategoryOptions);

            const exportOptions = {
                ...stockData,
                filters: stockData?.appliedFilters || filters,
                filtersSummary: resolvedFiltersSummary,
                periodLabel: stockData?.periodLabel || '',
            };

            if (exportFormat === 'xlsx') {
                await exportStockReportXLSX(exportOptions);
            } else if (exportFormat === 'csv') {
                await exportStockReportCSV(exportOptions);
            } else {
                await exportStockReportPDF(exportOptions);
            }
        } catch (error) {
            console.error('Erro ao exportar relatório de estoque:', error);
            if (typeof window !== 'undefined') {
                window.alert('Não foi possível gerar o relatório de estoque.');
            }
        } finally {
            setIsExportingStock(false);
        }
    }, [stockCategoryOptions, stockFilters, stockFormat]);

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

                    <div className="mt-6 flex flex-col gap-6">
                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Categoria(s)
                                <select
                                    multiple
                                    value={stockSelectedCategoryIds}
                                    onChange={(event) =>
                                        setStockSelectedCategoryIds(
                                            Array.from(event.target.selectedOptions).map((option) => option.value)
                                        )
                                    }
                                    disabled={isLoadingStockCategories || stockCategoryOptions.length === 0}
                                    className="mt-1 block h-32 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                >
                                    {isLoadingStockCategories ? (
                                        <option value="" disabled>
                                            Carregando categorias...
                                        </option>
                                    ) : stockCategoryOptions.length === 0 ? (
                                        <option value="" disabled>
                                            Nenhuma categoria disponível
                                        </option>
                                    ) : (
                                        stockCategoryOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <span className="mt-2 block text-xs text-gray-500 dark:text-gray-400">
                                    Selecione uma ou mais categorias para filtrar o relatório. Caso nenhuma seja escolhida,
                                    todas as categorias serão consideradas.
                                </span>
                            </label>

                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Intervalo de tempo
                                <select
                                    value={stockPeriodType}
                                    onChange={(event) => setStockPeriodType(event.target.value)}
                                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                >
                                    {PERIOD_TYPE_OPTIONS.map((option) => (
                                        <option key={`stock-period-${option.value}`} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        {stockPeriodType === 'range' && (
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Data inicial
                                    <input
                                        type="date"
                                        value={stockStartDate}
                                        onChange={(event) => setStockStartDate(event.target.value)}
                                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                    />
                                </label>

                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Data final
                                    <input
                                        type="date"
                                        value={stockEndDate}
                                        onChange={(event) => setStockEndDate(event.target.value)}
                                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                    />
                                </label>
                            </div>
                        )}

                        {stockPeriodType === 'monthly' && (
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Mês
                                    <select
                                        value={stockSelectedMonth}
                                        onChange={(event) => setStockSelectedMonth(event.target.value)}
                                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                    >
                                        {MONTH_OPTIONS.map((option) => (
                                            <option key={`stock-month-${option.value}`} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Ano
                                    <select
                                        value={stockSelectedYear}
                                        onChange={(event) => setStockSelectedYear(event.target.value)}
                                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                    >
                                        {yearOptions.map((year) => (
                                            <option key={`stock-year-monthly-${year}`} value={year}>
                                                {year}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        )}

                        {stockPeriodType === 'yearly' && (
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Ano
                                    <select
                                        value={stockSelectedYear}
                                        onChange={(event) => setStockSelectedYear(event.target.value)}
                                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800"
                                    >
                                        {yearOptions.map((year) => (
                                            <option key={`stock-year-yearly-${year}`} value={year}>
                                                {year}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        )}

                        <div>
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
