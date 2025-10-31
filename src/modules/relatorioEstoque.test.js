import importStockFile from './stockImporter';
import {
    calcularTotalPorTamanho,
    resumoPositivoNegativo,
    criarSnapshotProduto,
    montarDailyRecord,
    paginarRelatorioEmPaginasA4,
    gerarHTMLImpressaoPaginado,
    importarArquivoDeProducao,
} from './relatorioEstoque';

jest.mock('./stockImporter');

describe('relatorioEstoque module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.clear();
        }
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
