import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GestaoProducaoEstoqueModule, { validarEAdicionarProdutoAoPortfolio } from './gestaoProducaoEstoque';
import {
    upsertPortfolio,
    carregarHistorico,
    listPortfolio,
    deletePortfolio,
    reordenarPortfolio,
} from './relatorioEstoque';

jest.mock('./auth', () => ({
    __esModule: true,
    useAuth: jest.fn(() => ({
        user: { displayName: 'Usuário Teste', email: 'usuario@teste.com' },
        logout: jest.fn(),
    })),
}));

jest.mock('./shared', () => ({
    __esModule: true,
    usePersistedTheme: jest.fn(() => ({ theme: 'light', toggleTheme: jest.fn() })),
    GlobalStyles: () => <div data-testid="global-styles" />,
}));

jest.mock('../components/HeaderContainer', () => ({
    __esModule: true,
    default: ({ children }) => <div data-testid="header-container">{children}</div>,
}));

jest.mock('../components/GlobalNavigation', () => ({
    __esModule: true,
    default: () => <nav data-testid="global-navigation" />,
}));

jest.mock('./stockImporter', () => ({
    __esModule: true,
    default: jest.fn(),
    PDF_LIBRARY_UNAVAILABLE_ERROR: 'PDF_LIBRARY_UNAVAILABLE_ERROR',
}));

jest.mock('./relatorioEstoque', () => ({
    __esModule: true,
    listPortfolio: jest.fn(),
    upsertPortfolio: jest.fn(),
    deletePortfolio: jest.fn(),
    reordenarPortfolio: jest.fn(),
    criarSnapshotProduto: jest.fn(),
    carregarHistorico: jest.fn(),
    paginarRelatorioEmPaginasA4: jest.fn(),
    gerarHTMLImpressaoPaginado: jest.fn(),
    importarArquivoDeProducao: jest.fn(),
    exemploFluxoCompleto: jest.fn(),
}));

