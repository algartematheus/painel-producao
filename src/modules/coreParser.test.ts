import { parseTextContent } from './coreParser';
import { ProductSnapshot } from './types';

describe('coreParser', () => {
  it('interpreta relatórios TXT com produtos UN e grades numéricas', () => {
    const text = [
      'Grade: 2 - UNICA',
      'Qtde         UN',
      '300',
      'A PRODUZIR: -456',
      'Grade: 3 - 06/08/10/12/14/16/02/04',
      'Qtde             06  08  10  12  14  16  02  04',
      '016.AZ',
      'A PRODUZIR: -301 -50 -5  -15 -37 -51 -95 -28 -20',
      'Qtde             06  08  10  12  14  16  02  04',
      '016.DV',
      'A PRODUZIR: -210 -10 -20 -30 -40 -50 -20 -20 -20',
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
    ]);
  });

  it('captura referência na linha da grade e ignora totais extras na linha de produção', () => {
    const text = [
      'Grade: 3 - 04/06/08',
      'Qtde           04 06 08',
      '123.AB',
      'A PRODUZIR: 60 10 20 30 999',
    ].join('\n');

    const snapshots = parseTextContent(text);

    expect(snapshots).toEqual([
      {
        productCode: '123',
        grade: ['04', '06', '08'],
        warnings: [],
        variations: [
          {
            ref: '123.AB',
            grade: ['04', '06', '08'],
            tamanhos: { '04': 10, '06': 20, '08': 30 },
            total: 60,
          },
        ],
      },
    ]);
  });

  it('captura referência na mesma linha do cabeçalho Qtde e descarta totais adicionais', () => {
    const text = [
      'Grade: 3 - 04/06/08',
      '123.AC Qtde       04  06 08',
      'A PRODUZIR: 100    5  15 20 999',
    ].join('\n');

    const snapshots = parseTextContent(text);

    expect(snapshots).toEqual([
      {
        productCode: '123',
        grade: ['04', '06', '08'],
        warnings: [],
        variations: [
          {
            ref: '123.AC',
            grade: ['04', '06', '08'],
            tamanhos: { '04': 5, '06': 15, '08': 20 },
            total: 40,
          },
        ],
      },
    ]);
  });

  it('infere grade numérica a partir da linha Qtde', () => {
    const text = [
      'Grade: 0 -',
      'Qtde             50  52  54  56  58  60',
      '123.AB',
      'A PRODUZIR: -210 -10 -20 -30 -40 -50 -60',
    ].join('\n');

    const snapshots = parseTextContent(text);

    expect(snapshots).toEqual([
      {
        productCode: '123',
        grade: ['50', '52', '54', '56', '58', '60'],
        warnings: [],
        variations: [
          {
            ref: '123.AB',
            grade: ['50', '52', '54', '56', '58', '60'],
            tamanhos: {
              '50': -10,
              '52': -20,
              '54': -30,
              '56': -40,
              '58': -50,
              '60': -60,
            },
            total: -210,
          },
        ],
      },
    ]);
  });

  it('normaliza grades alfabéticas a partir da linha Qtde', () => {
    const text = [
      'Grade: 0 -',
      'Qtde             PP  P   M   G   GG',
      '456.BR',
      'A PRODUZIR: -150 -10 -20 -30 -40 -50',
    ].join('\n');

    const snapshots = parseTextContent(text);

    expect(snapshots).toEqual([
      {
        productCode: '456',
        grade: ['PP', 'P', 'M', 'G', 'GG'],
        warnings: [],
        variations: [
          {
            ref: '456.BR',
            grade: ['PP', 'P', 'M', 'G', 'GG'],
            tamanhos: { PP: -10, P: -20, M: -30, G: -40, GG: -50 },
            total: -150,
          },
        ],
      },
    ]);
  });

  it('aplica ordenação de produtos informada nas opções', () => {
    const text = [
      'Grade: 2 - UNICA',
      'Qtde         UN',
      '200',
      'A PRODUZIR: 5',
      'Grade: 2 - UNICA',
      'Qtde         UN',
      '100',
      'A PRODUZIR: 10',
    ].join('\n');

    const snapshots = parseTextContent(text, { productOrder: ['100', '200'] });

    expect(snapshots.map((snapshot) => snapshot.productCode)).toEqual(['100', '200']);
  });
});
