import React, { useEffect, useRef } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { TRAVETE_MACHINES, raceBullLogoUrl } from './constants';

const JSPDF_CDN_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
const JSPDF_AUTOTABLE_CDN_URL = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.1/dist/jspdf.plugin.autotable.min.js';

const loadScriptOnce = (src) => new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
        reject(new Error('Scripts can only be loaded in the browser.'));
        return;
    }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
        if (existing.dataset.loaded === 'true') {
            resolve();
            return;
        }
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', (event) => reject(event?.error || new Error(`Falha ao carregar script: ${src}`)));
        return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.loaded = 'false';
    script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
    };
    script.onerror = (event) => reject(event?.error || new Error(`Falha ao carregar script: ${src}`));
    document.head.appendChild(script);
});

let jsPdfLoaderPromise = null;

const ensureJsPdfResources = async () => {
    if (jsPdfLoaderPromise) {
        return jsPdfLoaderPromise;
    }
    jsPdfLoaderPromise = (async () => {
        if (typeof window === 'undefined') {
            throw new Error('Exportação de PDF disponível apenas no navegador.');
        }
        await loadScriptOnce(JSPDF_CDN_URL);
        const globalJsPdf = window.jspdf;
        if (!globalJsPdf || !globalJsPdf.jsPDF) {
            throw new Error('Não foi possível carregar o jsPDF.');
        }
        if (!globalJsPdf.jsPDF.API?.autoTable) {
            await loadScriptOnce(JSPDF_AUTOTABLE_CDN_URL);
        }
        if (!globalJsPdf.jsPDF.API?.autoTable) {
            throw new Error('Não foi possível carregar o plugin jsPDF-Autotable.');
        }
        return globalJsPdf;
    })();
    return jsPdfLoaderPromise;
};

const formatLocaleNumber = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return numeric.toLocaleString('pt-BR');
};

const formatPercentageLabel = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0,00%';
    return `${numeric.toFixed(2)}%`;
};

const LOT_STATUS_LABELS = {
    future: 'Na Fila',
    ongoing: 'Em Andamento',
    completed: 'Concluído',
    completed_missing: 'Concluído (com Falta)',
    completed_exceeding: 'Concluído (com Sobra)',
};

export const getLotStatusLabel = (status, fallback = '') => {
    if (!status) {
        return fallback;
    }

    const normalized = String(status).toLowerCase();

    if (LOT_STATUS_LABELS[normalized]) {
        return LOT_STATUS_LABELS[normalized];
    }

    if (normalized.startsWith('completed')) {
        if (normalized.includes('missing')) {
            return LOT_STATUS_LABELS.completed_missing;
        }
        if (normalized.includes('exceeding')) {
            return LOT_STATUS_LABELS.completed_exceeding;
        }
        return LOT_STATUS_LABELS.completed;
    }

    return typeof status === 'string' ? status : fallback;
};

const CALENDAR_VIEW_LABELS = {
    day: 'Dia',
    month: 'Mês',
    year: 'Ano',
};

const FILTER_LABELS_MAP = {
    dashboardName: 'Dashboard',
    selectedDate: 'Data selecionada',
    currentMonth: 'Mês de referência',
    calendarView: 'Visão do calendário',
    lotFilter: 'Filtro de lotes',
    showUrgent: 'Item fora de ordem ativo',
    isTraveteDashboard: 'Dashboard Travete',
};

const tryParseDateValue = (value) => {
    if (!value) {
        return null;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value?.toDate === 'function') {
        const asDate = value.toDate();
        if (asDate instanceof Date && !Number.isNaN(asDate.getTime())) {
            return asDate;
        }
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return null;
};

const isPlainObject = (value) => (
    value !== null
    && typeof value === 'object'
    && Object.prototype.toString.call(value) === '[object Object]'
);

const formatFiltersSummaryValue = (key, rawValue) => {
    if (rawValue === undefined || rawValue === null) {
        return '-';
    }

    if (typeof rawValue === 'boolean') {
        return rawValue ? 'Sim' : 'Não';
    }

    if (key === 'calendarView') {
        const normalized = String(rawValue).toLowerCase();
        if (CALENDAR_VIEW_LABELS[normalized]) {
            return CALENDAR_VIEW_LABELS[normalized];
        }
        return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : '-';
    }

    if (key === 'lotFilter') {
        return getLotStatusLabel(rawValue, '-');
    }

    if (key === 'currentMonth') {
        const parsedMonth = tryParseDateValue(rawValue);
        if (parsedMonth) {
            return parsedMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        }
    }

    if (key === 'selectedDate') {
        const parsedDate = tryParseDateValue(rawValue);
        if (parsedDate) {
            return parsedDate.toLocaleDateString('pt-BR');
        }
    }

    const parsedValueAsDate = tryParseDateValue(rawValue);
    if (parsedValueAsDate) {
        return parsedValueAsDate.toLocaleDateString('pt-BR');
    }

    if (typeof rawValue === 'number') {
        return Number.isFinite(rawValue) ? rawValue.toLocaleString('pt-BR') : '-';
    }

    if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        return trimmed || '-';
    }

    return String(rawValue);
};

export const buildFiltersSummaryEntries = (filtersSummary = {}) => {
    if (!filtersSummary || typeof filtersSummary !== 'object') {
        return [];
    }

    return Object.entries(filtersSummary).map(([key, rawValue]) => ({
        key,
        label: FILTER_LABELS_MAP[key] || key,
        value: formatFiltersSummaryValue(key, rawValue),
    }));
};

export const generateId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export async function sha256Hex(message) {
    const data = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const ADMIN_PASSWORD_HASH = (process.env.REACT_APP_ADMIN_PASSWORD_HASH || '').trim();
export const IS_VALID_ADMIN_PASSWORD_HASH = /^[a-f0-9]{64}$/i.test(ADMIN_PASSWORD_HASH);


// --- ESTILOS GLOBAIS E ANIMAÇÕES ---
export const GlobalStyles = () => (
    <style>{`
        :root {
            --font-size-title: clamp(18px, 1.8vw, 28px);
            --font-size-text: clamp(13px, 1.2vw, 18px);
            --container-padding: clamp(12px, 2vw, 32px);
            --container-gap: clamp(12px, 2vw, 32px);
            --app-max-width: 1600px;
        }
        body {
            font-size: var(--font-size-text);
            margin: 0;
        }
        .responsive-root {
            padding-inline: var(--container-padding);
        }
        .responsive-main {
            width: min(100%, var(--app-max-width));
            margin: 0 auto;
        }
        .responsive-main,
        .dashboard-grid,
        .responsive-grid {
            gap: var(--container-gap);
        }
        .dashboard-grid {
            display: grid;
            grid-template-columns: 1fr;
        }
        .responsive-card,
        .dashboard-card {
            width: 100%;
        }
        .responsive-actions {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        .responsive-actions > * {
            width: 100%;
        }
        .responsive-form-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 1rem;
        }
        .responsive-tv {
            height: calc(100vh - 120px);
            overflow-y: auto;
        }
        @media (min-width: 769px) {
            .responsive-actions {
                flex-direction: row;
                align-items: center;
            }
            .responsive-actions > * {
                width: auto;
            }
            .responsive-form-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }
        @media (min-width: 1025px) {
            .dashboard-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }
        @media (min-width: 1280px) {
            .dashboard-grid {
                grid-template-columns: repeat(3, minmax(0, 1fr));
            }
        }
        @media (min-width: 1536px) {
            .responsive-main {
                width: min(100%, var(--app-max-width));
            }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleUp { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blinking-red {
            0% { background-color: transparent; }
            50% { background-color: rgba(239, 68, 68, 0.5); }
            100% { background-color: transparent; }
        }
        .blinking-red {
            animation: blinking-red 1s infinite;
        }
        .modal-backdrop { animation: fadeIn 0.2s ease-out forwards; }
        .modal-content { animation: scaleUp 0.2s ease-out forwards; }
        .dropdown-content { animation: slideDown 0.2s ease-out forwards; }
    `}</style>
);


export const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
    const modalRef = useRef();
    useClickOutside(modalRef, onClose);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md modal-content">
                <h2 className="text-xl font-bold mb-4">{title || 'Confirmar Ação'}</h2>
                <p className="mb-6">{message || 'Você tem certeza?'}</p>
                <div className="flex justify-end gap-4">
                    <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600">Cancelar</button>
                    <button onClick={() => { if (onConfirm) { onConfirm(); } onClose(); }} className="px-4 py-2 rounded-md bg-red-600 text-white">Confirmar</button>
                </div>
            </div>
        </div>
    );
};

