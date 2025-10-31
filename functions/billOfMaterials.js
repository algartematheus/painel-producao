const admin = require('firebase-admin');

const roundToFourDecimals = (value) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
};

const generateId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const parseLotQuantityValue = (value) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return 0;
    }
    const parsed = parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, parsed);
  }
  return 0;
};

const buildLotVariationKey = (variation, index = 0) => {
  if (!variation) {
    return `index::${index}`;
  }
  if (variation.variationKey) {
    return variation.variationKey;
  }
  if (variation.variationId) {
    return `id::${variation.variationId}`;
  }
  if (variation.id) {
    return `id::${variation.id}`;
  }
  const label = typeof variation.label === 'string' ? variation.label.trim().toLowerCase() : '';
  if (label) {
    return `label::${label}::${index}`;
  }
  return `index::${index}`;
};

const buildLotProductionDetailsForBillOfMaterials = (lotData = {}) => {
  if (!lotData) {
    return [];
  }

  const productId = typeof lotData.productId === 'string' ? lotData.productId : '';
  const productBaseId = typeof lotData.productBaseId === 'string' ? lotData.productBaseId : '';

  const rawVariations = Array.isArray(lotData.variations) ? lotData.variations : [];
  const normalizedVariations = rawVariations
    .map((variation, index) => {
      const producedValue = parseLotQuantityValue(variation?.target ?? variation?.produced);
      if (producedValue <= 0) {
        return null;
      }
      const variationKey = variation?.variationKey || buildLotVariationKey(variation, index);
      return {
        ...variation,
        variationKey,
        produced: producedValue,
      };
    })
    .filter(Boolean);

  if (normalizedVariations.length > 0) {
    const totalProduced = normalizedVariations.reduce((sum, variation) => sum + variation.produced, 0);
    if (totalProduced <= 0) {
      return [];
    }
    return [
      {
        productId,
        productBaseId,
        produced: totalProduced,
        variations: normalizedVariations,
      },
    ];
  }

  const targetValue = parseLotQuantityValue(lotData?.target);
  if (targetValue <= 0) {
    return [];
  }

  return [
    {
      productId,
      productBaseId,
      produced: targetValue,
    },
  ];
};

const buildBillOfMaterialsMovementDetails = ({
  originalDetails = [],
  updatedDetails = [],
} = {}) => {
  const normalizeDetail = (detail, sign) => {
    if (!detail) {
      return null;
    }

    const productId = typeof detail.productId === 'string' ? detail.productId : '';
    const productBaseId = typeof detail.productBaseId === 'string' ? detail.productBaseId : '';
    const producedValue = parseFloat(detail.produced);
    const variations = Array.isArray(detail.variations) ? detail.variations : [];

    const normalizedVariations = variations
      .map((variation) => {
        const producedVariation = parseFloat(variation?.produced);
        if (!Number.isFinite(producedVariation) || producedVariation === 0) {
          return null;
        }
        return {
          ...variation,
          produced: sign * producedVariation,
        };
      })
      .filter(Boolean);

    const hasVariationMovements = normalizedVariations.length > 0;

    const hasProducedValue = Number.isFinite(producedValue) && producedValue !== 0;
    const produced = hasProducedValue ? sign * producedValue : 0;

    if (!hasVariationMovements && !hasProducedValue) {
      return null;
    }

    return {
      productId,
      productBaseId,
      produced,
      ...(hasVariationMovements ? { variations: normalizedVariations } : {}),
    };
  };

  const movements = [];

  originalDetails.forEach((detail) => {
    const normalized = normalizeDetail(detail, -1);
    if (normalized) {
      movements.push(normalized);
    }
  });

  updatedDetails.forEach((detail) => {
    const normalized = normalizeDetail(detail, 1);
    if (normalized) {
      movements.push(normalized);
    }
  });

  return movements;
};

const normalizeDashboardIds = (rawDashboardIds) => {
  if (!Array.isArray(rawDashboardIds) || rawDashboardIds.length === 0) {
    return [];
  }
  return rawDashboardIds
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean);
};

