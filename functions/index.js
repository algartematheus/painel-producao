const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

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
