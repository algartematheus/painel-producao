import importStockFile from './stockImporter';

const STORAGE_KEYS = {
    portfolio: 'relatorioEstoquePortfolio',
    historico: 'relatorioEstoqueHistorico',
};

const memoryStorage = (() => {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => {
            store.set(key, value);
        },
        removeItem: (key) => {
            store.delete(key);
        },
    };
})();

const getStorage = () => {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
    } catch (error) {
        // Ignorado: fallback para memória
    }
    return memoryStorage;
};

const cloneGrade = (grade) => (Array.isArray(grade) ? grade.map((item) => String(item)) : []);

const normalizeNumber = (value) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) {
        return parsed;
    }
    return 0;
};

const sanitizeVariations = (variations = []) => {
    if (!Array.isArray(variations)) {
        return [];
    }
    return variations
        .map((variation) => {
            if (!variation || typeof variation !== 'object') {
                return null;
            }
            const ref = typeof variation.ref === 'string' ? variation.ref.trim() : '';
            if (!ref) {
                return null;
            }
            const tamanhos = variation.tamanhos && typeof variation.tamanhos === 'object'
                ? Object.entries(variation.tamanhos).reduce((acc, [size, numberValue]) => {
                    acc[String(size)] = normalizeNumber(numberValue);
                    return acc;
                }, {})
                : {};
            return {
                ref,
                tamanhos,
            };
        })
        .filter(Boolean);
};

const sanitizePortfolioItem = (item) => {
    if (!item || typeof item !== 'object') {
        return null;
    }
    const codigo = typeof item.codigo === 'string' ? item.codigo.trim() : '';
    if (!codigo) {
        return null;
    }
    return {
        codigo,
        grade: cloneGrade(item.grade),
        variations: sanitizeVariations(item.variations),
        agruparVariacoes: item.agruparVariacoes !== false,
    };
};

export const carregarPortfolio = () => {
    const storage = getStorage();
    try {
        const raw = storage.getItem(STORAGE_KEYS.portfolio);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.map(sanitizePortfolioItem).filter(Boolean);
    } catch (error) {
        return [];
    }
};

export const salvarPortfolio = (portfolioArray = []) => {
    const storage = getStorage();
    const sanitized = Array.isArray(portfolioArray)
        ? portfolioArray.map(sanitizePortfolioItem).filter(Boolean)
        : [];
    storage.setItem(STORAGE_KEYS.portfolio, JSON.stringify(sanitized));
    return sanitized;
};

export const adicionarProdutoAoPortfolio = ({ codigo, grade, variations, agruparVariacoes }) => {
    const portfolio = carregarPortfolio();
    const sanitized = sanitizePortfolioItem({ codigo, grade, variations, agruparVariacoes });
    if (!sanitized) {
        throw new Error('Dados inválidos ao adicionar produto ao portfólio.');
    }
    const existingIndex = portfolio.findIndex((item) => item.codigo === sanitized.codigo);
    const updated = [...portfolio];
    if (existingIndex >= 0) {
        updated[existingIndex] = sanitized;
    } else {
        updated.push(sanitized);
    }
    salvarPortfolio(updated);
    return updated;
};

export const removerProdutoDoPortfolio = (codigo) => {
    const portfolio = carregarPortfolio();
    const updated = portfolio.filter((item) => item.codigo !== codigo);
    salvarPortfolio(updated);
    return updated;
};

export const reordenarPortfolio = (novaOrdemArray = []) => {
    const portfolio = carregarPortfolio();
    if (!Array.isArray(novaOrdemArray) || novaOrdemArray.length === 0) {
        return portfolio;
    }
    const orderCodes = novaOrdemArray.map((item) => (typeof item === 'string' ? item : item?.codigo)).filter(Boolean);
    if (!orderCodes.length) {
        return portfolio;
    }
    const orderMap = new Map(orderCodes.map((code, index) => [code, index]));
    const sorted = [...portfolio].sort((a, b) => {
        const indexA = orderMap.has(a.codigo) ? orderMap.get(a.codigo) : Number.MAX_SAFE_INTEGER;
        const indexB = orderMap.has(b.codigo) ? orderMap.get(b.codigo) : Number.MAX_SAFE_INTEGER;
        return indexA - indexB;
    });
    salvarPortfolio(sorted);
    return sorted;
};

