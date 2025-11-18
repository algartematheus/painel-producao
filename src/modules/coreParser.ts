import { ProductSnapshot, TextParserOptions, VariationSnapshot } from './types';

interface ColumnLayoutSize {
  label: string;
  start: number;
  end: number;
}

interface ColumnLayout {
  sizes: ColumnLayoutSize[];
  margin: number;
}

interface ParsedVariation {
  ref: string;
  grade: string[];
  tamanhos: Record<string, number>;
  lastTotalEstoqueLine?: string;
  columnLayout?: ColumnLayout | null;
}

interface ParsedProduct {
  productCode: string;
  grade: string[];
  variations: ParsedVariation[];
  warnings: string[];
}

const VARIATION_ONLY_REGEX = /^\s*(\d{3,}[A-Z]?\.[A-Z0-9]+)\s*$/;
const BASE_ONLY_REGEX = /^\s*(\d{3,}[A-Z]?)\s*$/;
const GRADE_HEADER_REGEX = /^\s*Grade:\s*\d+\s*-\s*(.+?)\s*$/i;
const QTDE_HEADER_REGEX = /\bQtde\b/i;
const PRODUCE_REGEX = /A\s+PRODUZIR:/i;
const TOTAL_GRADE_REGEX = /^\s*TOTAL\s+GRADE:/i;
const TOTAL_ESTOQUES_REGEX = /TOTAL\s+ESTOQUES/i;

interface NumberToken {
  value: number;
  index: number;
}

const DEFAULT_ALIGNMENT_DISTANCE = 3;

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

const cloneColumnLayout = (layout?: ColumnLayout | null): ColumnLayout | null => {
  if (!layout?.sizes?.length) {
    return null;
  }

  return {
    sizes: layout.sizes.map((size) => ({ ...size })),
    margin: layout.margin,
  };
};

const parseColumnLayoutFromQtdeLine = (line: string, gradeTokens: string[]): ColumnLayout | null => {
  if (!line || !gradeTokens.length) {
    return null;
  }

  const qtdeIndex = line.toLowerCase().indexOf('qtde');
  if (qtdeIndex < 0) {
    return null;
  }

  const regex = /([0-9A-Za-zÁ-ú]+)/g;
  let match: RegExpExecArray | null = regex.exec(line);
  let seenQtde = false;
  const entries: { raw: string; start: number }[] = [];

  while (match) {
    const rawToken = match[1];
    const start = match.index;

    if (!seenQtde) {
      if (/^qtde$/i.test(rawToken)) {
        seenQtde = true;
      }
      match = regex.exec(line);
      continue;
    }

    entries.push({ raw: rawToken, start });
    match = regex.exec(line);
  }

  if (!entries.length) {
    return null;
  }

  const sizes: ColumnLayoutSize[] = [];
  let gradeIndex = 0;

  for (let i = 0; i < entries.length && gradeIndex < gradeTokens.length; i += 1) {
    const entry = entries[i];
    const normalized = normalizeSizeLabel(entry.raw);
    if (!normalized) {
      continue;
    }

    if (normalized === gradeTokens[gradeIndex]) {
      sizes.push({ label: normalized, start: entry.start, end: entry.start });
      gradeIndex += 1;
    }
  }

  if (sizes.length !== gradeTokens.length) {
    return null;
  }

  const resolvedSizes = sizes.map((size, index) => ({
    label: size.label,
    start: size.start,
    end: index + 1 < sizes.length ? sizes[index + 1].start : line.length,
  }));

  return { sizes: resolvedSizes, margin: resolvedSizes[0]?.start ?? qtdeIndex };
};

const extractNumbersAfterColon = (line: string): number[] => {
  const index = line.indexOf(':');
  const slice = index >= 0 ? line.slice(index + 1) : line;
  const matches = slice.match(/-?\d+/g) || [];
  return matches.map((value) => parseInt(value, 10));
};

