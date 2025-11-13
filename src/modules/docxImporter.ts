import { extractRawText } from 'mammoth';
import { parseTextContent } from './coreParser';
import { ProductSnapshot, StockImportOptions } from './types';

const getArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  if (file && typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return Promise.reject(new Error('O arquivo DOCX fornecido é inválido.'));
};

export const importDocxStockFile = async (file: File, options?: StockImportOptions): Promise<ProductSnapshot[]> => {
  const arrayBuffer = await getArrayBuffer(file);
  const result = await extractRawText({ arrayBuffer });
  const textContent = result.value ?? '';
  return parseTextContent(textContent, options);
};
