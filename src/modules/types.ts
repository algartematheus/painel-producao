export const NO_VARIATIONS_FOUND_ERROR = 'NO_VARIATIONS_FOUND';

export interface VariationSnapshot {
  ref: string;
  grade: string[];
  tamanhos: Record<string, number>;
  total: number;
}

export interface ProductSnapshot {
  productCode: string;
  grade: string[];
  variations: VariationSnapshot[];
  warnings: string[];
}

export interface TextParserOptions {
  productOrder?: string[];
}

export type StockImportOptions = TextParserOptions;
