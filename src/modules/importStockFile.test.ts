import type { ExtractRawTextResult } from 'mammoth';
import { importStockFile } from './importStockFile';
import { NO_VARIATIONS_FOUND_ERROR, ProductSnapshot } from './types';

jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
}), { virtual: true });

const { extractRawText } = jest.requireMock('mammoth') as { extractRawText: jest.Mock<Promise<ExtractRawTextResult>, any> };

describe('importStockFile', () => {
  beforeEach(() => {
    extractRawText.mockReset();
  });

  const createDocxFile = (): File => ({
    name: 'relatorio.docx',
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  }) as unknown as File;

  const createTxtFile = (text: string): File => ({
    name: 'relatorio.txt',
    text: jest.fn().mockResolvedValue(text),
  }) as unknown as File;

  it('importa arquivos DOCX utilizando o mammoth', async () => {
    extractRawText.mockResolvedValue({
      value: ['1000.AZ', 'GRADE P M G TOTAL', 'A PRODUZIR 1 2 3 6'].join('\n'),
    });

    const snapshots = await importStockFile(createDocxFile());

    expect(extractRawText).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].variations).toHaveLength(1);
    expect(snapshots[0].variations[0].tamanhos).toEqual({ P: 1, M: 2, G: 3 });
  });

  it('importa arquivos TXT com base no parser textual', async () => {
    const snapshots = await importStockFile(
      createTxtFile(['2000.AA', 'GRADE PP P TOTAL', 'A PRODUZIR 2 4 6'].join('\n')),
    );

    expect(snapshots).toEqual([
      expect.objectContaining({
        productCode: '2000',
        variations: [expect.objectContaining({ ref: '2000.AA', total: 6 })],
      }),
    ]);
  });

  it('lança erro quando nenhuma variação é encontrada', async () => {
    extractRawText.mockResolvedValue({ value: '' });

    await expect(importStockFile(createDocxFile())).rejects.toMatchObject({ code: NO_VARIATIONS_FOUND_ERROR });
  });

  it('respeita a ordenação de produtos informada nas opções', async () => {
    extractRawText.mockResolvedValue({
      value: [
        '2000.AA',
        'GRADE P M TOTAL',
        'A PRODUZIR 1 2 3',
        '1000.BB',
        'GRADE PP P TOTAL',
        'A PRODUZIR 4 5 9',
      ].join('\n'),
    });

    const snapshots = await importStockFile(createDocxFile(), { productOrder: ['1000', '2000'] });

    expect(snapshots.map((snapshot: ProductSnapshot) => snapshot.productCode)).toEqual(['1000', '2000']);
  });

  it('rejeita extensões não suportadas', async () => {
    const unsupported = { name: 'arquivo.pdf' } as unknown as File;
    await expect(importStockFile(unsupported)).rejects.toThrow('Tipo de arquivo não suportado');
  });
});