const extractNumberTokensWithIndex = (line: string): NumberToken[] => {
  if (typeof line !== 'string') {
    return [];
  }
  const tokens: NumberToken[] = [];
  const regex = /-?\d+/g;
  let match: RegExpExecArray | null = regex.exec(line);
  while (match) {
    tokens.push({ value: parseInt(match[0], 10), index: match.index });
    match = regex.exec(line);
  }
  return tokens;
};

const mapProduceLineToSizesByColumns = (
  grade: string[],
  produceLine: string,
  totalLine: string,
  distanceThreshold = DEFAULT_ALIGNMENT_DISTANCE,
): number[] | null => {
  if (!grade.length || !totalLine) {
    return null;
  }
  const totalTokens = extractNumberTokensWithIndex(totalLine);
  if (totalTokens.length < grade.length + 1) {
    return null;
  }
  const columnTokens = totalTokens.slice(1, grade.length + 1);
  if (columnTokens.length !== grade.length) {
    return null;
  }
  const produceTokens = extractNumberTokensWithIndex(produceLine);
  if (!produceTokens.length) {
    return null;
  }
  const sizeTokens = produceTokens.slice(1);
  const perSizeValues: number[] = [];
  let sizeIndex = 0;

  for (let i = 0; i < columnTokens.length; i += 1) {
    const columnToken = columnTokens[i];
    let assignedValue = 0;
    const currentSizeToken = sizeTokens[sizeIndex];
    if (currentSizeToken) {
      const distance = Math.abs(currentSizeToken.index - columnToken.index);
      if (distance <= distanceThreshold) {
        assignedValue = currentSizeToken.value;
        sizeIndex += 1;
      } else if (currentSizeToken.index < columnToken.index) {
        return null;
      }
    }
    perSizeValues.push(assignedValue);
  }

  return perSizeValues;
};

const mapLineToGradeUsingLayout = (
  line: string,
  grade: string[],
  layout?: ColumnLayout | null,
): number[] | null => {
  if (!layout?.sizes?.length || !grade.length) {
    return null;
  }

  const colonIndex = line.indexOf(':');
  const layoutMargin = layout.margin ?? layout.sizes[0]?.start ?? 0;
  const dataStart = colonIndex >= 0 ? colonIndex + 1 : 0;
  let dataSlice = colonIndex >= 0 ? line.slice(colonIndex + 1) : line;

  const offset = layoutMargin - dataStart;
  if (offset > 0) {
    dataSlice = `${' '.repeat(offset)}${dataSlice}`;
  } else if (offset < 0) {
    dataSlice = dataSlice.slice(Math.min(-offset, dataSlice.length));
  }
  const perSizeValues: number[] = [];

  for (let i = 0; i < grade.length; i += 1) {
    const size = grade[i];
    const column = layout.sizes.find((entry) => entry.label === size);
    if (!column) {
      return null;
    }
    const relativeStart = Math.max(column.start - layoutMargin, 0);
    const relativeEnd = Math.max(column.end - layoutMargin, relativeStart);
    const slice = dataSlice.slice(relativeStart, relativeEnd).trim();
    const match = slice.match(/-?\d+/);
    perSizeValues.push(match ? parseInt(match[0], 10) : 0);
  }

  return perSizeValues;
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
  columnLayoutFromContext?: ColumnLayout | null,
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
      columnLayout: cloneColumnLayout(columnLayoutFromContext),
    };
    product.variations.push(variation);
  } else if (!variation.grade.length) {
    if (gradeFromContext?.length) {
      variation.grade = cloneGrade(gradeFromContext);
    } else if (product.grade.length) {
      variation.grade = cloneGrade(product.grade);
    }
  }

  if (columnLayoutFromContext?.sizes.length) {
    variation.columnLayout = cloneColumnLayout(columnLayoutFromContext);
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
    if (/^\d+$/.test(token)) {
      const normalizedNumber = String(parseInt(token, 10)).padStart(2, '0');
      acc.push(normalizedNumber);
      return acc;
    }

    const alphaToken = token.replace(/[^a-z]/gi, '').toUpperCase();
    if (!alphaToken) {
      return acc;
    }

    if (alphaToken === 'UNICA') {
      acc.push('UN');
      return acc;
    }

    if (/^[A-Z]+$/.test(alphaToken)) {
      acc.push(alphaToken);
    }

    return acc;
  }, []);
};

