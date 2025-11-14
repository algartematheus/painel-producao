import importStockFile from './importStockFile';
import {
    calcularTotalPorTamanho,
    resumoPositivoNegativo,
    criarSnapshotProduto,
    montarDailyRecord,
    paginarRelatorioEmPaginasA4,
    gerarHTMLImpressaoPaginado,
    importarArquivoDeProducao,
    listPortfolio,
    upsertPortfolio,
    deletePortfolio,
    adicionarProdutoAoPortfolio,
    reordenarPortfolio,
    normalizarProdutosImportados,
} from './relatorioEstoque';

jest.mock('./importStockFile');

describe('relatorioEstoque module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.clear();
        }
    });

    it('salva, lista e remove itens do portfólio preservando metadados', () => {
        const salvo = upsertPortfolio({
            codigo: '020',
            grade: ['P', 'M'],
            grouping: 'separadas',
            variations: [
                { ref: '020.AZ', tamanhos: { P: '5', M: '-2' } },
            ],
        });

        expect(salvo).toHaveLength(1);
        expect(salvo[0]).toMatchObject({
            codigo: '020',
            grade: ['P', 'M'],
            grouping: 'separadas',
            agruparVariacoes: false,
            variations: [
                { ref: '020.AZ', tamanhos: { P: 5, M: -2 } },
            ],
        });
        expect(salvo[0].updatedAt).toEqual(expect.any(String));
        expect(salvo[0].createdAt).toEqual(expect.any(String));

        const carregado = listPortfolio();
        expect(carregado).toEqual(salvo);

        const removido = deletePortfolio('020');
        expect(removido).toEqual([]);
        expect(listPortfolio()).toEqual([]);
    });

    it('normaliza o código para comparar atualizações, remoções e reordenação', () => {
        upsertPortfolio({ codigo: 'ã16', grade: ['UN'] });
        const atualizado = upsertPortfolio({ codigo: 'A16', grade: ['P', 'M'] });
        expect(atualizado).toHaveLength(1);
        expect(atualizado[0].grade).toEqual(['P', 'M']);

        upsertPortfolio({ codigo: 'b20', grade: ['36'] });
        reordenarPortfolio(['B20', 'a16']);
        const ordenado = listPortfolio();
        expect(ordenado.map((item) => item.codigo)).toEqual(['b20', 'ã16']);

        deletePortfolio('Á16');
        expect(listPortfolio().map((item) => item.codigo)).toEqual(['b20']);
    });

    it('permite cadastrar manualmente produtos com variações agrupadas e separadas', () => {
        const portfolioInicial = adicionarProdutoAoPortfolio({
            codigo: '016',
            grade: ['06', '08'],
            grouping: 'juntas',
            variations: [
                { ref: '016.AZ', tamanhos: { '06': 10, '08': -5 } },
            ],
        });

        expect(portfolioInicial).toHaveLength(1);
        expect(portfolioInicial[0]).toMatchObject({
            codigo: '016',
            grouping: 'juntas',
            agruparVariacoes: true,
            variations: [
                { ref: '016.AZ', tamanhos: { '06': 10, '08': -5 } },
            ],
        });

        const portfolioAtualizado = adicionarProdutoAoPortfolio({
            codigo: '017',
            grade: ['P', 'M'],
            grouping: 'separadas',
            variations: [
                { ref: '017.ST', tamanhos: { P: 3, M: -1 } },
            ],
        });

        expect(portfolioAtualizado).toHaveLength(2);
        const carregado = listPortfolio();
        const itemAgrupado = carregado.find((item) => item.codigo === '016');
        const itemSeparado = carregado.find((item) => item.codigo === '017');

        expect(itemAgrupado?.agruparVariacoes).toBe(true);
        expect(itemAgrupado?.grouping).toBe('juntas');
        expect(itemAgrupado?.variations).toEqual([
            { ref: '016.AZ', tamanhos: { '06': 10, '08': -5 } },
        ]);
        expect(itemSeparado?.agruparVariacoes).toBe(false);
        expect(itemSeparado?.grouping).toBe('separadas');
        expect(itemSeparado?.variations).toEqual([
            { ref: '017.ST', tamanhos: { P: 3, M: -1 } },
        ]);
    });

    it('normaliza produtos importados respeitando configuração de agrupamento do portfólio', () => {
        upsertPortfolio({
            codigo: '016',
            grade: ['06', '08'],
            grouping: 'juntas',
        });

        const dadosImportados = [
            {
                productCode: '016',
                grade: ['06', '08'],
                variations: [
                    { ref: '016.AZ', grade: ['06', '08'], tamanhos: { '06': 5, '08': -2 } },
                    { ref: '016.DV', grade: ['06', '08'], tamanhos: { '06': -3, '08': 4 } },
                ],
            },
        ];

        let normalizado = normalizarProdutosImportados(dadosImportados);
        expect(Object.keys(normalizado)).toEqual(['016']);
        expect(normalizado['016'].produtoBase).toBe('016');
        expect(normalizado['016'].variations).toHaveLength(2);
        expect(normalizado['016'].grade).toEqual(['06', '08']);

        upsertPortfolio({
            codigo: '016',
            grade: ['06', '08'],
            grouping: 'separadas',
        });

        normalizado = normalizarProdutosImportados(dadosImportados);
        expect(Object.keys(normalizado).sort()).toEqual(['016:016.AZ', '016:016.DV']);
        expect(normalizado['016:016.AZ'].produtoBase).toBe('016.AZ');
        expect(normalizado['016:016.AZ'].variations).toHaveLength(1);
        expect(normalizado['016:016.DV'].produtoBase).toBe('016.DV');
        expect(normalizado['016:016.DV'].variations[0].tamanhos).toEqual({ '06': -3, '08': 4 });
    });

    it('calcula totais e resumo positivos/negativos corretamente', () => {
        const variations = [
            {
                ref: '016.AZ',
                tamanhos: { '06': -10, '08': 5, '10': 0 },
            },
            {
                ref: '016.DV',
                tamanhos: { '06': 15, '08': -5, '10': 20 },
            },
        ];
        const grade = ['06', '08', '10'];
        const totais = calcularTotalPorTamanho(variations, grade);
        expect(totais).toEqual({ '06': 5, '08': 0, '10': 20 });

        const resumo = resumoPositivoNegativo(totais);
        expect(resumo).toEqual({ positivoTotal: 25, negativoTotal: 0, formatoHumano: '25 0' });
    });

    it('cria snapshot com totais agregados', () => {
        const snapshot = criarSnapshotProduto({
            produtoBase: '016',
            grade: ['06', '08'],
            variations: [
                { ref: '016.AZ', tamanhos: { '06': -2, '08': 4 } },
                { ref: '016.ST', tamanhos: { '06': 1, '08': -1 } },
            ],
            dataLancamentoISO: '2024-01-01T00:00:00Z',
            responsavel: 'Matheus',
        });

        expect(snapshot.totalPorTamanho).toEqual({ '06': -1, '08': 3 });
        expect(snapshot.totalPorTamanhoDetalhado).toEqual({
            '06': { positivo: 1, negativo: -2, liquido: -1 },
            '08': { positivo: 4, negativo: -1, liquido: 3 },
        });
        expect(snapshot.resumoPositivoNegativo).toEqual({ positivoTotal: 3, negativoTotal: -1, formatoHumano: '3 -1' });
        expect(snapshot.metadata).toEqual({ dataLancamentoISO: '2024-01-01T00:00:00Z', responsavel: 'Matheus' });
    });

    it('paginates report blocks respecting page height', () => {
        const snapshotA = criarSnapshotProduto({
            produtoBase: '016',
            grade: ['06', '08'],
            variations: new Array(6).fill(null).map((_, index) => ({
                ref: `016.${index}`,
                tamanhos: { '06': index, '08': -index },
            })),
        });

        const snapshotB = criarSnapshotProduto({
            produtoBase: '017',
            grade: ['36', '38'],
            variations: new Array(6).fill(null).map((_, index) => ({
                ref: `017.${index}`,
                tamanhos: { '36': -index, '38': index },
            })),
        });

        const record = montarDailyRecord({
            dataLancamentoISO: '2024-01-02T00:00:00Z',
            responsavel: 'Equipe',
            snapshotsProdutos: [snapshotA, snapshotB],
        });

        const paginas = paginarRelatorioEmPaginasA4(record, 250);
        expect(paginas.length).toBeGreaterThanOrEqual(2);
        expect(paginas[0][0].html).toContain('Produto 016');
    });

    it('gera HTML final com metadados e páginas', () => {
        const snapshot = criarSnapshotProduto({
            produtoBase: '040',
            grade: ['PP', 'P'],
            variations: [{ ref: '040.AZ', tamanhos: { PP: 5, P: -3 } }],
        });
        const record = montarDailyRecord({
            dataLancamentoISO: '2024-03-10T12:00:00Z',
            responsavel: 'Ana',
            snapshotsProdutos: [snapshot],
        });
        const paginas = paginarRelatorioEmPaginasA4(record, 800);
        const html = gerarHTMLImpressaoPaginado(record, paginas);
        expect(html).toContain('Relatório de Estoque / Produção');
        expect(html).toContain('Página 1 /');
        expect(html).toContain('Produto 040');
    });

    it('executa fluxo completo de importação usando parser mockado', async () => {
        importStockFile.mockResolvedValue([
            {
                productCode: '016',
                grade: ['06', '08'],
                variations: [
                    { ref: '016.AZ', grade: ['06', '08'], tamanhos: { '06': 10, '08': -5 } },
                    { ref: '016.DV', grade: ['06', '08'], tamanhos: { '06': -2, '08': 3 } },
                ],
            },
            {
                productCode: '017',
                grade: ['36', '38'],
                variations: [
                    { ref: '017.ST', grade: ['36', '38'], tamanhos: { '36': 4, '38': -6 } },
                ],
            },
        ]);

        const openSpy = jest.spyOn(window, 'open').mockImplementation(() => ({
            document: {
                write: jest.fn(),
                close: jest.fn(),
            },
        }));

        const fakeFile = { name: 'relatorio.docx' };
        const resultado = await importarArquivoDeProducao(fakeFile, 'docx', 'Supervisor');

        expect(importStockFile).toHaveBeenCalledWith(fakeFile);
        expect(resultado.dailyRecord.produtos.length).toBe(2);
        expect(resultado.html).toContain('Relatório de Estoque / Produção');

        openSpy.mockRestore();
    });
});