const accumulateConsumption = ({
  billOfMaterials = [],
  producedValue,
  consumptionByVariation,
  dashboardId,
}) => {
  if (!Array.isArray(billOfMaterials) || billOfMaterials.length === 0) {
    return;
  }

  billOfMaterials.forEach((item) => {
    const stockProductId = item?.stockProductId;
    const stockVariationId = item?.stockVariationId;
    if (!stockProductId || !stockVariationId) return;

    const allowedDashboards = normalizeDashboardIds(item?.dashboardIds);
    if (allowedDashboards.length > 0) {
      if (!dashboardId || !allowedDashboards.includes(dashboardId)) {
        return;
      }
    }

    const quantityPerPiece = parseFloat(item?.quantityPerPiece);
    if (!Number.isFinite(quantityPerPiece) || quantityPerPiece === 0) return;

    const consumption = producedValue * quantityPerPiece;
    if (!Number.isFinite(consumption) || consumption === 0) return;

    const key = `${stockProductId}::${stockVariationId}`;
    consumptionByVariation.set(key, (consumptionByVariation.get(key) || 0) + consumption);
  });
};

const buildProductVariationCache = (product) => {
  const variations = Array.isArray(product?.variations) ? product.variations : [];
  const mapById = new Map();
  const mapByLabel = new Map();

  variations.forEach((variation) => {
    if (variation?.id) {
      mapById.set(variation.id, variation);
    }
    const label = typeof variation?.label === 'string' ? variation.label.trim().toLowerCase() : '';
    if (label && !mapByLabel.has(label)) {
      mapByLabel.set(label, variation);
    }
  });

  return { variations, mapById, mapByLabel };
};

const resolveProductVariation = (productVariationCache, detailVariation) => {
  if (!detailVariation) {
    return null;
  }

  const variationId = (() => {
    if (!detailVariation) {
      return '';
    }
    const rawId = typeof detailVariation.variationId === 'string' ? detailVariation.variationId.trim() : '';
    if (rawId) {
      return rawId;
    }
    const rawKey = typeof detailVariation.variationKey === 'string' ? detailVariation.variationKey.trim() : '';
    if (rawKey.startsWith('id::')) {
      return rawKey.slice(4);
    }
    return '';
  })();

  if (variationId && productVariationCache.mapById.has(variationId)) {
    return productVariationCache.mapById.get(variationId);
  }

  const label = typeof detailVariation.label === 'string' ? detailVariation.label.trim().toLowerCase() : '';
  if (label && productVariationCache.mapByLabel.has(label)) {
    return productVariationCache.mapByLabel.get(label);
  }

  return null;
};

const buildProductLookupMap = (...lists) => {
  const map = new Map();
  lists.forEach((list) => {
    (list || []).forEach((product) => {
      if (product?.id) {
        const existing = map.get(product.id) || {};
        map.set(product.id, { ...existing, ...product });
      }
    });
  });
  return map;
};

