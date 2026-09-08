import { useState } from 'react'
import { normalizarCodigoGrupo } from '../lib/vistaHermano'
import { Icono } from './Icono'

type CampoCodigoGrupoProps = {
  ocupado?: boolean
  deshabilitado?: boolean
  alUnir: (codigo: string) => Promise<string | null>
}

export function CampoCodigoGrupo({
  ocupado = false,
  deshabilitado = false,
  alUnir,
}: CampoCodigoGrupoProps) {
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = async () => {
    const limpio = normalizarCodigoGrupo(codigo)
    if (limpio.length !== 6) {
      setError('El código tiene 6 letras. Fijate si lo copiaste entero.')
      return
    }
    setEnviando(true)
    setError(null)
    const fallo = await alUnir(limpio)
    setEnviando(false)
    if (fallo) setError(fallo)
    else setCodigo('')
  }

  return (
    <div className="campo-codigo-grupo">
      <label className="sub">
        Código de tu grupo
        <input
          className="boton secundario codigo-grupo"
          value={codigo}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={6}
          disabled={deshabilitado || enviando || ocupado}
          placeholder="KPMRTX"
          onChange={(evento) => {
            setCodigo(normalizarCodigoGrupo(evento.target.value))
            setError(null)
          }}
        />
      </label>
      {error ? (
        <p className="nota" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="boton principal"
        disabled={deshabilitado || enviando || ocupado || codigo.length !== 6}
        onClick={() => void enviar()}
      >
        <Icono nombre="grupo" tamaño={18} />
        {enviando ? 'Entrando…' : ocupado ? 'Sin conexión' : 'Entrar al grupo'}
      </button>
    </div>
  )
}
