import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import {
    buildProductLookupMap,
    buildTraveteProcessedEntries,
    formatDefaultLotDisplayName,
    getEmployeeProducts,
    joinGoalSegments,
    splitGoalSegments,
    sumGoalDisplay,
} from './shared';

const parseDateKeyToDate = (value) => {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const normalized = typeof value === 'string' ? value.trim() : String(value);
    if (!normalized) {
        return null;
    }

    const candidate = normalized.length === 10 && normalized.includes('-')
        ? new Date(`${normalized}T00:00:00`)
        : new Date(normalized);

    return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const formatDateToKey = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return '';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const resolveDateFilter = (filters = {}) => {
    const now = new Date();
    const periodTypeRaw = typeof filters.periodType === 'string' ? filters.periodType.toLowerCase() : '';
    const normalizedPeriodType = ['monthly', 'yearly', 'range'].includes(periodTypeRaw)
        ? periodTypeRaw
        : 'range';

    const baseResult = {
        filter: (date) => date instanceof Date && !Number.isNaN(date.getTime()),
        startDate: null,
        endDate: null,
        hasDateFilter: false,
        periodType: normalizedPeriodType,
        month: null,
        year: null,
    };

    if (normalizedPeriodType === 'monthly') {
        const parsedYear = parseInt(filters.year, 10);
        const resolvedYear = Number.isFinite(parsedYear) ? parsedYear : now.getFullYear();
        const parsedMonth = parseInt(filters.month, 10);
        const monthIndex = Number.isFinite(parsedMonth)
            ? Math.min(11, Math.max(0, parsedMonth - 1))
            : now.getMonth();

        const startDate = new Date(resolvedYear, monthIndex, 1);
        const endDate = new Date(resolvedYear, monthIndex + 1, 0);

        return {
            ...baseResult,
            filter: (date) => (
                date instanceof Date
                && !Number.isNaN(date.getTime())
                && date.getFullYear() === resolvedYear
                && date.getMonth() === monthIndex
            ),
            startDate,
            endDate,
            hasDateFilter: true,
            month: monthIndex + 1,
            year: resolvedYear,
        };
    }

    if (normalizedPeriodType === 'yearly') {
        const parsedYear = parseInt(filters.year, 10);
        const resolvedYear = Number.isFinite(parsedYear) ? parsedYear : now.getFullYear();
        const startDate = new Date(resolvedYear, 0, 1);
        const endDate = new Date(resolvedYear, 11, 31);

        return {
            ...baseResult,
            filter: (date) => (
                date instanceof Date
                && !Number.isNaN(date.getTime())
                && date.getFullYear() === resolvedYear
            ),
            startDate,
            endDate,
            hasDateFilter: true,
            year: resolvedYear,
        };
    }

    const startDate = parseDateKeyToDate(filters.startDate);
    const endDate = parseDateKeyToDate(filters.endDate);
    const hasStart = Boolean(startDate);
    const hasEnd = Boolean(endDate);

    return {
        ...baseResult,
        filter: (date) => {
            if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
                return false;
            }
            if (hasStart && date < startDate) {
                return false;
            }
            if (hasEnd && date > endDate) {
                return false;
            }
            return true;
        },
        startDate: hasStart ? startDate : null,
        endDate: hasEnd ? endDate : null,
        hasDateFilter: hasStart || hasEnd,
    };
};

