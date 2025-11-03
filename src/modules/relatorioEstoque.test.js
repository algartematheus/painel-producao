import importStockFile from './stockImporter';
import {
    calcularTotalPorTamanho,
    resumoPositivoNegativo,
    criarSnapshotProduto,
    montarDailyRecord,
    paginarRelatorioEmPaginasA4,
    gerarHTMLImpressaoPaginado,
    importarArquivoDeProducao,
    carregarPortfolio,
    salvarPortfolio,
    adicionarProdutoAoPortfolio,
    normalizarProdutosImportados,
} from './relatorioEstoque';

jest.mock('./stockImporter');

describe('relatorioEstoque module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.clear();
        }
    });

    it('salva e carrega portfólio preservando variações e agrupamento', () => {
        const salvo = salvarPortfolio([
            {
                codigo: '020',
                grade: ['P', 'M'],
                agruparVariacoes: false,
                variations: [
                    { ref: '020.AZ', tamanhos: { P: '5', M: '-2' } },
                ],
            },
        ]);

        expect(salvo).toEqual([
            {
                codigo: '020',
                grade: ['P', 'M'],
                agruparVariacoes: false,
                variations: [
                    { ref: '020.AZ', tamanhos: { P: 5, M: -2 } },
                ],
            },
        ]);

        const carregado = carregarPortfolio();
        expect(carregado).toEqual(salvo);
    });

    it('permite cadastrar manualmente produtos com variações agrupadas e separadas', () => {
        const portfolioInicial = adicionarProdutoAoPortfolio({
            codigo: '016',
            grade: ['06', '08'],
            agruparVariacoes: true,
            variations: [
                { ref: '016.AZ', tamanhos: { '06': 10, '08': -5 } },
            ],
        });

        expect(portfolioInicial).toHaveLength(1);
        expect(portfolioInicial[0]).toMatchObject({
            codigo: '016',
            agruparVariacoes: true,
            variations: [
                { ref: '016.AZ', tamanhos: { '06': 10, '08': -5 } },
            ],
        });

        const portfolioAtualizado = adicionarProdutoAoPortfolio({
            codigo: '017',
            grade: ['P', 'M'],
            agruparVariacoes: false,
            variations: [
                { ref: '017.ST', tamanhos: { P: 3, M: -1 } },
            ],
        });

        expect(portfolioAtualizado).toHaveLength(2);
        const carregado = carregarPortfolio();
        const itemAgrupado = carregado.find((item) => item.codigo === '016');
        const itemSeparado = carregado.find((item) => item.codigo === '017');

        expect(itemAgrupado?.agruparVariacoes).toBe(true);
        expect(itemAgrupado?.variations).toEqual([
            { ref: '016.AZ', tamanhos: { '06': 10, '08': -5 } },
        ]);
        expect(itemSeparado?.agruparVariacoes).toBe(false);
        expect(itemSeparado?.variations).toEqual([
            { ref: '017.ST', tamanhos: { P: 3, M: -1 } },
        ]);
    });

    it('normaliza produtos importados respeitando configuração de agrupamento do portfólio', () => {
        salvarPortfolio([
            {
                codigo: '016',
                grade: ['06', '08'],
                agruparVariacoes: true,
            },
        ]);

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

        salvarPortfolio([
            {
                codigo: '016',
                grade: ['06', '08'],
                agruparVariacoes: false,
            },
        ]);

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

        const resultado = await importarArquivoDeProducao(null, 'pdf', 'Supervisor');

        expect(importStockFile).toHaveBeenCalledWith({ file: null, type: 'pdf' });
        expect(resultado.dailyRecord.produtos.length).toBe(2);
        expect(resultado.html).toContain('Relatório de Estoque / Produção');

        openSpy.mockRestore();
    });
});
