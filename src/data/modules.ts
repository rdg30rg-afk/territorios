import type { IconoNombre } from '../lib/iconos'

export type ModuleDefinition = {
  path: string
  title: string
  summary: string
  icon: IconoNombre
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
    summary: 'Lo que espera una decisión tuya.',
    icon: 'inicio',
    key: 'dashboard',
  },
  {
    path: '/mapas',
    title: 'Mapas y Territorios',
    summary: 'El mapa, y los territorios dibujados sobre él.',
    icon: 'territorios',
    key: 'mapas',
  },
  {
    path: '/conductores',
    title: 'Conductores',
    summary: 'Quién conduce las salidas.',
    icon: 'conductor',
    key: 'conductores',
  },
  {
    path: '/grupos',
    title: 'Grupos para el Servicio',
    summary: 'Quién está a cargo de cada grupo.',
    icon: 'grupo',
    key: 'grupos',
  },
  {
    path: '/salidas',
    title: 'Salidas',
    summary: 'Cuándo y dónde se sale a predicar.',
    icon: 'salidas',
    key: 'salidas',
  },
  {
    path: '/salidas-grupo',
    title: 'Salidas Grupo de Servicio',
    summary: 'Los territorios que reserva cada grupo.',
    icon: 'grupo',
    key: 'salidas_grupo',
  },
  {
    path: '/territorio-personal',
    title: 'Territorio Personal',
    summary: 'Territorios de una persona o una familia.',
    icon: 'personal',
    key: 'territorio_personal',
  },
]