const applyBillOfMaterialsMovements = ({
  db,
  batch,
  productionDetails,
  productSources = [],
  stockProducts = [],
  sourceEntryId,
  user,
  movementTimestamp = admin.firestore.Timestamp.now(),
  dashboardId,
  suppressMovementRecords = false,
  suppressStockUpdates = false,
}) => {
  if (!db || !batch) {
    return;
  }
  if (!user || !user.uid) {
    return;
  }
  if (!Array.isArray(productionDetails) || productionDetails.length === 0) {
    return;
  }

  const productMap = buildProductLookupMap(...productSources);
  const baseProductMap = new Map();
  productSources.forEach((list) => {
    (list || []).forEach((product) => {
      if (product?.baseProductId && !baseProductMap.has(product.baseProductId)) {
        baseProductMap.set(product.baseProductId, product);
      }
    });
  });

  const stockProductMap = new Map();
  stockProducts.forEach((product) => {
    if (!product?.id) return;
    const variationMap = new Map();
    (product.variations || []).forEach((variation) => {
      if (variation?.id) {
        variationMap.set(variation.id, variation);
      }
    });
    stockProductMap.set(product.id, { product, variationMap });
  });

  const productVariationCache = new Map();
  const consumptionByVariation = new Map();

  productionDetails.forEach((detail) => {
    if (!detail) return;

    let product = detail?.productId ? productMap.get(detail.productId) : null;
    if (!product && detail?.productBaseId) {
      const baseProduct = baseProductMap.get(detail.productBaseId);
      if (baseProduct) {
        product = productMap.get(baseProduct.id) || baseProduct;
      }
    }
    if (!product) return;

    const defaultBillOfMaterials = Array.isArray(product.billOfMaterials) ? product.billOfMaterials : [];
    const detailVariations = Array.isArray(detail.variations) ? detail.variations : [];

    let hasAppliedVariationConsumption = false;
    if (detailVariations.length > 0) {
      if (!productVariationCache.has(product.id)) {
        productVariationCache.set(product.id, buildProductVariationCache(product));
      }
      const cachedVariations = productVariationCache.get(product.id);

      detailVariations.forEach((variation) => {
        const producedValue = parseFloat(variation?.produced);
        if (!Number.isFinite(producedValue) || producedValue === 0) {
          return;
        }

        hasAppliedVariationConsumption = true;

        const productVariation = resolveProductVariation(cachedVariations, variation);
        const variationBill = Array.isArray(productVariation?.billOfMaterials) && productVariation.billOfMaterials.length > 0
          ? productVariation.billOfMaterials
          : defaultBillOfMaterials;

        accumulateConsumption({
          billOfMaterials: variationBill,
          producedValue,
          consumptionByVariation,
          dashboardId,
        });
      });
    }

    if (hasAppliedVariationConsumption) {
      return;
    }

    let producedValue = parseFloat(detail?.produced);
    if (!Number.isFinite(producedValue) || producedValue === 0) {
      const variationTotal = detailVariations.reduce((sum, variation) => {
        const numeric = parseFloat(variation?.produced);
        if (!Number.isFinite(numeric) || numeric === 0) {
          return sum;
        }
        return sum + numeric;
      }, 0);
      producedValue = variationTotal;
    }
    if (!Number.isFinite(producedValue) || producedValue === 0) return;

    accumulateConsumption({
      billOfMaterials: defaultBillOfMaterials,
      producedValue,
      consumptionByVariation,
      dashboardId,
    });
  });

  if (consumptionByVariation.size === 0) {
    return;
  }

  const productUpdates = new Map();
  const movementRecords = [];
  let hasStockUpdates = false;
  let hasMovementGeneration = false;
  const timestamp = movementTimestamp || admin.firestore.Timestamp.now();

  consumptionByVariation.forEach((consumption, key) => {
    if (!Number.isFinite(consumption) || consumption === 0) return;
    const [stockProductId, stockVariationId] = key.split('::');
    const stockRecord = stockProductMap.get(stockProductId);
    if (!stockRecord) return;
    const { variationMap } = stockRecord;
    const variation = variationMap.get(stockVariationId);
    if (!variation) return;

    if (!suppressStockUpdates) {
      const baseStockValue = parseFloat(variation.currentStock);
      const baseStock = Number.isFinite(baseStockValue) ? baseStockValue : 0;
      const updatedStock = baseStock - consumption;

      if (!productUpdates.has(stockProductId)) {
        productUpdates.set(stockProductId, new Map());
      }
      productUpdates.get(stockProductId).set(stockVariationId, updatedStock);
      hasStockUpdates = true;
    }

    if (!suppressMovementRecords) {
      const quantity = Math.abs(consumption);
      if (quantity === 0) return;

      movementRecords.push({
        productId: stockProductId,
        variationId: stockVariationId,
        quantity,
        type: consumption > 0 ? 'Saída' : 'Entrada',
      });
      hasMovementGeneration = true;
    }
  });

  if (!hasStockUpdates && !hasMovementGeneration) {
    return;
  }

  if (!suppressStockUpdates && hasStockUpdates) {
    productUpdates.forEach((variationUpdates, stockProductId) => {
      const stockRecord = stockProductMap.get(stockProductId);
      if (!stockRecord) return;
      const updatedVariations = (stockRecord.product.variations || []).map((variation) => {
        if (!variationUpdates.has(variation.id)) {
          return variation;
        }
        const newValue = roundToFourDecimals(variationUpdates.get(variation.id));
        return { ...variation, currentStock: newValue };
      });
      const stockProductRef = db.collection('stock').doc('data').collection('products').doc(stockProductId);
      batch.update(stockProductRef, { variations: updatedVariations });
    });
  }

  if (!suppressMovementRecords && hasMovementGeneration) {
    movementRecords.forEach((movement) => {
      const movementId = generateId('mov');
      const movementRef = db.collection('stock').doc('data').collection('movements').doc(movementId);
      batch.set(movementRef, {
        ...movement,
        quantity: roundToFourDecimals(movement.quantity),
        user: user.uid,
        userEmail: user.email,
        timestamp,
        ...(sourceEntryId ? { sourceEntryId } : {}),
      });
    });
  }
};

module.exports = {
  roundToFourDecimals,
  parseLotQuantityValue,
  buildLotVariationKey,
  buildLotProductionDetailsForBillOfMaterials,
  buildBillOfMaterialsMovementDetails,
  applyBillOfMaterialsMovements,
};