const inferGradeFromVariations = (variations = [], fallbackGrade = []) => {
    if (Array.isArray(fallbackGrade) && fallbackGrade.length) {
        return cloneGrade(fallbackGrade);
    }
    for (const variation of variations) {
        const keys = Object.keys(variation.tamanhos || {});
        if (keys.length) {
            return keys;
        }
    }
    return [];
};

const calcularTotaisPorTamanhoComDetalhes = (variations = [], grade = []) => {
    const sanitizedVariations = sanitizeVariations(variations);
    const gradeBase = cloneGrade(grade);
    const gradeToUse = gradeBase.length ? gradeBase : inferGradeFromVariations(sanitizedVariations);
    const totals = {};
    const detalhes = {};
    gradeToUse.forEach((size) => {
        totals[size] = 0;
        detalhes[size] = { positivo: 0, negativo: 0, liquido: 0 };
    });

    sanitizedVariations.forEach((variation) => {
        gradeToUse.forEach((size) => {
            const value = normalizeNumber(variation.tamanhos[size]);
            totals[size] = (totals[size] || 0) + value;
            const detalhe = detalhes[size];
            detalhe.liquido += value;
            if (value > 0) {
                detalhe.positivo += value;
            } else if (value < 0) {
                detalhe.negativo += value;
            }
        });
    });

    return { grade: gradeToUse, totalPorTamanho: totals, detalhesPorTamanho: detalhes };
};

export const calcularTotalPorTamanho = (variations = [], grade = []) => {
    const sanitizedVariations = sanitizeVariations(variations);
    const sanitizedGrade = cloneGrade(grade);
    const { grade: gradeUtilizada, totalPorTamanho } = calcularTotaisPorTamanhoComDetalhes(
        sanitizedVariations,
        sanitizedGrade,
    );
    const gradeFinal = sanitizedGrade.length ? sanitizedGrade : gradeUtilizada;

    return gradeFinal.reduce((acc, size) => {
        acc[size] = normalizeNumber(totalPorTamanho[size]);
        return acc;
    }, {});
};

export const calcularTotalDetalhadoPorTamanho = (variations = [], grade = []) => {
    const sanitizedVariations = sanitizeVariations(variations);
    const gradeBase = cloneGrade(grade);
    const gradeToUse = gradeBase.length ? gradeBase : inferGradeFromVariations(sanitizedVariations);
    const totals = {};

    gradeToUse.forEach((size) => {
        totals[size] = { positivo: 0, negativo: 0, liquido: 0 };
    });

    sanitizedVariations.forEach((variation) => {
        gradeToUse.forEach((size) => {
            const value = normalizeNumber(variation.tamanhos[size]);
            if (value > 0) {
                totals[size].positivo += value;
            } else if (value < 0) {
                totals[size].negativo += value;
            }
            totals[size].liquido += value;
        });
    });

    return totals;
};

export const resumoPositivoNegativo = (totalPorTamanho = {}) => {
    const entries = Object.entries(totalPorTamanho || {});
    let positivoTotal = 0;
    let negativoTotal = 0;
    entries.forEach(([, value]) => {
        const numero = normalizeNumber(value);
        if (numero > 0) {
            positivoTotal += numero;
        } else if (numero < 0) {
            negativoTotal += numero;
        }
    });
    return {
        positivoTotal,
        negativoTotal,
        formatoHumano: `${positivoTotal} ${negativoTotal}`,
    };
};

