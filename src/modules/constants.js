export const raceBullLogoUrl = "https://firebasestorage.googleapis.com/v0/b/quadrodeproducao.firebasestorage.app/o/assets%2FLOGO%20PROPRIET%C3%81RIA.png?alt=media&token=a16d015f-e8ca-4b3c-b744-7cef3ab6504b";

export const initialDashboards = [
  { id: 'producao', name: 'Quadro da Produção', order: 1 },
  { id: 'acabamento', name: 'Quadro do Acabamento', order: 2 },
  { id: 'estoque', name: 'Quadro do Estoque', order: 3 },
  { id: 'corte', name: 'Quadro do Corte', order: 4 },
  { id: 'travete', name: 'Quadro do Travete', order: 5 },
];

export const FIXED_PERIODS = ['08:00', '09:00', '10:00', '11:00', '11:45', '14:00', '15:00', '16:00', '17:00'];

export const TRAVETE_MACHINES = ['Travete 2 Agulhas', 'Travete 1 Agulha', 'Travete Convencional'];

export const ALL_PERMISSIONS = {
  MANAGE_DASHBOARDS: 'Gerenciar Quadros (Criar/Renomear/Excluir/Reordenar)',
  MANAGE_PRODUCTS: 'Gerenciar Produtos (Criar/Editar/Excluir)',
  MANAGE_LOTS: 'Gerenciar Lotes (Criar/Editar/Excluir/Reordenar)',
  ADD_ENTRIES: 'Adicionar Lançamentos de Produção',
  EDIT_ENTRIES: 'Editar Lançamentos de Produção',
  DELETE_ENTRIES: 'Excluir Lançamentos de Produção',
  VIEW_TRASH: 'Visualizar Lixeira',
  RESTORE_TRASH: 'Restaurar Itens da Lixeira',
  MANAGE_SETTINGS: 'Acessar e Gerenciar Configurações de Administrador',
};

export const defaultRoles = {
  admin: { id: 'admin', name: 'Administrador', permissions: Object.keys(ALL_PERMISSIONS) },
  editor: { id: 'editor', name: 'Editor', permissions: ['MANAGE_PRODUCTS', 'MANAGE_LOTS', 'ADD_ENTRIES', 'EDIT_ENTRIES', 'DELETE_ENTRIES'] },
  viewer: { id: 'viewer', name: 'Visualizador', permissions: [] },
};
