import { useRef, useState, type FormEvent } from 'react'
import type { CoverageState } from '../lib/coverageSummary'

export function CoverageCorrectionForm({onSubmit,onCancel,disabled=false}:{
  onSubmit:(state:CoverageState,note:string)=>Promise<void>;onCancel:()=>void;disabled?:boolean
}) {
  const [state,setState]=useState<CoverageState>('sin_dato')
  const [note,setNote]=useState('')
  const [error,setError]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  const running=useRef(false)
  async function submit(event:FormEvent) {
    event.preventDefault()
    if(disabled||running.current)return
    if(note.trim().length<2){setError('Explicá el motivo de la corrección.');return}
    running.current=true;setBusy(true);setError(null)
    try{await onSubmit(state,note.trim())}
    catch(e){setError(e instanceof Error?e.message:'No se pudo preparar la corrección.')}
    finally{running.current=false;setBusy(false)}
  }
  return <form className="form-stack" onSubmit={submit}>
    <p>Agrega un nuevo evento. El original no se modifica ni se borra. Si corregís una marca antigua, este nuevo estado pasa a ser el último informado del lado.</p>
    <label>Estado corregido<select value={state} disabled={disabled||busy} onChange={e=>setState(e.target.value as CoverageState)}>
      <option value="sin_dato">Sin dato</option><option value="recorrido">Recorrido</option>
      <option value="revisitar">Revisitar</option><option value="no_accesible">No accesible</option>
    </select></label>
    <label>Motivo de la corrección<textarea required minLength={2} rows={3} value={note} disabled={disabled||busy} onChange={e=>setNote(e.target.value)}/></label>
    {error?<p role="alert">{error}</p>:null}
    <button type="submit" className="boton primario" disabled={disabled||busy}>{busy?'Preparando…':'Agregar corrección'}</button>
    <button type="button" className="boton secundario" disabled={busy} onClick={onCancel}>Cancelar</button>
  </form>
}
