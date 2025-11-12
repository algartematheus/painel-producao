import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    Upload,
    FileSpreadsheet,
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
    criarSnapshotProduto,
    montarDailyRecord,
    salvarNoHistorico,
    carregarHistorico,
    paginarRelatorioEmPaginasA4,
    gerarHTMLImpressaoPaginado,
    importarArquivoDeProducao,
    exemploFluxoCompleto,
} from './relatorioEstoque';
import importStockFile, { PDF_LIBRARY_UNAVAILABLE_ERROR } from './stockImporter';

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
    return { ref: '', tamanhos };
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

const normalizarMapaDeTamanhos = (tamanhosEntrada, gradeLista = []) => {
    const mapaEntrada = isPlainObject(tamanhosEntrada)
        ? tamanhosEntrada
        : parseTamanhosString(tamanhosEntrada, { grade: gradeLista });
    const listaNormalizada = normalizarGradeLista(gradeLista);
    const resultado = {};

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

    Object.entries(mapaNormalizado).forEach(([tamanho, valor]) => {
        if (!tamanho || listaNormalizada.includes(tamanho)) {
            return;
        }
        resultado[tamanho] = normalizarQuantidade(valor);
    });

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
    adicionarProduto = upsertPortfolio,
}) => {
    const codigoTrim = typeof codigo === 'string' ? codigo.trim() : '';
    if (!codigoTrim) {
        throw new Error('Informe o código do produto base.');
    }

    let gradeLista = normalizarGradeLista(parseGradeString(grade));
    const variacoesProcessadas = (Array.isArray(variacoes) ? variacoes : [])
        .map((variacao) => {
            const ref = typeof variacao?.ref === 'string' ? variacao.ref.trim() : '';
            const tamanhosNormalizados = normalizarMapaDeTamanhos(variacao?.tamanhos, gradeLista);
            if (!ref || !temQuantidadeInformada(tamanhosNormalizados)) {
                return null;
            }
            return {
                ref,
                tamanhos: tamanhosNormalizados,
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
    }));

    const grouping = agrupamento === 'separadas' ? 'separadas' : 'juntas';
    const payload = {
        codigo: codigoTrim,
        grade: gradeFinal,
        variations: variacoesNormalizadas,
        grouping,
        createdBy: responsavel,
    };

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

const parseManualGradeText = (gradeText) => normalizarGradeLista(parseGradeString(gradeText));

const reconciliarVariacoesManuais = (variacoes = [], gradeLista = []) => {
    const alinhadas = prepararVariacoesComGrade(variacoes, gradeLista);
    if (!alinhadas.length) {
        return [criarVariacaoVazia(gradeLista)];
    }
    return alinhadas;
};

const extrairTamanhosDeVariacoes = (variacoes = []) =>
    normalizarGradeLista(
        (Array.isArray(variacoes) ? variacoes : []).flatMap((variacao) =>
            Object.keys(isPlainObject(variacao?.tamanhos) ? variacao.tamanhos : {}),
        ),
    );

const validarFormularioManual = ({
    codigo,
    gradeTexto,
    gradeLista,
    variacoes,
    agrupamento,
}) => {
    const codigoTrim = typeof codigo === 'string' ? codigo.trim().toUpperCase() : '';
    if (!codigoTrim) {
        throw new Error('Informe o código do produto base.');
    }

    let gradeNormalizada = normalizarGradeLista(
        Array.isArray(gradeLista) && gradeLista.length ? gradeLista : parseGradeString(gradeTexto),
    );

    const variacoesProcessadas = (Array.isArray(variacoes) ? variacoes : [])
        .map((variacao) => {
            const ref = typeof variacao?.ref === 'string' ? variacao.ref.trim().toUpperCase() : '';
            const tamanhos = preencherTamanhosComGrade(gradeNormalizada, variacao?.tamanhos);
            if (!ref || !temQuantidadeInformada(tamanhos)) {
                return null;
            }
            return {
                ref,
                tamanhos,
            };
        })
        .filter(Boolean);

    if (!gradeNormalizada.length) {
        const tamanhosExtras = extrairTamanhosDeVariacoes(variacoesProcessadas);
        gradeNormalizada = tamanhosExtras;
    }

    if (!gradeNormalizada.length) {
        throw new Error('Informe ao menos um tamanho na grade.');
    }

    const gradeFinal = normalizarGradeLista([
        ...gradeNormalizada,
        ...extrairTamanhosDeVariacoes(variacoesProcessadas),
    ]);

    if (!variacoesProcessadas.length) {
        throw new Error('Cadastre pelo menos uma variação com tamanhos válidos.');
    }

    const variacoesAlinhadas = variacoesProcessadas.map((variacao) => ({
        ref: variacao.ref,
        tamanhos: preencherTamanhosComGrade(gradeFinal, variacao.tamanhos),
    }));

    return {
        codigo: codigoTrim,
        grade: gradeFinal,
        variacoes: variacoesAlinhadas,
        agrupamento: agrupamento === 'separadas' ? 'separadas' : 'juntas',
    };
};

const tentarValidarFormularioManual = (dados) => {
    try {
        return validarFormularioManual(dados);
    } catch (error) {
        return null;
    }
};

const construirSnapshotsManuais = ({
    codigo,
    grade,
    variacoes,
    agrupamento,
    responsavel,
    dataLancamentoISO = null,
}) => {
    const snapshotConfig = {
        grade,
        responsavel,
        dataLancamentoISO,
    };

    if (agrupamento === 'separadas') {
        return variacoes.map((variacao) =>
            criarSnapshotProduto({
                ...snapshotConfig,
                produtoBase: variacao.ref || codigo,
                variations: [variacao],
            }),
        );
    }

    return [
        criarSnapshotProduto({
            ...snapshotConfig,
            produtoBase: codigo,
            variations: variacoes,
        }),
    ];
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
    const [novoProdutoCodigo, setNovoProdutoCodigo] = useState('');
    const [novoProdutoGrade, setNovoProdutoGrade] = useState('');
    const [novoProdutoVariacoes, setNovoProdutoVariacoes] = useState([criarVariacaoVazia()]);
    const [novoProdutoAgrupamento, setNovoProdutoAgrupamento] = useState('juntas');
    const [tipoArquivo, setTipoArquivo] = useState('xlsx');
    const [arquivoSelecionado, setArquivoSelecionado] = useState(null);
    const [arquivoNome, setArquivoNome] = useState('');
    const [previewSnapshots, setPreviewSnapshots] = useState([]);
    const [manualPreviewSnapshots, setManualPreviewSnapshots] = useState([]);
    const [manualPreviewData, setManualPreviewData] = useState(null);
    const [previewSource, setPreviewSource] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [status, setStatus] = useState({ type: 'idle', message: '' });

    const gradeListaAtual = useMemo(() => parseManualGradeText(novoProdutoGrade), [novoProdutoGrade]);

    const clearManualPreview = useCallback(() => {
        setManualPreviewSnapshots([]);
        setManualPreviewData(null);
        if (previewSource === 'manual') {
            setPreviewSnapshots([]);
            setPreviewSource(null);
        }
    }, [previewSource]);

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
        setNovoProdutoVariacoes((prev) => {
            const alinhadas = reconciliarVariacoesManuais(prev, gradeListaAtual);
            if (!alinhadas.length) {
                return [criarVariacaoVazia(gradeListaAtual)];
            }
            const nenhumaMudanca =
                alinhadas.length === prev.length &&
                alinhadas.every((variacao, index) => {
                    const original = prev[index] || {};
                    const refOriginal = typeof original.ref === 'string' ? original.ref : '';
                    return (
                        variacao.ref === refOriginal &&
                        saoMapasDeTamanhosIguais(variacao.tamanhos, original.tamanhos)
                    );
                });
            return nenhumaMudanca ? prev : alinhadas;
        });
    }, [gradeListaAtual]);

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
        setManualPreviewSnapshots([]);
        setManualPreviewData(null);
        setPreviewSource(null);
    }, []);

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
            const produtosImportados = await importStockFile({ file: arquivoSelecionado, type: tipoArquivo });
            const snapshots = produtosImportados.map((produto) => criarSnapshotProduto({
                produtoBase: produto.productCode || produto.produtoBase,
                grade: produto.grade,
                variations: produto.variations,
                dataLancamentoISO: new Date().toISOString(),
                responsavel: responsavelAtual,
            }));
            setPreviewSnapshots(snapshots);
            setManualPreviewSnapshots([]);
            setManualPreviewData(null);
            setPreviewSource('auto');
            if (snapshots.length) {
                setStatus({ type: 'success', message: `Prévia montada com ${snapshots.length} produto(s). Revise e confirme o lançamento.` });
            } else {
                setStatus({ type: 'warning', message: 'Nenhum produto foi encontrado neste arquivo.' });
            }
        } catch (error) {
            if (error?.code === PDF_LIBRARY_UNAVAILABLE_ERROR) {
                setStatus({
                    type: 'error',
                    message: 'Não foi possível ler o PDF porque a biblioteca pdf.js não está disponível. Recarregue a página ou reinstale as dependências e tente novamente.',
                });
            } else {
                setStatus({ type: 'error', message: error?.message || 'Falha ao processar o arquivo. Tente novamente.' });
            }
        } finally {
            setProcessing(false);
        }
    }, [arquivoSelecionado, tipoArquivo, responsavelAtual]);

    const handleConfirmarLancamento = useCallback(async () => {
        if (!arquivoSelecionado) {
            setStatus({ type: 'error', message: 'Selecione e processe um arquivo antes de confirmar o lançamento.' });
            return;
        }
        setProcessing(true);
        setStatus({ type: 'info', message: 'Gerando relatório completo e salvando no histórico...' });
        try {
            await importarArquivoDeProducao(arquivoSelecionado, tipoArquivo, responsavelAtual);
            setHistorico(carregarHistorico());
            setStatus({ type: 'success', message: 'Lançamento registrado com sucesso! O relatório foi aberto em uma nova aba.' });
            resetPreview();
        } catch (error) {
            setStatus({ type: 'error', message: error?.message || 'Não foi possível concluir o lançamento.' });
        } finally {
            setProcessing(false);
        }
    }, [arquivoSelecionado, tipoArquivo, responsavelAtual, resetPreview]);

    const handleExecutarExemplo = useCallback(() => {
        exemploFluxoCompleto();
        setHistorico(carregarHistorico());
        setStatus({ type: 'success', message: 'Exemplo executado. Um relatório demonstrativo foi gerado em uma nova aba.' });
    }, []);

    const handleAdicionarLinhaVariacao = useCallback(() => {
        setNovoProdutoVariacoes((prev) => [...prev, criarVariacaoVazia(gradeListaAtual)]);
        clearManualPreview();
    }, [gradeListaAtual, clearManualPreview]);

    const handleAtualizarVariacao = useCallback((index, campo, valor, tamanhoAlvo = null) => {
        let houveAlteracao = false;
        setNovoProdutoVariacoes((prev) =>
            prev.map((variacao, idx) => {
                if (idx !== index) {
                    return variacao;
                }
                if (campo === 'ref') {
                    const valorNormalizado = typeof valor === 'string' ? valor.toUpperCase() : '';
                    if (variacao.ref === valorNormalizado) {
                        return variacao;
                    }
                    houveAlteracao = true;
                    return { ...variacao, ref: valorNormalizado };
                }
                if (campo === 'tamanhos' && tamanhoAlvo) {
                    const tamanhosAtuais = isPlainObject(variacao.tamanhos) ? variacao.tamanhos : {};
                    const valorBruto = typeof valor === 'string' ? valor : String(valor ?? '');
                    if (valorBruto === '' || valorBruto === '-' || valorBruto === '+') {
                        if (tamanhosAtuais[tamanhoAlvo] === valorBruto) {
                            return variacao;
                        }
                        houveAlteracao = true;
                        return {
                            ...variacao,
                            tamanhos: {
                                ...tamanhosAtuais,
                                [tamanhoAlvo]: valorBruto,
                            },
                        };
                    }
                    const quantidadeNormalizada = normalizarQuantidade(valorBruto);
                    if (tamanhosAtuais[tamanhoAlvo] === quantidadeNormalizada) {
                        return variacao;
                    }
                    houveAlteracao = true;
                    return {
                        ...variacao,
                        tamanhos: {
                            ...tamanhosAtuais,
                            [tamanhoAlvo]: quantidadeNormalizada,
                        },
                    };
                }
                return variacao;
            }),
        );
        if (houveAlteracao) {
            clearManualPreview();
        }
    }, [clearManualPreview]);

    const handleAplicarValoresColados = useCallback(
        (index, tamanhoInicial, textoBruto) => {
            if (typeof textoBruto !== 'string' || !textoBruto.trim()) {
                return;
            }

            const indiceInicial = tamanhoInicial ? gradeListaAtual.indexOf(tamanhoInicial) : -1;
            const gradeSegmento = indiceInicial >= 0 ? gradeListaAtual.slice(indiceInicial) : gradeListaAtual;

            const construirMapaSequencial = () => {
                if (!gradeSegmento.length) {
                    return {};
                }
                const sanitized = textoBruto.replace(/\r/g, '').replace(/\n/g, '\t');
                const tokens = sanitized
                    .split('\t')
                    .flatMap((segmento) => segmento.split(/[,;]+/))
                    .flatMap((segmento) => segmento.split(/\s+/))
                    .map((token) => token.trim())
                    .filter(Boolean);
                const numeroRegex = /^-?\d+(?:[.,]\d+)?$/;
                const tokensNumericos = tokens.filter((token) => numeroRegex.test(token));
                if (!tokensNumericos.length) {
                    return {};
                }
                const mapaSequencial = {};
                gradeSegmento.forEach((tamanho, idx) => {
                    const token = tokensNumericos[idx];
                    if (token === undefined) {
                        return;
                    }
                    mapaSequencial[tamanho] = token;
                });
                return mapaSequencial;
            };

            const mapaDireto = parseTamanhosString(textoBruto, { grade: gradeSegmento });
            const mapaValores = Object.keys(mapaDireto).length ? mapaDireto : construirMapaSequencial();

            if (!Object.keys(mapaValores).length) {
                return;
            }

            let houveAlteracao = false;
            setNovoProdutoVariacoes((prev) =>
                prev.map((variacao, idx) => {
                    if (idx !== index) {
                        return variacao;
                    }
                    const tamanhosAtuais = preencherTamanhosComGrade(gradeListaAtual, variacao.tamanhos);
                    const tamanhosAtualizados = { ...tamanhosAtuais };

                    const aplicarValor = (tamanho, valor) => {
                        if (!tamanho) {
                            return;
                        }
                        tamanhosAtualizados[tamanho] = normalizarQuantidade(valor);
                    };

                    gradeSegmento.forEach((tamanho) => {
                        if (Object.prototype.hasOwnProperty.call(mapaValores, tamanho)) {
                            const valorAtual = tamanhosAtualizados[tamanho];
                            const valorNovo = normalizarQuantidade(mapaValores[tamanho]);
                            if (!Object.is(valorAtual, valorNovo)) {
                                houveAlteracao = true;
                            }
                            aplicarValor(tamanho, mapaValores[tamanho]);
                        }
                    });

                    Object.entries(mapaValores).forEach(([tamanho, valor]) => {
                        if (!Object.prototype.hasOwnProperty.call(tamanhosAtualizados, tamanho)) {
                            houveAlteracao = true;
                            aplicarValor(tamanho, valor);
                        }
                    });

                    if (saoMapasDeTamanhosIguais(tamanhosAtualizados, tamanhosAtuais)) {
                        return variacao;
                    }

                    houveAlteracao = true;
                    return {
                        ...variacao,
                        tamanhos: tamanhosAtualizados,
                    };
                }),
            );
            if (houveAlteracao) {
                clearManualPreview();
            }
        },
        [gradeListaAtual, clearManualPreview],
    );

    const handleColarNaVariacao = useCallback(
        (event, index, tamanhoAlvo) => {
            if (!event?.clipboardData) {
                return;
            }
            const texto =
                event.clipboardData.getData('text') || event.clipboardData.getData('text/plain');
            if (!texto) {
                return;
            }
            event.preventDefault();
            handleAplicarValoresColados(index, tamanhoAlvo, texto);
        },
        [handleAplicarValoresColados],
    );

    const handleRemoverVariacao = useCallback(
        (index) => {
            let houveAlteracao = false;
            setNovoProdutoVariacoes((prev) => {
                if (index < 0 || index >= prev.length) {
                    return prev;
                }
                houveAlteracao = true;
                const restante = prev.filter((_, idx) => idx !== index);
                if (!restante.length) {
                    return [criarVariacaoVazia(gradeListaAtual)];
                }
                return restante;
            });
            if (houveAlteracao) {
                clearManualPreview();
            }
        },
        [gradeListaAtual, clearManualPreview],
    );

    const resetFormularioNovoProduto = useCallback(() => {
        setNovoProdutoCodigo('');
        setNovoProdutoGrade('');
        setNovoProdutoVariacoes([criarVariacaoVazia()]);
        setNovoProdutoAgrupamento('juntas');
        clearManualPreview();
    }, [clearManualPreview]);

    const temRascunho = useMemo(() => {
        if (novoProdutoCodigo.trim() || novoProdutoGrade.trim()) {
            return true;
        }
        return novoProdutoVariacoes.some((variacao) => {
            const refPreenchido = typeof variacao?.ref === 'string' && variacao.ref.trim();
            return Boolean(refPreenchido || temQuantidadeInformada(variacao?.tamanhos));
        });
    }, [novoProdutoCodigo, novoProdutoGrade, novoProdutoVariacoes]);

    const manualFormularioNormalizado = useMemo(
        () =>
            tentarValidarFormularioManual({
                codigo: novoProdutoCodigo,
                gradeTexto: novoProdutoGrade,
                gradeLista: gradeListaAtual,
                variacoes: novoProdutoVariacoes,
                agrupamento: novoProdutoAgrupamento,
            }),
        [novoProdutoCodigo, novoProdutoGrade, gradeListaAtual, novoProdutoVariacoes, novoProdutoAgrupamento],
    );

    const manualFormularioValido = Boolean(manualFormularioNormalizado);

    const handleAdicionarProduto = useCallback(() => {
        try {
            const variacoesPreparadas = prepararVariacoesComGrade(novoProdutoVariacoes, gradeListaAtual);
            const { portfolioAtualizado, mensagemSucesso } = validarEAdicionarProdutoAoPortfolio({
                codigo: novoProdutoCodigo,
                grade: novoProdutoGrade,
                variacoes: variacoesPreparadas,
                agrupamento: novoProdutoAgrupamento,
                responsavel: responsavelAtual,
            });
            setPortfolio(portfolioAtualizado);
            resetFormularioNovoProduto();
            setStatus({
                type: 'success',
                message: `${mensagemSucesso} Alterações salvas automaticamente.`,
            });
        } catch (error) {
            setStatus({ type: 'error', message: error?.message || 'Não foi possível adicionar o produto.' });
        }
    }, [
        novoProdutoCodigo,
        novoProdutoGrade,
        novoProdutoVariacoes,
        novoProdutoAgrupamento,
        gradeListaAtual,
        resetFormularioNovoProduto,
        responsavelAtual,
    ]);

    const handleSalvarPortfolio = useCallback(() => {
        if (!temRascunho) {
            setStatus({ type: 'info', message: 'Preencha o formulário para salvar um novo produto.' });
            return;
        }
        try {
            const variacoesPreparadas = prepararVariacoesComGrade(novoProdutoVariacoes, gradeListaAtual);
            const { portfolioAtualizado, mensagemSucesso } = validarEAdicionarProdutoAoPortfolio({
                codigo: novoProdutoCodigo,
                grade: novoProdutoGrade,
                variacoes: variacoesPreparadas,
                agrupamento: novoProdutoAgrupamento,
                responsavel: responsavelAtual,
            });
            setPortfolio(portfolioAtualizado);
            resetFormularioNovoProduto();
            setStatus({
                type: 'success',
                message: `Rascunho salvo: ${mensagemSucesso}`,
            });
        } catch (error) {
            setStatus({ type: 'error', message: error?.message || 'Não foi possível salvar o rascunho.' });
        }
    }, [
        temRascunho,
        novoProdutoCodigo,
        novoProdutoGrade,
        novoProdutoVariacoes,
        novoProdutoAgrupamento,
        gradeListaAtual,
        resetFormularioNovoProduto,
        responsavelAtual,
    ]);

    const handleCarregarProduto = useCallback(
        (produto) => {
            if (!produto) {
                return;
            }
            const agrupamentoSalvo = produto.grouping || (produto.agruparVariacoes ? 'juntas' : 'separadas');
            setNovoProdutoCodigo(produto.codigo || '');
            setNovoProdutoGrade(Array.isArray(produto.grade) && produto.grade.length ? produto.grade.join(', ') : '');
            setNovoProdutoAgrupamento(agrupamentoSalvo === 'separadas' ? 'separadas' : 'juntas');
            setNovoProdutoVariacoes(() => {
                if (Array.isArray(produto.variations) && produto.variations.length) {
                    return produto.variations.map((variacao) => ({
                        ref: variacao?.ref || '',
                        tamanhos: preencherTamanhosComGrade(produto.grade || [], variacao?.tamanhos || {}),
                    }));
                }
                return [criarVariacaoVazia(produto.grade || [])];
            });
            clearManualPreview();
        },
        [clearManualPreview],
    );

    const handleNovoProdutoCodigoChange = useCallback(
        (event) => {
            setNovoProdutoCodigo(event.target.value.toUpperCase());
            clearManualPreview();
        },
        [clearManualPreview],
    );

    const handleNovoProdutoGradeChange = useCallback(
        (event) => {
            setNovoProdutoGrade(event.target.value);
            clearManualPreview();
        },
        [clearManualPreview],
    );

    const handleNovoProdutoAgrupamentoChange = useCallback(
        (event) => {
            setNovoProdutoAgrupamento(event.target.value);
            clearManualPreview();
        },
        [clearManualPreview],
    );

    const handleGerarPreviaManual = useCallback(() => {
        if (!manualFormularioNormalizado) {
            setStatus({
                type: 'error',
                message: 'Preencha o formulário manual corretamente antes de gerar a prévia.',
            });
            return;
        }

        const dadosConfirmacao = {
            codigo: manualFormularioNormalizado.codigo,
            grade: [...manualFormularioNormalizado.grade],
            agrupamento: manualFormularioNormalizado.agrupamento,
            variacoes: manualFormularioNormalizado.variacoes.map((variacao) => ({
                ref: variacao.ref,
                tamanhos: { ...variacao.tamanhos },
            })),
        };

        const snapshots = construirSnapshotsManuais({
            ...dadosConfirmacao,
            responsavel: responsavelAtual,
        });

        setManualPreviewData(dadosConfirmacao);
        setManualPreviewSnapshots(snapshots);
        setPreviewSnapshots(snapshots);
        setPreviewSource('manual');
        setStatus({
            type: 'success',
            message: `Prévia manual montada com ${snapshots.length} snapshot(s). Revise e confirme o lançamento.`,
        });
    }, [manualFormularioNormalizado, responsavelAtual]);

    const handleConfirmarLancamentoManual = useCallback(async () => {
        if (!manualPreviewData || !manualPreviewSnapshots.length) {
            setStatus({
                type: 'error',
                message: 'Gere uma prévia manual antes de confirmar o lançamento.',
            });
            return;
        }

        setProcessing(true);
        setStatus({
            type: 'info',
            message: 'Registrando lançamento manual e gerando relatório...',
        });

        try {
            const dataLancamentoISO = new Date().toISOString();
            const snapshotsConfirmados = construirSnapshotsManuais({
                ...manualPreviewData,
                responsavel: responsavelAtual,
                dataLancamentoISO,
            });

            let dailyRecord = null;
            try {
                const resultado = await importarArquivoDeProducao(snapshotsConfirmados, 'manual', responsavelAtual);
                if (resultado?.dailyRecord) {
                    dailyRecord = resultado.dailyRecord;
                }
            } catch (error) {
                console.warn('[GestaoProducaoEstoque] Falha ao importar manualmente, aplicando fallback local.', error);
            }

            if (!dailyRecord) {
                dailyRecord = montarDailyRecord({
                    dataLancamentoISO,
                    responsavel: responsavelAtual,
                    snapshotsProdutos: snapshotsConfirmados,
                });
                salvarNoHistorico(dailyRecord);
                const paginas = paginarRelatorioEmPaginasA4(dailyRecord);
                const html = gerarHTMLImpressaoPaginado(dailyRecord, paginas);
                if (typeof window !== 'undefined') {
                    const novaJanela = window.open('', '_blank');
                    if (novaJanela) {
                        novaJanela.document.write(html);
                        novaJanela.document.close();
                    }
                }
            }

            setHistorico(carregarHistorico());
            setStatus({
                type: 'success',
                message: 'Lançamento manual registrado com sucesso! O relatório foi aberto em uma nova aba.',
            });
            resetPreview();
        } catch (error) {
            setStatus({
                type: 'error',
                message: error?.message || 'Não foi possível concluir o lançamento manual.',
            });
        } finally {
            setProcessing(false);
        }
    }, [manualPreviewData, manualPreviewSnapshots, responsavelAtual, resetPreview]);

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
                                    Selecione o relatório recebido (XLSX ou PDF), gere uma prévia e confirme o lançamento para salvar o snapshot diário com histórico e relatório paginado.
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

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="flex flex-col gap-2">
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de arquivo</span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleTipoArquivo('xlsx')}
                                        className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border ${tipoArquivo === 'xlsx' ? 'border-green-500 bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-200' : 'border-gray-300 bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                                    >
                                        <FileSpreadsheet size={18} /> XLSX
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleTipoArquivo('pdf')}
                                        className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border ${tipoArquivo === 'pdf' ? 'border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200' : 'border-gray-300 bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'}`}
                                    >
                                        <FileText size={18} /> PDF
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
                                        accept={tipoArquivo === 'xlsx' ? '.xlsx,.xls' : '.pdf'}
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
                                disabled={processing || !arquivoSelecionado || !previewSnapshots.length}
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

                                <div className="space-y-6">
                                    {previewSnapshots.map((snapshot) => (
                                        <div key={snapshot.produtoBase} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                                            <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                                                <div>
                                                    <h4 className="text-lg font-semibold">Produto {snapshot.produtoBase}</h4>
                                                    <p className="text-sm text-gray-600 dark:text-gray-300">Grade: {snapshot.grade.join(' / ')}</p>
                                                </div>
                                                <div className="flex flex-wrap gap-4 text-sm">
                                                    <div>Necessário produzir: <span className="text-red-600 dark:text-red-400 font-semibold">{snapshot.resumoPositivoNegativo.positivoTotal}</span></div>
                                                    <div>Sobra consolidada: <span className="text-blue-600 dark:text-blue-400 font-semibold">{snapshot.resumoPositivoNegativo.negativoTotal}</span></div>
                                                    <div>Resumo rápido: <span className="font-semibold">{snapshot.resumoPositivoNegativo.formatoHumano}</span></div>
                                                </div>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full text-sm">
                                                    <thead className="bg-gray-100 dark:bg-gray-900/60">
                                                        <tr>
                                                            <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-200">Variação</th>
                                                            {snapshot.grade.map((tamanho) => (
                                                                <th key={tamanho} className="px-3 py-2 text-center font-semibold text-gray-700 dark:text-gray-200">{tamanho}</th>
                                                            ))}
                                                            <th className="px-3 py-2 text-center font-semibold text-gray-700 dark:text-gray-200">Total</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {snapshot.variations.map((variation) => {
                                                            const totalVar = snapshot.grade.reduce((acc, size) => acc + (variation.tamanhos?.[size] || 0), 0);
                                                            return (
                                                                <tr key={variation.ref} className="border-t border-gray-200 dark:border-gray-800">
                                                                    <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{variation.ref}</td>
                                                                    {snapshot.grade.map((tamanho) => (
                                                                        <td key={`${variation.ref}-${tamanho}`} className={`px-3 py-2 text-center ${getValueTone(variation.tamanhos?.[tamanho] || 0)}`}>
                                                                            {variation.tamanhos?.[tamanho] ?? 0}
                                                                        </td>
                                                                    ))}
                                                                    <td className={`px-3 py-2 text-center ${getValueTone(totalVar)}`}>{totalVar}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr className="border-t border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 font-semibold">
                                                            <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{snapshot.produtoBase}.</td>
                                                            {snapshot.grade.map((tamanho) => {
                                                                const liquido = snapshot.totalPorTamanho?.[tamanho] ?? 0;
                                                                const detalhe = snapshot.totalPorTamanhoDetalhado?.[tamanho];
                                                                const { texto, classe } = formatDetalheTotalPreview(detalhe, liquido);
                                                                return (
                                                                    <td key={`${snapshot.produtoBase}-total-${tamanho}`} className={`px-3 py-2 text-center ${classe}`}>
                                                                        {texto}
                                                                    </td>
                                                                );
                                                            })}
                                                            <td className={`px-3 py-2 text-center ${getValueTone(Object.values(snapshot.totalPorTamanho || {}).reduce((acc, value) => acc + value, 0))}`}>
                                                                {Object.values(snapshot.totalPorTamanho || {}).reduce((acc, value) => acc + value, 0)}
                                                            </td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        </div>
                                    ))}
                                </div>
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
                                    <p className="text-sm text-gray-600 dark:text-gray-300">Mantenha a lista ordenada de produtos e grades utilizadas na importação.</p>
                                </div>
                            </div>
                            <ArrowDown className={`transition-transform ${mostrarPortfolio ? 'rotate-180' : ''}`} size={20} />
                        </header>
                        {mostrarPortfolio && (
                            <div className="p-6 space-y-6">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Código do produto base</label>
                                        <input
                                            type="text"
                                            value={novoProdutoCodigo}
                                            onChange={handleNovoProdutoCodigoChange}
                                            className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                                            placeholder="Ex: 016"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grade (tamanhos separados por espaço, vírgula ou quebra de linha)</label>
                                        <textarea
                                            value={novoProdutoGrade}
                                            onChange={handleNovoProdutoGradeChange}
                                            className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                                            rows={2}
                                            placeholder="06 08 10 12 14 16 02 04"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Variações (referência e saldos por tamanho)</label>
                                            <button
                                                type="button"
                                                onClick={handleAdicionarLinhaVariacao}
                                                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                                            >
                                                <PlusCircle size={14} />
                                                Adicionar variação
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            As colunas são geradas automaticamente a partir da grade definida acima. Informe as
                                            quantidades em cada célula (valores negativos são permitidos) ou utilize o formato
                                            tradicional com tamanho e saldo ao importar dados existentes.
                                        </p>
                                        <div className="overflow-x-auto rounded-md border border-dashed border-gray-300 dark:border-gray-600">
                                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                                                <thead className="bg-gray-50 dark:bg-gray-900/60">
                                                    <tr>
                                                        <th
                                                            scope="col"
                                                            className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-200"
                                                        >
                                                            Referência
                                                        </th>
                                                        {gradeListaAtual.map((tamanho) => (
                                                            <th
                                                                key={`cabecalho-${tamanho}`}
                                                                scope="col"
                                                                className="px-3 py-2 text-center font-medium text-gray-700 dark:text-gray-200"
                                                            >
                                                                {tamanho}
                                                            </th>
                                                        ))}
                                                        <th
                                                            scope="col"
                                                            className="px-3 py-2 text-center font-medium text-gray-700 dark:text-gray-200"
                                                        >
                                                            Ações
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
                                                    {novoProdutoVariacoes.map((variacao, index) => (
                                                        <tr key={`variacao-${index}`}>
                                                            <td className="px-3 py-2 align-middle">
                                                                <input
                                                                    type="text"
                                                                    value={variacao.ref}
                                                                    onChange={(event) => handleAtualizarVariacao(index, 'ref', event.target.value)}
                                                                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2"
                                                                    placeholder="Ex: 016.AZ"
                                                                    aria-label={`Referência da variação ${index + 1}`}
                                                                />
                                                            </td>
                                                            {gradeListaAtual.map((tamanho) => (
                                                                <td key={`${tamanho}-${index}`} className="px-2 py-2 align-middle text-center">
                                                                <input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    pattern="-?\\d*(?:[\\.,]\\d*)?"
                                                                    value={obterValorParaCampoDeTamanho(variacao.tamanhos, tamanho)}
                                                                    onChange={(event) =>
                                                                        handleAtualizarVariacao(
                                                                            index,
                                                                            'tamanhos',
                                                                            event.target.value,
                                                                            tamanho,
                                                                        )
                                                                    }
                                                                    onPaste={(event) =>
                                                                        handleColarNaVariacao(event, index, tamanho)
                                                                    }
                                                                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-right"
                                                                    aria-label={`Quantidade para tamanho ${tamanho} da variação ${index + 1}`}
                                                                    placeholder="0"
                                                                    autoComplete="off"
                                                                />
                                                                </td>
                                                            ))}
                                                            <td className="px-3 py-2 text-center align-middle">
                                                                {novoProdutoVariacoes.length > 1 && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRemoverVariacao(index)}
                                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300"
                                                                        aria-label={`Remover variação ${index + 1}`}
                                                                    >
                                                                        <Trash2 size={14} />
                                                                        Remover
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {!gradeListaAtual.length && (
                                                        <tr>
                                                            <td
                                                                colSpan={Math.max(2, gradeListaAtual.length + 2)}
                                                                className="px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400"
                                                            >
                                                                Defina a grade para habilitar as colunas de tamanho e preencher os saldos por variação.
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    <div>
                                        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Agrupamento das variações</span>
                                        <div className="grid gap-2 md:grid-cols-2">
                                            <label className="flex items-start gap-2 rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 cursor-pointer bg-white dark:bg-gray-800">
                                                <input
                                                    type="radio"
                                                    name="agrupamentoVariacoes"
                                                    value="juntas"
                                                    checked={novoProdutoAgrupamento === 'juntas'}
                                                    onChange={handleNovoProdutoAgrupamentoChange}
                                                    className="mt-1"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Juntas</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Consolida todas as variações do código em um único snapshot.</p>
                                                </div>
                                            </label>
                                            <label className="flex items-start gap-2 rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 cursor-pointer bg-white dark:bg-gray-800">
                                                <input
                                                    type="radio"
                                                    name="agrupamentoVariacoes"
                                                    value="separadas"
                                                    checked={novoProdutoAgrupamento === 'separadas'}
                                                    onChange={handleNovoProdutoAgrupamentoChange}
                                                    className="mt-1"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Separadas</p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">Gera snapshots individuais por referência, ideal para monitorar cores ou lavagens separadamente.</p>
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    <button
                                        type="button"
                                        onClick={handleGerarPreviaManual}
                                        disabled={processing || !manualFormularioValido}
                                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                                            processing || !manualFormularioValido
                                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'
                                                : 'bg-blue-600 text-white hover:bg-blue-700'
                                        }`}
                                    >
                                        <Eye size={16} />
                                        Gerar prévia
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleConfirmarLancamentoManual}
                                        disabled={processing || !manualPreviewSnapshots.length}
                                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                                            processing || !manualPreviewSnapshots.length
                                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'
                                                : 'bg-green-600 text-white hover:bg-green-700'
                                        }`}
                                    >
                                        <CheckCircle2 size={16} />
                                        Confirmar lançamento
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAdicionarProduto}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700"
                                    >
                                        <PlusCircle size={16} />
                                        Adicionar ao portfólio
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSalvarPortfolio}
                                        disabled={!temRascunho}
                                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
                                            temRascunho
                                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                                : 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'
                                        }`}
                                    >
                                        <CheckCircle2 size={16} />
                                        Salvar alterações
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {portfolio.length === 0 && (
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum produto cadastrado. Utilize o formulário acima para adicionar os códigos principais.</p>
                                    )}
                                    {portfolio.map((item, index) => (
                                        <div key={item.codigo} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border border-gray-200 dark:border-gray-700 rounded-md px-4 py-3">
                                            <div className="space-y-2">
                                                <div>
                                                    <h4 className="font-semibold">Produto {item.codigo}</h4>
                                                    <p className="text-sm text-gray-600 dark:text-gray-300">
                                                        Grade: {item.grade && item.grade.length ? item.grade.join(' / ') : 'Sem grade definida'}
                                                    </p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                                        {(() => {
                                                            const grouping = item.grouping || (item.agruparVariacoes ? 'juntas' : 'separadas');
                                                            return grouping === 'juntas'
                                                                ? 'Agrupamento: variações juntas (snapshot único)'
                                                                : 'Agrupamento: variações separadas (snapshots individuais)';
                                                        })()}
                                                    </p>
                                                </div>
                                                <div className="space-y-1">
                                                    {item.variations && item.variations.length > 0 ? (
                                                        item.variations.map((variacao) => (
                                                            <p key={variacao.ref} className="text-sm text-gray-700 dark:text-gray-200">
                                                                <span className="font-semibold">{variacao.ref}</span> · {formatarTamanhos(variacao.tamanhos)}
                                                            </p>
                                                        ))
                                                    ) : (
                                                        <p className="text-sm text-gray-500 dark:text-gray-400 italic">Sem variações cadastradas manualmente.</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleCarregarProduto(item)}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600"
                                                >
                                                    <RefreshCcw size={16} />
                                                    Carregar
                                                </button>
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
