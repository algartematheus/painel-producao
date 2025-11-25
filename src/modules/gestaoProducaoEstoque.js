import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    Upload,
    FileType2,
    FileText,
    CheckCircle2,
    History,
    Settings,
    Trash2,
    ArrowUp,
    ArrowDown,
    PlusCircle,
    RefreshCcw,
    Printer,
    Eye,
    Layers,
    Home,
    Warehouse,
    ClipboardList,
    BarChart,
} from 'lucide-react';
import HeaderContainer from '../components/HeaderContainer';
import GlobalNavigation from '../components/GlobalNavigation';
import { useAuth } from './auth';
import { raceBullLogoUrl } from './constants';
import {
    GlobalStyles,
    usePersistedTheme,
} from './shared';
import {
    listPortfolio,
    upsertPortfolio,
    deletePortfolio,
    reordenarPortfolio,
    buildPortfolioPreferences,
    criarSnapshotProduto,
    montarDailyRecord,
    salvarNoHistorico,
    carregarHistorico,
    paginarRelatorioEmPaginasA4,
    gerarHTMLImpressaoPaginado,
    importarArquivoDeProducao,
    exemploFluxoCompleto,
} from './relatorioEstoque';
import importStockFile from './importStockFile';
import AutoImportReview from './gestaoProducaoEstoque/AutoImportReview';

const MODULE_TITLE = 'Gestão de Produção x Estoque';
const MODULE_SUBTITLE = 'Integre produção e estoque em um relatório consolidado pronto para impressão.';
const normalizarRotuloGrade = (valor) => {
    if (valor === null || valor === undefined) {
        return '';
    }
    const token = String(valor).trim();
    if (!token) {
        return '';
    }
    const upperToken = token.toUpperCase();
    if (/^\d+$/.test(upperToken)) {
        return upperToken.padStart(2, '0');
    }
    return upperToken;
};

const parseGradeString = (value = '') =>
    value
        .split(/[,;\s]+/)
        .map((item) => normalizarRotuloGrade(item))
        .filter(Boolean);

const parseTamanhosString = (value = '', options = {}) => {
    const resultados = {};
    if (typeof value !== 'string') {
        return resultados;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return resultados;
    }

    const gradeLista = normalizarGradeLista(options?.grade);

    if (gradeLista.length && !/[=:]/.test(value)) {
        const sanitized = value.replace(/\r/g, '').replace(/\n/g, '\t');
        const rawTokens = sanitized.includes('\t')
            ? sanitized.split('\t').flatMap((segment) => {
                  if (segment === '') {
                      return [''];
                  }
                  const partes = segment.split(/\s+/);
                  return partes.length ? partes : [''];
              })
            : sanitized.split(/\s+/);
        const tokens = rawTokens.map((token) => token.trim());

        const numeroRegex = /^-?\d+(?:[.,]\d+)?$/;
        const tokensValidos = tokens.length > 0 && tokens.every((token) => token === '' || numeroRegex.test(token));

        if (tokensValidos) {
            gradeLista.forEach((tamanho, index) => {
                const token = tokens[index];
                if (token === undefined) {
                    return;
                }
                const tokenNormalizado = token.replace(',', '.');
                const quantidade = token.trim() === '' ? 0 : Number(tokenNormalizado);
                resultados[tamanho] = Number.isFinite(quantidade) ? quantidade : 0;
            });
        }
    }

    const regex = /([^\s=:,;]+)\s*(?:[:=]\s*|\s+)(-?\d+(?:[.,]\d+)?)/g;
    let match;
    while ((match = regex.exec(value)) !== null) {
        const tamanho = normalizarRotuloGrade(match[1]);
        const quantidadeBruta = String(match[2]).replace(',', '.');
        const quantidade = Number(quantidadeBruta);
        if (!tamanho) {
            continue;
        }
        resultados[tamanho] = Number.isFinite(quantidade) ? quantidade : 0;
    }

    return resultados;
};

const normalizarGradeLista = (gradeLista = []) =>
    Array.from(
        new Set(
            (Array.isArray(gradeLista) ? gradeLista : [])
                .map((item) => normalizarRotuloGrade(item))
                .filter(Boolean),
        ),
    );