const resolveProductStandardTimeForDate = (product, referenceDate) => {
    if (!product) {
        return 0;
    }

    const reference = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
        ? referenceDate
        : null;

    if (reference) {
        const history = Array.isArray(product.standardTimeHistory) ? product.standardTimeHistory : [];
        let matchedTime = null;
        let matchedDate = null;

        history.forEach((entry) => {
            if (!entry) {
                return;
            }
            const effectiveDate = parseDateKeyToDate(entry.effectiveDate || entry.date || entry.startDate);
            if (!effectiveDate || effectiveDate > reference) {
                return;
            }
            const timeValue = parseFloat(entry.time ?? entry.value ?? entry.standardTime);
            if (!Number.isFinite(timeValue) || timeValue <= 0) {
                return;
            }
            if (!matchedDate || effectiveDate > matchedDate) {
                matchedDate = effectiveDate;
                matchedTime = timeValue;
            }
        });

        if (matchedTime !== null) {
            return matchedTime;
        }
    }

    const standardTime = product.standardTime !== undefined ? parseFloat(product.standardTime) : NaN;
    return Number.isFinite(standardTime) && standardTime > 0 ? standardTime : 0;
};

const buildProductMapForDate = (products, referenceDate) => {
    const map = new Map();
    (products || []).forEach((product) => {
        if (!product || !product.id) {
            return;
        }
        const key = String(product.id);
        map.set(key, {
            ...product,
            standardTime: resolveProductStandardTimeForDate(product, referenceDate),
        });
    });
    return map;
};

const resolveDetailProductId = (detail, lotProductLookup) => {
    if (!detail) {
        return '';
    }

    if (detail.productId) {
        return String(detail.productId);
    }

    if (detail.productBaseId) {
        return String(detail.productBaseId);
    }

    if (detail.baseProductId) {
        return String(detail.baseProductId);
    }

    if (detail.lotId && lotProductLookup?.has(detail.lotId)) {
        return String(lotProductLookup.get(detail.lotId));
    }

    return '';
};

const filterProductionDetailsByProducts = (
    details,
    hasProductFilter,
    selectedProductIds,
    lotProductLookup,
) => {
    const list = Array.isArray(details) ? details : [];
    if (!hasProductFilter) {
        return list;
    }
    return list.filter((detail) => {
        const productId = resolveDetailProductId(detail, lotProductLookup);
        return productId && selectedProductIds.has(String(productId));
    });
};

const filterTraveteEntryByProducts = (
    entry,
    hasProductFilter,
    selectedProductIds,
    lotProductLookup,
) => {
    if (!hasProductFilter) {
        return { ...entry };
    }

    const employees = Array.isArray(entry.employeeEntries) ? entry.employeeEntries : [];
    const filteredEmployees = employees
        .map((employee) => {
            const productsArray = getEmployeeProducts(employee);
            const filteredProducts = productsArray.filter((detail) => {
                const productId = resolveDetailProductId(detail, lotProductLookup);
                return productId && selectedProductIds.has(String(productId));
            });

            if (filteredProducts.length === 0) {
                return null;
            }

            const nextEmployee = { ...employee };
            if (Array.isArray(employee.products)) {
                nextEmployee.products = filteredProducts;
            }
            if (Array.isArray(employee.productionDetails)) {
                nextEmployee.productionDetails = filteredProducts;
            }
            if (!Array.isArray(employee.products) && !Array.isArray(employee.productionDetails)) {
                nextEmployee.products = filteredProducts;
            }
            return nextEmployee;
        })
        .filter(Boolean);

    if (filteredEmployees.length === 0) {
        return null;
    }

    return {
        ...entry,
        employeeEntries: filteredEmployees,
    };
};

const formatPeriodLabelWithDate = (date, period) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return period || '';
    }
    const dateLabel = date.toLocaleDateString('pt-BR');
    return period ? `${dateLabel} - ${period}` : dateLabel;
};

