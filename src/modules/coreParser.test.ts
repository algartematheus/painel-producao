import { convertBlocksToSnapshots, parseTextContent } from './coreParser';
import { RawParsedBlock } from './types';

describe('coreParser', () => {
  it('converte texto em snapshots agrupados com avisos de grade', () => {
    const text = [
      '1234.AZ CAMISA',
      'GRADE PP P M G GG TOTAL',
      'A PRODUZIR 5 10 15 20 50 100',
      '1234.BY CALÇA',
      'GRADE 34 36 38 40 TOTAL',
      'A PRODUZIR 2 4 6 8 20',
      '6789.CX BLUSA',
      'GRADE P M G GG TOTAL',
      'A PRODUZIR 1 2 3 4 10',
    ].join('\n');

    const snapshots = parseTextContent(text);

    expect(snapshots).toEqual([
      {
        productCode: '1234',
        grade: ['PP', 'P', 'M', 'G', 'GG'],
        warnings: [
          'Grade divergente detectada para 1234.BY: [34, 36, 38, 40] (mantida grade original [PP, P, M, G, GG])',
        ],
        variations: [
          {
            ref: '1234.AZ',
            grade: ['PP', 'P', 'M', 'G', 'GG'],
            tamanhos: { PP: 5, P: 10, M: 15, G: 20, GG: 50 },
            total: 100,
          },
          {
            ref: '1234.BY',
            grade: ['34', '36', '38', '40'],
            tamanhos: { '34': 2, '36': 4, '38': 6, '40': 8 },
            total: 20,
          },
        ],
      },
      {
        productCode: '6789',
        grade: ['P', 'M', 'G', 'GG'],
        warnings: [],
        variations: [
          {
            ref: '6789.CX',
            grade: ['P', 'M', 'G', 'GG'],
            tamanhos: { P: 1, M: 2, G: 3, GG: 4 },
            total: 10,
          },
        ],
      },
    ]);
  });

  it('respeita a ordenação de produtos fornecida', () => {
    const blocks: RawParsedBlock[] = [
      {
        reference: '2000.AA',
        productCode: '2000',
        grade: ['P', 'M'],
        quantities: [1, 2],
        total: 3,
        tamanhos: { P: 1, M: 2 },
        lines: [],
      },
      {
        reference: '1000.AB',
        productCode: '1000',
        grade: ['PP', 'P'],
        quantities: [2, 3],
        total: 5,
        tamanhos: { PP: 2, P: 3 },
        lines: [],
      },
    ];

    const snapshots = convertBlocksToSnapshots(blocks, { productOrder: ['1000', '2000'] });

    expect(snapshots.map((snapshot) => snapshot.productCode)).toEqual(['1000', '2000']);
  });
});