export const criarSnapshotProduto = ({
    produtoBase,
    grade = [],
    variations = [],
    dataLancamentoISO,
    responsavel,
}) => {
    if (!produtoBase) {
        throw new Error('produtoBase é obrigatório para criar snapshot.');
    }
    const sanitizedGrade = cloneGrade(grade);
    const sanitizedVariations = sanitizeVariations(variations);
    const { grade: gradeCalculada, totalPorTamanho, detalhesPorTamanho } = calcularTotaisPorTamanhoComDetalhes(
        sanitizedVariations,
        sanitizedGrade,
    );
    const resumo = resumoPositivoNegativo(totalPorTamanho);
    const gradeFinal = sanitizedGrade.length ? sanitizedGrade : gradeCalculada;
    return {
        produtoBase,
        grade: gradeFinal,
        variations: sanitizedVariations,
        totalPorTamanho,
        totalPorTamanhoDetalhado: detalhesPorTamanho,
        resumoPositivoNegativo: resumo,
        metadata: {
            dataLancamentoISO: dataLancamentoISO || null,
            responsavel: responsavel || null,
        },
    };
};

export const montarDailyRecord = ({ dataLancamentoISO, responsavel, snapshotsProdutos = [] }) => ({
    dataLancamentoISO: dataLancamentoISO || null,
    responsavel: responsavel || null,
    produtos: Array.isArray(snapshotsProdutos) ? snapshotsProdutos : [],
});

export const carregarHistorico = () => {
    const storage = getStorage();
    try {
        const raw = storage.getItem(STORAGE_KEYS.historico);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
};

export const salvarNoHistorico = (dailyRecord) => {
    const storage = getStorage();
    const historicoAtual = carregarHistorico();
    const updated = [...historicoAtual, dailyRecord];
    storage.setItem(STORAGE_KEYS.historico, JSON.stringify(updated));
    return updated;
};

const getValueClass = (value) => {
    if (value > 0) {
        return 'falta';
    }
    if (value < 0) {
        return 'sobra';
    }
    return '';
};

const formatNumber = (value) => {
    const numero = normalizeNumber(value);
    if (!Number.isFinite(numero)) {
        return '0';
    }
    return numero.toString();
};

export const renderizarBlocoProdutoHTML = (produtoSnapshot) => {
    if (!produtoSnapshot) {
        return '';
    }
    const grade = cloneGrade(produtoSnapshot.grade);
    const variations = Array.isArray(produtoSnapshot.variations) ? produtoSnapshot.variations : [];
    const totalDetalhado = calcularTotalDetalhadoPorTamanho(variations, grade);
    const resumo = produtoSnapshot.resumoPositivoNegativo || { positivoTotal: 0, negativoTotal: 0, formatoHumano: '0 0' };

    const headerCells = grade.map((size) => `<th>${size}</th>`).join('');

    const bodyRows = variations
        .map((variation) => {
            const totalVariation = grade.reduce((acc, size) => acc + normalizeNumber(variation.tamanhos?.[size]), 0);
            const cells = grade
                .map((size) => {
                    const value = normalizeNumber(variation.tamanhos?.[size]);
                    const className = getValueClass(value);
                    return `<td class="${className}">${formatNumber(value)}</td>`;
                })
                .join('');
            return `
                <tr>
                    <td class="ref">${variation.ref}</td>
                    ${cells}
                    <td class="${getValueClass(totalVariation)}">${formatNumber(totalVariation)}</td>
                </tr>
            `;
        })
        .join('');

    const totalCells = grade
        .map((size) => {
            const detalhe = totalDetalhado[size] || { positivo: 0, negativo: 0, liquido: 0 };
            const { positivo, negativo, liquido } = detalhe;
            let textoCelula;
            let className = '';

            if (positivo > 0 && negativo < 0) {
                textoCelula = `${positivo}-${Math.abs(negativo)}`;
            } else {
                textoCelula = formatNumber(liquido);
                className = getValueClass(liquido);
            }
            return `<td class="${className}">${textoCelula}</td>`;
        })
        .join('');

    const totalGeral = Object.values(totalDetalhado).reduce((acc, detalhe) => acc + (detalhe?.liquido || 0), 0);

    return `
        <section class="produto-bloco">
            <h2>Produto ${produtoSnapshot.produtoBase}</h2>
            <table class="tabela-produto">
                <thead>
                    <tr>
                        <th>Variação</th>
                        ${headerCells}
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
                <tfoot>
                    <tr class="total-geral">
                        <td>${produtoSnapshot.produtoBase}.</td>
                        ${totalCells}
                        <td class="${getValueClass(totalGeral)}">${formatNumber(totalGeral)}</td>
                    </tr>
                </tfoot>
            </table>
            <div class="resumo-produto">
                <p><strong>Necessário produzir:</strong> <span class="falta">${formatNumber(resumo.positivoTotal)}</span></p>
                <p><strong>Sobra consolidada:</strong> <span class="sobra">${formatNumber(resumo.negativoTotal)}</span></p>
                <p><strong>Resumo rápido:</strong> ${resumo.formatoHumano}</p>
            </div>
        </section>
    `;
};

const createMeasurementContainer = () => {
    if (typeof document === 'undefined') {
        return null;
    }
    const container = document.createElement('div');
    container.style.visibility = 'hidden';
    container.style.position = 'absolute';
    container.style.top = '-9999px';
    container.style.left = '-9999px';
    container.style.width = '210mm';
    document.body.appendChild(container);
    return container;
};

const estimateBlockHeight = (produtoSnapshot) => {
    const base = 140;
    const variationsCount = Array.isArray(produtoSnapshot?.variations) ? produtoSnapshot.variations.length : 0;
    const rowsHeight = variationsCount * 28;
    const summaryHeight = 72;
    return base + rowsHeight + summaryHeight;
};

export const paginarRelatorioEmPaginasA4 = (dailyRecord, pageHeightPx = 1122) => {
    const produtos = Array.isArray(dailyRecord?.produtos) ? dailyRecord.produtos : [];
    if (!produtos.length) {
        return [];
    }

    const container = createMeasurementContainer();
    const pages = [];
    let currentPage = [];
    let currentHeight = 0;

    const appendBlock = (block) => {
        if (currentHeight + block.altura > pageHeightPx && currentPage.length) {
            pages.push(currentPage);
            currentPage = [];
            currentHeight = 0;
        }
        currentPage.push(block);
        currentHeight += block.altura;
    };

    produtos.forEach((produtoSnapshot) => {
        const html = renderizarBlocoProdutoHTML(produtoSnapshot);
        let altura = estimateBlockHeight(produtoSnapshot);
        if (container) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            const element = wrapper.firstElementChild;
            if (element) {
                container.appendChild(element);
                altura = element.offsetHeight || element.getBoundingClientRect().height || altura;
                container.removeChild(element);
            }
        }
        appendBlock({ html, altura, produtoBase: produtoSnapshot.produtoBase });
    });

    if (currentPage.length) {
        pages.push(currentPage);
    }

    if (container && container.parentNode) {
        container.parentNode.removeChild(container);
    }

    return pages;
};

