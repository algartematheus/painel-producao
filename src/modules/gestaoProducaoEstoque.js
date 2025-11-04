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
    carregarPortfolio,
    salvarPortfolio,
    adicionarProdutoAoPortfolio,
    removerProdutoDoPortfolio,
    reordenarPortfolio,
    criarSnapshotProduto,
    carregarHistorico,
    paginarRelatorioEmPaginasA4,
    gerarHTMLImpressaoPaginado,
    importarArquivoDeProducao,
    exemploFluxoCompleto,
} from './relatorioEstoque';
import importStockFile, { PDF_LIBRARY_UNAVAILABLE_ERROR } from './stockImporter';

const MODULE_TITLE = 'Gestão de Produção x Estoque';
const MODULE_SUBTITLE = 'Integre produção e estoque em um relatório consolidado pronto para impressão.';

const parseGradeString = (value = '') => value
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const parseTamanhosString = (value = '') => {
    const resultados = {};
    if (typeof value !== 'string' || !value.trim()) {
        return resultados;
    }

    const regex = /([^\s=:,;]+)\s*(?:[:=]\s*|\s+)(-?\d+(?:[.,]\d+)?)/g;
    let match;
    while ((match = regex.exec(value)) !== null) {
        const tamanho = String(match[1]).trim();
        const quantidadeBruta = String(match[2]).replace(',', '.');
        const quantidade = Number(quantidadeBruta);
        if (!tamanho) {
            continue;
        }
        resultados[tamanho] = Number.isFinite(quantidade) ? quantidade : 0;
    }
    return resultados;
};