describe('validarEAdicionarProdutoAoPortfolio', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('valida campos e retorna o portfólio atualizado', () => {
        const portfolioEsperado = [
            {
                codigo: '123',
                grade: ['PP', 'P'],
                variations: [
                    {
                        ref: '123-A',
                        tamanhos: { PP: 10, P: -2 },
                    },
                ],
                agruparVariacoes: true,
            },
        ];

        upsertPortfolio.mockReturnValue(portfolioEsperado);

        const resultado = validarEAdicionarProdutoAoPortfolio({
            codigo: '123 ',
            grade: 'PP, P',
            variacoes: [
                {
                    ref: '123-A',
                    tamanhos: { PP: 10, P: -2 },
                },
            ],
            agrupamento: 'juntas',
        });

        expect(upsertPortfolio).toHaveBeenCalledWith(
            {
                codigo: '123',
                grade: ['PP', 'P'],
                variations: [
                    {
                        ref: '123-A',
                        tamanhos: { PP: 10, P: -2 },
                    },
                ],
                grouping: 'juntas',
                createdBy: undefined,
            },
            undefined,
        );
        expect(resultado.portfolioAtualizado).toEqual(portfolioEsperado);
        expect(resultado.mensagemSucesso).toBe('Produto 123 salvo com variações agrupadas.');
    });

    it('infere grade quando necessário e lança erros apropriados', () => {
        upsertPortfolio.mockReturnValue([]);

        const resultado = validarEAdicionarProdutoAoPortfolio({
            codigo: '456',
            grade: '',
            variacoes: [
                {
                    ref: '456-B',
                    tamanhos: { '6': 1, '8': 2 },
                },
            ],
            agrupamento: 'separadas',
        });

        expect(upsertPortfolio).toHaveBeenCalledWith(
            {
                codigo: '456',
                grade: ['06', '08'],
                variations: [
                    {
                        ref: '456-B',
                        tamanhos: { '06': 1, '08': 2 },
                    },
                ],
                grouping: 'separadas',
                createdBy: undefined,
            },
            undefined,
        );
        expect(resultado.mensagemSucesso).toBe('Produto 456 salvo com variações separadas.');

        expect(() =>
            validarEAdicionarProdutoAoPortfolio({
                codigo: '  ',
                grade: '',
                variacoes: [],
                agrupamento: 'juntas',
            }),
        ).toThrow('Informe o código do produto base.');

        expect(() =>
            validarEAdicionarProdutoAoPortfolio({
                codigo: '789',
                grade: '',
                variacoes: [
                    {
                        ref: '',
                        tamanhos: '',
                    },
                ],
                agrupamento: 'juntas',
            }),
        ).toThrow('Informe ao menos um tamanho na grade.');

        expect(() =>
            validarEAdicionarProdutoAoPortfolio({
                codigo: '789',
                grade: 'PP',
                variacoes: [
                    {
                        ref: '',
                        tamanhos: '',
                    },
                ],
                agrupamento: 'juntas',
            }),
        ).toThrow('Cadastre pelo menos uma variação com tamanhos válidos.');
    });

    it('normaliza tokens da grade aplicando caixa alta e preenchimento numérico', () => {
        upsertPortfolio.mockReturnValue([]);

        validarEAdicionarProdutoAoPortfolio({
            codigo: '321',
            grade: 'pp, 6, 07, m1',
            variacoes: [
                {
                    ref: '321-b',
                    tamanhos: { pp: 5, '6': 2, '07': 3, m1: 4 },
                },
            ],
            agrupamento: 'juntas',
        });

        expect(upsertPortfolio).toHaveBeenCalledWith(
            {
                codigo: '321',
                grade: ['PP', '06', '07', 'M1'],
                variations: [
                    {
                        ref: '321-b',
                        tamanhos: { PP: 5, '06': 2, '07': 3, M1: 4 },
                    },
                ],
                grouping: 'juntas',
                createdBy: undefined,
            },
            undefined,
        );
    });

    it('interpreta sequências alinhadas à grade com espaços e tabulações', () => {
        upsertPortfolio.mockReturnValue([]);

        const resultado = validarEAdicionarProdutoAoPortfolio({
            codigo: '999',
            grade: 'PP P M G',
            variacoes: [
                {
                    ref: '999-A',
                    tamanhos: '10 20 30 40',
                },
                {
                    ref: '999-B',
                    tamanhos: '5\t\t15\t',
                },
                {
                    ref: '999-C',
                    tamanhos: '7\t8',
                },
            ],
            agrupamento: 'juntas',
        });

        expect(upsertPortfolio).toHaveBeenCalledWith(
            {
                codigo: '999',
                grade: ['PP', 'P', 'M', 'G'],
                variations: [
                    { ref: '999-A', tamanhos: { PP: 10, P: 20, M: 30, G: 40 } },
                    { ref: '999-B', tamanhos: { PP: 5, P: 0, M: 15, G: 0 } },
                    { ref: '999-C', tamanhos: { PP: 7, P: 8, M: 0, G: 0 } },
                ],
                grouping: 'juntas',
                createdBy: undefined,
            },
            undefined,
        );
        expect(resultado.mensagemSucesso).toBe('Produto 999 salvo com variações agrupadas.');
    });
});

