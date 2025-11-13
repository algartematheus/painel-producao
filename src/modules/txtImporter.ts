import { parseTextContent } from './coreParser';
import { ProductSnapshot, StockImportOptions } from './types';

const getText = (file: File): Promise<string> => {
  if (file && typeof file.text === 'function') {
    return file.text();
  }
  return Promise.reject(new Error('O arquivo TXT fornecido é inválido.'));
};

export const importTxtStockFile = async (file: File, options?: StockImportOptions): Promise<ProductSnapshot[]> => {
  const text = await getText(file);
  return parseTextContent(text, options);
};