const criarVariacaoVazia = (gradeLista = []) => {
    const listaNormalizada = normalizarGradeLista(gradeLista);
    const tamanhos = listaNormalizada.reduce((acc, tamanho) => {
        acc[tamanho] = 0;
        return acc;
    }, {});
    return { ref: '', tamanhos, alwaysSeparate: false };
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizarQuantidade = (valor) => {
    if (typeof valor === 'number') {
        return Number.isFinite(valor) ? valor : 0;
    }
    if (typeof valor === 'string') {
        const numero = Number(valor.replace(',', '.'));
        return Number.isFinite(numero) ? numero : 0;
    }
    return 0;
};

const preencherTamanhosComGrade = (gradeLista = [], tamanhos = {}) => {
    const listaNormalizada = normalizarGradeLista(gradeLista);
    const resultado = {};
    const mapaEntrada = isPlainObject(tamanhos) ? tamanhos : {};
    const mapaNormalizado = Object.entries(mapaEntrada).reduce((acc, [chave, valor]) => {
        const chaveNormalizada = normalizarRotuloGrade(chave);
        if (!chaveNormalizada) {
            return acc;
        }
        acc[chaveNormalizada] = valor;
        return acc;
    }, {});

    const adicionarTamanho = (tamanho, valor) => {
        const chaveNormalizada = normalizarRotuloGrade(tamanho);
        if (!chaveNormalizada) {
            return;
        }
        resultado[chaveNormalizada] = normalizarQuantidade(valor);
    };

    if (listaNormalizada.length) {
        listaNormalizada.forEach((tamanho) => {
            if (Object.prototype.hasOwnProperty.call(mapaNormalizado, tamanho)) {
                adicionarTamanho(tamanho, mapaNormalizado[tamanho]);
            } else {
                resultado[tamanho] = 0;
            }
        });

        Object.keys(mapaNormalizado).forEach((tamanho) => {
            if (!listaNormalizada.includes(tamanho)) {
                adicionarTamanho(tamanho, mapaNormalizado[tamanho]);
            }
        });

        return resultado;
    }

    Object.entries(mapaNormalizado).forEach(([tamanho, valor]) => {
        adicionarTamanho(tamanho, valor);
    });

    return resultado;
};

const normalizarMapaDeTamanhos = (tamanhosEntrada, gradeLista = [], options = {}) => {
    const mapaEntrada = isPlainObject(tamanhosEntrada)
        ? tamanhosEntrada
        : parseTamanhosString(tamanhosEntrada, { grade: gradeLista });
    const listaNormalizada = normalizarGradeLista(gradeLista);
    const resultado = {};
    const manterExtrasForaDaGrade =
        typeof options?.manterExtrasForaDaGrade === 'boolean'
            ? options.manterExtrasForaDaGrade
            : listaNormalizada.length === 0;

    const mapaNormalizado = Object.entries(mapaEntrada || {}).reduce((acc, [chave, valor]) => {
        const chaveNormalizada = normalizarRotuloGrade(chave);
        if (!chaveNormalizada) {
            return acc;
        }
        acc[chaveNormalizada] = valor;
        return acc;
    }, {});

    listaNormalizada.forEach((tamanho) => {
        if (!tamanho) {
            return;
        }
        const valor = Object.prototype.hasOwnProperty.call(mapaNormalizado, tamanho)
            ? mapaNormalizado[tamanho]
            : 0;
        resultado[tamanho] = normalizarQuantidade(valor);
    });

    if (manterExtrasForaDaGrade) {
        Object.entries(mapaNormalizado).forEach(([tamanho, valor]) => {
            if (!tamanho || listaNormalizada.includes(tamanho)) {
                return;
            }
            resultado[tamanho] = normalizarQuantidade(valor);
        });
    }

    return resultado;
};

const saoMapasDeTamanhosIguais = (a = {}, b = {}) => {
    const chavesA = Object.keys(a || {});
    const chavesB = Object.keys(b || {});
    if (chavesA.length !== chavesB.length) {
        return false;
    }
    return chavesA.every((chave) => Object.is(a[chave], b[chave]));
};

const prepararVariacoesComGrade = (variacoes = [], gradeLista = []) => {
    const listaNormalizada = normalizarGradeLista(gradeLista);
    return (Array.isArray(variacoes) ? variacoes : []).map((variacao = {}) => {
        const tamanhosNormalizados = normalizarMapaDeTamanhos(variacao.tamanhos, listaNormalizada);
        return {
            ...variacao,
            tamanhos: tamanhosNormalizados,
        };
    });
};

const temQuantidadeInformada = (tamanhos = {}) =>
    Object.values(isPlainObject(tamanhos) ? tamanhos : {}).some(
        (quantidade) => normalizarQuantidade(quantidade) !== 0,
    );

const calcularResumoPorTamanho = (variacoes = [], gradeLista = []) => {
    const resumo = {};
    const listaNormalizada = normalizarGradeLista(gradeLista);
    listaNormalizada.forEach((tamanho) => {
        if (!tamanho) {
            return;
        }
        resumo[tamanho] = { positivo: 0, negativo: 0 };
    });
    (Array.isArray(variacoes) ? variacoes : []).forEach((variacao) => {
        listaNormalizada.forEach((tamanho) => {
            const quantidade = normalizarQuantidade(variacao?.tamanhos?.[tamanho]);
            if (!Number.isFinite(quantidade) || quantidade === 0) {
                return;
            }
            if (!resumo[tamanho]) {
                resumo[tamanho] = { positivo: 0, negativo: 0 };
            }
            if (quantidade > 0) {
                resumo[tamanho].positivo += quantidade;
            } else {
                resumo[tamanho].negativo += quantidade;
            }
        });
    });
    return resumo;
};

const formatQuantidadeResumo = (valor) => {
    const numero = Number(valor) || 0;
    return numero.toLocaleString('pt-BR', {
        minimumFractionDigits: Number.isInteger(numero) ? 0 : 2,
        maximumFractionDigits: 2,
    });
};

const obterValorParaCampoDeTamanho = (tamanhos = {}, tamanho) => {
    if (!isPlainObject(tamanhos)) {
        return '';
    }
    const valor = tamanhos[tamanho];
    if (valor === undefined || valor === null) {
        return '';
    }
    if (typeof valor === 'number') {
        return Number.isFinite(valor) ? String(valor) : '';
    }
    return String(valor);
};

const formatDateTime = (isoString) => {
    if (!isoString) {
        return '-';
    }
    try {
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) {
            return isoString;
        }
        return date.toLocaleString('pt-BR', { hour12: false });
    } catch (error) {
        return isoString;
    }
};

const normalizePreviewNumber = (value) => {
    const numero = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numero) ? numero : 0;
};

const getValueTone = (value) => {
    if (value > 0) {
        return 'text-red-600 dark:text-red-400 font-semibold';
    }
    if (value < 0) {
        return 'text-blue-600 dark:text-blue-400 font-semibold';
    }
    return 'text-gray-700 dark:text-gray-200';
};

