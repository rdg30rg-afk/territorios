export type SalidaPdfData = {
  title: string
  scheduledFor: string
  territoryName?: string | null
  driverName?: string | null
  groupName?: string | null
  meetingPointName?: string | null
  meetingCoords?: [number, number] | null
  notes?: string | null
}

export type ArchivoPdf = {
  blob: Blob
  filename: string
}

const OLIVA = [100, 124, 39] as const
const TINTA = [31, 35, 39] as const
const SUAVE = [104, 110, 116] as const
const PAPEL = [248, 246, 240] as const

function textoO(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback
}

function fechaValida(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function fechaSalidaPdf(value: string) {
  const date = fechaValida(value)
  if (!date) return 'Horario a confirmar'
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function enlaceMapaSalida(data: SalidaPdfData) {
  if (data.meetingCoords) {
    const [lng, lat] = data.meetingCoords
    return `https://www.google.com/maps?q=${lat},${lng}`
  }
  const place = data.meetingPointName?.trim()
  return place
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
    : null
}

function slug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

export function nombrePdfSalida(data: SalidaPdfData) {
  const date = fechaValida(data.scheduledFor)
  const datePart = date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : 'sin-fecha'
  const territory = slug(textoO(data.territoryName, data.title)) || 'salida'
  return `salida-${datePart}-${territory}.pdf`
}

function descargarBlob({ blob, filename }: ArchivoPdf) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function descargarPdf(archivo: ArchivoPdf) {
  descargarBlob(archivo)
}

export function puedeCompartirPdf() {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  if (typeof File === 'undefined') return false
  const prueba = new File([''], 'salida.pdf', { type: 'application/pdf' })
  return typeof navigator.canShare !== 'function' || navigator.canShare({ files: [prueba] })
}

export async function compartirPdf(archivo: ArchivoPdf, title: string) {
  const file = new File([archivo.blob], archivo.filename, { type: 'application/pdf' })
  await navigator.share({ title, files: [file] })
}

function encabezado(doc: import('jspdf').jsPDF, titulo: string, subtitulo: string) {
  doc.setFillColor(...TINTA)
  doc.rect(0, 0, 210, 38, 'F')
  doc.setFillColor(...OLIVA)
  doc.rect(0, 38, 210, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('TERRITORIOS · CONGREGACIÓN SAN JUAN', 16, 14)
  doc.setFontSize(20)
  doc.text(titulo, 16, 27)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(subtitulo, 194, 27, { align: 'right' })
  doc.setTextColor(...TINTA)
}

function pie(doc: import('jspdf').jsPDF, page: number, pages: number) {
  doc.setDrawColor(222, 218, 208)
  doc.line(16, 282, 194, 282)
  doc.setTextColor(...SUAVE)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Generado desde Territorios', 16, 288)
  doc.text(`${page} / ${pages}`, 194, 288, { align: 'right' })
}

export async function crearPdfSalida(data: SalidaPdfData): Promise<ArchivoPdf> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const territory = textoO(data.territoryName, 'Territorio a confirmar')
  const dateLabel = fechaSalidaPdf(data.scheduledFor)
  encabezado(doc, 'Ficha de salida', 'Lista para compartir')

  doc.setFillColor(...PAPEL)
  doc.roundedRect(16, 51, 178, 42, 4, 4, 'F')
  doc.setTextColor(...SUAVE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('TERRITORIO', 22, 62)
  doc.setTextColor(...TINTA)
  doc.setFontSize(22)
  doc.text(territory, 22, 76, { maxWidth: 105 })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(dateLabel, 22, 87, { maxWidth: 165 })

  const fields = [
    ['Conductor', textoO(data.driverName, 'A confirmar')],
    ['Grupo', textoO(data.groupName, 'Sin grupo asignado')],
    ['Punto de encuentro', textoO(data.meetingPointName, 'A confirmar')],
  ] as const
  let y = 108
  for (const [label, value] of fields) {
    doc.setTextColor(...SUAVE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(label.toUpperCase(), 18, y)
    doc.setTextColor(...TINTA)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    const lines = doc.splitTextToSize(value, 160) as string[]
    doc.text(lines, 18, y + 7)
    y += 13 + Math.max(0, lines.length - 1) * 5
  }

  const mapsUrl = enlaceMapaSalida(data)
  if (mapsUrl) {
    doc.setFillColor(232, 239, 211)
    doc.roundedRect(16, y + 1, 178, 14, 3, 3, 'F')
    doc.setTextColor(...OLIVA)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.textWithLink('Abrir cómo llegar en Google Maps', 22, y + 10, { url: mapsUrl })
    y += 23
  } else {
    y += 7
  }

  doc.setTextColor(...SUAVE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('INDICACIONES', 18, y)
  doc.setFillColor(250, 249, 246)
  doc.setDrawColor(226, 222, 212)
  doc.roundedRect(16, y + 5, 178, 42, 3, 3, 'FD')
  doc.setTextColor(...TINTA)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const notes = doc.splitTextToSize(textoO(data.notes, 'Sin indicaciones adicionales.'), 164) as string[]
  doc.text(notes.slice(0, 8), 22, y + 14)

  pie(doc, 1, 1)
  return { blob: doc.output('blob'), filename: nombrePdfSalida(data) }
}

export async function crearPdfAgenda(
  outings: SalidaPdfData[],
  label: string,
): Promise<ArchivoPdf> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const ordered = [...outings].sort(
    (a, b) => (fechaValida(a.scheduledFor)?.getTime() ?? 0) - (fechaValida(b.scheduledFor)?.getTime() ?? 0),
  )
  const rowsPerPage = 7
  const pages = Math.max(1, Math.ceil(ordered.length / rowsPerPage))

  for (let page = 0; page < pages; page += 1) {
    if (page > 0) doc.addPage()
    encabezado(doc, 'Agenda de salidas', label)
    const slice = ordered.slice(page * rowsPerPage, (page + 1) * rowsPerPage)
    let y = 51
    if (slice.length === 0) {
      doc.setFontSize(12)
      doc.text('No hay salidas para exportar con estos filtros.', 16, y + 10)
    }
    for (const outing of slice) {
      doc.setFillColor(...PAPEL)
      doc.roundedRect(16, y, 178, 28, 3, 3, 'F')
      doc.setTextColor(...TINTA)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(fechaSalidaPdf(outing.scheduledFor), 21, y + 8, { maxWidth: 168 })
      doc.setFontSize(12)
      doc.text(textoO(outing.territoryName, outing.title || 'Territorio a confirmar'), 21, y + 17, { maxWidth: 80 })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...SUAVE)
      const detail = `${textoO(outing.driverName, 'Conductor a confirmar')} · ${textoO(outing.meetingPointName, 'Punto a confirmar')}`
      doc.text(detail, 21, y + 24, { maxWidth: 168 })
      y += 32
    }
    pie(doc, page + 1, pages)
  }

  const today = new Date().toISOString().slice(0, 10)
  return { blob: doc.output('blob'), filename: `agenda-salidas-${today}.pdf` }
}