// --- HOOKS CUSTOMIZADOS ---
export const useClickOutside = (ref, handler) => {
    useEffect(() => {
        const listener = (event) => {
            if (!ref.current || ref.current.contains(event.target)) return;
            handler(event);
        };
        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [ref, handler]);
};

export const usePrevious = (value) => {
    const ref = useRef();
    useEffect(() => {
        ref.current = value;
    });
    return ref.current;
};

export const createTraveteProductFormState = () => ({
    baseName: '',
    baseTime: '',
    createTwoNeedle: true,
    createOneNeedle: true,
    createConventional: true,
    oneNeedleTime: '',
    conventionalTime: '',
    oneNeedleManual: false,
    conventionalManual: false,
});

export const createDefaultTraveteProductItem = (overrides = {}) => ({
    lotId: '',
    produced: '',
    isAutoSuggested: false,
    ...overrides,
});

export const createDefaultTraveteEmployee = (employeeId) => ({
    employeeId,
    machineType: employeeId === 1 ? 'Travete 2 Agulhas' : 'Travete 1 Agulha',
    standardTime: '',
    standardTimeManual: false,
    products: [createDefaultTraveteProductItem()],
});

export const createDefaultOperationDestinations = (machine) => {
    const normalized = normalizeTraveteMachineType(machine || '');
    const traveteFlags = {};
    TRAVETE_MACHINES.forEach((machineType) => {
        traveteFlags[machineType] = normalized === machineType;
    });
    return {
        production: !normalized,
        travete: traveteFlags,
    };
};

export const normalizeOperationDestinations = (destinos, machine) => {
    const base = createDefaultOperationDestinations(machine);
    if (!destinos || typeof destinos !== 'object') {
        return base;
    }

    const normalized = {
        production: typeof destinos.production === 'boolean' ? destinos.production : base.production,
        travete: { ...base.travete },
    };

    const traveteSource = destinos.travete && typeof destinos.travete === 'object' ? destinos.travete : destinos;
    TRAVETE_MACHINES.forEach((machineType) => {
        const value = traveteSource[machineType];
        if (typeof value === 'boolean') {
            normalized.travete[machineType] = value;
        }
    });

    if (typeof destinos.manuallyEdited === 'boolean') {
        normalized.manuallyEdited = destinos.manuallyEdited;
    } else if (typeof destinos.destinosManualmenteEditados === 'boolean') {
        normalized.manuallyEdited = destinos.destinosManualmenteEditados;
    }

    return normalized;
};

export const createOperationalSequenceOperation = (overrides = {}) => {
    const {
        id: overrideId,
        destinos,
        destinations,
        destinosManualmenteEditados,
        machine,
        ...restOverrides
    } = overrides;

    const machineValue = restOverrides.maquina || machine || '';
    const normalizedDestinos = normalizeOperationDestinations(destinos || destinations, machineValue);
    const manuallyEdited = destinosManualmenteEditados
        ?? destinos?.manuallyEdited
        ?? destinations?.manuallyEdited
        ?? false;

    return {
        id: overrideId ?? generateId('seqOp'),
        numero: '',
        descricao: '',
        maquina: '',
        tempoValor: '',
        unidade: 'min',
        ...restOverrides,
        destinos: normalizedDestinos,
        destinosManualmenteEditados: manuallyEdited,
    };
};

export const convertOperationToSeconds = (operation) => {
    const value = parseFloat(operation?.tempoValor);
    if (!(value > 0)) return 0;
    return (operation?.unidade || 'min') === 'seg' ? value : value * 60;
};

export const formatSecondsToDurationLabel = (totalSeconds) => {
    if (!(totalSeconds > 0)) return '00:00 min';
    const rounded = Math.round(totalSeconds);
    const minutes = Math.floor(rounded / 60);
    const seconds = Math.max(0, rounded % 60);
    const minutesLabel = String(minutes).padStart(2, '0');
    const secondsLabel = String(seconds).padStart(2, '0');
    return `${minutesLabel}:${secondsLabel} min`;
};

const RACE_BULL_LOGO_STORAGE_PATH = 'logos/racebull_logo.png';
let cachedOperationalLogoDataUrl = null;

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

const convertImageToDataUrlViaCanvas = (url) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return Promise.resolve('');
    }

    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext('2d');
                if (!context) {
                    resolve('');
                    return;
                }
                context.drawImage(image, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (error) {
                reject(error);
            }
        };
        image.onerror = reject;
        image.src = url;
    });
};

const getImageFormatFromDataUrl = (dataUrl) => {
    if (typeof dataUrl !== 'string') {
        return 'PNG';
    }
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
        return 'JPEG';
    }
    if (dataUrl.startsWith('data:image/webp')) {
        return 'WEBP';
    }
    return 'PNG';
};

const fetchOperationalLogoDataUrl = async () => {
    if (cachedOperationalLogoDataUrl !== null) {
        return cachedOperationalLogoDataUrl;
    }
    const tryConvertToDataUrl = async (url) => {
        if (!url) return '';
        try {
            const response = await fetch(url, { cache: 'no-store', mode: 'cors', credentials: 'omit' });
            if (!response.ok) {
                throw new Error(`Falha ao carregar logo: ${response.status}`);
            }
            const blob = await response.blob();
            const dataUrl = await blobToDataURL(blob);
            return typeof dataUrl === 'string' ? dataUrl : '';
        } catch (networkError) {
            try {
                const dataUrl = await convertImageToDataUrlViaCanvas(url);
                return typeof dataUrl === 'string' ? dataUrl : '';
            } catch (canvasError) {
                console.warn('Falha ao converter a logo para DataURL.', canvasError || networkError);
                return '';
            }
        }
    };

    if (raceBullLogoUrl) {
        try {
            const logoFromConstant = await tryConvertToDataUrl(raceBullLogoUrl);
            cachedOperationalLogoDataUrl = logoFromConstant;
            if (logoFromConstant) {
                return logoFromConstant;
            }
        } catch (error) {
            console.warn('Não foi possível carregar a logo usando a URL configurada, tentando buscar pelo Storage.', error);
        }
    }

    if (storage) {
        try {
            const logoRef = ref(storage, RACE_BULL_LOGO_STORAGE_PATH);
            const downloadUrl = await getDownloadURL(logoRef);
            const logoFromStorage = await tryConvertToDataUrl(downloadUrl);
            cachedOperationalLogoDataUrl = logoFromStorage;
            return logoFromStorage;
        } catch (error) {
            console.warn('Não foi possível carregar a logo do Firebase Storage, gerando PDF sem imagem.', error);
        }
    }

    cachedOperationalLogoDataUrl = '';
    return '';
};

