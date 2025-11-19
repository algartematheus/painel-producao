import { ProductSnapshot, TextParserOptions, VariationSnapshot } from './types';

interface ParsedVariation {
  ref: string;
  grade: string[];
  tamanhos: Record<string, number>;
}

interface ParsedProduct {
  productCode: string;
  grade: string[];
  variations: ParsedVariation[];
  warnings: string[];
}

const VARIATION_REGEX = /(\d{3,}[A-Z]?\.[A-Z0-9]+)/;
const VARIATION_ONLY_REGEX = /^\s*(\d{3,}[A-Z]?\.[A-Z0-9]+)\s*$/;
const BASE_ONLY_REGEX = /^\s*(\d{3,}[A-Z]?)\s*$/;
const GRADE_HEADER_REGEX = /^\s*Grade:\s*\d+\s*-\s*(.+?)\s*$/i;
const QTDE_HEADER_REGEX = /\bQtde\b/i;
const PRODUCE_REGEX = /A\s+PRODUZIR:/i;
const PARTIAL_PRODUCE_REGEX = /PARCIAL\s*\(\d+\)\s*:/i;
const TOTAL_GRADE_REGEX = /^\s*TOTAL\s+GRADE:/i;
const TOTAL_ESTOQUES_REGEX = /TOTAL\s+ESTOQUES/i;

const normalizeLines = (text: string): string[] => {
  if (typeof text !== 'string') {
    return [];
  }
  return text.replace(/\r\n/g, '\n').split('\n');
};

const normalizeSizeLabel = (token: string): string | null => {
  if (!token) {
    return null;
  }

  if (/^\d+$/.test(token)) {
    return String(parseInt(token, 10)).padStart(2, '0');
  }

  const alphaToken = token.replace(/[^a-z]/gi, '').toUpperCase();
  if (!alphaToken) {
    return null;
  }

  if (alphaToken === 'UNICA') {
    return 'UN';
  }

  if (/^[A-Z]+$/.test(alphaToken)) {
    return alphaToken;
  }

  return null;
};

const extractNumbersAfterColon = (line: string): number[] => {
  const index = line.indexOf(':');
  const slice = index >= 0 ? line.slice(index + 1) : line;
  const matches = slice.match(/-?\d+/g) || [];
  return matches.map((value) => parseInt(value, 10));
};

const cloneGrade = (grade?: string[] | null): string[] => {
  if (!Array.isArray(grade)) {
    return [];
  }
  return grade.filter((token) => token.length);
};

const createOrGetProduct = (
  productsMap: Map<string, ParsedProduct>,
  productCode: string,
  gradeFromContext?: string[] | null,
): ParsedProduct => {
  if (!productsMap.has(productCode)) {
    productsMap.set(productCode, {
      productCode,
      grade: cloneGrade(gradeFromContext),
      variations: [],
      warnings: [],
    });
  }
  const product = productsMap.get(productCode)!;
  if (!product.grade.length && gradeFromContext?.length) {
    product.grade = cloneGrade(gradeFromContext);
  }
  return product;
};

const createOrGetVariation = (
  productsMap: Map<string, ParsedProduct>,
  ref: string,
  gradeFromContext?: string[] | null,
): ParsedVariation | null => {
  const codeMatch = ref.match(/^(\d{3,}[A-Z]?)/);
  if (!codeMatch) {
    return null;
  }
  const productCode = codeMatch[1];
  const product = createOrGetProduct(productsMap, productCode, gradeFromContext);
  let variation = product.variations.find((entry) => entry.ref === ref);
  if (!variation) {
    const grade = gradeFromContext?.length
      ? cloneGrade(gradeFromContext)
      : cloneGrade(product.grade);
    variation = {
      ref,
      grade,
      tamanhos: {},
    };
    product.variations.push(variation);
  } else if (!variation.grade.length) {
    if (gradeFromContext?.length) {
      variation.grade = cloneGrade(gradeFromContext);
    } else if (product.grade.length) {
      variation.grade = cloneGrade(product.grade);
    }
  }

  return variation;
};

