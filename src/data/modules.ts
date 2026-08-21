export type ModuleDefinition = {
  path: string
  title: string
  summary: string
  icon: string
  key: 'dashboard' | 'mapas' | 'conductores' | 'grupos' | 'salidas'
}

export const modules: ModuleDefinition[] = [
  {
    path: '/',
    title: 'Inicio',
    summary: 'Resumen del sistema y estado del MVP.',
    icon: '01',
    key: 'dashboard',
  },
  {
    path: '/mapas',
    title: 'Mapas y Territorios',
    summary: 'Mapa de San Juan, zonas y futuros poligonos.',
    icon: '02',
    key: 'mapas',
  },
  {
    path: '/conductores',
    title: 'Conductores',
    summary: 'Altas y consulta de conductores.',
    icon: '03',
    key: 'conductores',
  },
  {
    path: '/grupos',
    title: 'Grupos para el Servicio',
    summary: 'Superintendentes, siervos y grupos.',
    icon: '04',
    key: 'grupos',
  },
  {
    path: '/salidas',
    title: 'Salidas',
    summary: 'Puntos de encuentro, horarios y asignaciones.',
    icon: '05',
    key: 'salidas',
  },
]