const addRaceBullLogoToPdf = (doc, logoDataUrl, options = {}) => {
    if (!logoDataUrl) {
        return;
    }

    const {
        align = 'left',
        margin = 15,
        y = 12,
        width = 42,
        height = 18,
    } = options;

    const pageWidth = doc.internal.pageSize.getWidth();
    let x = margin;

    if (align === 'right') {
        x = pageWidth - margin - width;
    } else if (align === 'center') {
        x = (pageWidth - width) / 2;
    }

    doc.addImage(logoDataUrl, getImageFormatFromDataUrl(logoDataUrl), x, y, width, height);
};

const deriveOperationMinutesForPdf = (operation) => {
    if (!operation) return 0;
    if (operation.tempoMinutos !== undefined) {
        const minutes = parseFloat(operation.tempoMinutos);
        if (Number.isFinite(minutes)) return minutes;
    }
    if (operation.tempo !== undefined) {
        const minutes = parseFloat(operation.tempo);
        if (Number.isFinite(minutes)) return minutes;
    }
    if (operation.tempoSegundos !== undefined) {
        const seconds = parseFloat(operation.tempoSegundos);
        if (Number.isFinite(seconds)) return seconds / 60;
    }
    if (operation.tempoValor !== undefined) {
        const value = parseFloat(operation.tempoValor);
        if (Number.isFinite(value)) {
            const unit = operation.unidade || operation.unidadeTempo || 'min';
            return unit === 'seg' ? value / 60 : value;
        }
    }
    return 0;
};

export const exportSequenciaOperacionalPDF = async (modelo, incluirDados = true, options = {}) => {
    const globalJsPdf = await ensureJsPdfResources();
    const { jsPDF } = globalJsPdf;
    const doc = new jsPDF();
    const now = new Date();
    const dateLabel = now.toLocaleDateString('pt-BR');
    const dateTimeLabel = now.toLocaleString('pt-BR');

    const { blankLineCount = 25 } = options;
    const sanitizedBlankLineCount = Math.max(1, Math.floor(Number(blankLineCount) || 0) || 25);

    const logoDataUrl = await fetchOperationalLogoDataUrl();
    addRaceBullLogoToPdf(doc, logoDataUrl);

    doc.setFontSize(14);
    const pageCenterX = doc.internal.pageSize.getWidth() / 2;
    doc.text('SEQUÊNCIA OPERACIONAL', pageCenterX, 22, { align: 'center' });
    doc.setFontSize(10);

    const empresa = (modelo?.empresa || 'RACE BULL').toUpperCase();
    const modeloNome = modelo?.modelo || '__________';

    doc.text(`EMPRESA: ${empresa}`, 15, 38);
    doc.text(`MODELO: ${modeloNome}`, 15, 45);

    const colunas = ['N', 'OPERAÇÃO', 'MÁQUINA', 'TEMPO'];
    let linhas = [];

    if (incluirDados && modelo) {
        const operacoes = Array.isArray(modelo.operacoes) ? modelo.operacoes : [];
        let totalMinutos = 0;
        linhas = operacoes.map((operacao, index) => {
            const numero = operacao?.numero !== undefined ? operacao.numero : index + 1;
            const descricao = operacao?.descricao || operacao?.nome || '';
            const maquina = operacao?.maquina || '';
            const minutos = deriveOperationMinutesForPdf(operacao);
            if (Number.isFinite(minutos)) {
                totalMinutos += minutos;
            }
            return [
                numero,
                descricao,
                maquina,
                Number.isFinite(minutos) && minutos > 0 ? `${minutos.toFixed(2)} min` : '',
            ];
        });

        if (linhas.length === 0) {
            linhas = Array.from({ length: 25 }, (_, index) => [index + 1, '', '', '']);
        } else {
            linhas.push(['', '', 'TOTAL', `${totalMinutos.toFixed(2)} min`]);
        }
    } else {
        linhas = Array.from({ length: sanitizedBlankLineCount }, (_, index) => [index + 1, '', '', '']);
    }

    doc.autoTable({
        startY: 50,
        head: [colunas],
        body: linhas,
        theme: 'grid',
        styles: {
            fontSize: 9,
            halign: 'center',
            lineColor: [0, 0, 0],
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: [0, 0, 0],
            textColor: [255, 255, 255],
            lineColor: [0, 0, 0],
            lineWidth: 0.1,
        },
        bodyStyles: {
            lineColor: [0, 0, 0],
            lineWidth: 0.1,
        },
        columnStyles: {
            1: { halign: 'left' },
            2: { halign: 'left' },
        },
    });

    doc.setFontSize(8);
    doc.text(`Gerado automaticamente pelo Sistema Race Bull – ${dateTimeLabel}`, 15, 285);

    const safeModelName = modelo?.modelo ? modelo.modelo.replace(/\s+/g, '_') : 'SemModelo';
    const nomeArquivo = incluirDados
        ? `Sequencia_Operacional_${safeModelName}_${dateLabel}.pdf`
        : `Sequencia_Operacional_EmBranco_${dateLabel}.pdf`;

    doc.save(nomeArquivo);
};