export const validarEAdicionarProdutoAoPortfolio = ({
    codigo,
    grade,
    variacoes,
    agrupamento,
    responsavel,
    orderIndex,
    adicionarProduto = upsertPortfolio,
}) => {
    const codigoTrim = typeof codigo === 'string' ? codigo.trim() : '';
    if (!codigoTrim) {
        throw new Error('Informe o código do produto base.');
    }

    let gradeLista = normalizarGradeLista(parseGradeString(grade));
    const normalizeRef = (valor) => (typeof valor === 'string' ? valor.trim().toUpperCase() : '');
    const variacoesProcessadas = (Array.isArray(variacoes) ? variacoes : [])
        .map((variacao) => {
            const ref = normalizeRef(variacao?.ref);
            const tamanhosNormalizados = normalizarMapaDeTamanhos(variacao?.tamanhos, gradeLista);
            const possuiAlgumTamanho = Object.keys(tamanhosNormalizados || {}).length > 0;
            if (!ref || !possuiAlgumTamanho) {
                return null;
            }
            return {
                ref,
                tamanhos: tamanhosNormalizados,
                alwaysSeparate: Boolean(variacao?.alwaysSeparate),
            };
        })
        .filter(Boolean);

    if (!gradeLista.length) {
        const tamanhosEncontrados = normalizarGradeLista(
            variacoesProcessadas.flatMap((variacao) => Object.keys(variacao.tamanhos || {})),
        );
        if (tamanhosEncontrados.length) {
            gradeLista = tamanhosEncontrados;
        }
    }

    if (!gradeLista.length) {
        throw new Error('Informe ao menos um tamanho na grade.');
    }

    if (!variacoesProcessadas.length) {
        throw new Error('Cadastre pelo menos uma variação com tamanhos válidos.');
    }

    const todosOsTamanhosDasVariacoes = variacoesProcessadas.flatMap((variacao) =>
        Object.keys(variacao.tamanhos || {}),
    );
    const gradeFinal = normalizarGradeLista([...gradeLista, ...todosOsTamanhosDasVariacoes]);

    const variacoesNormalizadas = variacoesProcessadas.map((variacao) => ({
        ref: variacao.ref,
        tamanhos: preencherTamanhosComGrade(gradeFinal, variacao.tamanhos),
        alwaysSeparate: Boolean(variacao.alwaysSeparate),
    }));

    const alwaysSeparateRefsSet = new Set();
    variacoesNormalizadas.forEach((variacao) => {
        if (!variacao.alwaysSeparate) {
            return;
        }
        const normalizedRef = normalizeRef(variacao.ref);
        if (normalizedRef) {
            alwaysSeparateRefsSet.add(normalizedRef);
        }
    });

    const grouping = agrupamento === 'separadas' ? 'separadas' : 'juntas';
    const groupingMode = grouping === 'separadas' ? 'separated' : 'grouped';
    const payload = {
        codigo: codigoTrim,
        grade: gradeFinal,
        variations: variacoesNormalizadas,
        grouping,
        groupingMode,
        createdBy: responsavel,
        alwaysSeparateRefs: Array.from(alwaysSeparateRefsSet),
    };

    if (Number.isFinite(orderIndex)) {
        payload.orderIndex = orderIndex;
    }

    const options = responsavel ? { actor: responsavel } : undefined;
    const portfolioAtualizado = adicionarProduto(payload, options);

    const mensagemSucesso = `Produto ${codigoTrim} salvo com variações ${
        grouping === 'juntas' ? 'agrupadas' : 'separadas'
    }.`;

    return {
        portfolioAtualizado,
        mensagemSucesso,
    };
};

const formatDetalheTotalPreview = (detalhe, liquido) => {
    const positivo = normalizePreviewNumber(detalhe?.positivo);
    const negativo = normalizePreviewNumber(detalhe?.negativo);
    const liquidoNumero = normalizePreviewNumber(detalhe?.liquido ?? liquido);

    if (positivo > 0 && negativo < 0) {
        return {
            texto: `${positivo}-${Math.abs(negativo)}`,
            classe: 'text-gray-800 dark:text-gray-100',
        };
    }

    if (positivo > 0) {
        return {
            texto: String(positivo),
            classe: getValueTone(positivo),
        };
    }

    if (negativo < 0) {
        return {
            texto: String(negativo),
            classe: getValueTone(negativo),
        };
    }

    return {
        texto: String(liquidoNumero),
        classe: getValueTone(liquidoNumero),
    };
};

const sumSnapshotsResumo = (snapshots = []) => {
    return snapshots.reduce((acc, snapshot) => {
        const resumo = snapshot?.resumoPositivoNegativo || { positivoTotal: 0, negativoTotal: 0 };
        acc.positivo += resumo.positivoTotal || 0;
        acc.negativo += resumo.negativoTotal || 0;
        return acc;
    }, { positivo: 0, negativo: 0 });
};

const normalizeProductCodeForMatching = (value = '') => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.toUpperCase() : '';
};

const normalizeVariationRefForMatching = (value = '') => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    return trimmed ? trimmed.toUpperCase() : '';
};

const buildInitialAutoOrder = (snapshots = [], portfolio = []) => {
    if (!Array.isArray(snapshots) || !snapshots.length) {
        return [];
    }
    const snapshotMap = new Map();
    snapshots.forEach((snapshot) => {
        const normalized = normalizeProductCodeForMatching(snapshot?.productCode);
        if (normalized && !snapshotMap.has(normalized)) {
            snapshotMap.set(normalized, snapshot.productCode);
        }
    });
    const { order: portfolioOrder } = buildPortfolioPreferences(portfolio);
    const seen = new Set();
    const order = [];
    portfolioOrder.forEach((codigo) => {
        const normalized = normalizeProductCodeForMatching(codigo);
        if (!normalized || seen.has(normalized)) {
            return;
        }
        if (snapshotMap.has(normalized)) {
            order.push(snapshotMap.get(normalized));
            seen.add(normalized);
        }
    });
    snapshotMap.forEach((codigoOriginal, normalized) => {
        if (!seen.has(normalized)) {
            seen.add(normalized);
            order.push(codigoOriginal);
        }
    });
    return order;
};