const extractGradeTokensFromQtdeLine = (line: string): string[] => {
  const qtdeIndex = line.toLowerCase().indexOf('qtde');
  if (qtdeIndex < 0) {
    return [];
  }
  const afterQtde = line.slice(qtdeIndex + 4).trim();
  if (!afterQtde) {
    return [];
  }
  const tokens = afterQtde
    .split(/[/\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return tokens.reduce<string[]>((acc, token) => {
    const normalized = normalizeSizeLabel(token);
    if (normalized) {
      acc.push(normalized);
    }
    return acc;
  }, []);
};

const mapNumbersToGrade = (grade: string[], numbers: number[]): number[] => {
  if (!grade.length) {
    return [];
  }

  let values = numbers.slice();
  if (values.length > grade.length) {
    values = values.slice(1);
  }

  if (values.length > grade.length) {
    values = values.slice(0, grade.length);
  }

  if (values.length < grade.length) {
    values = values.concat(Array.from({ length: grade.length - values.length }, () => 0));
  }

  return values;
};

const parseLinesIntoProducts = (lines: string[]): Map<string, ParsedProduct> => {
  const productsMap = new Map<string, ParsedProduct>();
  let currentGrade: string[] | null = null;
  let currentVariation: ParsedVariation | null = null;

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\s+$/g, '');
    if (!line) {
      return;
    }

    const gradeMatch = line.match(GRADE_HEADER_REGEX);
    if (gradeMatch) {
      const desc = gradeMatch[1].trim();
      if (/UNICA/i.test(desc)) {
        currentGrade = ['UN'];
      } else {
        currentGrade = desc
          .split(/[/\s]+/)
          .map((token) => token.trim())
          .reduce<string[]>((acc, token) => {
            const normalized = normalizeSizeLabel(token);
            if (normalized) {
              acc.push(normalized);
            }
            return acc;
          }, []);
      }

      const inlineVariationMatch = line.match(VARIATION_REGEX);
      currentVariation = inlineVariationMatch
        ? createOrGetVariation(productsMap, inlineVariationMatch[1], currentGrade)
        : null;
      return;
    }

    if (TOTAL_GRADE_REGEX.test(line) || TOTAL_ESTOQUES_REGEX.test(line)) {
      return;
    }

    if (QTDE_HEADER_REGEX.test(line)) {
      const qtdeGradeTokens = extractGradeTokensFromQtdeLine(line);
      if (qtdeGradeTokens.length) {
        currentGrade = qtdeGradeTokens.slice();
        if (currentVariation) {
          currentVariation.grade = qtdeGradeTokens.slice();
          const productCodeMatch = currentVariation.ref.match(/^(\d{3,}[A-Z]?)/);
          if (productCodeMatch) {
            const product = productsMap.get(productCodeMatch[1]);
            if (product) {
              product.grade = qtdeGradeTokens.slice();
            }
          }
        }
      }

      const variationInQtdeLine = line.match(/^(\s*\d{3,}[A-Z]?\.[A-Z0-9]+).*Qtde/i);
      const baseMatch = line.match(/^(\s*\d{3,}[A-Z]?).*Qtde\s+UN\b/i);
      if (variationInQtdeLine) {
        currentVariation = createOrGetVariation(
          productsMap,
          variationInQtdeLine[1].trim(),
          currentGrade,
        );
        return;
      }

      if (baseMatch && currentGrade?.length === 1) {
        currentVariation = createOrGetVariation(
          productsMap,
          baseMatch[1].trim(),
          currentGrade,
        );
        return;
      }
    }

    const refOnlyMatch = line.match(VARIATION_ONLY_REGEX);
    if (refOnlyMatch) {
      currentVariation = createOrGetVariation(
        productsMap,
        refOnlyMatch[1],
        currentGrade,
      );
      return;
    }

    if (!currentVariation) {
      const baseMatch = line.match(BASE_ONLY_REGEX);
      if (baseMatch && currentGrade?.length === 1) {
        currentVariation = createOrGetVariation(productsMap, baseMatch[1], currentGrade);
        return;
      }
    }

    if (currentVariation && (PRODUCE_REGEX.test(line) || PARTIAL_PRODUCE_REGEX.test(line))) {
      const grade = currentVariation.grade.length ? currentVariation.grade : cloneGrade(currentGrade);
      if (!currentVariation.grade.length && grade.length) {
        currentVariation.grade = grade.slice();
      }

      const numbers = extractNumbersAfterColon(line);
      const perSizeValues = mapNumbersToGrade(grade, numbers);

      currentVariation.tamanhos = grade.reduce<Record<string, number>>((acc, size, index) => {
        acc[size] = perSizeValues[index] ?? 0;
        return acc;
      }, {});
    }
  });

  return productsMap;
};

const buildSnapshotsFromMap = (productsMap: Map<string, ParsedProduct>): ProductSnapshot[] => {
  return Array.from(productsMap.values()).map((product) => {
    const grade = cloneGrade(product.grade);
    const variations: VariationSnapshot[] = product.variations.map((variation) => {
      const variationGrade = variation.grade.length ? variation.grade : grade;
      const tamanhos = { ...variation.tamanhos };
      const total = Object.values(tamanhos).reduce((sum, value) => sum + (value || 0), 0);
      return {
        ref: variation.ref,
        grade: variationGrade.slice(),
        tamanhos,
        total,
      };
    });
    return {
      productCode: product.productCode,
      grade,
      variations,
      warnings: product.warnings.slice(),
    };
  });
};

const applyProductOrdering = (snapshots: ProductSnapshot[], options?: TextParserOptions): ProductSnapshot[] => {
  if (!options?.productOrder?.length) {
    return snapshots;
  }
  const orderMap = new Map(options.productOrder.map((code, index) => [code, index]));
  return snapshots.slice().sort((a, b) => {
    const orderA = orderMap.get(a.productCode);
    const orderB = orderMap.get(b.productCode);
    if (typeof orderA === 'number' && typeof orderB === 'number') {
      return orderA - orderB;
    }
    if (typeof orderA === 'number') {
      return -1;
    }
    if (typeof orderB === 'number') {
      return 1;
    }
    return 0;
  });
};

export const parseTextContent = (text: string, options?: TextParserOptions): ProductSnapshot[] => {
  const lines = normalizeLines(text);
  const productsMap = parseLinesIntoProducts(lines);
  const snapshots = buildSnapshotsFromMap(productsMap);
  return applyProductOrdering(snapshots, options);
};

export default parseTextContent;