export const exportDashboardPerformancePDF = (options = {}) => {
    const {
        dashboardName: rawDashboardName,
        selectedDate: rawSelectedDate,
        currentMonth: rawCurrentMonth,
        isTraveteDashboard = false,
        summary = {},
        monthlySummary = {},
        dailyEntries = [],
        traveteEntries = [],
        lotSummary = {},
        monthlyBreakdown = [],
        filtersSummary: providedFiltersSummary = null,
    } = options || {};

    const normalizedFiltersSummary = isPlainObject(providedFiltersSummary)
        ? providedFiltersSummary
        : {};

    const dashboardName = rawDashboardName || 'Dashboard';
    const selectedDate = rawSelectedDate ?? new Date();
    const currentMonth = rawCurrentMonth ?? new Date();

    return ensureJsPdfResources().then((globalJsPdf) => (
        fetchOperationalLogoDataUrl().then((logoDataUrl) => {
            const { jsPDF } = globalJsPdf;
            const doc = new jsPDF();
            const now = new Date();
            const pageWidth = doc.internal.pageSize.getWidth();
            const centerX = pageWidth / 2;
            const selectedDateLabel = selectedDate instanceof Date
                ? selectedDate.toLocaleDateString('pt-BR')
                : new Date(selectedDate).toLocaleDateString('pt-BR');
            const generatedAt = now.toLocaleString('pt-BR');

            addRaceBullLogoToPdf(doc, logoDataUrl);

            doc.setFontSize(16);
            doc.text(`Relatório de Desempenho - ${dashboardName}`, centerX, 20, { align: 'center' });
            let currentY = 26;

            const filtersEntries = buildFiltersSummaryEntries({
                dashboardName,
                selectedDate,
                currentMonth,
                ...normalizedFiltersSummary,
            }).map(entry => [entry.label, entry.value]);

            if (filtersEntries.length > 0) {
                doc.autoTable({
                    startY: currentY,
                    head: [['Filtro', 'Valor']],
                    body: filtersEntries,
                    theme: 'grid',
                    styles: {
                        fontSize: 9,
                        halign: 'left',
                        lineColor: [0, 0, 0],
                        lineWidth: 0.1,
                    },
                    headStyles: {
                        fillColor: [0, 0, 0],
                        textColor: [255, 255, 255],
                        lineColor: [0, 0, 0],
                        lineWidth: 0.1,
                    },
                    bodyStyles: {
                        lineColor: [0, 0, 0],
                        lineWidth: 0.1,
                    },
                    columnStyles: {
                        0: { halign: 'left' },
                        1: { halign: 'left' },
                    },
                });
                currentY = (doc.lastAutoTable && doc.lastAutoTable.finalY)
                    ? doc.lastAutoTable.finalY + 6
                    : currentY + 10;
            } else {
                currentY += 4;
            }

            doc.setFontSize(10);
            doc.text(`Gerado em: ${generatedAt}`, 15, currentY);
            currentY += 8;

            const addTableSection = (title, head, body, columnStyles = {}) => {
                if (!body || body.length === 0) {
                    return;
                }
                if (currentY > doc.internal.pageSize.getHeight() - 40) {
                    doc.addPage();
                    currentY = 20;
                }
                doc.setFontSize(12);
                doc.text(title, 15, currentY);
                currentY += 4;
                doc.autoTable({
                    startY: currentY,
                    head,
                    body,
                    theme: 'grid',
                    styles: {
                        fontSize: 9,
                        halign: 'center',
                        lineColor: [0, 0, 0],
                        lineWidth: 0.1,
                    },
                    headStyles: {
                        fillColor: [0, 0, 0],
                        textColor: [255, 255, 255],
                        lineColor: [0, 0, 0],
                        lineWidth: 0.1,
                    },
                    bodyStyles: {
                        lineColor: [0, 0, 0],
                        lineWidth: 0.1,
                    },
                    columnStyles,
                });
                currentY = (doc.lastAutoTable && doc.lastAutoTable.finalY)
                    ? doc.lastAutoTable.finalY + 8
                    : currentY + 8;
            };

            const dailySummaryRows = [
                ['Produção Acumulada (Dia)', formatLocaleNumber(summary.totalProduced)],
                ['Meta Acumulada (Dia)', formatLocaleNumber(summary.totalGoal)],
                ['Eficiência da Última Hora', formatPercentageLabel(summary.lastHourEfficiency)],
                ['Média de Eficiência (Dia)', formatPercentageLabel(summary.averageEfficiency)],
            ];
            addTableSection('Resumo do Dia', [['Indicador', 'Valor']], dailySummaryRows, { 0: { halign: 'left' } });

            if (isTraveteDashboard && traveteEntries.length > 0) {
                const lastEntry = traveteEntries[traveteEntries.length - 1] || {};
                const employees = Array.isArray(lastEntry.employees) ? lastEntry.employees : [];
                const individualRows = employees.map((emp, index) => ([
                    `Funcionário ${index + 1}`,
                    formatLocaleNumber(emp.cumulativeProduced),
                    formatLocaleNumber(emp.cumulativeMeta),
                    formatPercentageLabel(emp.cumulativeEfficiency),
                ]));
                addTableSection(
                    'Resumo Individual do Dia (Travete)',
                    [['Operador', 'Produção Acum.', 'Meta Acum.', 'Eficiência Média']],
                    individualRows,
                    { 0: { halign: 'left' } }
                );
            }

            const monthlyRows = [
                ['Produção do Mês', formatLocaleNumber(monthlySummary.totalProduction)],
                ['Meta do Mês', formatLocaleNumber(monthlySummary.totalGoal)],
                ['Eficiência Média Mensal', formatPercentageLabel(monthlySummary.averageEfficiency)],
            ];
            addTableSection('Resumo Mensal', [['Indicador', 'Valor']], monthlyRows, { 0: { halign: 'left' } });

            if (monthlyBreakdown.length > 0) {
                const monthlyBody = monthlyBreakdown.map((item) => {
                    const dateLabel = item.date instanceof Date
                        ? item.date.toLocaleDateString('pt-BR')
                        : (item.dateLabel || String(item.date || ''));
                    return [
                        dateLabel,
                        formatLocaleNumber(item.totalProduction),
                        formatLocaleNumber(item.totalGoal),
                        formatPercentageLabel(item.averageEfficiency),
                    ];
                });
                addTableSection(
                    'Desempenho Diário no Mês',
                    [['Dia', 'Produção', 'Meta', 'Eficiência Média']],
                    monthlyBody,
                    { 0: { halign: 'left' } }
                );
            }

            if (isTraveteDashboard) {
                const traveteBody = traveteEntries.map((entry) => {
                    const employees = Array.isArray(entry.employees) ? entry.employees : [];
                    const empOne = employees[0] || {};
                    const empTwo = employees[1] || {};
                    return [
                        entry.period || '-',
                        empOne.metaDisplay || formatLocaleNumber(empOne.meta),
                        empOne.producedDisplay || formatLocaleNumber(empOne.produced),
                        formatPercentageLabel(empOne.efficiency),
                        empTwo.metaDisplay || formatLocaleNumber(empTwo.meta),
                        empTwo.producedDisplay || formatLocaleNumber(empTwo.produced),
                        formatPercentageLabel(empTwo.efficiency),
                        entry.lotDisplay || '-',
                        entry.observation || '-',
                    ];
                });
                addTableSection(
                    'Detalhamento por Período (Travete)',
                    [['Período', 'Meta F1', 'Prod. F1', 'Eficiência F1', 'Meta F2', 'Prod. F2', 'Eficiência F2', 'Lotes', 'Observação']],
                    traveteBody,
                    { 0: { halign: 'left' }, 7: { halign: 'left' }, 8: { halign: 'left' } }
                );
            } else if (dailyEntries.length > 0) {
                const dailyBody = dailyEntries.map((entry) => ([
                    entry.period || '-',
                    `${entry.people || 0} / ${(entry.availableTime || 0)} min`,
                    entry.goalForDisplay || entry.goal || '-',
                    entry.producedForDisplay || entry.produced || '-',
                    formatPercentageLabel(entry.efficiency),
                    formatLocaleNumber(entry.cumulativeGoal),
                    formatLocaleNumber(entry.cumulativeProduction),
                    formatPercentageLabel(entry.cumulativeEfficiency),
                    entry.observation || '-',
                ]));
                addTableSection(
                    'Detalhamento por Período',
                    [['Período', 'Pessoas / Tempo', 'Meta', 'Produção', 'Eficiência', 'Meta Acum.', 'Prod. Acum.', 'Efic. Acum.', 'Observação']],
                    dailyBody,
                    { 0: { halign: 'left' }, 1: { halign: 'left' }, 8: { halign: 'left' } }
                );
            }

            if (lotSummary && Array.isArray(lotSummary.completed) && lotSummary.completed.length > 0) {
                const completedBody = lotSummary.completed.map((lot) => ([
                    lot.name || lot.id || '-',
                    formatLocaleNumber(lot.produced),
                    formatLocaleNumber(lot.target),
                    formatPercentageLabel(lot.efficiency),
                    lot.duration ? lot.duration.toFixed(1) : '-',
                    formatLocaleNumber(lot.averageDaily),
                ]));
                addTableSection(
                    'Lotes Concluídos no Mês',
                    [['Lote', 'Produzido', 'Meta', 'Eficiência', 'Duração (dias)', 'Média Diária']],
                    completedBody,
                    { 0: { halign: 'left' } }
                );
                if (Number.isFinite(lotSummary.overallAverage) && lotSummary.overallAverage > 0) {
                    doc.setFontSize(10);
                    doc.text(
                        `Média diária combinada dos lotes concluídos: ${formatLocaleNumber(lotSummary.overallAverage)} peças`,
                        15,
                        currentY
                    );
                    currentY += 8;
                }
            }

            if (lotSummary && Array.isArray(lotSummary.active) && lotSummary.active.length > 0) {
                const activeBody = lotSummary.active.map((lot) => ([
                    lot.name || lot.id || '-',
                    formatLocaleNumber(lot.produced),
                    formatLocaleNumber(lot.target),
                    formatPercentageLabel(lot.efficiency),
                    getLotStatusLabel(lot.status, '-'),
                ]));
                addTableSection(
                    'Lotes Ativos',
                    [['Lote', 'Produzido', 'Meta', 'Eficiência', 'Status']],
                    activeBody,
                    { 0: { halign: 'left' }, 4: { halign: 'left' } }
                );
            }

            const selectedDateLabelSafe = selectedDateLabel
                .replace(/\//g, '-')
                .replace(/\\/g, '-');
            const safeDashboardName = dashboardName ? dashboardName.replace(/\s+/g, '_') : 'Dashboard';
            doc.save(`Relatorio_${safeDashboardName}_${selectedDateLabelSafe}.pdf`);
        })
    ));
};

export const getEmployeeProducts = (employee) => {
    if (Array.isArray(employee.products) && employee.products.length > 0) {
        return employee.products;
    }
    if (Array.isArray(employee.productionDetails) && employee.productionDetails.length > 0) {
        return employee.productionDetails;
    }
    return [];
};

export const buildProductLookupMap = (...lists) => {
    const map = new Map();
    lists.forEach(list => {
        (list || []).forEach(product => {
            if (product?.id) {
                const existing = map.get(product.id) || {};
                map.set(product.id, { ...existing, ...product });
            }
        });
    });
    return map;
};

export const sumProducedQuantities = (productsArray, fallbackProduced) => {
    const producedFromProducts = productsArray.reduce((sum, detail) => sum + (parseInt(detail.produced, 10) || 0), 0);
    if (producedFromProducts > 0) return producedFromProducts;
    const fallbackValue = fallbackProduced !== undefined ? parseInt(fallbackProduced, 10) : 0;
    return Number.isNaN(fallbackValue) ? 0 : fallbackValue;
};

export const findFirstProductDetail = (productsArray, employee) => {
    if (productsArray.length > 0) {
        const detailWithProduct = productsArray.find(detail => detail.productId);
        if (detailWithProduct) return detailWithProduct;
    }
    return Array.isArray(employee.productionDetails) && employee.productionDetails.length > 0
        ? employee.productionDetails[0]
        : null;
};

export const resolveProductReference = (employee, firstProductDetail, productMap) => {
    const productId = firstProductDetail?.productId || employee.productId || '';
    return { productId, product: productMap.get(productId) };
};

export const resolveEmployeeStandardTime = (employee, firstProductDetail, product) => {
    const parsedStandardTime = parseFloat(employee.standardTime);
    const fallbackStandardTimeRaw = firstProductDetail?.standardTime !== undefined
        ? parseFloat(firstProductDetail.standardTime)
        : (product?.standardTime || 0);
    const fallbackStandardTime = (!Number.isNaN(fallbackStandardTimeRaw) && fallbackStandardTimeRaw > 0)
        ? fallbackStandardTimeRaw
        : 0;
    return (!Number.isNaN(parsedStandardTime) && parsedStandardTime > 0)
        ? parsedStandardTime
        : fallbackStandardTime;
};

export const computeMetaFromStandardTime = (standardTime, availableTime) => {
    if (!(standardTime > 0 && availableTime > 0)) return 0;
    return Math.round(availableTime / standardTime);
};

export const computeEfficiencyPercentage = (produced, standardTime, availableTime) => {
    if (!(standardTime > 0 && availableTime > 0 && produced > 0)) return 0;
    return parseFloat((((produced * standardTime) / availableTime) * 100).toFixed(2));
};

export const buildProductNames = (productsArray, productMap) => productsArray
    .map(detail => {
        const product = productMap.get(detail.productId);
        return product?.name || null;
    })
    .filter(Boolean)
    .join(' / ');

export const buildNumericSegments = (productsArray) => productsArray.map(detail => {
    const producedNumeric = parseInt(detail.produced, 10);
    return Number.isNaN(producedNumeric) ? 0 : producedNumeric;
});

export const formatSegmentedNumbers = (segments, fallbackValue, delimiter = ' / ') => {
    if (!Array.isArray(segments) || segments.length === 0) {
        return Number(fallbackValue || 0).toLocaleString('pt-BR');
    }
    const sanitizedSegments = segments
        .map(value => Number(value) || 0)
        .filter((value, index) => index === 0 || value > 0);
    if (sanitizedSegments.length === 0) {
        return Number(fallbackValue || 0).toLocaleString('pt-BR');
    }
    if (sanitizedSegments.length === 1) {
        const [firstValue] = sanitizedSegments;
        if (firstValue === 0 && Number(fallbackValue || 0) === 0) return '0';
        return firstValue.toLocaleString('pt-BR');
    }
    return sanitizedSegments.map(value => value.toLocaleString('pt-BR')).join(delimiter);
};

export const formatGoalBlockDisplay = (goalBlock, fallbackDisplay, fallbackMetaValue) => {
    if (!goalBlock) return fallbackDisplay;
    const goalBlockCurrent = Number(goalBlock.current || 0);
    const goalBlockNext = Number(goalBlock.next || 0);
    const goalBlockShowNext = Boolean(goalBlock.showNext) && (goalBlock.next !== undefined && goalBlock.next !== null);
    const currentLabel = goalBlockCurrent > 0
        ? goalBlockCurrent.toLocaleString('pt-BR')
        : (fallbackMetaValue > 0 ? fallbackMetaValue.toLocaleString('pt-BR') : '0');
    if (goalBlockShowNext) {
        const nextLabel = goalBlockNext > 0 ? goalBlockNext.toLocaleString('pt-BR') : currentLabel;
        return `${currentLabel}/${nextLabel}`;
    }
    return goalBlockCurrent > 0 ? currentLabel : '-';
};

export const formatTraveteLotDisplay = (lotBlock, fallbackLabel) => {
    if (!lotBlock) return fallbackLabel || '-';
    const suffix = (lotBlock.machineType || '').replace(/^Travete\s*/i, '').trim();
    const currentLabel = lotBlock.current
        ? `${lotBlock.current}${suffix ? ` - ${suffix}` : ''}`
        : '';
    const nextLabel = lotBlock.next || '';
    if (currentLabel) {
        return nextLabel ? `${currentLabel}/${nextLabel}` : currentLabel;
    }
    return nextLabel || '-';
};

export const getOrderedActiveLots = (lots = []) =>
    [...lots]
        .filter(lot => lot && (lot.status === 'ongoing' || lot.status === 'future'))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

export const getLotRemainingPieces = (lot) => {
    if (!lot) return 0;
    return Math.max(0, (lot.target || 0) - (lot.produced || 0));
};

export const splitGoalSegments = (goalDisplay = '') => goalDisplay
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean);

