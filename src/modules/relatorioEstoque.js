import importStockFile from './importStockFile';

const STORAGE_KEYS = {
    portfolio: 'portfolioProdutos',
    historico: 'historicoEstoque',
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
        return memoryStorage;
    }
    return memoryStorage;
};

const cloneGrade = (grade) => (Array.isArray(grade) ? grade.map((item) => String(item)) : []);

const stripAccentsAndUpper = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    const normalized = value.normalize ? value.normalize('NFD') : value;
    return normalized.replace(/[\u0300-\u036f]/g, '').toUpperCase();
};

const normalizeCodigoComparacao = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    return trimmed ? stripAccentsAndUpper(trimmed) : '';
};

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

const normalizeGrouping = (value) => {
    if (value === 'separadas') {
        return 'separadas';
    }
    if (value === 'juntas') {
        return 'juntas';
    }
    return value === false ? 'separadas' : 'juntas';
};

const sanitizeActor = (value) => {
    if (!value) {
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (typeof value === 'object') {
        const actor = {};
        if (typeof value.uid === 'string' && value.uid.trim()) {
            actor.uid = value.uid.trim();
        }
        if (typeof value.email === 'string' && value.email.trim()) {
            actor.email = value.email.trim();
        }
        if (typeof value.name === 'string' && value.name.trim()) {
            actor.name = value.name.trim();
        }
        return Object.keys(actor).length ? actor : null;
    }
    return null;
};

const sanitizeTimestamp = (value) => {
    if (!value || typeof value !== 'string') {
        return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date.toISOString();
};

const sanitizePortfolioProduct = (item) => {
    if (!item || typeof item !== 'object') {
        return null;
    }
    const codigo = typeof item.codigo === 'string' ? item.codigo.trim() : '';
    if (!codigo) {
        return null;
    }
    const grade = cloneGrade(item.grade);
    const variations = sanitizeVariations(item.variations);
    const grouping = normalizeGrouping(item.grouping ?? item.agruparVariacoes);
    const createdAt = sanitizeTimestamp(item.createdAt);
    const updatedAt = sanitizeTimestamp(item.updatedAt);
    const createdBy = sanitizeActor(item.createdBy);
    const updatedBy = sanitizeActor(item.updatedBy);

    return {
        codigo,
        grade,
        variations,
        grouping,
        agruparVariacoes: grouping !== 'separadas',
        createdAt,
        updatedAt,
        createdBy,
        updatedBy,
    };
};

const readPortfolioFromStorage = () => {
    const storage = getStorage();
    try {
        const raw = storage.getItem(STORAGE_KEYS.portfolio);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
};

const persistPortfolio = (portfolioArray = []) => {
    const storage = getStorage();
    const sanitized = Array.isArray(portfolioArray)
        ? portfolioArray.map(sanitizePortfolioProduct).filter(Boolean)
        : [];
    storage.setItem(STORAGE_KEYS.portfolio, JSON.stringify(sanitized));
    return sanitized;
};

export const listPortfolio = () => {
    const stored = readPortfolioFromStorage();
    return stored.map(sanitizePortfolioProduct).filter(Boolean);
};

export const upsertPortfolio = (produto, options = {}) => {
    const sanitizedInput = sanitizePortfolioProduct(produto);
    if (!sanitizedInput) {
        throw new Error('Dados inválidos ao salvar produto no portfólio.');
    }

    const actor = sanitizeActor(options.actor ?? produto?.updatedBy ?? produto?.createdBy);
    const currentPortfolio = listPortfolio();
    const nowIso = new Date().toISOString();
    const normalizedInputCode = normalizeCodigoComparacao(sanitizedInput.codigo);
    const existingIndex = currentPortfolio.findIndex(
        (item) => normalizeCodigoComparacao(item.codigo) === normalizedInputCode
    );

    if (existingIndex >= 0) {
        const previous = currentPortfolio[existingIndex];
        const merged = {
            ...previous,
            ...sanitizedInput,
            grade: sanitizedInput.grade.length ? sanitizedInput.grade : previous.grade,
            variations: sanitizedInput.variations.length ? sanitizedInput.variations : previous.variations,
            grouping: sanitizedInput.grouping || previous.grouping || 'juntas',
            agruparVariacoes:
                sanitizedInput.grouping
                    ? sanitizedInput.grouping !== 'separadas'
                    : previous.agruparVariacoes ?? true,
            createdAt: previous.createdAt || sanitizedInput.createdAt || nowIso,
            updatedAt: nowIso,
            createdBy: previous.createdBy || sanitizedInput.createdBy || actor || null,
            updatedBy: actor || sanitizedInput.updatedBy || previous.updatedBy || null,
        };
        currentPortfolio[existingIndex] = merged;
    } else {
        currentPortfolio.push({
            ...sanitizedInput,
            createdAt: sanitizedInput.createdAt || nowIso,
            updatedAt: sanitizedInput.updatedAt || nowIso,
            createdBy: sanitizedInput.createdBy || actor || null,
            updatedBy: actor || sanitizedInput.updatedBy || sanitizedInput.createdBy || null,
        });
    }

    return persistPortfolio(currentPortfolio);
};

export const deletePortfolio = (codigo) => {
    const normalized = normalizeCodigoComparacao(codigo);
    if (!normalized) {
        return listPortfolio();
    }
    const updated = listPortfolio().filter(
        (item) => normalizeCodigoComparacao(item.codigo) !== normalized
    );
    return persistPortfolio(updated);
};

export const reordenarPortfolio = (novaOrdemArray = []) => {
    const current = listPortfolio();
    if (!Array.isArray(novaOrdemArray) || !novaOrdemArray.length) {
        return persistPortfolio(current);
    }

    const codigoOrder = novaOrdemArray
        .map((item) => {
            if (typeof item === 'string') {
                return normalizeCodigoComparacao(item);
            }
            if (item && typeof item === 'object' && typeof item.codigo === 'string') {
                return normalizeCodigoComparacao(item.codigo);
            }
            return null;
        })
        .filter((codigoItem) => Boolean(codigoItem));

    if (!codigoOrder.length) {
        return persistPortfolio(current);
    }

    const portfolioMap = new Map(
        current.map((item) => [normalizeCodigoComparacao(item.codigo), item])
    );
    const ordered = [];

    codigoOrder.forEach((codigoItem) => {
        if (portfolioMap.has(codigoItem)) {
            ordered.push(portfolioMap.get(codigoItem));
            portfolioMap.delete(codigoItem);
        }
    });

    portfolioMap.forEach((value) => {
        ordered.push(value);
    });

    return persistPortfolio(ordered);
};

export const adicionarProdutoAoPortfolio = (produto, options) => {
    return upsertPortfolio(produto, options);
};

export const removerProdutoDoPortfolio = (codigo) => {
    return deletePortfolio(codigo);
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

export const calcularTotalPorTamanho = (variations = [], grade = []) => {
    const sanitizedVariations = sanitizeVariations(variations);
    const sanitizedGrade = cloneGrade(grade);
    const gradeToUse = sanitizedGrade.length ? sanitizedGrade : inferGradeFromVariations(sanitizedVariations);

    const totals = {};
    gradeToUse.forEach((size) => {
        totals[size] = 0;
    });

    sanitizedVariations.forEach((variation) => {
        gradeToUse.forEach((size) => {
            const value = normalizeNumber(variation.tamanhos[size]);
            totals[size] = (totals[size] || 0) + value;
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
    const gradeCalculada = sanitizedGrade.length ? sanitizedGrade : inferGradeFromVariations(sanitizedVariations);
    const totalPorTamanho = calcularTotalPorTamanho(sanitizedVariations, gradeCalculada);
    const resumo = resumoPositivoNegativo(totalPorTamanho);
    const gradeFinal = sanitizedGrade.length ? sanitizedGrade : gradeCalculada;
    return {
        produtoBase,
        grade: gradeFinal,
        variations: sanitizedVariations,
        totalPorTamanho,
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
    const totalPorTamanho = produtoSnapshot.totalPorTamanho || calcularTotalPorTamanho(variations, grade);
    const resumo = produtoSnapshot.resumoPositivoNegativo || { positivoTotal: 0, negativoTotal: 0, formatoHumano: '0 0' };

    const headerCells = grade.map((size) => `<th>${size}</th>`).join('');

    const bodyRows = variations
        .map((variation) => {
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
                </tr>
            `;
        })
        .join('');

    const totalCells = grade
        .map((size) => {
            const value = normalizeNumber(totalPorTamanho[size]);
            const className = getValueClass(value);
            return `<td class="${className}">${formatNumber(value)}</td>`;
        })
        .join('');

    return `
        <section class="produto-bloco">
            <h2>Produto ${produtoSnapshot.produtoBase}</h2>
            <table class="tabela-produto">
                <thead>
                    <tr>
                        <th>REF/TAM</th>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
                <tfoot>
                    <tr class="total-geral">
                        <td>${produtoSnapshot.produtoBase}.</td>
                        ${totalCells}
                    </tr>
                </tfoot>
            </table>
            <div class="resumo-produto">
                <p>Necessário produzir (falta total): <strong class="falta">${formatNumber(resumo.positivoTotal)}</strong></p>
                <p>Sobra consolidada: <strong class="sobra">${formatNumber(resumo.negativoTotal)}</strong></p>
                <p>Formato rápido: <code>${resumo.formatoHumano}</code></p>
            </div>
        </section>
    `;
};

const createMeasurementContainer = () => {
    if (typeof document === 'undefined') {
        return null;
    }
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-99999px';
    container.style.top = '0';
    container.style.width = '210mm';
    container.style.padding = '16px';
    container.style.boxSizing = 'border-box';
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
        if (block.altura > pageHeightPx) {
            if (currentPage.length) {
                pages.push(currentPage);
                currentPage = [];
                currentHeight = 0;
            }
            pages.push([block]);
            return;
        }

        if (currentHeight + block.altura > pageHeightPx) {
            if (currentPage.length) {
                pages.push(currentPage);
                currentPage = [];
                currentHeight = 0;
            }
        }

        currentPage.push(block);
        currentHeight += block.altura;
    };

    produtos.forEach((produtoSnapshot) => {
        const html = renderizarBlocoProdutoHTML(produtoSnapshot);
        let altura = estimateBlockHeight(produtoSnapshot);
        if (container) {
            const wrapper = document.createElement('div');
            wrapper.className = 'produto-wrapper-medida';
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
                <header class="page-header">
                    <div>
                        <strong>Relatório de Estoque / Produção</strong><br/>
                        Data/Hora: ${dataLancamento || '-'}<br/>
                        Responsável: ${responsavel || '-'}<br/>
                        Página ${pageIndex + 1} / ${totalPages}
                    </div>
                </header>
                ${pageBlocks.map((block) => block.html).join('')}
            </div>
        `)
        .join('');

    const styles = `
        * {
            box-sizing: border-box;
        }
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            background: #ccc;
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
        }
        .page:last-child {
            page-break-after: auto;
        }
        .page-header {
            font-size: 11px;
            border-bottom: 1px solid #000;
            margin-bottom: 8px;
            padding-bottom: 4px;
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
            margin-top: 4px;
            margin-bottom: 12px;
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
    <title>Relatório de Estoque - ${dataLancamento || 'Relatório'}</title>
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

const normalizeParsedProductsToSnapshots = (produtos = [], dataLancamentoISO, responsavel) => {
    if (!Array.isArray(produtos)) {
        return [];
    }
    return produtos.map((produto) => {
        return criarSnapshotProduto({
            produtoBase: produto.productCode || produto.produtoBase,
            grade: produto.grade || [],
            variations: Array.isArray(produto.variations) ? produto.variations : [],
            dataLancamentoISO,
            responsavel,
        });
    });
};

export const importarArquivoDeProducao = async (file, tipoArquivo, responsavelLogado) => {
    const dataLancamentoISO = new Date().toISOString();
    let snapshotsProdutos = [];

    if (tipoArquivo === 'manual' && Array.isArray(file)) {
        snapshotsProdutos = file;
    } else if ((tipoArquivo === 'docx' || tipoArquivo === 'txt') && file) {
        const produtosImportados = await importStockFile(file);
        snapshotsProdutos = normalizeParsedProductsToSnapshots(produtosImportados, dataLancamentoISO, responsavelLogado);
    } else {
        throw new Error('Tipo de arquivo não suportado. Use "docx" ou "txt".');
    }

    const dailyRecord = montarDailyRecord({
        dataLancamentoISO,
        responsavel: responsavelLogado,
        snapshotsProdutos,
    });

    salvarNoHistorico(dailyRecord);
    const paginas = paginarRelatorioEmPaginasA4(dailyRecord);
    const htmlFinal = gerarHTMLImpressaoPaginado(dailyRecord, paginas);

    if (typeof window !== 'undefined') {
        abrirJanelaRelatorio(htmlFinal);
    }

    return {
        dailyRecord,
        htmlRelatorio: htmlFinal,
    };
};

export const exemploFluxoCompleto = () => {
    const dataLancamentoISO = new Date().toISOString();
    const responsavel = 'Matheus';
    const grade016 = ['06', '08', '10', '12', '14', '16', '02', '04'];
    const variations016 = [
        {
            ref: '016.AZ',
            tamanhos: { '06': -7, '08': -4, '10': -16, '12': -6, '14': 11, '16': 4, '02': -9, '04': -49 },
        },
        {
            ref: '016.DV',
            tamanhos: { '06': -5, '08': -8, '10': -5, '12': -6, '14': 3, '16': 5, '02': -8, '04': -33 },
        },
        {
            ref: '016.ST',
            tamanhos: { '06': -9, '08': -9, '10': -18, '12': -8, '14': 11, '16': 4, '02': -23, '04': -66 },
        },
    ];

    const snap016 = criarSnapshotProduto({
        produtoBase: '016',
        grade: grade016,
        variations: variations016,
        dataLancamentoISO,
        responsavel,
    });

    const dailyRecord = montarDailyRecord({
        dataLancamentoISO,
        responsavel,
        snapshotsProdutos: [snap016],
    });

    salvarNoHistorico(dailyRecord);
    const paginas = paginarRelatorioEmPaginasA4(dailyRecord);
    const htmlFinal = gerarHTMLImpressaoPaginado(dailyRecord, paginas);

    if (typeof window !== 'undefined') {
        abrirJanelaRelatorio(htmlFinal);
    }

    return {
        dailyRecord,
        paginas,
        html: htmlFinal,
    };
};

const ProductionStockApp = {
    listPortfolio,
    upsertPortfolio,
    deletePortfolio,
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

if (typeof window !== 'undefined') {
    window.ProductionStockApp = ProductionStockApp;
}

export {
    ProductionStockApp,
};

export default ProductionStockApp;
