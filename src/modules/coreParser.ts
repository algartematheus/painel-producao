import { ProductSnapshot, TextParserOptions, VariationSnapshot } from './types';

interface Token {
  text: string;
  start: number;
  end: number;
  center: number;
}

interface HeaderLayout {
  qtdeToken: Token;
  sizeTokens: Token[];
}

// Lista de palavras para ignorar se aparecerem no início de uma linha (falsos positivos de Referência)
const IGNORED_REFS = [
  'LOTES', 'TOTAL', 'ESTOQUE', 'RELATÓRIO', 'RELATORIO', 
  'PAGINA', 'DATA', 'FILIAIS', 'PRODUÇÃO', 'PRODUCAO', 
  'APLIC', 'TEMPO', 'SALDO', 'CANCELADOS', 'PROJEÇÃO', 'GRADE',
  'PCP', 'PLANEJAMENTO', 'CONTROLE', 'OP', 'OBS'
];

/**
 * Extrai "tokens" (palavras/números) de uma linha preservando sua posição visual.
 */
const getTokens = (line: string): Token[] => {
  const regex = /\S+/g;
  const tokens: Token[] = [];
  let match;
  while ((match = regex.exec(line)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      center: match.index + (match[0].length / 2)
    });
  }
  return tokens;
};

/**
 * Identifica a linha de cabeçalho (Qtde + Tamanhos).
 */
const parseHeaderLayout = (line: string): HeaderLayout | null => {
  const tokens = getTokens(line);
  const qtdeIndex = tokens.findIndex(t => t.text.toLowerCase().includes('qtde'));
  
  if (qtdeIndex === -1 || qtdeIndex >= tokens.length - 1) {
    return null;
  }

  return {
    qtdeToken: tokens[qtdeIndex],
    sizeTokens: tokens.slice(qtdeIndex + 1) // Todos os tokens após "Qtde" são tamanhos
  };
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
        continue;
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
      // Pega apenas números da linha
      // Usamos um regex global para pegar "-123" ou "123"
      const numberTokens = getTokens(line).filter(t => /^-?\d+$/.test(t.text));
      
      if (numberTokens.length === 0) continue;

      const values: Record<string, number> = {};
      let totalRow = 0;

      // --- LÓGICA DE MAPEAMENTO ---
      // Temos tokens de dados (D) e tokens de cabeçalho de tamanho (H)
      // Precisamos casar D com H baseados na proximidade, mas mantendo a ordem.
      
      // Passo A: Determinar se o primeiro número é o "Total Geral"
      // Heurística 1: Alinhamento com "Qtde"
      // Heurística 2: Contagem (Se tem mais números que tamanhos, o 1º é total)
      
      let dataStartIndex = 0;
      const firstToken = numberTokens[0];
      const distToQtde = Math.abs(firstToken.center - currentLayout.qtdeToken.center);
      const distToFirstSize = Math.abs(firstToken.center - currentLayout.sizeTokens[0].center);

      // Se estiver mais perto do "Qtde" do que do primeiro tamanho, ou se a contagem sobrar
      if (distToQtde < distToFirstSize || numberTokens.length > currentLayout.sizeTokens.length) {
        // O primeiro token é o Total, ignoramos ele para o mapeamento da grade
        dataStartIndex = 1;
        // (Opcional: poderíamos validar se esse valor bate com a soma)
      }

      // Passo B: Mapeamento Guloso Ordenado (Greedy Ordered Matching)
      // Para cada token de dado restante, encontre o cabeçalho DISPONÍVEL mais próximo.
      let lastMatchedHeaderIndex = -1;

      for (let d = dataStartIndex; d < numberTokens.length; d++) {
        const dToken = numberTokens[d];
        const val = parseInt(dToken.text, 10);

        let bestHeaderIndex = -1;
        let minDistance = Infinity;

        // Procura o melhor cabeçalho que esteja À DIREITA do último usado
        for (let h = lastMatchedHeaderIndex + 1; h < currentLayout.sizeTokens.length; h++) {
          const hToken = currentLayout.sizeTokens[h];
          const dist = Math.abs(dToken.center - hToken.center);
          
          // Se for o melhor até agora, salva.
          // NOTA: Como estamos iterando em ordem, se a distância começar a aumentar muito, paramos?
          // Não necessariamente, pois o gap pode ser grande. Verificamos todos os candidatos válidos.
          if (dist < minDistance) {
            minDistance = dist;
            bestHeaderIndex = h;
          }
        }

        // Se encontrou um cabeçalho válido
        if (bestHeaderIndex !== -1) {
          const sizeLabel = currentLayout.sizeTokens[bestHeaderIndex].text;
          values[sizeLabel] = val;
          totalRow += val;
          lastMatchedHeaderIndex = bestHeaderIndex;
        }
      }

      // Preenche com 0 os tamanhos que não receberam valores (Gaps/Buracos)
      currentLayout.sizeTokens.forEach(hToken => {
        if (values[hToken.text] === undefined) {
          values[hToken.text] = 0;
        }
      });

      // --- FIM DA LÓGICA DE MAPEAMENTO ---

      // Salvar/Atualizar Produto
      const codeMatch = currentRef.match(/^([^.]+)/);
      const productCode = codeMatch ? codeMatch[1] : currentRef;

      if (!productsMap.has(productCode)) {
        productsMap.set(productCode, []);
      }
      
      const variations = productsMap.get(productCode)!;
      const existingVarIndex = variations.findIndex(v => v.ref === currentRef);
      
      const newVariation = {
        ref: currentRef,
        grade: currentLayout.sizeTokens.map(t => t.text),
        tamanhos: values,
        total: totalRow
      };

      const variations = productsMap.get(productCode)!;
      const refForSearch = currentRef;
      const existingVarIndex = variations.findIndex(v => v.ref === refForSearch);

      const newVariation = {
        ref: currentRef,
        grade: currentLayout.sizeTokens.map(t => t.text),
        tamanhos: values,
        total: totalRow
      };

      if (existingVarIndex >= 0) {
        variations[existingVarIndex] = newVariation;
      } else {
        variations.push(newVariation);
      }
    }
  }

  // Construir Resultado Final
  const snapshots: ProductSnapshot[] = [];
  productsMap.forEach((variations, productCode) => {
    const mainGrade = variations.length > 0 ? variations[0].grade : [];
    snapshots.push({
      productCode,
      grade: mainGrade,
      variations,
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