export const splitTraveteGoalSegments = (goalDisplay = '') => goalDisplay
    .split('//')
    .map(segment => segment.trim())
    .filter(Boolean);

export const buildTraveteProcessedEntries = (productionData, productMapForSelectedDate) => {
    if (!productionData || productionData.length === 0) return [];

    const cumulativeMeta = [];
    const cumulativeProduction = [];
    const cumulativeEfficiencySum = [];
    const cumulativeEntryCounts = [];

    return [...productionData]
        .sort((a, b) => (a.period || '').localeCompare(b.period || ''))
        .map((entry) => {
            const availableTime = parseFloat(entry.availableTime) || 0;
            const storedGoalBlocks = Array.isArray(entry.traveteGoalBlocks) ? entry.traveteGoalBlocks : null;
            const storedLotBlocks = Array.isArray(entry.traveteLotBlocks) ? entry.traveteLotBlocks : null;
            const entryGoalSegments = splitTraveteGoalSegments(entry.goalDisplay || '');

            const employees = (entry.employeeEntries || []).map((emp, empIndex) => {
                const productsArray = getEmployeeProducts(emp);
                const producedValue = sumProducedQuantities(productsArray, emp.produced);
                const firstProduct = findFirstProductDetail(productsArray, emp);
                const { product } = resolveProductReference(emp, firstProduct, productMapForSelectedDate);
                const standardTime = resolveEmployeeStandardTime(emp, firstProduct, product);
                const meta = computeMetaFromStandardTime(standardTime, availableTime);
                const efficiency = computeEfficiencyPercentage(producedValue, standardTime, availableTime);

                cumulativeMeta[empIndex] = (cumulativeMeta[empIndex] || 0) + meta;
                cumulativeProduction[empIndex] = (cumulativeProduction[empIndex] || 0) + producedValue;
                cumulativeEfficiencySum[empIndex] = (cumulativeEfficiencySum[empIndex] || 0) + efficiency;
                cumulativeEntryCounts[empIndex] = (cumulativeEntryCounts[empIndex] || 0) + 1;

                const entriesCount = cumulativeEntryCounts[empIndex] || 1;
                const cumulativeEfficiency = parseFloat(((cumulativeEfficiencySum[empIndex] || 0) / entriesCount).toFixed(2));
                const productNames = buildProductNames(productsArray, productMapForSelectedDate);
                const producedSegments = buildNumericSegments(productsArray);
                const producedDisplay = formatSegmentedNumbers(producedSegments, producedValue);

                const goalBlock = storedGoalBlocks?.[empIndex] || null;
                const lotBlock = storedLotBlocks?.[empIndex] || null;
                const entryGoalDisplay = entryGoalSegments[empIndex] || '';
                const fallbackGoalDisplay = entryGoalDisplay || (meta > 0 ? meta.toLocaleString('pt-BR') : '-');
                const goalDisplayForEmployee = formatGoalBlockDisplay(goalBlock, fallbackGoalDisplay, meta);

                const lotFallbackLabel = (productNames || product?.name) ? (productNames || product?.name) : '-';
                const lotDisplayForEmployee = formatTraveteLotDisplay(lotBlock, lotFallbackLabel);

                return {
                    ...emp,
                    produced: producedValue,
                    producedDisplay,
                    standardTime,
                    meta,
                    efficiency,
                    cumulativeMeta: cumulativeMeta[empIndex] || 0,
                    cumulativeProduced: cumulativeProduction[empIndex] || 0,
                    cumulativeEfficiency,
                    productName: productNames || product?.name || '',
                    metaDisplay: goalDisplayForEmployee,
                    lotDisplay: lotDisplayForEmployee,
                };
            });

            return {
                ...entry,
                employees,
            };
        });
};

