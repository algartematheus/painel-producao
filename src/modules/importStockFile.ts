import { importDocxStockFile } from './docxImporter';
import { importTxtStockFile } from './txtImporter';
import { NO_VARIATIONS_FOUND_ERROR, ProductSnapshot, StockImportOptions } from './types';

const getExtensionFromName = (name?: string): string => {
  if (!name) {
    return '';
  }
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
};

const detectExtension = (file: File): string => {
  const byName = getExtensionFromName(file?.name);
  if (byName) {
    return byName;
  }
  const mime = typeof file?.type === 'string' ? file.type.toLowerCase() : '';
  if (mime.includes('wordprocessingml')) {
    return 'docx';
  }
  if (mime.includes('text')) {
    return 'txt';
  }
  return '';
};

const assertHasVariations = (snapshots: ProductSnapshot[]): void => {
  const totalVariations = snapshots.reduce((sum, snapshot) => sum + snapshot.variations.length, 0);
  if (!totalVariations) {
    const error = new Error(
      "Nenhuma variação encontrada no arquivo importado. Confirme se o relatório contém linhas com 'A PRODUZIR'.",
    ) as Error & { code?: string };
    error.code = NO_VARIATIONS_FOUND_ERROR;
    throw error;
  }
};

export const flattenSnapshotsToVariations = (
  snapshots: ProductSnapshot[] = [],
): { productCode: string; ref: string; tamanhos: Record<string, number>; total: number }[] => {
  const flattened: { productCode: string; ref: string; tamanhos: Record<string, number>; total: number }[] = [];
  snapshots.forEach((snapshot) => {
    const variations = Array.isArray(snapshot?.variations) ? snapshot.variations : [];
    variations.forEach((variation) => {
      const tamanhos = variation?.tamanhos || {};
      const total = Object.values(tamanhos)
        .map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0))
        .reduce((sum, value) => sum + value, 0);
      flattened.push({
        productCode: snapshot.productCode,
        ref: variation?.ref || '',
        tamanhos,
        total,
      });
    });
  });
  return flattened;
};

export const importStockFile = async (
  file: File,
  options?: StockImportOptions,
): Promise<ProductSnapshot[]> => {
  if (!file) {
    throw new Error('Selecione um arquivo válido para importação.');
  }

  const extension = detectExtension(file);
  let snapshots: ProductSnapshot[] = [];

  if (extension === 'docx') {
    snapshots = await importDocxStockFile(file, options);
  } else if (extension === 'txt') {
    snapshots = await importTxtStockFile(file, options);
  } else {
    throw new Error('Tipo de arquivo não suportado. Utilize arquivos .docx ou .txt.');
  }

  assertHasVariations(snapshots);
  return snapshots;
};

export default importStockFile;
