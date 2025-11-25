import { ProductSnapshot, TextParserOptions, VariationSnapshot } from './types';

interface ColumnRange {
  label: string;
  start: number;
  end: number;
}

interface HeaderLayout {
  ranges: ColumnRange[];
}

// Lista de palavras para ignorar se aparecerem no início de uma linha (falsos positivos de Referência)
const IGNORED_REFS = [
  'LOTES', 'TOTAL', 'ESTOQUE', 'RELATÓRIO', 'RELATORIO',
  'PAGINA', 'DATA', 'FILIAIS', 'PRODUÇÃO', 'PRODUCAO',
  'APLIC', 'TEMPO', 'SALDO', 'CANCELADOS', 'PROJEÇÃO', 'GRADE',
  'PCP', 'PLANEJAMENTO', 'CONTROLE', 'OP', 'OBS'
];

/**
 * Identifica a linha de cabeçalho (Qtde + Tamanhos) e calcula os ranges fixos das colunas.
 */
const parseHeaderLayout = (line: string): HeaderLayout | null => {
  // Regex para encontrar "Qtde" e os tamanhos subsequentes
  // Captura a posição de cada token
  const regex = /\S+/g;
  let match;
  const tokens: { text: string; index: number }[] = [];

  while ((match = regex.exec(line)) !== null) {
    tokens.push({ text: match[0], index: match.index });
  }

  const qtdeIndex = tokens.findIndex(t => t.text.toLowerCase().includes('qtde'));

  if (qtdeIndex === -1 || qtdeIndex >= tokens.length - 1) {
    return null;
  }

  // O user pediu para ignorar o "Qtde" (total) no mapeamento de tamanhos,
  // mas precisamos saber onde começam os tamanhos.
  // Os tamanhos são os tokens APÓS "Qtde".

  const sizeTokens = tokens.slice(qtdeIndex + 1);
  const ranges: ColumnRange[] = [];

  for (let i = 0; i < sizeTokens.length; i++) {
    const currentToken = sizeTokens[i];
    const nextToken = sizeTokens[i + 1];

    // O range começa no início do token atual
    const start = currentToken.index;

    // O range vai até o início do próximo token, ou até o fim da linha (arbitrariamente longe)
    // Usamos um valor grande para o último token para pegar tudo até o fim
    const end = nextToken ? nextToken.index : 10000;

    ranges.push({
      label: currentToken.text,
      start,
      end
    });
  }

  return { ranges };
};

export const parseTextContent = (text: string, options?: TextParserOptions): ProductSnapshot[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const productsMap = new Map<string, VariationSnapshot[]>();

  // Estado do Parser
  let currentLayout: HeaderLayout | null = null;
  let currentRef: string | null = null;
  let expectingRef = false;

  const dataLineRegex = /(A PRODUZIR:|PARCIAL \(2\):)/i;
  const refStartRegex = /^([A-Z0-9.]+)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // NOTA: Não fazemos trim() na linha completa para não perder a indexação absoluta das colunas.
    // Apenas para verificações de conteúdo usamos trim.
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ---------------------------------------------------------
    // 1. Detectar Cabeçalho ("Qtde ...")
    // ---------------------------------------------------------
    if (line.includes("Qtde")) {
      const newLayout = parseHeaderLayout(line);

      if (newLayout) {
        currentLayout = newLayout;

        // Verifica Referência na mesma linha (antes do Qtde)
        const qtdeIndex = line.indexOf("Qtde");
        const preQtde = line.substring(0, qtdeIndex).trim();

        if (preQtde.length > 0) {
          const refMatch = preQtde.match(refStartRegex);
          if (refMatch && !IGNORED_REFS.includes(refMatch[1].toUpperCase())) {
            currentRef = refMatch[1];
            expectingRef = false;
          } else {
            currentRef = null;
            expectingRef = true;
          }
        } else {
          // Referência deve estar na próxima linha
          currentRef = null;
          expectingRef = true;
        }
        continue;
      }
    }

    // ---------------------------------------------------------
    // 2. Buscar Referência (se esperado)
    // ---------------------------------------------------------
    if (expectingRef) {
      const match = trimmed.match(refStartRegex);
      if (match) {
        const candidate = match[1];
        if (!IGNORED_REFS.includes(candidate.toUpperCase()) && candidate.length > 2) {
          currentRef = candidate;
          expectingRef = false;
        }
      }
      // Se encontrar divisores, cancela a espera para não pegar lixo
      if (trimmed.includes("Lotes Anteriores") || trimmed.includes("Estoque")) {
        expectingRef = false;
      }
    }

    // ---------------------------------------------------------
    // 3. Processar Dados ("A PRODUZIR")
    // ---------------------------------------------------------
    if (currentRef && currentLayout && dataLineRegex.test(line)) {
      // A linha contém dados. Vamos extrair usando os ranges fixos.

      const values: Record<string, number> = {};
      let totalRow = 0;

      // Itera sobre os ranges definidos no cabeçalho
      for (const range of currentLayout.ranges) {
        // Extrai o pedaço da linha correspondente à coluna
        // Precisamos garantir que a linha é longa o suficiente
        if (range.start >= line.length) {
          values[range.label] = 0;
          continue;
        }

        const slice = line.substring(range.start, Math.min(range.end, line.length));
        const cleanSlice = slice.trim();

        // Se estiver vazio, é 0 (coluna em branco)
        if (!cleanSlice) {
          values[range.label] = 0;
        } else {
          // Tenta parsear o número
          const val = parseInt(cleanSlice, 10);
          if (!isNaN(val)) {
            values[range.label] = val;
            totalRow += val;
          } else {
            values[range.label] = 0;
          }
        }
      }

      // Salvar/Atualizar Produto
      const codeMatch = currentRef.match(/^([^.]+)/);
      const productCode = codeMatch ? codeMatch[1] : currentRef;

      if (!productsMap.has(productCode)) {
        productsMap.set(productCode, []);
      }

      const productVariations = productsMap.get(productCode)!;
      const refToMatch = currentRef;
      const existingVarIndex = productVariations.findIndex(v => v.ref === refToMatch);

      const newVariation = {
        ref: currentRef,
        grade: currentLayout.ranges.map(r => r.label),
        tamanhos: values,
        total: totalRow
      };

      if (existingVarIndex >= 0) {
        productVariations[existingVarIndex] = newVariation;
      } else {
        productVariations.push(newVariation);
      }
    }
  }

  // Construir Resultado Final
  const snapshots: ProductSnapshot[] = [];
  productsMap.forEach((productVariations, productCode) => {
    const mainGrade = productVariations.length > 0 ? productVariations[0].grade : [];
    snapshots.push({
      productCode,
      grade: mainGrade,
      variations: productVariations,
      warnings: []
    });
  });

  if (options?.productOrder) {
    const orderMap = new Map(options.productOrder.map((code, index) => [code, index]));
    snapshots.sort((a, b) => {
      const orderA = orderMap.get(a.productCode);
      const orderB = orderMap.get(b.productCode);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return 0;
    });
  }

  return snapshots;
};

export default parseTextContent;