const parseLinesIntoProducts = (lines: string[]): Map<string, ParsedProduct> => {
  const productsMap = new Map<string, ParsedProduct>();
  let currentGrade: string[] | null = null;
  let currentVariation: ParsedVariation | null = null;
  let currentColumnLayout: ColumnLayout | null = null;

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
          .filter(Boolean);
      }
      currentVariation = null;
      currentColumnLayout = null;
      return;
    }

    if (TOTAL_GRADE_REGEX.test(line)) {
      currentVariation = null;
      return;
    }

    if (QTDE_HEADER_REGEX.test(line)) {
      const qtdeGradeTokens = extractGradeTokensFromQtdeLine(line);
      const columnLayout = parseColumnLayoutFromQtdeLine(line, qtdeGradeTokens);
      currentColumnLayout = columnLayout;
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
          if (columnLayout?.sizes.length) {
            currentVariation.columnLayout = cloneColumnLayout(columnLayout);
          }
        }
      }

      const baseMatch = line.match(/^\s*(\d{3,}[A-Z]?)\b.*Qtde\s+UN\b/i);
      if (baseMatch && currentGrade?.length === 1) {
        currentVariation = createOrGetVariation(
          productsMap,
          baseMatch[1],
          currentGrade,
          currentColumnLayout,
        );
        return;
      }

      const variationMatch = line.match(/^\s*(\d{3,}[A-Z]?\.[A-Z0-9]+)\b.*Qtde\b/i);
      if (variationMatch) {
        currentVariation = createOrGetVariation(
          productsMap,
          variationMatch[1],
          currentGrade,
          currentColumnLayout,
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
        currentColumnLayout,
      );
      return;
    }

    if (currentVariation && TOTAL_ESTOQUES_REGEX.test(line)) {
      currentVariation.lastTotalEstoqueLine = line;
      return;
    }

    if (!currentVariation) {
      const baseMatch = line.match(BASE_ONLY_REGEX);
      if (baseMatch && currentGrade?.length === 1) {
        currentVariation = createOrGetVariation(
          productsMap,
          baseMatch[1],
          currentGrade,
          currentColumnLayout,
        );
        return;
      }
    }

    if (currentVariation && PRODUCE_REGEX.test(line)) {
      const grade = currentVariation.grade.length ? currentVariation.grade : cloneGrade(currentGrade);
      if (!currentVariation.grade.length && grade.length) {
        currentVariation.grade = grade.slice();
      }
      const prodTokens = extractNumbersAfterColon(line);
      let perSizeValues: number[] = [];

      if (grade.length <= 1) {
        const lastValue = prodTokens[prodTokens.length - 1];
        perSizeValues = [typeof lastValue === 'number' ? lastValue : 0];
      } else {
        const layoutValues = currentVariation.columnLayout
          ? mapLineToGradeUsingLayout(line, grade, currentVariation.columnLayout)
          : null;

        if (layoutValues && layoutValues.length === grade.length) {
          perSizeValues = layoutValues;
        } else {
          let alignedValues: number[] | null = null;
          if (
            currentVariation.lastTotalEstoqueLine &&
            prodTokens.length !== grade.length + 1
          ) {
            alignedValues = mapProduceLineToSizesByColumns(
              grade,
              line,
              currentVariation.lastTotalEstoqueLine,
            );
          }

          if (alignedValues && alignedValues.length === grade.length) {
            perSizeValues = alignedValues;
          } else if (prodTokens.length === grade.length + 1) {
            perSizeValues = prodTokens.slice(1);
          } else if (prodTokens.length >= grade.length) {
            perSizeValues = prodTokens.slice(prodTokens.length - grade.length);
          } else {
            perSizeValues = Array.from({ length: grade.length }, (_, index) => prodTokens[index] ?? 0);
          }
        }
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
