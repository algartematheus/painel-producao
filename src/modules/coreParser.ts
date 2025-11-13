import { ProductSnapshot, RawParsedBlock, TextParserOptions, VariationSnapshot } from './types';
import {
  extractGradeTokens,
  extractProduceQuantities,
  extractReferenceFromLine,
  isLikelyGradeLine,
  isProduceLine,
  normalizeProductCode,
  splitIntoNormalizedLines,
} from './textUtils';

const MAX_LOOKBACK = 6;

const inferGradeFromQuantities = (count: number): string[] => {
  return Array.from({ length: count }, (_, index) => `COL${index + 1}`);
};

const buildVariationFromBlock = (block: RawParsedBlock): VariationSnapshot => ({
  ref: block.reference,
  grade: block.grade.slice(),
  tamanhos: block.tamanhos,
  total: block.total,
});

const areGradesEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((token, index) => token === b[index]);
};

const applyProductOrdering = (snapshots: ProductSnapshot[], options?: TextParserOptions): ProductSnapshot[] => {
  if (!options?.productOrder?.length) {
    return snapshots;
  }
  const orderMap = new Map(options.productOrder.map((code, index) => [normalizeProductCode(code), index]));
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

const createBlock = (reference: string, grade: string[], quantities: number[], lines: string[]): RawParsedBlock => {
  const normalizedGrade = grade.slice();
  const normalizedQuantities = quantities.slice(0, normalizedGrade.length || quantities.length);
  const workingGrade = normalizedGrade.length ? normalizedGrade : inferGradeFromQuantities(normalizedQuantities.length);
  const trimmedQuantities = normalizedQuantities.length ? normalizedQuantities : Array(workingGrade.length).fill(0);
  const tamanhos: Record<string, number> = {};
  workingGrade.forEach((token, index) => {
    tamanhos[token] = trimmedQuantities[index] ?? 0;
  });
  const total = trimmedQuantities.reduce((sum, value) => sum + value, 0);
  return {
    reference,
    productCode: normalizeProductCode(reference.split('.')[0] || reference),
    grade: workingGrade,
    quantities: trimmedQuantities,
    total,
    tamanhos,
    lines,
  };
};

const findPreviousIndex = (lines: string[], start: number, predicate: (line: string) => boolean): number => {
  for (let offset = 0; offset < MAX_LOOKBACK; offset += 1) {
    const index = start - offset;
    if (index < 0) {
      break;
    }
    if (predicate(lines[index])) {
      return index;
    }
  }
  return -1;
};

const parseProduceLine = (line: string, grade: string[]): { values: number[]; total: number } => {
  const quantities = extractProduceQuantities(line);
  if (!quantities.length) {
    return { values: [], total: 0 };
  }
  if (!grade.length && quantities.length > 1) {
    const values = quantities.slice(0, quantities.length - 1);
    const total = quantities[quantities.length - 1];
    return { values, total };
  }
  if (grade.length && quantities.length >= grade.length) {
    const values = quantities.slice(0, grade.length);
    const trailing = quantities.slice(grade.length);
    const total = trailing.length ? trailing[trailing.length - 1] : values.reduce((sum, value) => sum + value, 0);
    return { values, total };
  }
  const total = quantities.reduce((sum, value) => sum + value, 0);
  return { values: quantities, total };
};

const buildBlocksFromLines = (lines: string[]): RawParsedBlock[] => {
  const blocks: RawParsedBlock[] = [];
  lines.forEach((line, index) => {
    if (!isProduceLine(line)) {
      return;
    }
    const gradeLineIndex = findPreviousIndex(lines, index - 1, isLikelyGradeLine);
    const gradeLine = gradeLineIndex >= 0 ? lines[gradeLineIndex] : '';
    const gradeTokens = extractGradeTokens(gradeLine);

    const searchStart = gradeLineIndex >= 0 ? gradeLineIndex - 1 : index - 1;
    const referenceIndex = findPreviousIndex(lines, searchStart, (candidate) => Boolean(extractReferenceFromLine(candidate)));
    const referenceLine = referenceIndex >= 0 ? lines[referenceIndex] : '';
    const reference = extractReferenceFromLine(referenceLine);
    if (!reference) {
      return;
    }

    const { values, total } = parseProduceLine(line, gradeTokens);
    if (!values.length) {
      return;
    }

    const block = createBlock(reference, gradeTokens, values, [referenceLine, gradeLine, line].filter(Boolean));
    block.total = total;
    blocks.push(block);
  });
  return blocks;
};

export const convertBlocksToSnapshots = (blocks: RawParsedBlock[], options?: TextParserOptions): ProductSnapshot[] => {
  const grouped = new Map<string, ProductSnapshot>();
  blocks.forEach((block) => {
    if (!grouped.has(block.productCode)) {
      grouped.set(block.productCode, {
        productCode: block.productCode,
        grade: block.grade.slice(),
        variations: [],
        warnings: [],
      });
    }
    const snapshot = grouped.get(block.productCode)!;
    if (!snapshot.grade.length && block.grade.length) {
      snapshot.grade = block.grade.slice();
    } else if (block.grade.length && !areGradesEqual(snapshot.grade, block.grade)) {
      snapshot.warnings.push(
        `Grade divergente detectada para ${block.reference}: [${block.grade.join(', ')}] (mantida grade original [${snapshot.grade.join(', ')}])`,
      );
    }
    snapshot.variations.push(buildVariationFromBlock(block));
  });
  return applyProductOrdering(Array.from(grouped.values()), options);
};

export const parseTextContent = (text: string, options?: TextParserOptions): ProductSnapshot[] => {
  const lines = splitIntoNormalizedLines(text);
  const blocks = buildBlocksFromLines(lines);
  return convertBlocksToSnapshots(blocks, options);
};
