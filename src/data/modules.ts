export type ModuleDefinition = {
  path: string
  title: string
  summary: string
  icon: string
  key:
    | 'dashboard'
    | 'mapas'
    | 'conductores'
    | 'grupos'
    | 'salidas'
    | 'salidas_grupo'
    | 'territorio_personal'
}

export const modules: ModuleDefinition[] = [
  {
    path: '/',
    title: 'Inicio',
    summary: 'Lo que espera una decision tuya.',
    icon: '01',
    key: 'dashboard',
  },
  {
    path: '/mapas',
    title: 'Mapas y Territorios',
    summary: 'El mapa, y los territorios dibujados sobre el.',
    icon: '02',
    key: 'mapas',
  },
  {
    path: '/conductores',
    title: 'Conductores',
    summary: 'Quien puede llevar hermanos al territorio.',
    icon: '03',
    key: 'conductores',
  },
  {
    path: '/grupos',
    title: 'Grupos para el Servicio',
    summary: 'Quien esta a cargo de cada grupo.',
    icon: '04',
    key: 'grupos',
  },
  {
    path: '/salidas',
    title: 'Salidas',
    summary: 'Cuando y donde se sale a predicar.',
    icon: '05',
    key: 'salidas',
  },
  {
    path: '/salidas-grupo',
    title: 'Salidas Grupo de Servicio',
    summary: 'Los territorios que reserva cada grupo.',
    icon: '06',
    key: 'salidas_grupo',
  },
  {
    path: '/territorio-personal',
    title: 'Territorio Personal',
    summary: 'Territorios de una persona o una familia.',
    icon: '07',
    key: 'territorio_personal',
  },
]
