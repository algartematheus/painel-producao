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

const normalizeVariationRef = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    return trimmed ? stripAccentsAndUpper(trimmed) : '';
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
                alwaysSeparate: variation.alwaysSeparate === true,
            };
        })
        .filter(Boolean);
};

const sanitizeAlwaysSeparateRefs = (refs = []) => {
    if (!Array.isArray(refs)) {
        return [];
    }
    return refs
        .map((ref) => {
            if (typeof ref !== 'string') {
                return '';
            }
            const trimmed = ref.trim();
            return trimmed ? stripAccentsAndUpper(trimmed) : '';
        })
        .filter(Boolean);
};

const normalizeGrouping = (value) => {
    if (value === 'separadas' || value === 'separated') {
        return 'separadas';
    }
    if (value === 'juntas' || value === 'grouped') {
        return 'juntas';
    }
    return value === false ? 'separadas' : 'juntas';
};

const normalizeGroupingMode = (value, groupingFallback = 'juntas') => {
    if (value === 'separated' || value === 'grouped') {
        return value;
    }
    const grouping = normalizeGrouping(groupingFallback);
    return grouping === 'separadas' ? 'separated' : 'grouped';
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

const sanitizePortfolioProduct = (item, defaultOrderIndex = 0) => {
    if (!item || typeof item !== 'object') {
        return null;
    }
    const codigo = typeof item.codigo === 'string' ? item.codigo.trim() : '';
    if (!codigo) {
        return null;
    }
    const grade = cloneGrade(item.grade);
    const variations = sanitizeVariations(item.variations);
    const grouping = normalizeGrouping(item.grouping ?? item.agruparVariacoes ?? item.groupingMode);
    const groupingMode = normalizeGroupingMode(item.groupingMode, grouping);
    const alwaysSeparateRefs = sanitizeAlwaysSeparateRefs(item.alwaysSeparateRefs);
    const alwaysSeparateSet = new Set(alwaysSeparateRefs);
    const normalizedVariations = variations.map((variation) => {
        const normalizedRef = normalizeVariationRef(variation.ref);
        const shouldSeparate = variation.alwaysSeparate === true || (normalizedRef && alwaysSeparateSet.has(normalizedRef));
        if (shouldSeparate && normalizedRef && !alwaysSeparateSet.has(normalizedRef)) {
            alwaysSeparateSet.add(normalizedRef);
        }
        return {
            ...variation,
            alwaysSeparate: shouldSeparate,
        };
    });
    const createdAt = sanitizeTimestamp(item.createdAt);
    const updatedAt = sanitizeTimestamp(item.updatedAt);
    const createdBy = sanitizeActor(item.createdBy);
    const updatedBy = sanitizeActor(item.updatedBy);
    const orderIndexValue = Number.isFinite(item.orderIndex)
        ? item.orderIndex
        : Number.isFinite(defaultOrderIndex)
            ? defaultOrderIndex
            : 0;

    return {
        codigo,
        grade,
        variations: normalizedVariations,
        grouping,
        groupingMode,
        agruparVariacoes: grouping !== 'separadas',
        alwaysSeparateRefs: Array.from(alwaysSeparateSet),
        orderIndex: orderIndexValue,
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
        ? portfolioArray
              .map((item, index) => sanitizePortfolioProduct(item, index))
              .filter(Boolean)
        : [];
    const normalized = sanitized.map((item, index) => ({
        ...item,
        orderIndex: index,
        grouping: normalizeGrouping(item.grouping),
        groupingMode: normalizeGroupingMode(item.groupingMode, item.grouping),
        agruparVariacoes: normalizeGrouping(item.grouping) !== 'separadas',
    }));
    storage.setItem(STORAGE_KEYS.portfolio, JSON.stringify(normalized));
    return normalized;
};

export const listPortfolio = () => {
    const stored = readPortfolioFromStorage();
    const sanitized = stored
        .map((item, index) => sanitizePortfolioProduct(item, index))
        .filter(Boolean);
    return sanitized
        .slice()
        .sort((a, b) => {
            const aIndex = Number.isFinite(a.orderIndex) ? a.orderIndex : 0;
            const bIndex = Number.isFinite(b.orderIndex) ? b.orderIndex : 0;
            if (aIndex === bIndex) {
                return 0;
            }
            return aIndex - bIndex;
        })
        .map((item, index) => {
            if (item.orderIndex !== index) {
                return { ...item, orderIndex: index };
            }
            return item;
        });
};

const buildAlwaysSeparateLookup = (refs = []) => {
    return sanitizeAlwaysSeparateRefs(refs).reduce((acc, ref) => {
        const normalizedRef = normalizeVariationRef(ref);
        if (normalizedRef) {
            acc[normalizedRef] = true;
        }
        return acc;
    }, {});
};

export const buildPortfolioPreferences = (portfolioInput) => {
    const portfolioList = Array.isArray(portfolioInput) && portfolioInput.length
        ? portfolioInput
        : listPortfolio();
    const order = [];
    const preferenceMap = new Map();

    portfolioList.forEach((item, index) => {
        const sanitizedItem = sanitizePortfolioProduct(item, index);
        if (!sanitizedItem) {
            return;
        }
        const normalizedCode = normalizeCodigoComparacao(sanitizedItem.codigo);
        if (!normalizedCode) {
            return;
        }
        order.push(sanitizedItem.codigo);
        preferenceMap.set(normalizedCode, {
            codigo: sanitizedItem.codigo,
            grouping: sanitizedItem.grouping,
            groupingMode: sanitizedItem.groupingMode,
            agruparVariacoes: sanitizedItem.agruparVariacoes,
            alwaysSeparateRefs: sanitizeAlwaysSeparateRefs(sanitizedItem.alwaysSeparateRefs),
            alwaysSeparateLookup: buildAlwaysSeparateLookup(sanitizedItem.alwaysSeparateRefs),
            orderIndex: sanitizedItem.orderIndex,
        });
    });

    return { order, preferenceMap };
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
        const normalizedGrouping = normalizeGrouping(
            sanitizedInput.grouping || previous.grouping || 'juntas',
        );
        const normalizedGroupingMode = normalizeGroupingMode(
            sanitizedInput.groupingMode,
            normalizedGrouping,
        );
        const merged = {
            ...previous,
            ...sanitizedInput,
            grade: sanitizedInput.grade.length ? sanitizedInput.grade : previous.grade,
            variations: sanitizedInput.variations.length ? sanitizedInput.variations : previous.variations,
            grouping: normalizedGrouping,
            groupingMode: normalizedGroupingMode,
            agruparVariacoes: normalizedGrouping !== 'separadas',
            alwaysSeparateRefs: sanitizedInput.alwaysSeparateRefs.length
                ? sanitizedInput.alwaysSeparateRefs
                : previous.alwaysSeparateRefs || [],
            createdAt: previous.createdAt || sanitizedInput.createdAt || nowIso,
            updatedAt: nowIso,
            createdBy: previous.createdBy || sanitizedInput.createdBy || actor || null,
            updatedBy: actor || sanitizedInput.updatedBy || previous.updatedBy || null,
            orderIndex: Number.isFinite(previous.orderIndex)
                ? previous.orderIndex
                : Number.isFinite(sanitizedInput.orderIndex)
                    ? sanitizedInput.orderIndex
                    : existingIndex,
        };
        currentPortfolio[existingIndex] = merged;
    } else {
        const nextOrderIndex = Number.isFinite(sanitizedInput.orderIndex)
            ? sanitizedInput.orderIndex
            : currentPortfolio.length;
        const normalizedGrouping = normalizeGrouping(sanitizedInput.grouping);
        currentPortfolio.push({
            ...sanitizedInput,
            grouping: normalizedGrouping,
            groupingMode: normalizeGroupingMode(sanitizedInput.groupingMode, normalizedGrouping),
            agruparVariacoes: normalizedGrouping !== 'separadas',
            createdAt: sanitizedInput.createdAt || nowIso,
            updatedAt: sanitizedInput.updatedAt || nowIso,
            createdBy: sanitizedInput.createdBy || actor || null,
            updatedBy: actor || sanitizedInput.updatedBy || sanitizedInput.createdBy || null,
            orderIndex: nextOrderIndex,
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
            if (item && typeof item === 'object') {
                if (typeof item.codigo === 'string') {
                    return normalizeCodigoComparacao(item.codigo);
                }
                if (typeof item.productCode === 'string') {
                    return normalizeCodigoComparacao(item.productCode);
                }
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
    const seen = new Set();

    codigoOrder.forEach((codigoItem) => {
        if (!codigoItem || seen.has(codigoItem)) {
            return;
        }
        if (portfolioMap.has(codigoItem)) {
            ordered.push(portfolioMap.get(codigoItem));
            portfolioMap.delete(codigoItem);
            seen.add(codigoItem);
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
        if (value && typeof value === 'object') {
            const positivo = normalizeNumber(value.positivo);
            const negativo = normalizeNumber(value.negativo);
            if (positivo > 0) {
                positivoTotal += positivo;
            }
            if (negativo < 0) {
                negativoTotal += negativo;
            }

            if (positivo === 0 && negativo === 0) {
                const liquido = normalizeNumber(value.liquido);
                if (liquido > 0) {
                    positivoTotal += liquido;
                } else if (liquido < 0) {
                    negativoTotal += liquido;
                }
            }
            return;
        }

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

const calcularDetalhesPorTamanho = (variations = [], grade = []) => {
    const sanitizedVariations = sanitizeVariations(variations);
    const sanitizedGrade = cloneGrade(grade);
    const gradeToUse = sanitizedGrade.length ? sanitizedGrade : inferGradeFromVariations(sanitizedVariations);

    const detalhes = {};

    gradeToUse.forEach((size) => {
        detalhes[size] = {
            positivo: 0,
            negativo: 0,
            liquido: 0,
        };
    });

    sanitizedVariations.forEach((variation) => {
        gradeToUse.forEach((size) => {
            const value = normalizeNumber(variation.tamanhos?.[size]);
            if (!value) {
                return;
            }

            if (!detalhes[size]) {
                detalhes[size] = {
                    positivo: 0,
                    negativo: 0,
                    liquido: 0,
                };
            }

            if (value > 0) {
                detalhes[size].positivo += value;
            } else if (value < 0) {
                detalhes[size].negativo += value;
            }
            detalhes[size].liquido += value;
        });
    });

    return detalhes;
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
    const totalPorTamanhoDetalhado = calcularDetalhesPorTamanho(sanitizedVariations, gradeCalculada);
    const resumo = resumoPositivoNegativo(totalPorTamanhoDetalhado);
    const gradeFinal = sanitizedGrade.length ? sanitizedGrade : gradeCalculada;
    return {
        produtoBase,
        grade: gradeFinal,
        variations: sanitizedVariations,
        totalPorTamanho,
        totalPorTamanhoDetalhado,
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
    const totalPorTamanhoDetalhado = produtoSnapshot.totalPorTamanhoDetalhado || calcularDetalhesPorTamanho(variations, grade);
    const resumo = produtoSnapshot.resumoPositivoNegativo || { positivoTotal: 0, negativoTotal: 0, formatoHumano: '0 0' };

    const getDetalheNormalizado = (size) => {
        const detalhe = totalPorTamanhoDetalhado?.[size];
        const liquidoFallback = normalizeNumber(totalPorTamanho?.[size]);
        let positivo = normalizeNumber(detalhe?.positivo);
        let negativo = normalizeNumber(detalhe?.negativo);

        positivo = positivo > 0 ? positivo : 0;
        negativo = negativo < 0 ? negativo : 0;

        if (positivo === 0 && negativo === 0) {
            const liquidoDetalhe = normalizeNumber(detalhe?.liquido);
            if (liquidoDetalhe > 0) {
                positivo = liquidoDetalhe;
            } else if (liquidoDetalhe < 0) {
                negativo = liquidoDetalhe;
            }
        }

        if (positivo === 0 && negativo === 0 && liquidoFallback !== 0) {
            if (liquidoFallback > 0) {
                positivo = liquidoFallback;
            } else {
                negativo = liquidoFallback;
            }
        }

        return { positivo, negativo };
    };

    const formatTotalCell = (size) => {
        const { positivo, negativo } = getDetalheNormalizado(size);
        const hasPositivo = positivo > 0;
        const hasNegativo = negativo < 0;

        let displayValue = '0';
        if (hasPositivo && hasNegativo) {
            displayValue = `${formatNumber(positivo)}-${formatNumber(Math.abs(negativo))}`;
        } else if (hasPositivo) {
            displayValue = formatNumber(positivo);
        } else if (hasNegativo) {
            displayValue = formatNumber(negativo);
        }

        let className = '';
        if (hasPositivo && !hasNegativo) {
            className = 'falta';
        } else if (hasNegativo && !hasPositivo) {
            className = 'sobra';
        }

        return { className, displayValue };
    };

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
            const { className, displayValue } = formatTotalCell(size);
            return `<td class="${className}">${displayValue}</td>`;
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
