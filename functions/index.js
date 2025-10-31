const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

const {
  parseLotQuantityValue,
  buildLotVariationKey,
  buildLotProductionDetailsForBillOfMaterials,
  buildBillOfMaterialsMovementDetails,
  applyBillOfMaterialsMovements,
} = require('./billOfMaterials');

admin.initializeApp();

const db = admin.firestore();
const FUNCTION_REGION = process.env.FUNCTION_REGION || 'southamerica-east1';

const ADMIN_PASSWORD_HASH_CONFIG_PATH = ['security', 'admin_password_hash'];
const SHA256_REGEX = /^[a-f0-9]{64}$/i;

/**
 * Reads the admin password hash from Functions config.
 * @returns {string | null}
 */
const resolveAdminPasswordHash = () => {
  const config = functions.config();
  let current = config;

  for (const key of ADMIN_PASSWORD_HASH_CONFIG_PATH) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    current = current[key];
  }

  if (typeof current === 'string' && SHA256_REGEX.test(current)) {
    return current;
  }

  return null;
};

exports.verifyAdminPassword = functions
  .region(FUNCTION_REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    }

    const password = typeof data?.password === 'string' ? data.password.trim() : '';
    if (!password) {
      throw new functions.https.HttpsError('invalid-argument', 'A senha é obrigatória.');
    }

    const configuredHash = resolveAdminPasswordHash();
    if (!configuredHash) {
      console.error('Admin password hash não configurado ou inválido.');
      throw new functions.https.HttpsError('failed-precondition', 'Configuração de segurança indisponível.');
    }

    const userId = context.auth.uid;

    let roleData = {};
    try {
      const roleDoc = await db.collection('roles').doc(userId).get();
      roleData = roleDoc.exists ? roleDoc.data() : {};
    } catch (error) {
      console.error('Falha ao carregar permissões do usuário.', { userId, error });
      throw new functions.https.HttpsError('internal', 'Não foi possível validar as permissões do usuário.');
    }
    const explicitPermissions = Array.isArray(roleData?.permissions) ? roleData.permissions : [];
    const isAdminRole = typeof roleData?.role === 'string' && roleData.role.toLowerCase() === 'admin';

    const isAuthorized = isAdminRole || explicitPermissions.includes('MANAGE_SETTINGS');
    if (!isAuthorized) {
      throw new functions.https.HttpsError('permission-denied', 'Você não tem permissão para executar esta ação.');
    }

    const computedHash = crypto.createHash('sha256').update(password).digest('hex');
    const isValid = computedHash === configuredHash;

    return { valid: isValid };
  });

const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const LOT_FLOW_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedDashboardOrder = [];
let cachedDashboardFetchedAt = 0;
let cachedLotFlow = null;
let cachedLotFlowFetchedAt = 0;

const LOT_FLOW_SETTINGS_COLLECTION = 'settings';
const LOT_FLOW_SETTINGS_DOCUMENT = 'lotFlow';

const invalidateDashboardCaches = () => {
  cachedDashboardOrder = [];
  cachedDashboardFetchedAt = 0;
  cachedLotFlow = null;
  cachedLotFlowFetchedAt = 0;
};

const cloneLotFlowSteps = (steps = []) => steps.map((step) => ({ ...step }));

const VALID_SPLIT_MODES = new Set(['never', 'always', 'manual', 'variations']);

const resolveSplitMode = (step) => {
  const raw = typeof step?.splitMode === 'string' ? step.splitMode.toLowerCase() : '';
  if (VALID_SPLIT_MODES.has(raw)) {
    return raw;
  }

  if (typeof step?.split === 'boolean') {
    return step.split ? 'always' : 'never';
  }

  return 'never';
};

const normalizeLotFlowSteps = (rawSteps) => {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return [];
  }

  const seenDashboards = new Set();
  const normalized = [];

  rawSteps.forEach((step) => {
    const dashboardId = typeof step?.dashboardId === 'string' ? step.dashboardId.trim() : '';
    if (!dashboardId || seenDashboards.has(dashboardId)) {
      return;
    }

    seenDashboards.add(dashboardId);
    normalized.push({
      dashboardId,
      mode: typeof step?.mode === 'string' ? step.mode.toLowerCase() : 'auto',
      splitMode: resolveSplitMode(step),
    });
  });

  return normalized;
};

const loadConfiguredLotFlow = async () => {
  const now = Date.now();
  if (cachedLotFlow && now - cachedLotFlowFetchedAt < LOT_FLOW_CACHE_TTL_MS) {
    return cloneLotFlowSteps(cachedLotFlow);
  }

  try {
    const docRef = db.collection(LOT_FLOW_SETTINGS_COLLECTION).doc(LOT_FLOW_SETTINGS_DOCUMENT);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      cachedLotFlow = [];
      cachedLotFlowFetchedAt = now;
      return [];
    }

    const data = snapshot.data();
    const normalized = normalizeLotFlowSteps(data?.steps);
    cachedLotFlow = cloneLotFlowSteps(normalized);
    cachedLotFlowFetchedAt = now;
    return normalized;
  } catch (error) {
    console.error('Falha ao carregar fluxo de lotes configurado.', { error });
    cachedLotFlow = [];
    cachedLotFlowFetchedAt = now;
    return [];
  }
};

const cloneDeep = (value) => {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }

  if (typeof global.structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (error) {
      console.warn('structuredClone falhou, usando fallback para clone profundo.', { error });
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error('Falha ao clonar dados durante migração automática de lote.', { error });
    if (Array.isArray(value)) {
      return value.map((item) => (typeof item === 'object' && item !== null ? { ...item } : item));
    }
    return { ...value };
  }
};

