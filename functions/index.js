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
let cachedDashboardOrder = [];
let cachedDashboardFetchedAt = 0;

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

  const currentIndex = dashboards.findIndex((dashboard) => dashboard.id === currentDashboardId);
  if (currentIndex < 0) {
    console.warn('Dashboard atual não encontrado na ordem configurada.', { currentDashboardId });
    return null;
  }

  for (let index = currentIndex + 1; index < dashboards.length; index += 1) {
    const candidate = dashboards[index];
    if (isDashboardActive(candidate)) {
      return candidate;
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
    'migrationMetadata',
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      delete base[key];
    }
  });

  const targetValue = parseLotQuantityValue(lotData?.target);

  base.id = newLotId;
  base.dashboardId = nextDashboardId;
  base.sourceLotId = lotData?.id || newLotId;
  base.migratedFromDashboard = sourceDashboardId;
  base.produced = 0;
  base.status = 'future';
  base.startDate = null;
  base.endDate = null;
  base.order = Date.now();
  base.target = targetValue;

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

  const history = Array.isArray(lotData?.migrationHistory)
    ? lotData.migrationHistory.map((entry) => (typeof entry === 'object' && entry !== null ? cloneDeep(entry) : entry))
    : [];

  if (historyEntry) {
    const alreadyRecorded = history.some(
      (entry) => entry
        && entry.fromDashboardId === historyEntry.fromDashboardId
        && entry.toDashboardId === historyEntry.toDashboardId
        && entry.sourceLotId === historyEntry.sourceLotId,
    );
    if (!alreadyRecorded) {
      history.push(historyEntry);
    }
  }

  base.migrationHistory = history;

  return base;
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

      if (afterData?.migratedToDashboardId === nextDashboardId) {
        console.log('Migração de lote: lote já migrado anteriormente.', {
          lotId: afterData?.id || lotDocumentId,
          nextDashboardId,
        });
        return null;
      }

      const newLotId = typeof afterData?.id === 'string' && afterData.id
        ? afterData.id
        : lotDocumentId;

      const migrationHistoryEntry = {
        fromDashboardId: currentDashboardId,
        toDashboardId: nextDashboardId,
        sourceLotId: typeof afterData?.id === 'string' && afterData.id ? afterData.id : lotDocumentId,
        migratedAt: new Date().toISOString(),
      };

      const migrationUser = resolveMigrationUser(afterData);

      const baseLotData = createMigratedLotBaseData({
        lotData: afterData,
        newLotId,
        nextDashboardId,
        sourceDashboardId: currentDashboardId,
        historyEntry: migrationHistoryEntry,
      });

      const lotDataForBom = cloneDeep(baseLotData) || {};
      lotDataForBom.migratedBy = migrationUser;

      const lotDataForFirestore = {
        ...baseLotData,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        migratedBy: migrationUser,
      };

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
            ) {
              transaction.update(change.after.ref, {
                migratedToDashboardId: nextDashboardId,
                nextDashboardLotId: newLotId,
                migrationMetadata: {
                  fromDashboardId: currentDashboardId,
                  toDashboardId: nextDashboardId,
                  lotId: newLotId,
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
          migrationMetadata: {
            fromDashboardId: currentDashboardId,
            toDashboardId: nextDashboardId,
            lotId: newLotId,
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