const buildProcessedDailyEntries = (entries = []) => {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [];
    }

    const sorted = [...entries].sort((a, b) => {
        if (a.date && b.date && a.date.getTime() !== b.date.getTime()) {
            return a.date.getTime() - b.date.getTime();
        }
        return (a.period || '').localeCompare(b.period || '');
    });

    let cumulativeProduction = 0;
    let cumulativeGoal = 0;
    let cumulativeEfficiencySum = 0;

    return sorted.map((entry, index) => {
        const producedValue = Number(entry.totalProduced) || 0;
        const goalValue = Number(entry.numericGoal) || 0;
        const efficiencyValue = Number(entry.efficiency) || 0;

        cumulativeProduction += producedValue;
        cumulativeGoal += goalValue;
        cumulativeEfficiencySum += efficiencyValue;

        const cumulativeEfficiency = parseFloat((cumulativeEfficiencySum / (index + 1)).toFixed(2));

        return {
            period: formatPeriodLabelWithDate(entry.date, entry.period),
            people: entry.people,
            availableTime: entry.availableTime,
            goalForDisplay: entry.goalForDisplay,
            goal: goalValue,
            produced: producedValue,
            producedForDisplay: entry.producedForDisplay,
            efficiency: efficiencyValue,
            cumulativeProduction,
            cumulativeGoal,
            cumulativeEfficiency,
            observation: entry.observation,
        };
    });
};

const buildRegularSummary = (dailyEntries = []) => {
    if (!Array.isArray(dailyEntries) || dailyEntries.length === 0) {
        return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
    }

    const lastEntry = dailyEntries[dailyEntries.length - 1];

    return {
        totalProduced: Number(lastEntry.cumulativeProduction) || 0,
        totalGoal: Number(lastEntry.cumulativeGoal) || 0,
        lastHourEfficiency: Number(lastEntry.efficiency) || 0,
        averageEfficiency: Number(lastEntry.cumulativeEfficiency) || 0,
    };
};

const buildTraveteSummary = (entries = []) => {
    if (!Array.isArray(entries) || entries.length === 0) {
        return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
    }

    const employeeStatsMap = new Map();

    entries.forEach((entry) => {
        (entry.employees || []).forEach((employee, index) => {
            const key = employee.employeeId ?? index;
            const previous = employeeStatsMap.get(key) || {
                produced: 0,
                goal: 0,
                lastEfficiency: 0,
                cumulativeEfficiency: 0,
            };

            const producedValue = Number(employee.cumulativeProduced ?? employee.produced ?? 0) || 0;
            const goalValue = Number(employee.cumulativeMeta ?? employee.meta ?? 0) || 0;
            const lastEfficiencyValue = Number(employee.efficiency) || previous.lastEfficiency || 0;
            const cumulativeEfficiencyValue = Number(employee.cumulativeEfficiency ?? employee.efficiency ?? 0) || 0;

            employeeStatsMap.set(key, {
                produced: Math.max(previous.produced, producedValue),
                goal: Math.max(previous.goal, goalValue),
                lastEfficiency: lastEfficiencyValue || previous.lastEfficiency,
                cumulativeEfficiency: Math.max(previous.cumulativeEfficiency, cumulativeEfficiencyValue),
            });
        });
    });

    const stats = Array.from(employeeStatsMap.values());
    if (stats.length === 0) {
        return { totalProduced: 0, totalGoal: 0, lastHourEfficiency: 0, averageEfficiency: 0 };
    }

    const totalProduced = stats.reduce((sum, stat) => sum + (stat.produced || 0), 0);
    const totalGoal = stats.reduce((sum, stat) => sum + (stat.goal || 0), 0);
    const lastHourEfficiency = parseFloat((stats.reduce((sum, stat) => sum + (stat.lastEfficiency || 0), 0) / stats.length || 0).toFixed(2));
    const averageEfficiency = parseFloat((stats.reduce((sum, stat) => sum + (stat.cumulativeEfficiency || 0), 0) / stats.length || 0).toFixed(2));

    return { totalProduced, totalGoal, lastHourEfficiency, averageEfficiency };
};