const criarVariacaoVazia = () => ({ ref: '', tamanhos: '' });

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
    const [processing, setProcessing] = useState(false);
    const [status, setStatus] = useState({ type: 'idle', message: '' });

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
        setPortfolio(carregarPortfolio());
        setHistorico(carregarHistorico());
    }, []);

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
        setNovoProdutoVariacoes((prev) => [...prev, criarVariacaoVazia()]);
    }, []);

    const handleAtualizarVariacao = useCallback((index, campo, valor) => {
        setNovoProdutoVariacoes((prev) => {
            return prev.map((variacao, idx) => {
                if (idx !== index) {
                    return variacao;
                }
                if (campo === 'ref') {
                    return { ...variacao, ref: valor.toUpperCase() };
                }
                if (campo === 'tamanhos') {
                    return { ...variacao, tamanhos: valor };
                }
                return variacao;
            });
        });
    }, []);

    const handleRemoverVariacao = useCallback((index) => {
        setNovoProdutoVariacoes((prev) => {
            if (prev.length <= 1) {
                return [criarVariacaoVazia()];
            }
            return prev.filter((_, idx) => idx !== index);
        });
    }, []);

    const handleAdicionarProduto = useCallback(() => {
        try {
            const gradeLista = parseGradeString(novoProdutoGrade);
            if (!novoProdutoCodigo.trim()) {
                setStatus({ type: 'error', message: 'Informe o código do produto base.' });
                return;
            }
            const variacoesProcessadas = novoProdutoVariacoes
                .map((variacao) => {
                    const ref = (variacao.ref || '').trim();
                    const tamanhos = parseTamanhosString(variacao.tamanhos);
                    if (!ref || !Object.keys(tamanhos).length) {
                        return null;
                    }
                    return {
                        ref,
                        tamanhos,
                    };
                })
                .filter(Boolean);

            if (!gradeLista.length) {
                const tamanhosEncontrados = Array.from(new Set(variacoesProcessadas.flatMap((variacao) => Object.keys(variacao.tamanhos))));
                if (tamanhosEncontrados.length) {
                    gradeLista.push(...tamanhosEncontrados);
                }
            }

            if (!gradeLista.length) {
                setStatus({ type: 'error', message: 'Informe ao menos um tamanho na grade.' });
                return;
            }

            if (!variacoesProcessadas.length) {
                setStatus({ type: 'error', message: 'Cadastre pelo menos uma variação com tamanhos válidos.' });
                return;
            }

            const todosOsTamanhosDasVariacoes = variacoesProcessadas.flatMap((variacao) => Object.keys(variacao.tamanhos));
            const gradeFinal = Array.from(new Set([...gradeLista, ...todosOsTamanhosDasVariacoes]));

            const atualizado = adicionarProdutoAoPortfolio({
                codigo: novoProdutoCodigo.trim(),
                grade: gradeFinal,
                variations: variacoesProcessadas,
                agruparVariacoes: novoProdutoAgrupamento === 'juntas',
            });
            setPortfolio(atualizado);
            setNovoProdutoCodigo('');
            setNovoProdutoGrade('');
            setNovoProdutoVariacoes([criarVariacaoVazia()]);
            setNovoProdutoAgrupamento('juntas');
            setStatus({
                type: 'success',
                message: `Produto ${novoProdutoCodigo.trim()} adicionado ao portfólio (${novoProdutoAgrupamento === 'juntas' ? 'variações juntas' : 'variações separadas'}).`,
            });
        } catch (error) {
            setStatus({ type: 'error', message: error?.message || 'Não foi possível adicionar o produto.' });
        }
    }, [novoProdutoCodigo, novoProdutoGrade, novoProdutoVariacoes, novoProdutoAgrupamento]);

    const handleSalvarPortfolio = useCallback(() => {
        const atualizado = salvarPortfolio(portfolio);
        setPortfolio(atualizado);
        setStatus({ type: 'success', message: 'Portfólio salvo com sucesso.' });
    }, [portfolio]);

    const handleRemoverProduto = useCallback((codigo) => {
        const atualizado = removerProdutoDoPortfolio(codigo);
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
        const atualizado = reordenarPortfolio(novaOrdem.map((produto) => produto.codigo));
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
                                            onChange={(event) => setNovoProdutoCodigo(event.target.value.toUpperCase())}
                                            className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                                            placeholder="Ex: 016"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grade (tamanhos separados por espaço, vírgula ou quebra de linha)</label>
                                        <textarea
                                            value={novoProdutoGrade}
                                            onChange={(event) => setNovoProdutoGrade(event.target.value)}
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
                                            Utilize formatos como <span className="font-medium">06=10</span> ou <span className="font-medium">06 10</span>. Separe múltiplos tamanhos por espaço, vírgula ou quebra de linha.
                                        </p>
                                        <div className="space-y-3">
                                            {novoProdutoVariacoes.map((variacao, index) => (
                                                <div key={`variacao-${index}`} className="rounded-md border border-dashed border-gray-300 dark:border-gray-600 p-3 space-y-3">
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        <div>
                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Referência da variação</label>
                                                            <input
                                                                type="text"
                                                                value={variacao.ref}
                                                                onChange={(event) => handleAtualizarVariacao(index, 'ref', event.target.value)}
                                                                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                                                                placeholder="Ex: 016.AZ"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tamanhos e saldos</label>
                                                            <textarea
                                                                value={variacao.tamanhos}
                                                                onChange={(event) => handleAtualizarVariacao(index, 'tamanhos', event.target.value)}
                                                                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
                                                                rows={2}
                                                                placeholder="06=10, 08=-5, 10 3"
                                                            />
                                                        </div>
                                                    </div>
                                                    {novoProdutoVariacoes.length > 1 && (
                                                        <div className="flex justify-end">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoverVariacao(index)}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300"
                                                            >
                                                                <Trash2 size={14} />
                                                                Remover variação
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
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
                                                    onChange={(event) => setNovoProdutoAgrupamento(event.target.value)}
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
                                                    onChange={(event) => setNovoProdutoAgrupamento(event.target.value)}
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
                                        onClick={handleAdicionarProduto}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700"
                                    >
                                        <PlusCircle size={16} />
                                        Adicionar ao portfólio
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSalvarPortfolio}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
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
                                                        Agrupamento: {item.agruparVariacoes ? 'variações juntas (snapshot único)' : 'variações separadas (snapshots individuais)'}
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