const clampToNumber = (value) => {
  const parsed = parseLotQuantityValue(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
};

const clampToNonNegative = (value) => {
  const numeric = clampToNumber(value);
  return numeric >= 0 ? numeric : 0;
};

const extractLaundryReturnTotals = (lot = {}) => {
  if (!lot || typeof lot !== 'object') {
    return {};
  }

  const source = lot.laundryReturnQuantities;
  if (!source || typeof source !== 'object') {
    return {};
  }

  return Object.entries(source).reduce((accumulator, [key, rawValue]) => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      return accumulator;
    }
    accumulator[key] = clampToNonNegative(rawValue);
    return accumulator;
  }, {});
};

const buildLaundryReturnDetails = (lot = {}) => {
  if (!lot || typeof lot !== 'object') {
    return [];
  }

  const variations = Array.isArray(lot?.variations) ? lot.variations : [];
  const totals = extractLaundryReturnTotals(lot);
  const existingDetails = Array.isArray(lot?.laundryReturnDetails) ? lot.laundryReturnDetails : [];

  if (variations.length > 0) {
    return variations.map((variation, index) => {
      const variationKey = variation?.variationKey
        || variation?.variationId
        || variation?.id
        || buildLotVariationKey(variation, index);
      const label = typeof variation?.label === 'string' && variation.label.trim().length > 0
        ? variation.label.trim()
        : `Variação ${index + 1}`;
      const target = clampToNonNegative(variation?.target ?? variation?.produced);

      const candidateKeys = [
        variationKey,
        variation?.variationId,
        variation?.id,
        label,
        buildLotVariationKey(variation, index),
      ].filter(Boolean);

      let returned = 0;
      for (const key of candidateKeys) {
        if (Object.prototype.hasOwnProperty.call(totals, key)) {
          returned = clampToNonNegative(totals[key]);
          if (returned > 0) {
            break;
          }
        }
      }

      if (returned <= 0 && existingDetails.length > 0) {
        const matchedDetail = existingDetails.find((detail) => detail
          && (detail.variationKey === variationKey
            || (variation?.variationId && detail.variationId === variation.variationId)));
        if (matchedDetail) {
          returned = clampToNonNegative(matchedDetail.returned ?? matchedDetail.quantity);
        }
      }

      const divergence = returned - target;
      const divergencePercentage = target > 0
        ? Number(((divergence / target) * 100).toFixed(2))
        : null;

      return {
        variationId: variation?.variationId || null,
        variationKey,
        label,
        target,
        returned,
        divergence,
        divergencePercentage,
      };
    });
  }

  const labelCandidates = [
    lot?.customName,
    lot?.displayName,
    lot?.lotCode,
    lot?.productCode,
    lot?.productName,
    lot?.id,
  ];
  const label = labelCandidates.find((value) => typeof value === 'string' && value.trim().length > 0) || 'Lote';

  const target = clampToNonNegative(lot?.target);
  let returned = Object.values(totals).reduce((sum, value) => sum + clampToNonNegative(value), 0);
  if (returned <= 0 && existingDetails.length > 0) {
    returned = existingDetails.reduce((sum, detail) => sum + clampToNonNegative(detail?.returned ?? detail?.quantity), 0);
  }
  if (returned <= 0) {
    returned = clampToNonNegative(lot?.laundryReturnedQuantity ?? lot?.produced);
  }

  const divergence = returned - target;
  const divergencePercentage = target > 0
    ? Number(((divergence / target) * 100).toFixed(2))
    : null;

  return [{
    variationId: null,
    variationKey: null,
    label,
    target,
    returned,
    divergence,
    divergencePercentage,
  }];
};

const summarizeLaundryReturnDetails = (details = [], lot = {}) => {
  const normalizedDetails = Array.isArray(details) ? details : [];

  const totalTarget = normalizedDetails.reduce((sum, detail) => sum + clampToNonNegative(detail?.target), 0);
  const totalReturned = normalizedDetails.reduce((sum, detail) => sum + clampToNonNegative(detail?.returned ?? detail?.quantity), 0);

  const hasIncomplete = normalizedDetails.some((detail) => clampToNonNegative(detail?.returned ?? detail?.quantity)
    < clampToNonNegative(detail?.target));
  const hasDivergence = normalizedDetails.some((detail) => {
    const returned = clampToNumber(detail?.returned ?? detail?.quantity);
    const target = clampToNumber(detail?.target);
    if (!Number.isFinite(returned) || !Number.isFinite(target)) {
      return false;
    }
    return returned !== target;
  });

  const requiresAttention = hasIncomplete
    || (normalizedDetails.length === 0 && clampToNonNegative(lot?.target) > 0);

  return {
    totalTarget,
    totalReturned,
    hasIncomplete,
    hasDivergence,
    requiresAttention,
  };
};

const computeLaundryReturnAnalysis = (lot = {}) => {
  const details = buildLaundryReturnDetails(lot);
  const summary = summarizeLaundryReturnDetails(details, lot);
  return { details, summary };
};

const isDashboardActive = (dashboard) => {
  if (!dashboard) {
    return false;
  }
  if (dashboard.active === false || dashboard.enabled === false) {
    return false;
  }
  return Boolean(dashboard.id);
};

const getOrderedDashboards = async () => {
  const now = Date.now();
  if (cachedDashboardOrder.length > 0 && now - cachedDashboardFetchedAt < DASHBOARD_CACHE_TTL_MS) {
    return cachedDashboardOrder;
  }

  try {
    const snapshot = await db.collection('dashboards').orderBy('order').get();
    const dashboards = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(isDashboardActive);

    cachedDashboardOrder = dashboards;
    cachedDashboardFetchedAt = now;
    return dashboards;
  } catch (error) {
    console.error('Falha ao carregar ordem dos dashboards para migração automática.', { error });
    return [];
  }
};