const buildRegularMonthlySummary = (dailyAggregates) => {
    if (!(dailyAggregates instanceof Map) || dailyAggregates.size === 0) {
        return { totalProduction: 0, totalGoal: 0, averageEfficiency: 0 };
    }

    let totalProduction = 0;
    let totalGoal = 0;
    let efficiencySum = 0;
    let productiveDays = 0;

    dailyAggregates.forEach((day) => {
        const dayProduction = Number(day.totalProduction) || 0;
        const dayGoal = Number(day.totalGoal) || 0;
        const entryCount = Number(day.entryCount) || 0;
        totalProduction += dayProduction;
        totalGoal += dayGoal;
        if (entryCount > 0) {
            efficiencySum += (Number(day.efficiencySum) || 0) / entryCount;
            productiveDays += 1;
        }
    });

    const averageEfficiency = productiveDays > 0
        ? parseFloat((efficiencySum / productiveDays).toFixed(2))
        : 0;

    return { totalProduction, totalGoal, averageEfficiency };
};

const buildTraveteMonthlySummary = (traveteAggregates) => {
    if (!(traveteAggregates instanceof Map) || traveteAggregates.size === 0) {
        return { totalProduction: 0, totalGoal: 0, averageEfficiency: 0 };
    }

    let totalProduction = 0;
    let totalGoal = 0;
    let efficiencySum = 0;
    let productiveDays = 0;

    traveteAggregates.forEach((day) => {
        const dayProduction = Number(day.totalProduction) || 0;
        const dayGoal = Number(day.totalGoal) || 0;
        const samples = Number(day.samples) || 0;
        totalProduction += dayProduction;
        totalGoal += dayGoal;
        if (samples > 0) {
            efficiencySum += (Number(day.efficiencySum) || 0) / samples;
            productiveDays += 1;
        }
    });

    const averageEfficiency = productiveDays > 0
        ? parseFloat((efficiencySum / productiveDays).toFixed(2))
        : 0;

    return { totalProduction, totalGoal, averageEfficiency };
};

const buildRegularMonthlyBreakdown = (dailyAggregates) => {
    if (!(dailyAggregates instanceof Map) || dailyAggregates.size === 0) {
        return [];
    }

    const breakdown = [];

    dailyAggregates.forEach((day, dateKey) => {
        const referenceDate = parseDateKeyToDate(dateKey);
        if (!referenceDate) {
            return;
        }

        const entryCount = Number(day.entryCount) || 0;
        const averageEfficiency = entryCount > 0
            ? parseFloat(((Number(day.efficiencySum) || 0) / entryCount).toFixed(2))
            : 0;

        breakdown.push({
            date: referenceDate,
            totalGoal: Number(day.totalGoal) || 0,
            totalProduction: Number(day.totalProduction) || 0,
            averageEfficiency,
        });
    });

    breakdown.sort((a, b) => a.date.getTime() - b.date.getTime());
    return breakdown;
};

const buildTraveteMonthlyBreakdown = (traveteAggregates) => {
    if (!(traveteAggregates instanceof Map) || traveteAggregates.size === 0) {
        return [];
    }

    const breakdown = [];

    traveteAggregates.forEach((day, dateKey) => {
        const referenceDate = parseDateKeyToDate(dateKey);
        if (!referenceDate) {
            return;
        }

        const samples = Number(day.samples) || 0;
        const averageEfficiency = samples > 0
            ? parseFloat(((Number(day.efficiencySum) || 0) / samples).toFixed(2))
            : 0;

        breakdown.push({
            date: referenceDate,
            totalGoal: Number(day.totalGoal) || 0,
            totalProduction: Number(day.totalProduction) || 0,
            averageEfficiency,
        });
    });

    breakdown.sort((a, b) => a.date.getTime() - b.date.getTime());
    return breakdown;
};