describe('GestaoProducaoEstoqueModule - fluxo de salvar rascunho', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        listPortfolio.mockReturnValue([]);
        carregarHistorico.mockReturnValue([]);
        upsertPortfolio.mockImplementation((portfolio) => portfolio);
    });

    it('desabilita salvar sem rascunho e persiste dados quando o formulário está preenchido', async () => {
        const portfolioAtualizado = [
            {
                codigo: '016',
                grade: ['06', '08'],
                variations: [
                    {
                        ref: '016.AZ',
                        tamanhos: { '06': 10, '08': -5 },
                    },
                ],
                agruparVariacoes: true,
            },
        ];

        upsertPortfolio.mockReturnValue(portfolioAtualizado);

        render(
            <GestaoProducaoEstoqueModule
                onNavigateToCrono={null}
                onNavigateToStock={null}
                onNavigateToFichaTecnica={null}
                onNavigateToOperationalSequence={null}
                onNavigateToReports={null}
            />,
        );

        fireEvent.click(screen.getByText('Portfólio de produtos'));

        const salvarButton = screen.getByRole('button', { name: /Salvar alterações/i });
        expect(salvarButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Código do produto base'), { target: { value: '016' } });
        fireEvent.change(
            screen.getByLabelText('Grade (tamanhos separados por espaço, vírgula ou quebra de linha)'),
            { target: { value: '6 8' } },
        );

        fireEvent.change(screen.getByLabelText('Referência da variação 1'), { target: { value: '016.az' } });

        const tamanho06Input = await screen.findByLabelText('Quantidade para tamanho 06 da variação 1');
        const tamanho08Input = await screen.findByLabelText('Quantidade para tamanho 08 da variação 1');

        fireEvent.change(tamanho06Input, { target: { value: '10' } });
        fireEvent.change(tamanho08Input, { target: { value: '-5' } });

        expect(salvarButton).toBeEnabled();

        fireEvent.click(salvarButton);

        await waitFor(() => {
            expect(upsertPortfolio).toHaveBeenCalledWith(
                {
                    codigo: '016',
                    grade: ['06', '08'],
                    variations: [
                        {
                            ref: '016.AZ',
                            tamanhos: { '06': 10, '08': -5 },
                        },
                    ],
                    grouping: 'juntas',
                    createdBy: 'Usuário Teste',
                },
                { actor: 'Usuário Teste' },
            );
        });

        expect(
            await screen.findByText('Rascunho salvo: Produto 016 salvo com variações agrupadas.'),
        ).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByLabelText('Código do produto base')).toHaveValue('');
        });

        expect(salvarButton).toBeDisabled();
    });

    it('permite colar sequências alinhadas à grade para preencher rapidamente os tamanhos', async () => {
        upsertPortfolio.mockReturnValue([]);

        render(
            <GestaoProducaoEstoqueModule
                onNavigateToCrono={null}
                onNavigateToStock={null}
                onNavigateToFichaTecnica={null}
                onNavigateToOperationalSequence={null}
                onNavigateToReports={null}
            />,
        );

        fireEvent.click(screen.getByText('Portfólio de produtos'));

        fireEvent.change(screen.getByLabelText('Código do produto base'), { target: { value: '016' } });
        fireEvent.change(
            screen.getByLabelText('Grade (tamanhos separados por espaço, vírgula ou quebra de linha)'),
            { target: { value: '6 8 10 12 14 16 2 4' } },
        );

        fireEvent.change(screen.getByLabelText('Referência da variação 1'), { target: { value: '016.AZ' } });

        const tamanho06Input = await screen.findByLabelText('Quantidade para tamanho 06 da variação 1');
        const tamanho08Input = await screen.findByLabelText('Quantidade para tamanho 08 da variação 1');
        const tamanho10Input = await screen.findByLabelText('Quantidade para tamanho 10 da variação 1');
        const tamanho12Input = await screen.findByLabelText('Quantidade para tamanho 12 da variação 1');
        const tamanho14Input = await screen.findByLabelText('Quantidade para tamanho 14 da variação 1');
        const tamanho16Input = await screen.findByLabelText('Quantidade para tamanho 16 da variação 1');
        const tamanho02Input = await screen.findByLabelText('Quantidade para tamanho 02 da variação 1');
        const tamanho04Input = await screen.findByLabelText('Quantidade para tamanho 04 da variação 1');

        const clipboardData = {
            getData: jest.fn((type) =>
                type === 'text' || type === 'text/plain'
                    ? '016.AZ\t-7\t-4\t-16\t-6\t11\t4\t-9\t-49'
                    : '',
            ),
        };
        const preventDefault = jest.fn();

        fireEvent.paste(tamanho06Input, { clipboardData, preventDefault });

        expect(clipboardData.getData).toHaveBeenCalled();
        expect(preventDefault).toHaveBeenCalled();

        await waitFor(() => {
            expect(tamanho06Input).toHaveValue('-7');
        });
        expect(tamanho08Input).toHaveValue('-4');
        expect(tamanho10Input).toHaveValue('-16');
        expect(tamanho12Input).toHaveValue('-6');
        expect(tamanho14Input).toHaveValue('11');
        expect(tamanho16Input).toHaveValue('4');
        expect(tamanho02Input).toHaveValue('-9');
        expect(tamanho04Input).toHaveValue('-49');
    });

    it('permite adicionar variações extras e alterar o agrupamento antes de salvar', async () => {
        const portfolioAtualizado = [
            {
                codigo: '099',
                grade: ['06', '08'],
                variations: [
                    { ref: '099.AZ', tamanhos: { '06': 10, '08': 5 } },
                    { ref: '099.PT', tamanhos: { '06': 4, '08': -1 } },
                ],
                grouping: 'separadas',
                agruparVariacoes: false,
            },
        ];

        upsertPortfolio.mockReturnValue(portfolioAtualizado);

        render(
            <GestaoProducaoEstoqueModule
                onNavigateToCrono={null}
                onNavigateToStock={null}
                onNavigateToFichaTecnica={null}
                onNavigateToOperationalSequence={null}
                onNavigateToReports={null}
            />,
        );

        fireEvent.click(screen.getByText('Portfólio de produtos'));

        fireEvent.change(screen.getByLabelText('Código do produto base'), { target: { value: '099' } });
        fireEvent.change(
            screen.getByLabelText('Grade (tamanhos separados por espaço, vírgula ou quebra de linha)'),
            { target: { value: '06 08' } },
        );

        fireEvent.change(screen.getByLabelText('Referência da variação 1'), { target: { value: '099.az' } });

        const primeiroTamanho06 = await screen.findByLabelText('Quantidade para tamanho 06 da variação 1');
        const primeiroTamanho08 = await screen.findByLabelText('Quantidade para tamanho 08 da variação 1');
        fireEvent.change(primeiroTamanho06, { target: { value: '10' } });
        fireEvent.change(primeiroTamanho08, { target: { value: '5' } });

        fireEvent.click(screen.getByRole('button', { name: /Adicionar variação/i }));

        const referenciaSegundaVariacao = await screen.findByLabelText('Referência da variação 2');
        fireEvent.change(referenciaSegundaVariacao, { target: { value: '099.pt' } });

        const segundoTamanho06 = await screen.findByLabelText('Quantidade para tamanho 06 da variação 2');
        const segundoTamanho08 = await screen.findByLabelText('Quantidade para tamanho 08 da variação 2');
        fireEvent.change(segundoTamanho06, { target: { value: '4' } });
        fireEvent.change(segundoTamanho08, { target: { value: '-1' } });

        fireEvent.click(screen.getByLabelText('Separadas'));

        fireEvent.click(screen.getByRole('button', { name: /Salvar alterações/i }));

        await waitFor(() => {
            expect(upsertPortfolio).toHaveBeenCalledWith(
                {
                    codigo: '099',
                    grade: ['06', '08'],
                    variations: [
                        { ref: '099.AZ', tamanhos: { '06': 10, '08': 5 } },
                        { ref: '099.PT', tamanhos: { '06': 4, '08': -1 } },
                    ],
                    grouping: 'separadas',
                    createdBy: 'Usuário Teste',
                },
                { actor: 'Usuário Teste' },
            );
        });

        expect(
            await screen.findByText('Rascunho salvo: Produto 099 salvo com variações separadas.'),
        ).toBeInTheDocument();
    });
});