const determineNextDashboard = async (currentDashboardId) => {
  if (!currentDashboardId) {
    return null;
  }

  const dashboards = await getOrderedDashboards();
  if (dashboards.length === 0) {
    return null;
  }

  const dashboardsById = new Map(dashboards.map((dashboard) => [dashboard.id, dashboard]));
  const configuredFlow = await loadConfiguredLotFlow();

  if (configuredFlow.length > 0) {
    const configuredDashboards = configuredFlow
      .map((step) => {
        const dashboard = dashboardsById.get(step.dashboardId);
        if (!dashboard) {
          return null;
        }
        return { dashboard, step };
      })
      .filter((entry) => entry && isDashboardActive(entry.dashboard));

    const configuredIndex = configuredDashboards.findIndex((entry) => entry.dashboard.id === currentDashboardId);
    if (configuredIndex >= 0) {
      for (let index = configuredIndex + 1; index < configuredDashboards.length; index += 1) {
        const candidate = configuredDashboards[index];
        if (candidate && isDashboardActive(candidate.dashboard)) {
          return {
            ...candidate.dashboard,
            lotFlowStep: { ...candidate.step },
            lotFlowConfigured: true,
          };
        }
      }
      return null;
    }

    if (configuredDashboards.length > 0) {
      console.warn('Dashboard atual não encontrado no fluxo configurado. Recuando para ordenação padrão.', {
        currentDashboardId,
      });
    }
  }

  const currentIndex = dashboards.findIndex((dashboard) => dashboard.id === currentDashboardId);
  if (currentIndex < 0) {
    console.warn('Dashboard atual não encontrado na ordem configurada.', { currentDashboardId });
    return null;
  }

  for (let index = currentIndex + 1; index < dashboards.length; index += 1) {
    const candidate = dashboards[index];
    if (isDashboardActive(candidate)) {
      return {
        ...candidate,
        lotFlowConfigured: false,
      };
    }
  }

  return null;
};

const fetchProductForDashboard = async (dashboardId, productId) => {
  if (!dashboardId || !productId) {
    return null;
  }

  try {
    const productSnap = await db.collection('dashboards').doc(dashboardId).collection('products').doc(productId).get();
    if (!productSnap.exists) {
      return null;
    }
    return { id: productSnap.id, ...productSnap.data() };
  } catch (error) {
    console.error('Erro ao carregar produto para aplicação de ficha técnica durante migração.', {
      dashboardId,
      productId,
      error,
    });
    return null;
  }
};

const loadProductSources = async ({ sourceDashboardId, destinationDashboardId, productId }) => {
  const promises = [];

  if (destinationDashboardId && productId) {
    promises.push(
      fetchProductForDashboard(destinationDashboardId, productId).then((product) => ({ type: 'destination', product })),
    );
  }

  if (sourceDashboardId && productId && sourceDashboardId !== destinationDashboardId) {
    promises.push(
      fetchProductForDashboard(sourceDashboardId, productId).then((product) => ({ type: 'source', product })),
    );
  }

  const results = await Promise.all(promises);
  const productSources = [];

  results.forEach((result) => {
    if (result?.product) {
      productSources.push([result.product]);
    }
  });

  return productSources;
};

const loadStockProducts = async () => {
  try {
    const snapshot = await db.collection('stock').doc('data').collection('products').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Erro ao carregar produtos de estoque para migração automática.', { error });
    return [];
  }
};

const normalizeUserPayload = (user) => {
  if (!user || typeof user !== 'object') {
    return null;
  }
  const uid = typeof user.uid === 'string' && user.uid.trim().length > 0 ? user.uid.trim() : null;
  if (!uid) {
    return null;
  }
  const email = typeof user.email === 'string' && user.email.trim().length > 0
    ? user.email.trim()
    : 'system-migration@painel-producao';
  return { uid, email };
};

const resolveMigrationUser = (lotData) => {
  return (
    normalizeUserPayload(lotData?.lastEditedBy)
    || normalizeUserPayload(lotData?.createdBy)
    || { uid: 'system:migration', email: 'system-migration@painel-producao' }
  );
};