const buildLotSummaryForFilters = ({
    lots = [],
    productLookupMap = new Map(),
    selectedProductIds = new Set(),
    hasProductFilter = false,
    includeOnlyCompletedLots = false,
    dateFilter = null,
}) => {
    if (!Array.isArray(lots) || lots.length === 0) {
        return { completed: [], active: [], overallAverage: 0 };
    }

    const completed = [];
    const active = [];
    let totalPieces = 0;
    let totalDays = 0;

    const filterFn = dateFilter && typeof dateFilter.filter === 'function'
        ? dateFilter.filter
        : (() => true);
    const hasDateFilter = Boolean(dateFilter?.hasDateFilter);

    lots.forEach((lot) => {
        if (!lot || typeof lot !== 'object') {
            return;
        }

        const statusRaw = lot.status || '';
        const status = typeof statusRaw === 'string' ? statusRaw.toLowerCase() : String(statusRaw);
        const isCompleted = status.startsWith('completed');
        if (includeOnlyCompletedLots && !isCompleted) {
            return;
        }

        const productIdRaw = lot.productId || lot.productBaseId || lot.baseProductId || lot.productBaseName;
        const productId = productIdRaw ? String(productIdRaw) : '';
        if (hasProductFilter && (!productId || !selectedProductIds.has(productId))) {
            return;
        }

        const produced = parseFloat(lot.produced) || 0;
        const target = parseFloat(lot.target) || 0;
        const efficiency = target > 0 ? parseFloat(((produced / target) * 100).toFixed(2)) : 0;
        const lotName = formatDefaultLotDisplayName(lot, productLookupMap.get(productId));

        const startDate = parseDateKeyToDate(lot.startDate);
        const endDate = parseDateKeyToDate(lot.endDate);

        const matchesDateFilter = (() => {
            if (!hasDateFilter) {
                return true;
            }
            if (endDate) {
                return filterFn(endDate);
            }
            if (startDate) {
                return filterFn(startDate);
            }
            return false;
        })();

        if (!matchesDateFilter) {
            return;
        }

        if (isCompleted) {
            let duration = 0;
            if (startDate && endDate) {
                const diff = endDate.getTime() - startDate.getTime();
                if (Number.isFinite(diff)) {
                    duration = Math.max(1, diff / (1000 * 60 * 60 * 24));
                }
            }
            const averageDaily = duration > 0 ? produced / duration : 0;
            completed.push({
                id: lot.id,
                name: lotName,
                produced,
                target,
                efficiency,
                duration,
                averageDaily,
                endDate: lot.endDate || '',
            });

            if (duration > 0) {
                totalPieces += produced;
                totalDays += duration;
            }
        } else if (!includeOnlyCompletedLots) {
            active.push({
                id: lot.id,
                name: lotName,
                produced,
                target,
                efficiency,
                status,
            });
        }
    });

    completed.sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''));
    active.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const overallAverage = totalDays > 0 ? totalPieces / totalDays : 0;

    return { completed, active, overallAverage };
};

