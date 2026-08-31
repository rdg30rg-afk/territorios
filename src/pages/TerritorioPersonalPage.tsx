import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type TerritoryRecord = {
  id: string
  name: string
  description: string | null
}

type PersonalTerritoryReservation = {
  id: string
  territory_id: string
  reserved_for: string
  status: 'activa' | 'liberada'
  reserved_at: string
  released_at: string | null
}

const ONE_MONTH_IN_MS = 30 * 24 * 60 * 60 * 1000

function getReservedDays(reservedAt: string) {
  return Math.floor((Date.now() - new Date(reservedAt).getTime()) / (24 * 60 * 60 * 1000))
}

function isMonthOld(reservedAt: string) {
  return Date.now() - new Date(reservedAt).getTime() >= ONE_MONTH_IN_MS
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export function TerritorioPersonalPage() {
  const { profile } = useAuth()
  const client = supabase
  const [territories, setTerritories] = useState<TerritoryRecord[]>([])
  const [reservations, setReservations] = useState<PersonalTerritoryReservation[]>([])
  const [territoryId, setTerritoryId] = useState('')
  const [reservedFor, setReservedFor] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const canManagePersonalTerritories = profile?.role === 'admin'

  const activeReservations = useMemo(
    () => reservations.filter((reservation) => reservation.status === 'activa'),
    [reservations],
  )

  const activeReservationsByTerritory = useMemo(() => {
    const map = new Map<string, PersonalTerritoryReservation>()

    activeReservations.forEach((reservation) => {
      map.set(reservation.territory_id, reservation)
    })

    return map
  }, [activeReservations])

  const selectedTerritory = useMemo(
    () => territories.find((territory) => territory.id === territoryId) ?? null,
    [territories, territoryId],
  )

  const overdueReservations = useMemo(
    () => activeReservations.filter((reservation) => isMonthOld(reservation.reserved_at)),
    [activeReservations],
  )

  const filteredReservations = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return activeReservations.filter((reservation) => {
      if (!normalizedSearch) {
        return true
      }

      const territoryName =
        territories.find((territory) => territory.id === reservation.territory_id)
          ?.name ?? ''

      return [territoryName, reservation.reserved_for]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    })
  }, [activeReservations, searchTerm, territories])

  useEffect(() => {
    if (!client) {
      setIsLoading(false)
      return
    }

    let isMounted = true

    const loadData = async () => {
      setIsLoading(true)

      const [
        { data: territoriesData, error: territoriesError },
        { data: reservationsData, error: reservationsError },
      ] = await Promise.all([
        client
          .from('territorios')
          .select('id, name, description')
          .order('name', { ascending: true }),
        client
          .from('territorio_personal_reservas')
          .select('id, territory_id, reserved_for, status, reserved_at, released_at')
          .order('reserved_at', { ascending: false }),
      ])

      if (!isMounted) {
        return
      }

      const loadError = territoriesError?.message || reservationsError?.message

      if (loadError) {
        setError(loadError)
        setTerritories([])
        setReservations([])
      } else {
        setError(null)
        setTerritories((territoriesData as TerritoryRecord[]) ?? [])
        setReservations((reservationsData as PersonalTerritoryReservation[]) ?? [])
      }

      setIsLoading(false)
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [client])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (!client) {
      setError('Primero debes configurar Supabase.')
      return
    }

    if (!canManagePersonalTerritories) {
      setError('Solo un administrador puede reservar territorios personales.')
      return
    }

    if (!territoryId || !reservedFor.trim()) {
      setError('Selecciona un territorio y escribe el nombre de la persona o familia.')
      return
    }

    const currentReservation = activeReservationsByTerritory.get(territoryId)

    if (currentReservation) {
      setError(
        `El territorio ya esta reservado para ${currentReservation.reserved_for}.`,
      )
      return
    }

    setIsSaving(true)

    const { data, error: saveError } = await client
      .from('territorio_personal_reservas')
      .insert({
        territory_id: territoryId,
        reserved_for: reservedFor.trim(),
        status: 'activa',
        created_by: profile?.id ?? null,
      })
      .select('id, territory_id, reserved_for, status, reserved_at, released_at')
      .single()

    if (saveError) {
      setError(saveError.message)
      setIsSaving(false)
      return
    }

    setReservations((current) => [data as PersonalTerritoryReservation, ...current])
    setTerritoryId('')
    setReservedFor('')
    setMessage('Territorio personal reservado correctamente.')
    setIsSaving(false)
  }

  const handleRelease = async (reservation: PersonalTerritoryReservation) => {
    if (!client || !canManagePersonalTerritories) {
      return
    }

    setError(null)
    setMessage(null)
    setIsSaving(true)

    const { data, error: releaseError } = await client
      .from('territorio_personal_reservas')
      .update({
        status: 'liberada',
        released_at: new Date().toISOString(),
      })
      .eq('id', reservation.id)
      .select('id, territory_id, reserved_for, status, reserved_at, released_at')
      .single()

    if (releaseError) {
      setError(releaseError.message)
      setIsSaving(false)
      return
    }

    setReservations((current) =>
      current.map((item) =>
        item.id === reservation.id ? (data as PersonalTerritoryReservation) : item,
      ),
    )
    setMessage(`Territorio liberado para ${reservation.reserved_for}.`)
    setIsSaving(false)
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Modulo 7</p>
          <h2>Territorio Personal</h2>
          <p className="lead">
            Reserva territorios para personas o familias y evita que se usen en
            salidas mientras sigan activos.
          </p>
        </div>
      </section>

      <div className="module-console">
        <section className="module-hero">
          <div className="module-hero-copy">
            <p className="eyebrow">Reservas personales</p>
            <h3>Control simple para territorios asignados fuera de salidas</h3>
            <p>
              Al cumplirse un mes, el sistema avisa para consultar si ya fue
              abarcado y si la persona desea otro territorio.
            </p>
          </div>

          <div className="module-hero-stats">
            <article className="module-stat-card">
              <span>Disponibles</span>
              <strong>{territories.length - activeReservations.length}</strong>
              <small>Sin reserva personal</small>
            </article>
            <article className="module-stat-card">
              <span>Reservados</span>
              <strong>{activeReservations.length}</strong>
              <small>No utilizables en salidas</small>
            </article>
            <article className="module-stat-card">
              <span>Avisos</span>
              <strong>{overdueReservations.length}</strong>
              <small>Con mas de un mes</small>
            </article>
          </div>
        </section>

        {overdueReservations.length > 0 ? (
          <section className="panel personal-alert-panel">
            <p className="eyebrow">Avisos de seguimiento</p>
            <h3>Territorios reservados hace mas de un mes</h3>
            <div className="personal-alert-list">
              {overdueReservations.map((reservation) => {
                const territoryName =
                  territories.find((territory) => territory.id === reservation.territory_id)
                    ?.name ?? 'Sin territorio'

                return (
                  <article key={reservation.id} className="personal-alert-card">
                    <strong>
                      Ha pasado un mes que este territorio fue reservado para{' '}
                      {reservation.reserved_for}.
                    </strong>
                    <span>
                      Territorio {territoryName}. Desea preguntarle si ya lo abarco
                      y desea otro territorio?
                    </span>
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}

        <section className="two-column-grid module-form-grid">
          <article className="panel">
            <p className="eyebrow">Nueva reserva</p>
            <h3>Asignar territorio personal</h3>
            <p>
              Selecciona el territorio y escribe el nombre de la persona o
              familia que lo tendra reservado.
            </p>

            <form className="form-stack" onSubmit={handleSubmit}>
              <label>
                Territorio
                <select
                  value={territoryId}
                  onChange={(event) => setTerritoryId(event.target.value)}
                  disabled={!canManagePersonalTerritories}
                >
                  <option value="">Seleccionar territorio</option>
                  {territories.map((territory) => {
                    const reservation = activeReservationsByTerritory.get(territory.id)

                    return (
                      <option
                        key={territory.id}
                        value={territory.id}
                        disabled={Boolean(reservation)}
                      >
                        {reservation
                          ? `${territory.name} - reservado para ${reservation.reserved_for}`
                          : territory.name}
                      </option>
                    )
                  })}
                </select>
              </label>

              {selectedTerritory ? (
                <div className="module-detail-card">
                  <span>Territorio seleccionado</span>
                  <strong>{selectedTerritory.name}</strong>
                  <p>
                    {selectedTerritory.description ||
                      'Sin referencia breve cargada para este territorio.'}
                  </p>
                </div>
              ) : null}

              <label>
                Nombre
                <input
                  value={reservedFor}
                  onChange={(event) => setReservedFor(event.target.value)}
                  placeholder="Ej. Familia Perez"
                  disabled={!canManagePersonalTerritories}
                />
              </label>

              {error ? <div className="form-feedback error">{error}</div> : null}
              {message ? <div className="form-feedback success">{message}</div> : null}

              <button
                type="submit"
                className="primary-button full-width"
                disabled={isSaving || !canManagePersonalTerritories}
              >
                {isSaving ? 'Guardando...' : 'Reservar territorio'}
              </button>
            </form>
          </article>

          <article className="panel">
            <div className="module-registry-toolbar compact">
              <div>
                <p className="eyebrow">Reservas activas</p>
                <h3>Territorios bloqueados</h3>
              </div>
              <label className="module-search-field">
                <span className="sr-only">Buscar reserva</span>
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar por territorio o nombre"
                />
              </label>
            </div>

            {isLoading ? (
              <div className="status-card">Cargando reservas...</div>
            ) : filteredReservations.length === 0 ? (
              <div className="status-card">
                {isSupabaseConfigured
                  ? 'No hay reservas personales activas.'
                  : 'Cuando conectes Supabase, aqui apareceran las reservas.'}
              </div>
            ) : (
              <div className="personal-reservation-list">
                {filteredReservations.map((reservation) => {
                  const territoryName =
                    territories.find(
                      (territory) => territory.id === reservation.territory_id,
                    )?.name ?? 'Sin territorio'
                  const days = getReservedDays(reservation.reserved_at)

                  return (
                    <article key={reservation.id} className="personal-reservation-card">
                      <div>
                        <span className="status-pill status-activo">
                          {isMonthOld(reservation.reserved_at)
                            ? 'Consultar'
                            : 'Reservado'}
                        </span>
                        <strong>{territoryName}</strong>
                        <p>Reservado para {reservation.reserved_for}</p>
                        <small>
                          Desde {formatDate(reservation.reserved_at)} · {days} dia/s
                        </small>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleRelease(reservation)}
                        disabled={isSaving || !canManagePersonalTerritories}
                      >
                        Liberar
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </article>
        </section>
      </div>
    </div>
  )
}