export const joinGoalSegments = (segments = []) => {
    const cleaned = segments
        .map(segment => {
            if (typeof segment === 'number') {
                return Number.isFinite(segment) ? segment.toString() : '';
            }
            if (segment === null || segment === undefined) {
                return '';
            }
            return String(segment).trim();
        })
        .filter(segment => segment !== '');
    return cleaned.length > 0 ? cleaned.join(' / ') : '0';
};

export const sumGoalDisplay = (goalDisplay = '') => splitGoalSegments(goalDisplay)
    .reduce((total, segment) => total + (parseInt(segment, 10) || 0), 0);

export const formatDefaultLotDisplayName = (lot, product) => {
    if (!lot) {
        return product?.name || '';
    }

    const baseName = lot.productName || product?.name || lot.name || lot.id || '';
    return lot.customName ? `${baseName} - ${lot.customName}` : baseName;
};

export const createProductionRowFromDetail = (detail, productMap, lots) => {
    if (!detail) return null;

    const lot = detail.lotId ? lots.find(l => l.id === detail.lotId) || null : null;
    const product = detail.productId ? productMap.get(detail.productId) || null : null;
    const productName = formatDefaultLotDisplayName(lot, product) || detail.productName || detail.productId || 'Produto';
    const standardTimeRaw = detail.standardTime !== undefined ? detail.standardTime : product?.standardTime;
    const standardTime = standardTimeRaw !== undefined ? parseFloat(standardTimeRaw) || 0 : 0;

    return {
        key: detail.lotId || detail.productId || generateId('production-row'),
        lotId: detail.lotId || '',
        productId: detail.productId || '',
        productName,
        produced: detail.produced !== undefined ? String(detail.produced) : '',
        autoGenerated: false,
        standardTime,
        remainingPieces: lot ? getLotRemainingPieces(lot) : 0,
    };
};

export const computeDefaultPredictionsForEdit = ({ peopleValue, availableTimeValue, lots, productMap, fallbackProductId }) => {
    const people = parseFloat(peopleValue) || 0;
    const availableTime = parseFloat(availableTimeValue) || 0;

    if (people <= 0 || availableTime <= 0) {
        return [];
    }

    const activeLots = getOrderedActiveLots(lots);
    let remainingTime = people * availableTime;
    const predictions = [];

    let startIndex = activeLots.findIndex(lot => getLotRemainingPieces(lot) > 0);
    if (startIndex === -1 && fallbackProductId) {
        startIndex = activeLots.findIndex(lot => lot.productId === fallbackProductId);
    }

    const MAX_PREDICTIONS = 10;
    if (startIndex !== -1) {
        for (let index = startIndex; index < activeLots.length && remainingTime > 0 && predictions.length < MAX_PREDICTIONS; index++) {
            const lot = activeLots[index];
            const product = lot?.productId ? productMap.get(lot.productId) || null : null;
            const standardTimeRaw = product?.standardTime;
            const standardTime = standardTimeRaw !== undefined ? parseFloat(standardTimeRaw) : NaN;

            if (!product || Number.isNaN(standardTime) || standardTime <= 0) {
                continue;
            }

            const remainingPieces = getLotRemainingPieces(lot);
            if (remainingPieces <= 0) {
                continue;
            }

            if (remainingTime < standardTime) {
                break;
            }

            const producibleFloat = remainingTime / standardTime;
            const roundedProducible = Math.round(producibleFloat);
            const producible = Math.min(remainingPieces, Math.max(0, roundedProducible));

            if (producible <= 0) {
                break;
            }

            predictions.push({
                key: lot.id,
                id: lot.id,
                productId: lot.productId,
                productName: formatDefaultLotDisplayName(lot, product),
                remainingPieces,
                plannedPieces: producible,
                standardTime,
            });

            remainingTime -= producible * standardTime;
        }
    }

    if (predictions.length === 0 && fallbackProductId) {
        const fallbackProduct = productMap.get(fallbackProductId) || null;
        const standardTimeRaw = fallbackProduct?.standardTime;
        const standardTime = standardTimeRaw !== undefined ? parseFloat(standardTimeRaw) : NaN;

        if (!Number.isNaN(standardTime) && standardTime > 0 && remainingTime >= standardTime) {
            const producibleFloat = remainingTime / standardTime;
            const producible = Math.max(0, Math.round(producibleFloat));

            if (producible > 0) {
                predictions.push({
                    key: `product-${fallbackProductId}`,
                    id: '',
                    productId: fallbackProductId,
                    productName: fallbackProduct?.name || '',
                    remainingPieces: producible,
                    plannedPieces: producible,
                    standardTime,
                });
            }
        }
    }

    return predictions;
};

