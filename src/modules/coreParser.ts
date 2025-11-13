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

const VARIATION_ONLY_REGEX = /^\s*(\d{3,}\.[A-Z0-9]{2,3})\s*$/;
const BASE_ONLY_REGEX = /^\s*(\d{3,})\s*$/;
const GRADE_HEADER_REGEX = /^\s*Grade:\s*\d+\s*-\s*(.+?)\s*$/i;
const QTDE_HEADER_REGEX = /\bQtde\b/i;
const PRODUCE_REGEX = /A\s+PRODUZIR:/i;
const TOTAL_GRADE_REGEX = /^\s*TOTAL\s+GRADE:/i;

const normalizeLines = (text: string): string[] => {
  if (typeof text !== 'string') {
    return [];
  }
  return text.replace(/\r\n/g, '\n').split('\n');
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
  const codeMatch = ref.match(/^(\d{3,})/);
  if (!codeMatch) {
    return null;
  }
  const productCode = codeMatch[1];
  const product = createOrGetProduct(productsMap, productCode, gradeFromContext);
  let variation = product.variations.find((entry) => entry.ref === ref);
  if (!variation) {
    variation = {
      ref,
      grade: cloneGrade(gradeFromContext) || cloneGrade(product.grade),
      tamanhos: {},
    };
    product.variations.push(variation);
  } else if (!variation.grade.length && gradeFromContext?.length) {
    variation.grade = cloneGrade(gradeFromContext);
  }
  return variation;
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
          .split(/[\/\s]+/)
          .map((token) => token.trim())
          .filter(Boolean);
      }
      currentVariation = null;
      return;
    }

    if (TOTAL_GRADE_REGEX.test(line)) {
      currentVariation = null;
      return;
    }

    if (QTDE_HEADER_REGEX.test(line)) {
      const baseMatch = line.match(/^\s*(\d{3,})\b.*Qtde\s+UN\b/i);
      if (baseMatch && currentGrade?.length === 1) {
        currentVariation = createOrGetVariation(productsMap, baseMatch[1], currentGrade);
        return;
      }

      const variationMatch = line.match(/^\s*(\d{3,}\.[A-Z0-9]{2,3})\b.*Qtde\b/i);
      if (variationMatch) {
        currentVariation = createOrGetVariation(productsMap, variationMatch[1], currentGrade);
        return;
      }
    }

    const refOnlyMatch = line.match(VARIATION_ONLY_REGEX);
    if (refOnlyMatch) {
      currentVariation = createOrGetVariation(productsMap, refOnlyMatch[1], currentGrade);
      return;
    }

    if (!currentVariation) {
      const baseMatch = line.match(BASE_ONLY_REGEX);
      if (baseMatch && currentGrade?.length === 1) {
        currentVariation = createOrGetVariation(productsMap, baseMatch[1], currentGrade);
        return;
      }
    }

    if (currentVariation && PRODUCE_REGEX.test(line)) {
      const grade = currentVariation.grade.length ? currentVariation.grade : cloneGrade(currentGrade);
      if (!currentVariation.grade.length && grade.length) {
        currentVariation.grade = grade.slice();
      }
      const numbers = extractNumbersAfterColon(line);
      let perSizeValues: number[] = [];

      if (grade.length <= 1) {
        const lastValue = numbers[numbers.length - 1];
        perSizeValues = [typeof lastValue === 'number' ? lastValue : 0];
      } else if (numbers.length === grade.length + 1) {
        perSizeValues = numbers.slice(1);
      } else if (numbers.length >= grade.length) {
        perSizeValues = numbers.slice(numbers.length - grade.length);
      } else {
        perSizeValues = Array.from({ length: grade.length }, (_, index) => numbers[index] ?? 0);
      }

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