const createMigratedLotBaseData = ({
  lotData,
  newLotId,
  nextDashboardId,
  sourceDashboardId,
  historyEntry,
  targetOverride,
  producedOverride,
  parentLotId,
  variationData,
  customName,
  displayName,
}) => {
  const base = cloneDeep(lotData) || {};

  [
    'produced',
    'status',
    'startDate',
    'endDate',
    'order',
    'dashboardId',
    'migratedFromDashboard',
    'migratedAt',
    'sourceLotId',
    'migratedToDashboardId',
    'nextDashboardLotId',
    'nextDashboardId',
    'nextDashboardLotIds',
    'migrationMetadata',
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      delete base[key];
    }
  });

  const resolvedTargetOverride = targetOverride === undefined
    ? undefined
    : parseLotQuantityValue(targetOverride);
  const resolvedProducedOverride = producedOverride === undefined
    ? undefined
    : parseLotQuantityValue(producedOverride);
  const targetValue = resolvedTargetOverride !== undefined
    ? resolvedTargetOverride
    : parseLotQuantityValue(lotData?.target);

  base.id = newLotId;
  base.dashboardId = nextDashboardId;
  base.sourceLotId = lotData?.id || newLotId;
  base.migratedFromDashboard = sourceDashboardId;
  base.produced = resolvedProducedOverride !== undefined ? resolvedProducedOverride : 0;
  base.status = 'future';
  base.startDate = null;
  base.endDate = null;
  base.order = Date.now();
  base.target = targetValue;

  if (parentLotId) {
    base.parentLotId = parentLotId;
  } else if (Object.prototype.hasOwnProperty.call(base, 'parentLotId')) {
    delete base.parentLotId;
  }

  if (variationData) {
    base.variations = [cloneDeep(variationData)];
  } else {
    const rawVariations = Array.isArray(lotData?.variations) ? lotData.variations : [];
    if (rawVariations.length > 0) {
      base.variations = rawVariations.map((variation, index) => {
        const cloned = cloneDeep(variation) || {};
        cloned.target = parseLotQuantityValue(variation?.target ?? variation?.produced);
        cloned.produced = 0;
        cloned.variationKey = cloned.variationKey || buildLotVariationKey(cloned, index);
        return cloned;
      });
    } else if (Object.prototype.hasOwnProperty.call(base, 'variations')) {
      delete base.variations;
    }
  }

  const existingLaundrySentAt = lotData?.laundrySentAt ?? null;
  const normalizedLaundrySentAt = existingLaundrySentAt || (nextDashboardId === 'lavanderia' ? new Date().toISOString() : null);
  base.laundrySentAt = normalizedLaundrySentAt;
  base.laundryReturnedAt = lotData?.laundryReturnedAt ?? null;

  if (variationData) {
    base.laundryReturnDetails = [];
  } else if (Array.isArray(lotData?.laundryReturnDetails) && lotData.laundryReturnDetails.length > 0) {
    base.laundryReturnDetails = lotData.laundryReturnDetails
      .map((detail) => (typeof detail === 'object' && detail !== null ? cloneDeep(detail) : null))
      .filter(Boolean);
  } else {
    base.laundryReturnDetails = [];
  }

  const history = Array.isArray(lotData?.migrationHistory)
    ? lotData.migrationHistory.map((entry) => (typeof entry === 'object' && entry !== null ? cloneDeep(entry) : entry))
    : [];

  if (historyEntry) {
    const alreadyRecorded = history.some(
      (entry) => entry
        && entry.fromDashboardId === historyEntry.fromDashboardId
        && entry.toDashboardId === historyEntry.toDashboardId
        && entry.sourceLotId === historyEntry.sourceLotId
        && (entry.targetLotId || entry.lotId) === (historyEntry.targetLotId || historyEntry.lotId),
    );
    if (!alreadyRecorded) {
      history.push(historyEntry);
    }
  }

  base.migrationHistory = history;

  if (typeof customName === 'string' && customName.trim().length > 0) {
    base.customName = customName.trim();
  }

  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    base.displayName = displayName.trim();
  }

  return base;
};

const sanitizeLotIdSegment = (value, fallback) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return fallback;
  }
  return normalized.replace(/[^a-zA-Z0-9_-]/g, '-');
};

const haveSameElements = (first = [], second = []) => {
  if (!Array.isArray(first) || !Array.isArray(second)) {
    return false;
  }
  if (first.length !== second.length) {
    return false;
  }
  const sortedFirst = [...first].sort();
  const sortedSecond = [...second].sort();
  return sortedFirst.every((value, index) => value === sortedSecond[index]);
};

const findMatchingHistoryEntry = (history, targetEntry) => {
  if (!Array.isArray(history) || !targetEntry) {
    return null;
  }
  return history.find(
    (entry) => entry
      && entry.fromDashboardId === targetEntry.fromDashboardId
      && entry.toDashboardId === targetEntry.toDashboardId
      && entry.sourceLotId === targetEntry.sourceLotId
      && (entry.targetLotId || entry.lotId) === (targetEntry.targetLotId || targetEntry.lotId),
  );
};