const buildInitialAutoAdjustments = (snapshots = [], portfolio = []) => {
    const ajustes = {};
    const { preferenceMap } = buildPortfolioPreferences(portfolio);

    snapshots.forEach((snapshot) => {
        const normalized = normalizeProductCodeForMatching(snapshot?.productCode);
        if (!normalized) {
            return;
        }
        const preference = preferenceMap.get(normalized);
        const groupingMode = preference?.groupingMode === 'separated' ? 'separated' : 'grouped';
        const refsMap = preference?.alwaysSeparateLookup
            ? { ...preference.alwaysSeparateLookup }
            : {};
        ajustes[normalized] = {
            productCode: snapshot.productCode,
            groupingMode,
            alwaysSeparateRefs: refsMap,
        };
    });

    return ajustes;
};

const buildAutoSnapshots = ({
    rawSnapshots = [],
    adjustments = {},
    order = [],
    responsavel,
    dataLancamentoISO,
}) => {
    if (!Array.isArray(rawSnapshots) || !rawSnapshots.length) {
        return [];
    }

    const snapshotMap = new Map();
    rawSnapshots.forEach((snapshot) => {
        const normalized = normalizeProductCodeForMatching(snapshot?.productCode);
        if (normalized) {
            snapshotMap.set(normalized, snapshot);
        }
    });

    const normalizedOrder = [];
    const seen = new Set();
    order.forEach((codigo) => {
        const normalized = normalizeProductCodeForMatching(codigo);
        if (!normalized || seen.has(normalized)) {
            return;
        }
        if (snapshotMap.has(normalized)) {
            normalizedOrder.push(normalized);
            seen.add(normalized);
        }
    });
    snapshotMap.forEach((_, normalized) => {
        if (!seen.has(normalized)) {
            normalizedOrder.push(normalized);
            seen.add(normalized);
        }
    });

    const snapshotsFinais = [];

    normalizedOrder.forEach((normalized) => {
        const snapshot = snapshotMap.get(normalized);
        if (!snapshot) {
            return;
        }
        const adjustment = adjustments?.[normalized] || {};
        const groupingMode = adjustment.groupingMode === 'separated' ? 'separated' : 'grouped';
        const overrides = new Set();
        Object.entries(adjustment.alwaysSeparateRefs || {}).forEach(([ref, flag]) => {
            if (flag) {
                const normalizedRef = normalizeVariationRefForMatching(ref);
                if (normalizedRef) {
                    overrides.add(normalizedRef);
                }
            }
        });

        const baseConfig = {
            produtoBase: snapshot.productCode,
            grade: Array.isArray(snapshot?.grade) ? snapshot.grade : [],
            responsavel,
            dataLancamentoISO,
        };

        const groupedVariations = [];
        const separatedVariations = [];
        const variations = Array.isArray(snapshot?.variations) ? snapshot.variations : [];

        variations.forEach((variation) => {
            const normalizedRef = normalizeVariationRefForMatching(variation?.ref);
            if (groupingMode === 'separated') {
                separatedVariations.push(variation);
                return;
            }
            if (normalizedRef && overrides.has(normalizedRef)) {
                separatedVariations.push(variation);
                return;
            }
            groupedVariations.push(variation);
        });

        if (groupedVariations.length) {
            snapshotsFinais.push(
                criarSnapshotProduto({
                    ...baseConfig,
                    variations: groupedVariations,
                }),
            );
        }

        separatedVariations.forEach((variation) => {
            snapshotsFinais.push(
                criarSnapshotProduto({
                    ...baseConfig,
                    produtoBase: variation?.ref || snapshot.productCode,
                    variations: [variation],
                }),
            );
        });
    });

    return snapshotsFinais;
};