export const buildRowsFromPredictions = (existingRows = [], predictions = [], lots = [], productMap = new Map()) => {
    if (!predictions || predictions.length === 0) {
        const manualRows = existingRows.filter(row => !row.autoGenerated);
        if (manualRows.length > 0) {
            return manualRows;
        }
        if (existingRows.length > 0) {
            const [first] = existingRows;
            return [{ ...first, autoGenerated: false }];
        }
        return [];
    }

    const nextRows = predictions.map(prediction => {
        const existing = existingRows.find(row => row.key === prediction.key)
            || existingRows.find(row => row.lotId && row.lotId === prediction.id)
            || existingRows.find(row => row.productId && row.productId === prediction.productId);

        const lot = prediction.id ? lots.find(l => l.id === prediction.id) || null : null;
        const product = prediction.productId ? productMap.get(prediction.productId) || null : null;

        return {
            key: prediction.key,
            lotId: prediction.id || '',
            productId: prediction.productId || '',
            productName: prediction.productName
                || formatDefaultLotDisplayName(lot, product)
                || existing?.productName
                || '',
            produced: existing ? existing.produced : '',
            autoGenerated: existing ? existing.autoGenerated : true,
            standardTime: existing?.standardTime
                || prediction.standardTime
                || (product?.standardTime !== undefined ? parseFloat(product.standardTime) || 0 : 0),
            remainingPieces: prediction.remainingPieces ?? prediction.plannedPieces ?? 0,
        };
    });

    const manualRows = existingRows.filter(row => !row.autoGenerated && !nextRows.some(next => next.key === row.key));
    return [...nextRows, ...manualRows];
};

export const areProductionRowsEqual = (prevRows = [], nextRows = []) => {
    if (prevRows.length !== nextRows.length) {
        return false;
    }

    for (let index = 0; index < prevRows.length; index++) {
        const prev = prevRows[index];
        const next = nextRows[index];

        if (
            prev.key !== next.key
            || prev.lotId !== next.lotId
            || prev.productId !== next.productId
            || prev.productName !== next.productName
            || String(prev.produced ?? '') !== String(next.produced ?? '')
            || Boolean(prev.autoGenerated) !== Boolean(next.autoGenerated)
            || Number(prev.standardTime || 0) !== Number(next.standardTime || 0)
            || Number(prev.remainingPieces || 0) !== Number(next.remainingPieces || 0)
        ) {
            return false;
        }
    }

    return true;
};

export const formatTraveteStandardTimeValue = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return '';
    return parseFloat(value.toFixed(2)).toString();
};

export const resolveTraveteLotBaseId = (lot, products) => {
    if (!lot) return null;
    if (lot.productBaseId) return lot.productBaseId;
    if (lot.baseProductId) return lot.baseProductId;
    if (lot.productId) {
        const directProduct = products.find(p => p.id === lot.productId);
        if (directProduct?.baseProductId) return directProduct.baseProductId;
        return lot.productId;
    }
    return null;
};

export const findTraveteVariationForLot = (lot, machineType, products, variationLookup) => {
    if (!lot || !machineType) return null;
    const baseId = resolveTraveteLotBaseId(lot, products);
    if (!baseId) return null;

    const variationFromLookup = variationLookup?.get(baseId)?.get(machineType);
    if (variationFromLookup) {
        return variationFromLookup;
    }

    return products.find(p => p.machineType === machineType && (p.baseProductId === baseId || p.id === baseId)) || null;
};

export const computeTraveteStandardTime = (
    lotId,
    machineType,
    lots = [],
    products = [],
    variationLookup = new Map()
) => {
    if (!lotId || !machineType) return '';
    const lot = lots.find(l => l.id === lotId) || null;
    if (!lot) return '';

    const variation = findTraveteVariationForLot(lot, machineType, products, variationLookup);
    const numeric = variation?.standardTime ? parseFloat(variation.standardTime) : NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) return '';

    return formatTraveteStandardTimeValue(numeric);
};

export const buildTraveteStandardTimePatch = ({
    employee,
    lotId,
    machineType,
    lots = [],
    products = [],
    variationLookup = new Map(),
    resetWhenMissing = false,
}) => {
    if (!employee || employee.standardTimeManual) {
        return null;
    }

    if (!lotId) {
        return resetWhenMissing ? { standardTime: '', standardTimeManual: false } : null;
    }

    const derived = computeTraveteStandardTime(
        lotId,
        machineType || employee.machineType,
        lots,
        products,
        variationLookup
    );

    if (!derived) {
        return resetWhenMissing ? { standardTime: '', standardTimeManual: false } : null;
    }

    if (derived === employee.standardTime) {
        return null;
    }

    return { standardTime: derived, standardTimeManual: false };
};

export const applyTraveteAutoSuggestions = (employeeEntries = [], lotOptions = [], products = [], variationLookup = new Map()) => {
    if (!Array.isArray(employeeEntries) || employeeEntries.length === 0) {
        return { changed: false, employeeEntries: Array.isArray(employeeEntries) ? employeeEntries : [] };
    }

    const primaryLot = lotOptions[0] || null;
    const secondaryLot = lotOptions[1] || null;
    let changed = false;

    const normalizedEntries = employeeEntries.map((entry, index) => {
        const employee = {
            machineType: entry.machineType || TRAVETE_MACHINES[index] || TRAVETE_MACHINES[0],
            standardTime: entry.standardTime || '',
            standardTimeManual: Boolean(entry.standardTimeManual),
            ...entry,
        };

        let productsList = Array.isArray(entry.products) && entry.products.length > 0
            ? entry.products.map(item => ({ ...item }))
            : [createDefaultTraveteProductItem()];

        if (productsList.length === 0) {
            productsList = [createDefaultTraveteProductItem()];
        }

        let employeeChanged = false;

        if (primaryLot) {
            const first = { ...(productsList[0] || createDefaultTraveteProductItem()) };
            const shouldAutoAssignFirst = !first.lotId || first.isAutoSuggested;
            if (shouldAutoAssignFirst && first.lotId !== primaryLot.id) {
                first.lotId = primaryLot.id;
                employeeChanged = true;
            }
            if (shouldAutoAssignFirst) {
                if (!first.isAutoSuggested) {
                    employeeChanged = true;
                }
                first.isAutoSuggested = true;
            }
            productsList[0] = first;
        } else if (productsList[0]?.isAutoSuggested) {
            const first = { ...productsList[0], lotId: '', isAutoSuggested: false };
            productsList[0] = first;
            employeeChanged = true;
        }

        if (secondaryLot) {
            if (productsList.length < 2) {
                productsList.push(createDefaultTraveteProductItem({ isAutoSuggested: true }));
                employeeChanged = true;
            }
            const second = { ...(productsList[1] || createDefaultTraveteProductItem({ isAutoSuggested: true })) };
            const shouldAutoAssignSecond = !second.lotId || second.isAutoSuggested;
            if (shouldAutoAssignSecond && second.lotId !== secondaryLot.id) {
                second.lotId = secondaryLot.id;
                employeeChanged = true;
            }
            if (shouldAutoAssignSecond) {
                if (!second.isAutoSuggested) {
                    employeeChanged = true;
                }
                second.isAutoSuggested = true;
            }
            productsList[1] = second;
        } else if (productsList.length > 1) {
            const filtered = productsList.filter((item, idx) => !(idx > 0 && item.isAutoSuggested));
            if (filtered.length !== productsList.length) {
                productsList = filtered;
                employeeChanged = true;
            } else if (productsList[1]?.isAutoSuggested) {
                const second = { ...productsList[1], lotId: '', isAutoSuggested: false };
                productsList[1] = second;
                employeeChanged = true;
            }
        }

        let nextEmployee = { ...employee, products: productsList };
        const patch = buildTraveteStandardTimePatch({
            employee: nextEmployee,
            lotId: productsList[0]?.lotId,
            machineType: nextEmployee.machineType,
            lots: lotOptions,
            products,
            variationLookup,
        });
        if (patch) {
            nextEmployee = { ...nextEmployee, ...patch };
            employeeChanged = true;
        }

        if (employeeChanged) {
            changed = true;
        }

        return nextEmployee;
    });

    return { changed, employeeEntries: normalizedEntries };
};