const resolveLotBaseCode = (lotData) => {
  if (!lotData || typeof lotData !== 'object') {
    return 'Lote';
  }

  const sequentialId = lotData.sequentialId;
  if (Number.isFinite(sequentialId)) {
    return `#${sequentialId}`;
  }
  if (typeof sequentialId === 'string' && sequentialId.trim().length > 0) {
    return sequentialId.trim();
  }

  const candidates = [
    'customName',
    'displayName',
    'lotCode',
    'productCode',
    'productName',
    'id',
  ];

  for (const field of candidates) {
    const value = lotData[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return 'Lote';
};

const buildVariationDisplayLabel = (variation, index) => {
  if (!variation || typeof variation !== 'object') {
    return `Variação ${index + 1}`;
  }

  const label = typeof variation.label === 'string' ? variation.label.trim() : '';
  if (label) {
    return label;
  }

  const variationId = typeof variation.variationId === 'string' ? variation.variationId.trim() : '';
  if (variationId) {
    return variationId;
  }

  return `Variação ${index + 1}`;
};

const slugifyValue = (value = '') => {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const buildVariationSplitBlueprints = ({ lotData, currentDashboardId, nextDashboardId, sourceLotId }) => {
  const rawVariations = Array.isArray(lotData?.variations) ? lotData.variations : [];
  if (rawVariations.length === 0) {
    return [];
  }

  const baseCode = resolveLotBaseCode(lotData);

  return rawVariations
    .map((variation, index) => {
      const variationId = typeof variation?.variationId === 'string' && variation.variationId.trim().length > 0
        ? variation.variationId.trim()
        : '';
      const variationKey = variation?.variationKey || buildLotVariationKey(variation, index);
      const rawSplitCode = typeof variation?.splitCode === 'string'
        ? variation.splitCode.trim()
        : typeof variation?.childSuffix === 'string'
          ? variation.childSuffix.trim()
          : '';
      const displayLabel = buildVariationDisplayLabel(variation, index);
      const identifierSource = rawSplitCode || slugifyValue(displayLabel) || variationId || variationKey;
      const identifier = sanitizeLotIdSegment(identifierSource, `variation-${index + 1}`);
      const childLotId = `${sourceLotId}::${identifier}`;

      const childSuffix = rawSplitCode || displayLabel;
      const childName = `${baseCode} - ${childSuffix}`.trim();

      const normalizedVariation = cloneDeep(variation) || {};
      const variationTarget = parseLotQuantityValue(variation?.target ?? variation?.produced);
      normalizedVariation.target = variationTarget;
      normalizedVariation.produced = 0;
      normalizedVariation.variationKey = variation?.variationKey || buildLotVariationKey(variation, index);
      if (variationId) {
        normalizedVariation.variationId = variationId;
      }
      normalizedVariation.splitCode = rawSplitCode;
      normalizedVariation.childSuffix = rawSplitCode;

      const producedValue = variationTarget;
      const bomVariation = cloneDeep(variation) || {};
      bomVariation.variationKey = normalizedVariation.variationKey;
      if (variationId) {
        bomVariation.variationId = variationId;
      }
      bomVariation.produced = producedValue;
      bomVariation.target = producedValue;
      bomVariation.splitCode = rawSplitCode;
      bomVariation.childSuffix = rawSplitCode;

      const bomLotData = {
        id: childLotId,
        productId: lotData?.productId,
        productBaseId: lotData?.productBaseId,
        dashboardId: nextDashboardId,
        variations: [bomVariation],
        target: producedValue,
        produced: producedValue,
      };

      const baseHistoryEntry = {
        fromDashboardId: currentDashboardId,
        toDashboardId: nextDashboardId,
        sourceLotId,
        targetLotId: childLotId,
        lotId: childLotId,
      };

      return {
        variationId,
        variationKey: normalizedVariation.variationKey,
        childLotId,
        childName,
        normalizedVariation,
        bomLotData,
        baseHistoryEntry,
      };
    })
    .filter(Boolean);
};

const migrateLotWithVariationSplit = async ({
  change,
  lotData,
  currentDashboardId,
  nextDashboardId,
  migrationUser,
  fallbackLotId,
  laundryAnalysis = null,
}) => {
  const sourceLotId = typeof lotData?.id === 'string' && lotData.id.trim().length > 0
    ? lotData.id.trim()
    : (typeof fallbackLotId === 'string' && fallbackLotId.trim().length > 0
      ? fallbackLotId.trim()
      : change.after.id);

  const migratingFromLaundry = currentDashboardId === 'lavanderia';
  const laundryContext = laundryAnalysis || (migratingFromLaundry ? computeLaundryReturnAnalysis(lotData) : null);
  if (migratingFromLaundry && laundryContext && laundryContext.summary.requiresAttention) {
    console.warn('Migração de lote: retorno de lavanderia incompleto durante divisão por variações.', {
      lotId: sourceLotId,
      fromDashboardId: currentDashboardId,
      toDashboardId: nextDashboardId,
      summary: laundryContext.summary,
    });
    return null;
  }

  const blueprints = buildVariationSplitBlueprints({
    lotData,
    currentDashboardId,
    nextDashboardId,
    sourceLotId,
  });

  if (blueprints.length === 0) {
    console.log('Migração de lote: divisão por variações habilitada, mas nenhuma variação encontrada.', {
      lotId: sourceLotId,
      fromDashboardId: currentDashboardId,
      toDashboardId: nextDashboardId,
    });
    return null;
  }

  const destinationLotRefs = blueprints.map((blueprint) => db
    .collection('dashboards')
    .doc(nextDashboardId)
    .collection('lots')
    .doc(blueprint.childLotId));

  const transactionResult = await db.runTransaction(async (transaction) => {
    const sourceSnapshot = await transaction.get(change.after.ref);
    const sourceData = sourceSnapshot.data() || {};
    const existingHistory = Array.isArray(sourceData?.migrationHistory) ? sourceData.migrationHistory : [];
    const existingNextLotIds = Array.isArray(sourceData?.nextDashboardLotIds) ? sourceData.nextDashboardLotIds : [];

    const destinationSnapshots = await Promise.all(destinationLotRefs.map((ref) => transaction.get(ref)));

    const createdChildren = [];
    const historyEntriesToAdd = [];

    for (let index = 0; index < blueprints.length; index += 1) {
      const blueprint = blueprints[index];
      const destinationSnapshot = destinationSnapshots[index];

      const historyEntry = (() => {
        const existingEntry = findMatchingHistoryEntry(existingHistory, blueprint.baseHistoryEntry);
        if (existingEntry) {
          return existingEntry;
        }
        return {
          ...blueprint.baseHistoryEntry,
          migratedAt: new Date().toISOString(),
        };
      })();

      if (destinationSnapshot.exists) {
        const destinationData = destinationSnapshot.data() || {};
        if (
          destinationData?.migratedFromDashboard === currentDashboardId
          && destinationData?.sourceLotId === sourceLotId
          && destinationData?.parentLotId === sourceLotId
        ) {
          if (!findMatchingHistoryEntry(existingHistory, blueprint.baseHistoryEntry)) {
            historyEntriesToAdd.push(historyEntry);
          }
          continue;
        }

        console.error('Migração de lote: conflito detectado para variação no destino.', {
          lotId: blueprint.childLotId,
          sourceLotId,
          fromDashboardId: currentDashboardId,
          toDashboardId: nextDashboardId,
        });
        return { conflict: true };
      }

      const baseLotData = createMigratedLotBaseData({
        lotData,
        newLotId: blueprint.childLotId,
        nextDashboardId,
        sourceDashboardId: currentDashboardId,
        historyEntry,
        targetOverride: 0,
        producedOverride: 0,
        parentLotId: sourceLotId,
        variationData: {
          ...blueprint.normalizedVariation,
          variationKey: blueprint.variationKey,
        },
        customName: blueprint.childName,
        displayName: blueprint.childName,
      });

      const lotDataForFirestore = {
        ...baseLotData,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        migratedBy: migrationUser,
      };

      if (nextDashboardId === 'lavanderia') {
        const normalizedSentAt = baseLotData.laundrySentAt || new Date().toISOString();
        baseLotData.laundrySentAt = normalizedSentAt;
        lotDataForFirestore.laundrySentAt = normalizedSentAt;
      }

      lotDataForFirestore.laundryReturnDetails = Array.isArray(baseLotData.laundryReturnDetails)
        ? baseLotData.laundryReturnDetails
        : [];

      transaction.set(destinationLotRefs[index], lotDataForFirestore);
      createdChildren.push({
        lotId: blueprint.childLotId,
        lotDataForBom: {
          ...blueprint.bomLotData,
          migratedBy: migrationUser,
        },
      });

      if (!findMatchingHistoryEntry(existingHistory, blueprint.baseHistoryEntry)) {
        historyEntriesToAdd.push(historyEntry);
      }
    }

    const childIds = blueprints.map((blueprint) => blueprint.childLotId);
    const primaryChildId = childIds[0] || null;

    const parentUpdate = {};

    if (sourceData?.migratedToDashboardId !== nextDashboardId) {
      parentUpdate.migratedToDashboardId = nextDashboardId;
    }

    if (!haveSameElements(existingNextLotIds, childIds)) {
      parentUpdate.nextDashboardLotIds = childIds;
    }

    if ((sourceData?.nextDashboardLotId || null) !== primaryChildId) {
      parentUpdate.nextDashboardLotId = primaryChildId;
    }

    if (historyEntriesToAdd.length > 0) {
      parentUpdate.migrationHistory = admin.firestore.FieldValue.arrayUnion(...historyEntriesToAdd);
    }

    if (laundryContext && laundryContext.details.length > 0) {
      parentUpdate.laundryReturnDetails = laundryContext.details;
    }

    const existingMetadata = sourceData?.migrationMetadata || {};
    const existingLotIds = Array.isArray(existingMetadata?.lotIds) ? existingMetadata.lotIds : [];
    const shouldUpdateMetadata = (
      createdChildren.length > 0
      || !existingMetadata
      || existingMetadata.fromDashboardId !== currentDashboardId
      || existingMetadata.toDashboardId !== nextDashboardId
      || !haveSameElements(existingLotIds, childIds)
      || (existingMetadata.lotId || null) !== primaryChildId
    );

    if (shouldUpdateMetadata) {
      parentUpdate.migrationMetadata = {
        fromDashboardId: currentDashboardId,
        toDashboardId: nextDashboardId,
        lotId: primaryChildId,
        lotIds: childIds,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
    }

    if (Object.keys(parentUpdate).length > 0) {
      transaction.update(change.after.ref, parentUpdate);
    }

    return {
      conflict: false,
      createdChildren,
      childIds,
    };
  });

  if (!transactionResult || transactionResult.conflict) {
    if (transactionResult?.conflict) {
      console.error('Migração de lote: conflito detectado durante divisão por variações.', {
        sourceLotId,
        fromDashboardId: currentDashboardId,
        toDashboardId: nextDashboardId,
      });
    }
    return null;
  }

  const createdChildren = Array.isArray(transactionResult.createdChildren)
    ? transactionResult.createdChildren.filter(Boolean)
    : [];

  if (createdChildren.length === 0) {
    console.log('Migração de lote: lotes de variação já existentes. Nenhuma criação necessária.', {
      sourceLotId,
      toDashboardId: nextDashboardId,
    });
    return null;
  }

  for (const child of createdChildren) {
    await applyBillOfMaterialsForMigration({
      lotData: child.lotDataForBom,
      sourceLotData: lotData,
      sourceDashboardId: currentDashboardId,
      destinationDashboardId: nextDashboardId,
    });
  }

  console.log('Migração de lote concluída com divisão por variações.', {
    sourceLotId,
    createdLotIds: createdChildren.map((child) => child.lotId),
    fromDashboardId: currentDashboardId,
    toDashboardId: nextDashboardId,
  });

  return null;
};

const applyBillOfMaterialsForMigration = async ({
  lotData,
  sourceLotData,
  sourceDashboardId,
  destinationDashboardId,
}) => {
  if (!lotData || !destinationDashboardId) {
    return;
  }

  if (!lotData.productId) {
    console.warn('Migração de lote: lote sem produto associado. Ficha técnica não será aplicada.', {
      lotId: lotData.id,
      destinationDashboardId,
    });
    return;
  }

  const user = resolveMigrationUser(sourceLotData);
  if (!user?.uid) {
    console.warn('Migração de lote: usuário responsável não identificado. Ficha técnica ignorada.', {
      lotId: lotData.id,
    });
    return;
  }

  const productionDetails = buildLotProductionDetailsForBillOfMaterials(lotData);
  if (productionDetails.length === 0) {
    console.log('Migração de lote: nenhum detalhe de produção para ficha técnica.', {
      lotId: lotData.id,
    });
    return;
  }

  const movementDetails = buildBillOfMaterialsMovementDetails({ updatedDetails: productionDetails });
  if (movementDetails.length === 0) {
    console.log('Migração de lote: ficha técnica sem movimentações calculadas.', {
      lotId: lotData.id,
    });
    return;
  }

  const [productSources, stockProducts] = await Promise.all([
    loadProductSources({
      sourceDashboardId,
      destinationDashboardId,
      productId: lotData.productId,
    }),
    loadStockProducts(),
  ]);

  const hasProductData = productSources.some((source) => Array.isArray(source) && source.length > 0);
  if (!hasProductData) {
    console.warn('Migração de lote: dados de produto indisponíveis para aplicar ficha técnica.', {
      productId: lotData.productId,
      sourceDashboardId,
      destinationDashboardId,
    });
    return;
  }

  if (stockProducts.length === 0) {
    console.warn('Migração de lote: produtos de estoque indisponíveis. Ficha técnica não aplicada.', {
      destinationDashboardId,
    });
    return;
  }

  const batch = db.batch();

  applyBillOfMaterialsMovements({
    db,
    batch,
    productionDetails: movementDetails,
    productSources,
    stockProducts,
    sourceEntryId: lotData.id,
    user,
    movementTimestamp: admin.firestore.Timestamp.now(),
    dashboardId: destinationDashboardId,
  });

  try {
    await batch.commit();
    console.log('Migração de lote: ficha técnica aplicada com sucesso.', {
      lotId: lotData.id,
      destinationDashboardId,
    });
  } catch (error) {
    console.error('Migração de lote: erro ao registrar baixas de ficha técnica.', {
      lotId: lotData.id,
      destinationDashboardId,
      error,
    });
  }
};

exports.handleLotStatusCompletion = functions
  .region(FUNCTION_REGION)
  .firestore.document('dashboards/{dashboardId}/lots/{lotId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data();
    const afterData = change.after.data();

    if (!beforeData || !afterData) {
      return null;
    }

    const previousStatus = typeof beforeData.status === 'string' ? beforeData.status.toLowerCase() : '';
    const currentStatus = typeof afterData.status === 'string' ? afterData.status.toLowerCase() : '';

    const wasEligible = previousStatus === 'ongoing' || previousStatus === 'future';
    const becameCompleted = currentStatus.startsWith('completed');

    if (!wasEligible || !becameCompleted) {
      return null;
    }

    const currentDashboardId = context.params.dashboardId;
    const lotDocumentId = context.params.lotId;

    try {
      const nextDashboard = await determineNextDashboard(currentDashboardId);
      if (!nextDashboard?.id) {
        console.log('Migração de lote: nenhum próximo dashboard configurado.', {
          currentDashboardId,
          lotId: lotDocumentId,
        });
        return null;
      }

      const nextDashboardId = nextDashboard.id;

      if (nextDashboard?.lotFlowStep?.mode && nextDashboard.lotFlowStep.mode !== 'auto') {
        console.log('Migração de lote: próximo dashboard configurado para modo manual. Migração automática ignorada.', {
          lotId: lotDocumentId,
          nextDashboardId,
          mode: nextDashboard.lotFlowStep.mode,
        });
        return null;
      }

      if (afterData?.migratedToDashboardId === nextDashboardId) {
        console.log('Migração de lote: lote já migrado anteriormente.', {
          lotId: afterData?.id || lotDocumentId,
          nextDashboardId,
        });
        return null;
      }

      const migratingFromLaundry = currentDashboardId === 'lavanderia';
      const migratingIntoLaundry = nextDashboardId === 'lavanderia';

      let laundryReturnContext = null;
      if (migratingFromLaundry) {
        laundryReturnContext = computeLaundryReturnAnalysis(afterData);
        if (laundryReturnContext.summary.requiresAttention) {
          console.warn('Migração de lote: retorno de lavanderia incompleto. Migração bloqueada.', {
            lotId: lotDocumentId,
            currentDashboardId,
            nextDashboardId,
            summary: laundryReturnContext.summary,
          });
          return null;
        }
      }

      const splitMode = typeof nextDashboard?.lotFlowStep?.splitMode === 'string'
        ? nextDashboard.lotFlowStep.splitMode
        : 'never';

      const migrationUser = resolveMigrationUser(afterData);

      if (
        splitMode === 'variations'
        && Array.isArray(afterData?.variations)
        && afterData.variations.length > 0
      ) {
        return migrateLotWithVariationSplit({
          change,
          lotData: afterData,
          currentDashboardId,
          nextDashboardId,
          migrationUser,
          fallbackLotId: lotDocumentId,
          laundryAnalysis: laundryReturnContext,
        });
      }

      const newLotId = typeof afterData?.id === 'string' && afterData.id
        ? afterData.id
        : lotDocumentId;

      const existingNextLotIds = Array.isArray(afterData?.nextDashboardLotIds)
        ? afterData.nextDashboardLotIds
        : [];
      const shouldUpdateNextLotIds = existingNextLotIds.length !== 1 || existingNextLotIds[0] !== newLotId;
      const existingMetadataLotIds = Array.isArray(afterData?.migrationMetadata?.lotIds)
        ? afterData.migrationMetadata.lotIds
        : [];
      const shouldUpdateMetadataLotIds = !haveSameElements(existingMetadataLotIds, [newLotId]);

      const migrationHistoryEntry = {
        fromDashboardId: currentDashboardId,
        toDashboardId: nextDashboardId,
        sourceLotId: typeof afterData?.id === 'string' && afterData.id ? afterData.id : lotDocumentId,
        lotId: newLotId,
        targetLotId: newLotId,
        migratedAt: new Date().toISOString(),
      };

      const baseLotData = createMigratedLotBaseData({
        lotData: afterData,
        newLotId,
        nextDashboardId,
        sourceDashboardId: currentDashboardId,
        historyEntry: migrationHistoryEntry,
      });

      if (laundryReturnContext && laundryReturnContext.details.length > 0) {
        baseLotData.laundryReturnDetails = laundryReturnContext.details.map((detail) => ({ ...detail }));
      }

      const lotDataForBom = cloneDeep(baseLotData) || {};
      lotDataForBom.migratedBy = migrationUser;

      const lotDataForFirestore = {
        ...baseLotData,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        migratedBy: migrationUser,
      };

      if (migratingIntoLaundry) {
        const normalizedSentAt = baseLotData.laundrySentAt || new Date().toISOString();
        baseLotData.laundrySentAt = normalizedSentAt;
        lotDataForBom.laundrySentAt = normalizedSentAt;
        lotDataForFirestore.laundrySentAt = normalizedSentAt;
      }

      if (laundryReturnContext && laundryReturnContext.details.length > 0) {
        lotDataForFirestore.laundryReturnDetails = laundryReturnContext.details;
        const validationTimestamp = admin.firestore.FieldValue.serverTimestamp();
        const hasIncomplete = laundryReturnContext.summary.hasIncomplete;
        lotDataForFirestore.laundryReturnValidation = {
          status: hasIncomplete ? 'pending' : 'complete',
          totalTarget: laundryReturnContext.summary.totalTarget,
          totalReturned: laundryReturnContext.summary.totalReturned,
          hasDivergence: laundryReturnContext.summary.hasDivergence,
          hasIncomplete,
          updatedAt: validationTimestamp,
        };
      }

      const destinationLotRef = db
        .collection('dashboards')
        .doc(nextDashboardId)
        .collection('lots')
        .doc(newLotId);

      const migrationHistoryUpdate = {
        ...migrationHistoryEntry,
      };

      const transactionResult = await db.runTransaction(async (transaction) => {
        const destinationSnapshot = await transaction.get(destinationLotRef);
        if (destinationSnapshot.exists) {
          const destinationData = destinationSnapshot.data();
          if (
            destinationData?.migratedFromDashboard === currentDashboardId
            && destinationData?.sourceLotId === (afterData?.id || lotDocumentId)
          ) {
            console.log('Migração de lote: destino já contém registro migrado. Atualização do lote original garantida.', {
              lotId: newLotId,
              nextDashboardId,
            });

            if (
              afterData?.migratedToDashboardId !== nextDashboardId
              || afterData?.nextDashboardLotId !== newLotId
              || shouldUpdateNextLotIds
              || shouldUpdateMetadataLotIds
            ) {
              transaction.update(change.after.ref, {
                migratedToDashboardId: nextDashboardId,
                nextDashboardLotId: newLotId,
                nextDashboardLotIds: [newLotId],
                migrationMetadata: {
                  fromDashboardId: currentDashboardId,
                  toDashboardId: nextDashboardId,
                  lotId: newLotId,
                  lotIds: [newLotId],
                  migratedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                migrationHistory: admin.firestore.FieldValue.arrayUnion(migrationHistoryUpdate),
              });
            }

            return { created: false, alreadyExists: true, conflict: false };
          }

          console.error('Migração de lote: conflito detectado no destino. Nenhuma ação realizada.', {
            currentDashboardId,
            nextDashboardId,
            lotId: newLotId,
          });

          return { created: false, alreadyExists: true, conflict: true };
        }

        transaction.set(destinationLotRef, lotDataForFirestore);
        transaction.update(change.after.ref, {
          migratedToDashboardId: nextDashboardId,
          nextDashboardLotId: newLotId,
          nextDashboardLotIds: [newLotId],
          migrationMetadata: {
            fromDashboardId: currentDashboardId,
            toDashboardId: nextDashboardId,
            lotId: newLotId,
            lotIds: [newLotId],
            migratedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          migrationHistory: admin.firestore.FieldValue.arrayUnion(migrationHistoryUpdate),
        });

        return { created: true, alreadyExists: false, conflict: false };
      });

      if (transactionResult.conflict) {
        return null;
      }

      if (!transactionResult.created) {
        return null;
      }

      await applyBillOfMaterialsForMigration({
        lotData: lotDataForBom,
        sourceLotData: afterData,
        sourceDashboardId: currentDashboardId,
        destinationDashboardId: nextDashboardId,
      });

      console.log('Migração de lote concluída com sucesso.', {
        lotId: newLotId,
        fromDashboardId: currentDashboardId,
        toDashboardId: nextDashboardId,
      });

      return null;
    } catch (error) {
      console.error('Migração de lote: erro inesperado durante processamento.', {
        dashboardId: currentDashboardId,
        lotId: lotDocumentId,
        error,
      });
      return null;
    }
  });

exports.handleLotFlowSettingsChange = functions
  .region(FUNCTION_REGION)
  .firestore.document(`${LOT_FLOW_SETTINGS_COLLECTION}/${LOT_FLOW_SETTINGS_DOCUMENT}`)
  .onWrite(() => {
    invalidateDashboardCaches();
    console.log('Fluxo de lotes atualizado. Cache invalidado.');
    return null;
  });

exports.consolidateLaundryReturnDetails = functions
  .region(FUNCTION_REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    }

    const dashboardId = typeof data?.dashboardId === 'string' ? data.dashboardId.trim() : '';
    const lotId = typeof data?.lotId === 'string' ? data.lotId.trim() : '';

    if (!dashboardId || !lotId) {
      throw new functions.https.HttpsError('invalid-argument', 'dashboardId e lotId são obrigatórios.');
    }

    const lotRef = db
      .collection('dashboards')
      .doc(dashboardId)
      .collection('lots')
      .doc(lotId);

    const snapshot = await lotRef.get();
    if (!snapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Lote não encontrado.');
    }

    const lotData = snapshot.data() || {};
    const { details, summary } = computeLaundryReturnAnalysis(lotData);

    const timestamp = admin.firestore.Timestamp.now();
    const email = typeof context.auth.token?.email === 'string' ? context.auth.token.email : null;

    const validationPayload = {
      status: summary.hasIncomplete || summary.requiresAttention ? 'pending' : 'complete',
      totalTarget: summary.totalTarget,
      totalReturned: summary.totalReturned,
      hasDivergence: summary.hasDivergence,
      hasIncomplete: summary.hasIncomplete,
      updatedAt: timestamp,
      updatedBy: {
        uid: context.auth.uid,
        email,
      },
    };

    await lotRef.update({
      laundryReturnDetails: Array.isArray(details) ? details : [],
      laundryReturnValidation: validationPayload,
    });

    return {
      details,
      summary: {
        ...summary,
        status: validationPayload.status,
        updatedAt: timestamp.toDate().toISOString(),
      },
    };
  });
