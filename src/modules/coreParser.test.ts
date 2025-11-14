import { parseTextContent } from './coreParser';
import { ProductSnapshot } from './types';

describe('coreParser', () => {
  it('interpreta relatórios TXT com produtos UN e grades numéricas', () => {
    const text = [
      'Grade: 2 - UNICA',
      '300',
      'Qtde UN',
      'A PRODUZIR: -456',
      'Grade: 3 - 06/08/10/12/14/16/02/04',
      '016.AZ',
      'Qtde 06 08 10 12 14 16 02 04',
      'A PRODUZIR: -301 -50 -5 -15 -37 -51 -28 -20 -95',
      '016.DV',
      'A PRODUZIR: -200 -10 -20 -30 -40 -50 -20 -10 -20',
    ].join('\n');

    const snapshots = parseTextContent(text);

    expect(snapshots).toEqual([
      {
        productCode: '300',
        grade: ['UN'],
        warnings: [],
        variations: [
          {
            ref: '300',
            grade: ['UN'],
            tamanhos: { UN: -456 },
            total: -456,
          },
        ],
      },
      {
        productCode: '016',
        grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
        warnings: [],
        variations: [
          {
            ref: '016.AZ',
            grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
            tamanhos: { '02': -28, '04': -20, '06': -50, '08': -5, '10': -15, '12': -37, '14': -51, '16': -95 },
            total: -301,
          },
          {
            ref: '016.DV',
            grade: ['06', '08', '10', '12', '14', '16', '02', '04'],
            tamanhos: {
              '02': -20,
              '04': -20,
              '06': -10,
              '08': -20,
              '10': -30,
              '12': -40,
              '14': -50,
              '16': -20,
            },
            total: -210,
          },
        ],
      },
    ] as ProductSnapshot[]);
  });

  it('aplica ordenação de produtos informada nas opções', () => {
    const text = [
      'Grade: 2 - UNICA',
      '200',
      'Qtde UN',
      'A PRODUZIR: 5',
      'Grade: 2 - UNICA',
      '100',
      'Qtde UN',
      'A PRODUZIR: 10',
    ].join('\n');

    const snapshots = parseTextContent(text, { productOrder: ['100', '200'] });

    expect(snapshots.map((snapshot) => snapshot.productCode)).toEqual(['100', '200']);
  });

  it('interpreta bases alfanuméricas com e sem sufixo', () => {
    const text = [
      'Grade: 2 - UNICA',
      '010E',
      'Qtde UN',
      'A PRODUZIR: 5',
      '010E.AZ',
      'Qtde UN',
      'A PRODUZIR: 7',
      'Grade: 3 - 06/08/10',
      '016.AZ',
      'Qtde 06 08 10',
      'A PRODUZIR: -60 -10 -20 -30',
    ].join('\n');

    const snapshots = parseTextContent(text);

    expect(snapshots).toEqual([
      {
        productCode: '010E',
        grade: ['UN'],
        warnings: [],
        variations: [
          { ref: '010E', grade: ['UN'], tamanhos: { UN: 5 }, total: 5 },
          { ref: '010E.AZ', grade: ['UN'], tamanhos: { UN: 7 }, total: 7 },
        ],
      },
      {
        productCode: '016',
        grade: ['06', '08', '10'],
        warnings: [],
        variations: [
          {
            ref: '016.AZ',
            grade: ['06', '08', '10'],
            tamanhos: { '06': -10, '08': -20, '10': -30 },
            total: -60,
          },
        ],
      },
    ] as ProductSnapshot[]);
  });
});