export const formatTraveteLotDisplayName = (lot, products) => {
    if (!lot) return '';

    const baseId = resolveTraveteLotBaseId(lot, products);
    const productForLot = lot.productId ? products.find(p => p.id === lot.productId) : null;
    const baseProduct = baseId ? products.find(p => p.id === baseId) : null;

    const baseName = (
        lot.baseProductName ||
        productForLot?.baseProductName ||
        baseProduct?.baseProductName ||
        (baseProduct?.name ? baseProduct.name.replace(/\s-\s.*$/, '') : null) ||
        (productForLot?.name ? productForLot.name.replace(/\s-\s.*$/, '') : null) ||
        (lot.productName ? lot.productName.replace(/\s-\s.*$/, '') : null) ||
        lot.name ||
        lot.id ||
        ''
    );

    return lot.customName ? `${baseName} - ${lot.customName}` : baseName;
};

export const getTraveteBaseProductName = (product) => {
    if (!product) return '';
    if (product.baseProductName) return product.baseProductName;
    if (product.name) return product.name.replace(/\s-\s.*$/, '');
    return product.id || '';
};

export const deriveProductBaseName = (product) => {
    if (!product) return '';
    if (product.baseProductName) return product.baseProductName;
    if (product.baseName) return product.baseName;
    if (product.name) {
        const trimmed = product.name.trim();
        const travetePattern = /\s-\s(?:Travete\s*)?(?:\d+\sAgulhas|Convencional)$/i;
        if (travetePattern.test(trimmed)) {
            return trimmed.replace(travetePattern, '');
        }
        return trimmed.replace(/\s-\s.*$/, '');
    }
    return product.id || '';
};

export function normalizeTraveteMachineType(machine = '') {
    if (!machine) return '';
    const normalized = machine.toString().trim().toLowerCase();
    if (!normalized) return '';
    const hasTravete = normalized.includes('travete');
    if (!hasTravete) return '';
    if (normalized.includes('convenc')) return 'Travete Convencional';
    if (normalized.includes('2') && normalized.includes('agulh')) return 'Travete 2 Agulhas';
    if (normalized.includes('1') && normalized.includes('agulh')) return 'Travete 1 Agulha';
    return 'Travete 2 Agulhas';
}

export const computeOperationalTimeBreakdown = (operations = []) => {
    const breakdown = {
        productionMinutes: 0,
        traveteMinutesByMachine: {
            'Travete 2 Agulhas': 0,
            'Travete 1 Agulha': 0,
            'Travete Convencional': 0,
        },
    };

    operations.forEach((operation) => {
        const minutesRaw = typeof operation.tempoMinutos === 'number'
            ? operation.tempoMinutos
            : parseFloat(operation.tempoMinutos);
        if (!(minutesRaw > 0)) {
            return;
        }
        const destinos = normalizeOperationDestinations(
            operation.destinos || operation.destinations,
            operation.maquina || operation.machine || operation.machineType
        );

        let appliedByDestinos = false;

        if (destinos.production) {
            breakdown.productionMinutes += minutesRaw;
            appliedByDestinos = true;
        }

        TRAVETE_MACHINES.forEach((machineType) => {
            if (destinos.travete[machineType]) {
                breakdown.traveteMinutesByMachine[machineType] += minutesRaw;
                appliedByDestinos = true;
            }
        });

        if (appliedByDestinos) {
            return;
        }

        const machineType = normalizeTraveteMachineType(operation.maquina || operation.machine || operation.machineType);
        if (machineType && TRAVETE_MACHINES.includes(machineType)) {
            breakdown.traveteMinutesByMachine[machineType] += minutesRaw;
        } else {
            breakdown.productionMinutes += minutesRaw;
        }
    });

    breakdown.totalMinutes = breakdown.productionMinutes
        + TRAVETE_MACHINES
            .map(machine => breakdown.traveteMinutesByMachine[machine] || 0)
            .reduce((total, value) => total + value, 0);

    return breakdown;
};

export const aggregateProductOptionsForSequences = (products = []) => {
    const map = new Map();

    products.forEach((product) => {
        if (!product) return;

        const derivedName = (deriveProductBaseName(product)
            || product.baseProductName
            || product.name
            || product.baseProductId
            || product.baseId
            || product.id
            || '')
            .toString()
            .trim();

        if (!derivedName) {
            return;
        }

        const aggregationKey = derivedName.toLowerCase();
        const candidateBaseProductId = product.baseProductId
            || product.baseId
            || product.primaryProductId
            || product.id;

        let entry = map.get(aggregationKey);
        if (!entry) {
            entry = {
                id: product.id,
                aggregationKey,
                baseProductId: candidateBaseProductId || aggregationKey,
                baseProductName: derivedName,
                name: derivedName,
                primaryProductId: null,
                primaryProduct: null,
                productionProducts: [],
                traveteProducts: {},
                relatedProductIds: new Set(),
                dashboardNames: new Set(),
                allProducts: [],
            };
        }

        entry.allProducts.push(product);
        entry.relatedProductIds.add(product.id);
        if (product.dashboardName) {
            entry.dashboardNames.add(product.dashboardName);
        }

        if (product.dashboardId === 'producao') {
            entry.productionProducts.push(product);
            if (!entry.primaryProductId) {
                entry.primaryProductId = product.id;
                entry.primaryProduct = product;
            }
        } else if (product.dashboardId === 'travete' && TRAVETE_MACHINES.includes(product.machineType)) {
            entry.traveteProducts[product.machineType] = product;
            if (!entry.primaryProductId) {
                entry.primaryProductId = product.id;
                entry.primaryProduct = product;
            }
        } else if (!entry.primaryProductId) {
            entry.primaryProductId = product.id;
            entry.primaryProduct = product;
        }

        if (candidateBaseProductId) {
            entry.baseProductId = entry.baseProductId || candidateBaseProductId;
        }

        map.set(aggregationKey, entry);
    });

    return Array.from(map.values()).map((entry) => {
        if (!entry.primaryProductId) {
            const fallback = entry.allProducts[0];
            if (fallback) {
                entry.primaryProductId = fallback.id;
                entry.primaryProduct = fallback;
            }
        }

        const tags = [];
        if (entry.productionProducts.length > 0) {
            tags.push('Produção');
        }
        if (Object.values(entry.traveteProducts).some(Boolean)) {
            tags.push('Travete');
        }

        entry.dashboardNames.forEach((name) => {
            if (name && !tags.includes(name)) {
                tags.push(name);
            }
        });

        const displayLabel = entry.name;

        return {
            id: entry.primaryProductId,
            name: entry.name,
            baseProductId: entry.baseProductId,
            baseProductName: entry.baseProductName,
            primaryProductId: entry.primaryProductId,
            primaryProduct: entry.primaryProduct,
            productionProducts: entry.productionProducts,
            traveteProducts: { ...entry.traveteProducts },
            relatedProductIds: Array.from(entry.relatedProductIds),
            dashboardNames: Array.from(entry.dashboardNames).filter(Boolean).sort((a, b) => a.localeCompare(b)),
            allProducts: entry.allProducts,
            displayLabel,
            tags,
        };
    });
};


// #####################################################################