export const fetchDashboardPerformanceIndicators = async ({
    dashboardId,
    filters = {},
    dbInstance = db,
}) => {
    if (!dashboardId) {
        throw new Error('dashboardId é obrigatório para carregar os indicadores.');
    }

    const dateFilter = resolveDateFilter(filters);

    const [dashboardSnap, productsSnap, lotsSnap, productionSnap] = await Promise.all([
        getDoc(doc(dbInstance, 'dashboards', dashboardId)).catch(() => null),
        getDocs(collection(dbInstance, `dashboards/${dashboardId}/products`)).catch(() => ({ docs: [] })),
        getDocs(query(collection(dbInstance, `dashboards/${dashboardId}/lots`), orderBy('order'))).catch(() => ({ docs: [] })),
        getDoc(doc(dbInstance, `dashboards/${dashboardId}/productionData`, 'data')).catch(() => null),
    ]);

    const dashboardData = dashboardSnap && dashboardSnap.exists() ? dashboardSnap.data() : { id: dashboardId };
    const dashboardName = dashboardData?.name || dashboardData?.title || dashboardId;
    const isTraveteDashboard = dashboardId === 'travete'
        || dashboardData?.isTraveteDashboard
        || dashboardData?.type === 'travete';

    const products = productsSnap?.docs?.map((docSnap) => docSnap.data()) || [];
    const lots = lotsSnap?.docs?.map((docSnap) => docSnap.data()) || [];
    const allProductionData = productionSnap && productionSnap.exists() ? productionSnap.data() : {};

    const productLookupMap = buildProductLookupMap(products);
    const lotProductLookup = new Map();
    lots.forEach((lot) => {
        if (!lot || !lot.id) {
            return;
        }
        const productId = lot.productId || lot.productBaseId || lot.baseProductId || lot.productBaseName;
        if (productId) {
            lotProductLookup.set(lot.id, String(productId));
        }
    });

    const selectedProductIds = new Set((filters.products || []).map((value) => String(value)).filter(Boolean));
    const hasProductFilter = selectedProductIds.size > 0;
    const allowTraveteEntries = isTraveteDashboard || filters.includeTravetes !== false;

    const regularEntriesRaw = [];
    const dailyAggregates = new Map();
    const traveteEntriesByDate = new Map();
    const traveteDailyAggregates = new Map();

    Object.entries(allProductionData || {}).forEach(([dateKey, entries]) => {
        const referenceDate = parseDateKeyToDate(dateKey);
        if (!referenceDate) {
            return;
        }

        if (!dateFilter.filter(referenceDate)) {
            return;
        }

        const entryList = Array.isArray(entries) ? entries : [];
        const productMapForDate = buildProductMapForDate(products, referenceDate);

        entryList.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }

            const isTraveteEntry = Boolean(entry.type === 'travete' || entry.isTravete);
            if (isTraveteEntry) {
                if (!allowTraveteEntries) {
                    return;
                }
                const filteredEntry = filterTraveteEntryByProducts(entry, hasProductFilter, selectedProductIds, lotProductLookup);
                if (!filteredEntry) {
                    return;
                }

                const existing = traveteEntriesByDate.get(dateKey);
                if (existing) {
                    existing.entries.push(filteredEntry);
                } else {
                    traveteEntriesByDate.set(dateKey, {
                        date: referenceDate,
                        entries: [filteredEntry],
                        productMap: productMapForDate,
                    });
                }
                return;
            }

            const filteredDetails = filterProductionDetailsByProducts(
                entry.productionDetails,
                hasProductFilter,
                selectedProductIds,
                lotProductLookup,
            );

            if (hasProductFilter && filteredDetails.length === 0) {
                return;
            }

            let totalProduced = 0;
            let totalTimeValue = 0;
            filteredDetails.forEach((detail) => {
                const produced = Number(detail?.produced) || 0;
                totalProduced += produced;
                const detailProductId = resolveDetailProductId(detail, lotProductLookup);
                const product = detailProductId ? productMapForDate.get(detailProductId) : null;
                const standardTime = product?.standardTime !== undefined ? Number(product.standardTime) || 0 : 0;
                if (standardTime > 0) {
                    totalTimeValue += produced * standardTime;
                }
            });

            if (hasProductFilter && totalProduced === 0) {
                return;
            }

            const goalSegments = splitGoalSegments(entry.goalDisplay || '');
            const goalForDisplay = goalSegments.length > 0
                ? joinGoalSegments(goalSegments)
                : (entry.goalDisplay || '');
            const numericGoal = sumGoalDisplay(entry.goalDisplay || '');

            const people = Number(entry.people) || 0;
            const availableTime = Number(entry.availableTime) || 0;
            const totalAvailableTime = people > 0 && availableTime > 0 ? people * availableTime : 0;
            const efficiency = totalAvailableTime > 0
                ? parseFloat(((totalTimeValue / totalAvailableTime) * 100).toFixed(2))
                : 0;

            const producedForDisplay = filteredDetails.length > 0
                ? filteredDetails.map((detail) => `${detail.produced || 0}`).join(' / ')
                : (entry.producedForDisplay
                    || (Array.isArray(entry.productionDetails)
                        ? entry.productionDetails.map((detail) => `${detail.produced || 0}`).join(' / ')
                        : `${entry.produced || 0}`));

            regularEntriesRaw.push({
                date: referenceDate,
                dateKey,
                period: entry.period || '',
                people,
                availableTime,
                goalForDisplay,
                numericGoal,
                totalProduced,
                producedForDisplay,
                efficiency,
                observation: entry.observation || '',
            });

            const dayAggregate = dailyAggregates.get(dateKey) || { totalGoal: 0, totalProduction: 0, efficiencySum: 0, entryCount: 0 };
            dayAggregate.totalGoal += numericGoal;
            dayAggregate.totalProduction += totalProduced;
            dayAggregate.efficiencySum += efficiency;
            dayAggregate.entryCount += 1;
            dailyAggregates.set(dateKey, dayAggregate);
        });
    });

    const processedDailyEntries = buildProcessedDailyEntries(regularEntriesRaw);

    const traveteProcessedEntries = [];
    traveteEntriesByDate.forEach(({ date, entries, productMap }, dateKey) => {
        const processed = buildTraveteProcessedEntries(entries, productMap);
        if (!processed || processed.length === 0) {
            return;
        }

        processed.forEach((entry) => {
            traveteProcessedEntries.push({
                ...entry,
                period: formatPeriodLabelWithDate(date, entry.period),
            });
        });

        const dayAggregate = traveteDailyAggregates.get(dateKey) || { totalGoal: 0, totalProduction: 0, efficiencySum: 0, samples: 0 };
        processed.forEach((entry) => {
            (entry.employees || []).forEach((emp) => {
                const metaValue = Number(emp.meta) || 0;
                const producedValue = Number(emp.produced) || 0;
                const efficiencyValue = Number(emp.efficiency) || 0;
                dayAggregate.totalGoal += metaValue;
                dayAggregate.totalProduction += producedValue;
                if (efficiencyValue > 0) {
                    dayAggregate.efficiencySum += efficiencyValue;
                    dayAggregate.samples += 1;
                }
            });
        });
        traveteDailyAggregates.set(dateKey, dayAggregate);
    });

    const useTraveteSummaries = isTraveteDashboard || traveteProcessedEntries.length > 0;

    const summary = useTraveteSummaries
        ? buildTraveteSummary(traveteProcessedEntries)
        : buildRegularSummary(processedDailyEntries);

    const monthlySummary = useTraveteSummaries
        ? buildTraveteMonthlySummary(traveteDailyAggregates)
        : buildRegularMonthlySummary(dailyAggregates);

    const monthlyBreakdown = useTraveteSummaries
        ? buildTraveteMonthlyBreakdown(traveteDailyAggregates)
        : buildRegularMonthlyBreakdown(dailyAggregates);

    const lotSummary = buildLotSummaryForFilters({
        lots,
        productLookupMap,
        selectedProductIds,
        hasProductFilter,
        includeOnlyCompletedLots: filters.includeOnlyCompletedLots,
        dateFilter,
    });

    const selectedDate = dateFilter.endDate || dateFilter.startDate || new Date();
    const currentMonth = dateFilter.startDate
        ? new Date(dateFilter.startDate.getFullYear(), dateFilter.startDate.getMonth(), 1)
        : new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);

    const appliedFilters = {
        ...filters,
        periodType: dateFilter.periodType,
        startDate: dateFilter.startDate ? formatDateToKey(dateFilter.startDate) : (filters.startDate || ''),
        endDate: dateFilter.endDate ? formatDateToKey(dateFilter.endDate) : (filters.endDate || ''),
        month: dateFilter.month ? String(dateFilter.month).padStart(2, '0') : (filters.month || ''),
        year: dateFilter.year ? String(dateFilter.year) : (filters.year || ''),
    };

    return {
        dashboardId,
        dashboardName,
        isTraveteDashboard,
        summary,
        monthlySummary,
        monthlyBreakdown,
        dailyEntries: processedDailyEntries,
        traveteEntries: traveteProcessedEntries,
        lotSummary,
        appliedFilters,
        selectedDate,
        currentMonth,
    };
};

export default fetchDashboardPerformanceIndicators;