const GestaoProducaoEstoqueModule = ({
    onNavigateToCrono,
    onNavigateToStock,
    onNavigateToFichaTecnica,
    onNavigateToOperationalSequence,
    onNavigateToReports,
}) => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = usePersistedTheme();

    const [portfolio, setPortfolio] = useState([]);
    const [historico, setHistorico] = useState([]);
    const [mostrarPortfolio, setMostrarPortfolio] = useState(false);
    const [mostrarHistorico, setMostrarHistorico] = useState(false);
    const [tipoArquivo, setTipoArquivo] = useState('docx');
    const [arquivoSelecionado, setArquivoSelecionado] = useState(null);
    const [arquivoNome, setArquivoNome] = useState('');
    const [previewSnapshots, setPreviewSnapshots] = useState([]);
    const [previewSource, setPreviewSource] = useState(null);
    const [autoImportRawSnapshots, setAutoImportRawSnapshots] = useState([]);
    const [autoImportAdjustments, setAutoImportAdjustments] = useState({});
    const [autoImportOrder, setAutoImportOrder] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [status, setStatus] = useState({ type: 'idle', message: '' });
    const [autoCarregamentoInicialAplicado, setAutoCarregamentoInicialAplicado] = useState(false);
    const [aiConversationText, setAiConversationText] = useState('');

    const registerGridCell = useCallback((rowIndex, colIndex, element) => {
        const key = `${rowIndex}-${colIndex}`;
        if (element) {
            gridCellRefs.current.set(key, element);
        } else {
            gridCellRefs.current.delete(key);
        }
    }, []);

    const formatarTamanhos = useCallback((tamanhos = {}) => {
        const entries = Object.entries(tamanhos || {});
        if (!entries.length) {
            return 'Sem tamanhos cadastrados';
        }
        return entries.map(([size, quantidade]) => `${size}: ${quantidade}`).join(', ');
    }, []);

    const responsavelAtual = useMemo(() => {
        return user?.displayName || user?.email || 'Responsável não identificado';
    }, [user]);

    useEffect(() => {
        setPortfolio(listPortfolio());
        setHistorico(carregarHistorico());
    }, []);
    useEffect(() => {
        if (previewSource !== 'auto' && previewSource !== 'ia') {
            return;
        }
        if (!autoImportRawSnapshots.length) {
            setPreviewSnapshots([]);
            return;
        }
        const snapshots = buildAutoSnapshots({
            rawSnapshots: autoImportRawSnapshots,
            adjustments: autoImportAdjustments,
            order: autoImportOrder,
            responsavel: responsavelAtual,
        });
        setPreviewSnapshots(snapshots);
    }, [
        autoImportRawSnapshots,
        autoImportAdjustments,
        autoImportOrder,
        previewSource,
        responsavelAtual,
    ]);

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
                key: 'estoque',
                label: 'Estoque',
                icon: Warehouse,
                onClick: onNavigateToStock,
            }
            : null,
        onNavigateToFichaTecnica
            ? {
                key: 'ficha',
                label: 'Ficha Técnica',
                icon: ClipboardList,
                onClick: onNavigateToFichaTecnica,
            }
            : null,
        onNavigateToOperationalSequence
            ? {
                key: 'sequencia',
                label: 'Sequência Operacional',
                icon: Layers,
                onClick: onNavigateToOperationalSequence,
            }
            : null,
        onNavigateToReports
            ? {
                key: 'relatorios',
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

    const resetPreview = useCallback(() => {
        setPreviewSnapshots([]);
        setPreviewSource(null);
        setAutoImportRawSnapshots([]);
        setAutoImportAdjustments({});
        setAutoImportOrder([]);
    }, []);

    const atualizarPortfolioComAjustes = useCallback(
        (codigoNormalizado, transformFn) => {
            if (!codigoNormalizado || typeof transformFn !== 'function') {
                return;
            }
            setPortfolio((prevPortfolio) => {
                const snapshotRelacionado = autoImportRawSnapshots.find(
                    (item) => normalizeProductCodeForMatching(item?.productCode) === codigoNormalizado,
                );
                const existente = prevPortfolio.find(
                    (item) => normalizeProductCodeForMatching(item?.codigo) === codigoNormalizado,
                );
                const codigoFinal = existente?.codigo || snapshotRelacionado?.productCode || codigoNormalizado;
                const groupingSalvo = existente?.grouping
                    || (existente?.agruparVariacoes ? 'juntas' : 'separadas')
                    || 'juntas';
                const groupingModeSalvo = existente?.groupingMode === 'separated'
                    ? 'separated'
                    : existente?.groupingMode === 'grouped'
                        ? 'grouped'
                        : groupingSalvo === 'separadas'
                            ? 'separated'
                            : 'grouped';
                const payloadBase = {
                    codigo: codigoFinal,
                    grade: existente?.grade?.length ? existente.grade : snapshotRelacionado?.grade || [],
                    variations: existente?.variations || [],
                    grouping: groupingSalvo,
                    groupingMode: groupingModeSalvo,
                    alwaysSeparateRefs: existente?.alwaysSeparateRefs || [],
                };
                const atualizado = transformFn({ ...payloadBase }, snapshotRelacionado, existente);
                if (!atualizado || !atualizado.codigo) {
                    return prevPortfolio;
                }
                return upsertPortfolio(atualizado, { actor: { name: responsavelAtual } });
            });
        },
        [autoImportRawSnapshots, responsavelAtual],
    );

    const handleTipoArquivo = useCallback((novoTipo) => {
        setTipoArquivo(novoTipo);
        resetPreview();
        setStatus({ type: 'info', message: `Formato de importação atualizado para ${novoTipo.toUpperCase()}.` });
    }, [resetPreview]);

    const handleArquivoChange = useCallback((event) => {
        const [file] = event.target.files || [];
        setArquivoSelecionado(file || null);
        setArquivoNome(file ? file.name : '');
        resetPreview();
        if (file) {
            setStatus({ type: 'info', message: `Arquivo "${file.name}" pronto para processamento.` });
        }
    }, [resetPreview]);

    const handleProcessarArquivo = useCallback(async () => {
        if (!arquivoSelecionado) {
            setStatus({ type: 'error', message: 'Selecione um arquivo para processar.' });
            return;
        }
        setProcessing(true);
        setStatus({ type: 'info', message: 'Lendo arquivo e montando prévia das variações...' });
        try {
            const produtosImportados = await importStockFile(arquivoSelecionado);
            const ajustesIniciais = buildInitialAutoAdjustments(produtosImportados, portfolio);
            const ordemInicial = buildInitialAutoOrder(produtosImportados, portfolio);
            setAutoImportRawSnapshots(produtosImportados);
            setAutoImportAdjustments(ajustesIniciais);
            setAutoImportOrder(ordemInicial);
            setPreviewSnapshots([]);
            setPreviewSource('ia');
            if (produtosImportados.length) {
                setStatus({
                    type: 'success',
                    message:
                        'Prévia montada. Reordene os produtos, ajuste o agrupamento e confirme para gerar o relatório.',
                });
            } else {
                setStatus({ type: 'warning', message: 'Nenhum produto foi encontrado neste arquivo.' });
            }
        } catch (error) {
            setStatus({ type: 'error', message: error?.message || 'Falha ao processar o arquivo. Tente novamente.' });
        } finally {
            setProcessing(false);
        }
    }, [arquivoSelecionado, portfolio]);

    const handleAutoImportReorder = useCallback(
        (draggedCode, targetCode) => {
            const sourceNormalized = normalizeProductCodeForMatching(draggedCode);
            if (!sourceNormalized) {
                return;
            }
            if (targetCode && sourceNormalized === normalizeProductCodeForMatching(targetCode)) {
                return;
            }
            setAutoImportOrder((prev) => {
                const filtered = prev.filter(
                    (codigo) => normalizeProductCodeForMatching(codigo) !== sourceNormalized,
                );
                const snapshotRelacionado = autoImportRawSnapshots.find(
                    (item) => normalizeProductCodeForMatching(item?.productCode) === sourceNormalized,
                );
                const codigoParaInserir = snapshotRelacionado?.productCode || draggedCode;
                if (!codigoParaInserir) {
                    return filtered;
                }
                if (targetCode) {
                    const targetNormalized = normalizeProductCodeForMatching(targetCode);
                    const targetIndex = filtered.findIndex(
                        (codigo) => normalizeProductCodeForMatching(codigo) === targetNormalized,
                    );
                    if (targetIndex >= 0) {
                        filtered.splice(targetIndex, 0, codigoParaInserir);
                        return [...filtered];
                    }
                }
                return [...filtered, codigoParaInserir];
            });
        },
        [autoImportRawSnapshots],
    );

    const handleAutoImportGroupingChange = useCallback(
        (productCode, groupingMode) => {
            const normalized = normalizeProductCodeForMatching(productCode);
            if (!normalized) {
                return;
            }
            const normalizedMode = groupingMode === 'separated' ? 'separated' : 'grouped';
            const grouping = normalizedMode === 'separated' ? 'separadas' : 'juntas';
            setAutoImportAdjustments((prev) => {
                const atual = prev[normalized] || {
                    productCode,
                    groupingMode: 'grouped',
                    alwaysSeparateRefs: {},
                };
                if (atual.groupingMode === normalizedMode) {
                    return prev;
                }
                return {
                    ...prev,
                    [normalized]: {
                        ...atual,
                        productCode: atual.productCode || productCode,
                        groupingMode: normalizedMode,
                    },
                };
            });
            atualizarPortfolioComAjustes(normalized, (payloadBase) => ({
                ...payloadBase,
                grouping,
                groupingMode: normalizedMode,
                agruparVariacoes: grouping !== 'separadas',
            }));
        },
        [atualizarPortfolioComAjustes],
    );

    const handleAutoImportAlwaysSeparateChange = useCallback(
        (productCode, variationRef, checked) => {
            const normalizedCode = normalizeProductCodeForMatching(productCode);
            const normalizedRef = normalizeVariationRefForMatching(variationRef);
            if (!normalizedCode || !normalizedRef) {
                return;
            }
            setAutoImportAdjustments((prev) => {
                const atual = prev[normalizedCode] || {
                    productCode,
                    groupingMode: 'grouped',
                    alwaysSeparateRefs: {},
                };
                const refsAtualizados = { ...(atual.alwaysSeparateRefs || {}) };
                if (checked) {
                    refsAtualizados[normalizedRef] = true;
                } else {
                    delete refsAtualizados[normalizedRef];
                }
                return {
                    ...prev,
                    [normalizedCode]: {
                        ...atual,
                        productCode: atual.productCode || productCode,
                        alwaysSeparateRefs: refsAtualizados,
                    },
                };
            });
            atualizarPortfolioComAjustes(normalizedCode, (payloadBase) => {
                const refsExistentes = new Set(
                    (payloadBase.alwaysSeparateRefs || []).map((ref) =>
                        normalizeVariationRefForMatching(ref),
                    ),
                );
                if (checked) {
                    refsExistentes.add(normalizedRef);
                } else {
                    refsExistentes.delete(normalizedRef);
                }
                return {
                    ...payloadBase,
                    alwaysSeparateRefs: Array.from(refsExistentes).filter(Boolean),
                };
            });
        },
        [atualizarPortfolioComAjustes],
    );

    const handleConfirmarLancamento = useCallback(async () => {
        if ((previewSource !== 'auto' && previewSource !== 'ia') || !autoImportRawSnapshots.length) {
            setStatus({
                type: 'error',
                message: 'Gere e revise a prévia da IA antes de confirmar o lançamento.',
            });
            return;
        }
        setProcessing(true);
        setStatus({ type: 'info', message: 'Gerando relatório completo e salvando no histórico...' });
        try {
            const dataLancamentoISO = new Date().toISOString();
            const finalSnapshots = buildAutoSnapshots({
                rawSnapshots: autoImportRawSnapshots,
                adjustments: autoImportAdjustments,
                order: autoImportOrder,
                responsavel: responsavelAtual,
                dataLancamentoISO,
            });
            if (!finalSnapshots.length) {
                throw new Error('Nenhum snapshot foi gerado. Ajuste as variações e tente novamente.');
            }
            await importarArquivoDeProducao(finalSnapshots, 'ia', responsavelAtual);
            setHistorico(carregarHistorico());
            setStatus({
                type: 'success',
                message: 'Lançamento registrado com sucesso! O relatório foi aberto em uma nova aba.',
            });
            setArquivoSelecionado(null);
            setArquivoNome('');
            resetPreview();
            const portfolioCodes = new Set(
                portfolio.map((item) => normalizeProductCodeForMatching(item?.codigo)),
            );
            const ordemParaPersistir = autoImportOrder.filter((codigo) =>
                portfolioCodes.has(normalizeProductCodeForMatching(codigo)),
            );
            if (ordemParaPersistir.length) {
                const atualizado = reordenarPortfolio(ordemParaPersistir);
                setPortfolio(atualizado);
            }
        } catch (error) {
            setStatus({ type: 'error', message: error?.message || 'Não foi possível concluir o lançamento.' });
        } finally {
            setProcessing(false);
        }
    }, [
        previewSource,
        autoImportRawSnapshots,
        autoImportAdjustments,
        autoImportOrder,
        responsavelAtual,
        resetPreview,
        portfolio,
    ]);

    const handleExecutarExemplo = useCallback(() => {
        exemploFluxoCompleto();

    const handleAplicarRespostaIa = useCallback(() => {
        try {
            const parsed = JSON.parse(aiConversationText || '[]');
            const snapshots = Array.isArray(parsed?.snapshots) ? parsed.snapshots : Array.isArray(parsed) ? parsed : [];
            if (!snapshots.length) {
                throw new Error('Nenhum snapshot foi encontrado na resposta da IA.');
            }
            const ajustesIniciais = buildInitialAutoAdjustments(snapshots, portfolio);
            const ordemInicial = buildInitialAutoOrder(snapshots, portfolio);
            setAutoImportRawSnapshots(snapshots);
            setAutoImportAdjustments(ajustesIniciais);
            setAutoImportOrder(ordemInicial);
            setPreviewSnapshots([]);
            setPreviewSource('ia');
            setStatus({
                type: 'success',
                message: 'Resposta da IA aplicada. Revise o agrupamento e confirme o lançamento.',
            });
        } catch (error) {
            setStatus({ type: 'error', message: error?.message || 'Não foi possível interpretar a resposta da IA.' });
        }
    }, [aiConversationText, portfolio]);

    const handleRemoverProduto = useCallback((codigo) => {
        const atualizado = deletePortfolio(codigo);
        setPortfolio(atualizado);
        setStatus({ type: 'success', message: `Produto ${codigo} removido do portfólio.` });
    }, []);

    const handleMoverProduto = useCallback((index, direction) => {
        const alvo = index + direction;
        if (alvo < 0 || alvo >= portfolio.length) {
            return;
        }
        const novaOrdem = [...portfolio];
        const [item] = novaOrdem.splice(index, 1);
        novaOrdem.splice(alvo, 0, item);
        const atualizado = reordenarPortfolio(novaOrdem);
        setPortfolio(atualizado);
    }, [portfolio]);

    const handleVisualizarRegistro = useCallback((registro) => {
        const paginas = paginarRelatorioEmPaginasA4(registro);
        const html = gerarHTMLImpressaoPaginado(registro, paginas);
        const novaJanela = window.open('', '_blank');
        if (novaJanela) {
            novaJanela.document.write(html);
            novaJanela.document.close();
        }
    }, []);

    const previewResumo = useMemo(() => sumSnapshotsResumo(previewSnapshots), [previewSnapshots]);

    return (
        <div className="responsive-root min-h-screen bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200">
            <GlobalStyles />
            <HeaderContainer>
                <GlobalNavigation
                    logoSrc={raceBullLogoUrl}
                    title={MODULE_TITLE}
                    subtitle={MODULE_SUBTITLE}
                    navigationButtons={navigationButtons}
                    userEmail={user?.email}
                    onLogout={logout}
                    logoutLabel="Sair"
                    logoutButtonClassName="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-2 text-red-500 w-full sm:w-auto justify-center"
                    hideLogoutLabelOnMobile
                    theme={theme}
                    onToggleTheme={toggleTheme}
                />
            </HeaderContainer>

            <main className="responsive-main py-8">
                <div className="max-w-6xl mx-auto space-y-8">
                    {status.message && (
                        <div
                            className={[
                                'rounded-lg p-4 border text-sm shadow-sm',
                                status.type === 'error' && 'border-red-400 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
                                status.type === 'success' && 'border-green-400 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
                                status.type === 'warning' && 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
                                status.type === 'info' && 'border-blue-400 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
                                status.type === 'idle' && 'border-gray-300 bg-white dark:bg-gray-900 dark:text-gray-100',
                            ].filter(Boolean).join(' ')}
                        >
                            {status.message}
                        </div>
                    )}

                    <section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm p-6 space-y-6">
                        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-semibold">Importação automatizada</h2>
                                <p className="text-sm text-gray-600 dark:text-gray-300">
                                    Selecione o relatório recebido (DOCX ou TXT), gere uma prévia e confirme o lançamento para salvar o snapshot diário com histórico e relatório paginado.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleExecutarExemplo}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/50 dark:text-indigo-200"
                            >
                            <RefreshCcw size={16} />
                            Fluxo de exemplo
                        </button>
                    </header>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Resposta da IA (JSON ou lista de snapshots)</label>
                        <textarea
                            value={aiConversationText}
                            onChange={(event) => setAiConversationText(event.target.value)}
                            rows={4}
                            className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                            placeholder="Cole aqui a resposta gerada pela IA para mapear diretamente para snapshots."
                        />
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={handleAplicarRespostaIa}
                                disabled={processing || !aiConversationText.trim()}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                            >
                                <Layers size={16} />
                                Aplicar resposta da IA
                            </button>
                            <button
                                type="button"
                                onClick={() => setAiConversationText('')}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                                <Trash2 size={16} />
                                Limpar texto
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Esta área centraliza a interação com a IA. Cole o retorno da conversa ou importe um arquivo para gerar snapshots e relatórios.</p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de arquivo</span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleTipoArquivo('docx')}
                                    className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border ${tipoArquivo === 'docx' ? 'border-indigo-500 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200' : 'border-gray-300 bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                                >
                                    <FileType2 size={18} /> DOCX
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTipoArquivo('txt')}
                                    className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border ${tipoArquivo === 'txt' ? 'border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200' : 'border-gray-300 bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                                >
                                    <FileText size={18} /> TXT
                                </button>
                            </div>
                        </div>

                        <div className="md:col-span-2 flex flex-col gap-2">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Arquivo do relatório</span>
                            <label className="flex items-center gap-3 px-4 py-3 border border-dashed border-gray-300 dark:border-gray-600 rounded-md cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm">
                                <Upload size={18} />
                                <div className="flex-1">
                                    {arquivoNome ? (
                                        <span className="font-medium text-gray-800 dark:text-gray-100">{arquivoNome}</span>
                                    ) : (
                                        <span className="text-gray-500 dark:text-gray-300">Clique para selecionar o arquivo...</span>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    accept={tipoArquivo === 'docx' ? '.docx' : '.txt'}
                                    className="hidden"
                                    onChange={handleArquivoChange}
                                />
                            </label>
                        </div>
                    </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <button
                                type="button"
                                onClick={handleProcessarArquivo}
                                disabled={processing || !arquivoSelecionado}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                <Eye size={16} />
                                Gerar prévia
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmarLancamento}
                                disabled={processing || (!previewSnapshots.length || (previewSource !== 'auto' && previewSource !== 'ia'))}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                            >
                                <CheckCircle2 size={16} />
                                Confirmar lançamento
                            </button>
                            <button
                                type="button"
                                onClick={() => { setArquivoSelecionado(null); setArquivoNome(''); resetPreview(); setStatus({ type: 'idle', message: '' }); }}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                            >
                                <Trash2 size={16} />
                                Limpar seleção
                            </button>
                        </div>

                        {previewSnapshots.length > 0 && (
                            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
                                <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-semibold">Prévia do lançamento</h3>
                                        <p className="text-sm text-gray-600 dark:text-gray-300">
                                            Revise as variações encontradas antes de confirmar o lançamento. Os totais agregam sobras (valores negativos) e necessidades de produção (valores positivos).
                                        </p>
                                    </div>
                                    <div className="text-sm bg-gray-100 dark:bg-gray-800 rounded-md px-3 py-2">
                                        <div>Necessário produzir: <span className="font-semibold text-red-600 dark:text-red-400">{previewResumo.positivo}</span></div>
                                        <div>Sobra consolidada: <span className="font-semibold text-blue-600 dark:text-blue-400">{previewResumo.negativo}</span></div>
                                    </div>
                                </header>

                                {previewSource ? (
                                    <AutoImportReview
                                        rawSnapshots={autoImportRawSnapshots}
                                        orderedProductCodes={autoImportOrder}
                                        adjustments={autoImportAdjustments}
                                        onReorder={handleAutoImportReorder}
                                        onToggleGrouping={handleAutoImportGroupingChange}
                                        onToggleAlwaysSeparate={handleAutoImportAlwaysSeparateChange}
                                    />
                                ) : (
                                    <p className="text-sm text-gray-600 dark:text-gray-300">Importe um arquivo ou cole a resposta da IA para visualizar a prévia.</p>
                                )}
                            </div>
                        )}
                    </section>

                    <section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm">
                        <header
                            className="flex items-center justify-between px-6 py-4 cursor-pointer border-b border-gray-200 dark:border-gray-800"
                            onClick={() => setMostrarPortfolio((prev) => !prev)}
                        >
                            <div className="flex items-center gap-3">
                                <Settings size={20} />
                                <div>
                                    <h3 className="text-lg font-semibold">Portfólio de produtos</h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-300">Preferências usadas para ordenar e agrupar respostas da IA.</p>
                                </div>
                            </div>
                            <ArrowDown className={`transition-transform ${mostrarPortfolio ? 'rotate-180' : ''}`} size={20} />
                        </header>
                        {mostrarPortfolio && (
                            <div className="p-6 space-y-4">
                                {portfolio.length === 0 && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum portfólio salvo ainda. Confirme um lançamento da IA para popular automaticamente.</p>
                                )}
                                {portfolio.map((item, index) => (
                                    <div key={item.codigo} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border border-gray-200 dark:border-gray-700 rounded-md px-4 py-3">
                                        <div className="space-y-1">
                                            <h4 className="font-semibold">Produto {item.codigo}</h4>
                                            <p className="text-sm text-gray-600 dark:text-gray-300">Grade: {item.grade && item.grade.length ? item.grade.join(' / ') : 'Sem grade definida'}</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">Agrupamento preferido: {item.groupingMode === 'separated' ? 'Snapshots separados' : 'Snapshots agrupados'}</p>
                                            {item.variations && item.variations.length > 0 && (
                                                <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
                                                    {item.variations.map((variacao) => (
                                                        <p key={variacao.ref}>
                                                            <span className="font-semibold">{variacao.ref}</span> · {formatarTamanhos(variacao.tamanhos)}
                                                        </p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleMoverProduto(index, -1)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600"
                                            >
                                                <ArrowUp size={16} />
                                                Subir
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleMoverProduto(index, 1)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600"
                                            >
                                                <ArrowDown size={16} />
                                                Descer
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoverProduto(item.codigo)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300"
                                            >
                                                <Trash2 size={16} />
                                                Remover
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm">

                        <header
                            className="flex items-center justify-between px-6 py-4 cursor-pointer border-b border-gray-200 dark:border-gray-800"
                            onClick={() => setMostrarHistorico((prev) => !prev)}
                        >
                            <div className="flex items-center gap-3">
                                <History size={20} />
                                <div>
                                    <h3 className="text-lg font-semibold">Histórico de lançamentos</h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-300">Visualize lançamentos anteriores e reabra relatórios paginados.</p>
                                </div>
                            </div>
                            <ArrowDown className={`transition-transform ${mostrarHistorico ? 'rotate-180' : ''}`} size={20} />
                        </header>
                        {mostrarHistorico && (
                            <div className="p-6 space-y-4">
                                {historico.length === 0 && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum lançamento registrado ainda. Importe um arquivo para iniciar o histórico.</p>
                                )}
                                <div className="space-y-3">
                                    {historico.map((registro, index) => (
                                        <div key={`${registro.dataLancamentoISO}-${index}`} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-gray-200 dark:border-gray-700 rounded-md px-4 py-3">
                                            <div>
                                                <p className="text-sm text-gray-600 dark:text-gray-300">{formatDateTime(registro.dataLancamentoISO)}</p>
                                                <p className="font-semibold">Responsável: {registro.responsavel || '-'} · Produtos: {registro.produtos?.length || 0}</p>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleVisualizarRegistro(registro)}
                                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                                                >
                                                    <Printer size={16} />
                                                    Abrir relatório
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </main>
        </div>
    );
};

export default GestaoProducaoEstoqueModule;
