const PRODUCE_REGEX = /a\s*produzir/i;
const REFERENCE_REGEX = /(\d{3,}\.[A-Z0-9]{2,})/i;
export const SIZE_TOKEN_REGEX = /^(?:PP|P|M|G|GG|XG|EG|[0-9]{1,3})$/i;
const CLEAN_TOKEN_REGEX = /[^0-9A-Z]/gi;

export const splitIntoNormalizedLines = (text: string): string[] => {
  if (typeof text !== 'string') {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line));
};

export const cleanToken = (token: string): string => {
  if (typeof token !== 'string') {
    return '';
  }
  return token.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(CLEAN_TOKEN_REGEX, '').toUpperCase();
};

export const tokenizeLine = (line: string): string[] => {
  if (typeof line !== 'string') {
    return [];
  }
  return line
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

export const isProduceLine = (line: string): boolean => PRODUCE_REGEX.test(line);

export const extractReferenceFromLine = (line: string): string | null => {
  if (typeof line !== 'string') {
    return null;
  }
  const match = line.match(REFERENCE_REGEX);
  return match ? cleanToken(match[1]) : null;
};

export const isLikelyGradeLine = (line: string): boolean => {
  const tokens = tokenizeLine(line);
  if (!tokens.length) {
    return false;
  }
  const normalized = tokens.map(cleanToken);
  const startsWithGrade = normalized[0] === 'GRADE';
  const candidateTokens = startsWithGrade ? normalized.slice(1) : normalized;
  if (!candidateTokens.length) {
    return false;
  }
  const validTokens = candidateTokens.filter((token) => SIZE_TOKEN_REGEX.test(token));
  return validTokens.length >= Math.min(2, candidateTokens.length);
};

export const extractGradeTokens = (line: string): string[] => {
  if (!isLikelyGradeLine(line)) {
    return [];
  }
  const tokens = tokenizeLine(line);
  const normalized = tokens.map(cleanToken);
  const startsWithGrade = normalized[0] === 'GRADE';
  const relevantTokens = startsWithGrade ? tokens.slice(1) : tokens;
  return relevantTokens
    .map((token) => cleanToken(token))
    .filter((token) => token && token !== 'TOTAL' && SIZE_TOKEN_REGEX.test(token));
};

export const extractProduceQuantities = (line: string): number[] => {
  if (typeof line !== 'string') {
    return [];
  }
  const matches = line.match(/-?\d+(?:[.,]\d+)?/g) || [];
  return matches
    .map((value) => parseInt(value.replace(/\./g, '').replace(',', '.'), 10))
    .filter((value) => Number.isFinite(value));
};

export const normalizeProductCode = (value: string): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return cleanToken(value);
};