const formatDateTime = (isoString) => {
    if (!isoString) {
        return '';
    }
    try {
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) {
            return isoString;
        }
        return date.toLocaleString('pt-BR', {
            hour12: false,
        });
    } catch (error) {
        return isoString;
    }
};

export const gerarHTMLImpressaoPaginado = (dailyRecord, paginas) => {
    const totalPages = Math.max(1, Array.isArray(paginas) ? paginas.length : 0);
    const dataLancamento = formatDateTime(dailyRecord?.dataLancamentoISO);
    const responsavel = dailyRecord?.responsavel || '';

    const pagesHtml = (Array.isArray(paginas) ? paginas : [])
        .map((pageBlocks, pageIndex) => `
            <div class="page">
                <div class="page-header">
                    <div><strong>Relatório de Estoque / Produção</strong></div>
                    <div>Data/Hora: ${dataLancamento || '-'}</div>
                    <div>Responsável: ${responsavel || '-'}</div>
                    <div>Página ${pageIndex + 1} / ${totalPages}</div>
                </div>
                ${pageBlocks.map((block) => block.html).join('')}
            </div>
        `)
        .join('');

    const styles = `
        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            background: #f0f0f0;
            margin: 0;
            padding: 16px;
        }
        .page {
            width: 210mm;
            min-height: 297mm;
            padding: 16mm;
            margin: 10px auto;
            background: white;
            position: relative;
            display: flex;
            flex-direction: column;
            page-break-after: always;
            border: 1px solid #000;
            box-sizing: border-box;
        }
        .page:last-child {
            page-break-after: auto;
        }
        .page-header {
            font-size: 11px;
            border-bottom: 1px solid #000;
            margin-bottom: 8px;
            padding-bottom: 4px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 4px;
        }
        h2 {
            font-size: 14px;
            margin: 8px 0;
            font-weight: bold;
        }
        table.tabela-produto {
            border-collapse: collapse;
            width: 100%;
            font-size: 11px;
            margin-bottom: 8px;
        }
        table.tabela-produto th,
        table.tabela-produto td {
            border: 1px solid #000;
            padding: 3px 4px;
            text-align: center;
        }
        table.tabela-produto td.ref {
            text-align: left;
            font-weight: bold;
        }
        .falta {
            color: red;
            font-weight: bold;
        }
        .sobra {
            color: blue;
            font-weight: bold;
        }
        tr.total-geral {
            background: #eee;
            font-weight: bold;
        }
        .resumo-produto {
            font-size: 11px;
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }
        @media print {
            body {
                background: white;
            }
            .page {
                margin: 0;
                border: none;
                page-break-after: always;
            }
            .page:last-child {
                page-break-after: auto;
            }
        }
    `;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8" />
    <title>Relatório de Estoque / Produção</title>
    <style>${styles}</style>
</head>
<body>
    ${pagesHtml}
</body>
</html>`;
};

const abrirJanelaRelatorio = (html) => {
    if (typeof window === 'undefined') {
        return null;
    }
    const novaJanela = window.open('', '_blank');
    if (novaJanela) {
        novaJanela.document.write(html);
        novaJanela.document.close();
    }
    return novaJanela;
};

export const normalizarProdutosImportados = (produtos = []) => {
    const configuracoesPortfolio = new Map(carregarPortfolio().map((item) => [item.codigo, item]));
    const agrupado = {};
    produtos.forEach((produto) => {
        if (!produto || typeof produto !== 'object') {
            return;
        }
        const base = produto.productCode || produto.produtoBase;
        if (!base) {
            return;
        }
        const configItem = configuracoesPortfolio.get(base);
        const gradePrincipal = cloneGrade(produto.grade);
        const gradeFallback = gradePrincipal.length ? gradePrincipal : cloneGrade(configItem?.grade);
        const variationsImportadas = Array.isArray(produto.variations) ? produto.variations : [];
        const variationsConfiguradas = Array.isArray(configItem?.variations) ? configItem.variations : [];
        const variationsMap = new Map();

        variationsImportadas.forEach((variation) => {
            if (!variation || typeof variation !== 'object') {
                return;
            }
            const ref = typeof variation.ref === 'string' ? variation.ref.trim() : '';
            if (!ref) {
                return;
            }
            variationsMap.set(ref, variation);
        });

        variationsConfiguradas.forEach((variation) => {
            if (!variation || typeof variation !== 'object') {
                return;
            }
            const ref = typeof variation.ref === 'string' ? variation.ref.trim() : '';
            if (!ref || variationsMap.has(ref)) {
                return;
            }
            variationsMap.set(ref, variation);
        });

        const variationsParaProcessar = Array.from(variationsMap.values());
        const deveAgrupar = configItem ? configItem.agruparVariacoes !== false : true;

        if (!deveAgrupar && variationsParaProcessar.length) {
            variationsParaProcessar.forEach((variation) => {
                if (!variation || typeof variation !== 'object') {
                    return;
                }
                const ref = typeof variation.ref === 'string' ? variation.ref.trim() : '';
                if (!ref) {
                    return;
                }
                const chave = `${base}:${ref}`;
                if (!agrupado[chave]) {
                    const gradeVar = cloneGrade(variation.grade);
                    agrupado[chave] = {
                        produtoBase: ref,
                        grade: gradeVar.length ? gradeVar : gradeFallback,
                        variations: [],
                    };
                }
                agrupado[chave].variations.push({
                    ref,
                    tamanhos: variation.tamanhos || {},
                });
            });
            return;
        }

        const chaveBase = base;
        if (!agrupado[chaveBase]) {
            agrupado[chaveBase] = {
                produtoBase: base,
                grade: gradeFallback,
                variations: [],
            };
        }
        const destino = agrupado[chaveBase];
        if (!destino.grade.length) {
            destino.grade = gradeFallback;
        }

        variationsParaProcessar.forEach((variation) => {
            if (!variation || typeof variation !== 'object') {
                return;
            }
            const ref = typeof variation.ref === 'string' ? variation.ref.trim() : '';
            if (!ref) {
                return;
            }
            const gradeVar = cloneGrade(variation.grade);
            if (!destino.grade.length && gradeVar.length) {
                destino.grade = gradeVar;
            }
            if (destino.grade.length && gradeVar.length) {
                const mismatch = destino.grade.length !== gradeVar.length
                    || destino.grade.some((value, index) => value !== gradeVar[index]);
                if (mismatch && typeof console !== 'undefined') {
                    console.warn(`Grade divergente detectada para ${ref}.`, {
                        esperado: destino.grade,
                        encontrado: gradeVar,
                    });
                }
            }
            destino.variations.push({
                ref,
                tamanhos: variation.tamanhos || {},
            });
        });
    });
    return agrupado;
};

export const importarArquivoDeProducao = async (file, tipoArquivo, responsavelLogado) => {
    const parsed = await importStockFile({ file, type: tipoArquivo });
    const produtosNormalizados = normalizarProdutosImportados(parsed);
    const dataLancamentoISO = new Date().toISOString();
    const snapshotsProdutos = Object.entries(produtosNormalizados).map(([chave, info]) => criarSnapshotProduto({
        produtoBase: info?.produtoBase || chave,
        grade: info.grade,
        variations: info.variations,
        dataLancamentoISO,
        responsavel: responsavelLogado,
    }));

    const dailyRecord = montarDailyRecord({
        dataLancamentoISO,
        responsavel: responsavelLogado,
        snapshotsProdutos,
    });

    salvarNoHistorico(dailyRecord);
    const paginas = paginarRelatorioEmPaginasA4(dailyRecord);
    const html = gerarHTMLImpressaoPaginado(dailyRecord, paginas);
    abrirJanelaRelatorio(html);

    return {
        dailyRecord,
        paginas,
        html,
    };
};

export const exemploFluxoCompleto = () => {
    const dataLancamentoISO = new Date().toISOString();
    const responsavel = 'Usuário Demo';
    const grade016 = ['06', '08', '10', '12', '14', '16', '02', '04'];
    const snapshot016 = criarSnapshotProduto({
        produtoBase: '016',
        grade: grade016,
        variations: [
            {
                ref: '016.AZ',
                tamanhos: {
                    '06': -57,
                    '08': -5,
                    '10': -2,
                    '12': -14,
                    '14': -4,
                    '16': 13,
                    '02': 6,
                    '04': -5,
                },
            },
            {
                ref: '016.DV',
                tamanhos: {
                    '06': 10,
                    '08': 12,
                    '10': 5,
                    '12': 0,
                    '14': -2,
                    '16': -4,
                    '02': 3,
                    '04': -1,
                },
            },
        ],
        dataLancamentoISO,
        responsavel,
    });

    const dailyRecord = montarDailyRecord({
        dataLancamentoISO,
        responsavel,
        snapshotsProdutos: [snapshot016],
    });

    salvarNoHistorico(dailyRecord);
    const paginas = paginarRelatorioEmPaginasA4(dailyRecord);
    const html = gerarHTMLImpressaoPaginado(dailyRecord, paginas);
    abrirJanelaRelatorio(html);

    return {
        dailyRecord,
        paginas,
        html,
    };
};

const relatorioEstoque = {
    carregarPortfolio,
    salvarPortfolio,
    adicionarProdutoAoPortfolio,
    removerProdutoDoPortfolio,
    reordenarPortfolio,
    calcularTotalPorTamanho,
    resumoPositivoNegativo,
    criarSnapshotProduto,
    montarDailyRecord,
    carregarHistorico,
    salvarNoHistorico,
    renderizarBlocoProdutoHTML,
    paginarRelatorioEmPaginasA4,
    gerarHTMLImpressaoPaginado,
    importarArquivoDeProducao,
    exemploFluxoCompleto,
};

export default relatorioEstoque;
