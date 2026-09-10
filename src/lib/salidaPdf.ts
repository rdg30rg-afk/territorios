export type SalidaPdfData = {
  title: string
  scheduledFor: string
  territoryName?: string | null
  driverName?: string | null
  groupName?: string | null
  meetingPointName?: string | null
  meetingCoords?: [number, number] | null
  neighborhood?: string | null
  priority?: string | null
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

function horaSalidaPdf(value: string) {
  const date = fechaValida(value)
  if (!date) return '--:--'
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function claveDia(value: string) {
  const date = fechaValida(value)
  return date?.toLocaleDateString('sv-SE') ?? value
}

function rotuloDia(value: string) {
  const date = fechaValida(value)
  if (!date) return { dia: 'Sin fecha', fecha: '' }
  const dia = new Intl.DateTimeFormat('es-AR', { weekday: 'long' }).format(date)
  const fecha = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
  }).format(date)
  return {
    dia: dia.charAt(0).toUpperCase() + dia.slice(1),
    fecha,
  }
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
  if (/^(predicaci[oó]n telef[oó]nica|salidas? de grupos?)$/i.test(place ?? '')) return null
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
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const ordered = [...outings].sort(
    (a, b) => (fechaValida(a.scheduledFor)?.getTime() ?? 0) - (fechaValida(b.scheduledFor)?.getTime() ?? 0),
  )
  const firstDate = ordered[0] ? fechaValida(ordered[0].scheduledFor) : null
  const lastDate = ordered.at(-1) ? fechaValida(ordered.at(-1)!.scheduledFor) : null
  const shortDate = (date: Date) =>
    new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' }).format(date)
  const period = firstDate && lastDate
    ? firstDate.toLocaleDateString('sv-SE') === lastDate.toLocaleDateString('sv-SE')
      ? shortDate(firstDate)
      : `${shortDate(firstDate)} al ${shortDate(lastDate)}`
    : 'Fechas a confirmar'

  const columns = [
    { label: 'Hora', x: 14, width: 18 },
    { label: 'Lugar de encuentro', x: 35, width: 84 },
    { label: 'Terr.', x: 122, width: 22 },
    { label: 'Conductor', x: 147, width: 49 },
    { label: 'Ubicación', x: 199, width: 31 },
    { label: 'Priorizar', x: 233, width: 50 },
  ] as const

  const drawPageHeader = () => {
    doc.setFillColor(...TINTA)
    doc.rect(0, 0, 297, 30, 'F')
    doc.setFillColor(...OLIVA)
    doc.rect(0, 30, 297, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('TERRITORIOS · CONGREGACIÓN SAN JUAN', 14, 11)
    doc.setFontSize(18)
    doc.text('Salidas de predicación', 14, 24)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(period, 283, 18, { align: 'right' })
    doc.setTextColor(...SUAVE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    for (const column of columns) doc.text(column.label.toUpperCase(), column.x, 41)
    doc.setDrawColor(216, 212, 202)
    doc.line(14, 44, 283, 44)
  }

  const addPage = () => {
    if (doc.getNumberOfPages() > 0 && paginaIniciada) doc.addPage('a4', 'landscape')
    drawPageHeader()
    paginaIniciada = true
    return 48
  }

  const rowLines = (outing: SalidaPdfData) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const place = textoO(outing.meetingPointName, outing.title || 'Punto a confirmar')
    const placeWithNeighborhood = outing.neighborhood?.trim()
      ? `${place}\n${outing.neighborhood.trim()}`
      : place
    return {
      place: (doc.splitTextToSize(placeWithNeighborhood, columns[1].width) as string[]).slice(0, 2),
      driver: (doc.splitTextToSize(textoO(outing.driverName, 'A confirmar'), columns[3].width) as string[]).slice(0, 2),
      priority: (doc.splitTextToSize(textoO(outing.priority, 'Todo el territorio'), columns[5].width) as string[]).slice(0, 2),
    }
  }

  let paginaIniciada = false
  let y = addPage()
  let currentDay = ''
  let rowIndex = 0

  if (ordered.length === 0) {
    doc.setTextColor(...TINTA)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.text('No hay salidas para exportar con los filtros actuales.', 14, 61)
  }

  for (const outing of ordered) {
    const dayKey = claveDia(outing.scheduledFor)
    const lines = rowLines(outing)
    const rowHeight = Math.max(lines.place.length, lines.driver.length, lines.priority.length) > 1 ? 10.5 : 8.5
    const needsDay = dayKey !== currentDay
    const required = rowHeight + (needsDay ? 8 : 0)
    if (y + required > 193) {
      y = addPage()
      currentDay = ''
    }

    if (dayKey !== currentDay) {
      const day = rotuloDia(outing.scheduledFor)
      doc.setFillColor(232, 239, 211)
      doc.roundedRect(14, y, 269, 6.5, 2, 2, 'F')
      doc.setTextColor(...TINTA)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text(day.dia, 18, y + 4.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...SUAVE)
      doc.text(day.fecha, 52, y + 4.5)
      y += 8
      currentDay = dayKey
      rowIndex = 0
    }

    if (rowIndex % 2 === 1) {
      doc.setFillColor(...PAPEL)
      doc.rect(14, y - 1, 269, rowHeight, 'F')
    }
    doc.setTextColor(...TINTA)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(horaSalidaPdf(outing.scheduledFor), columns[0].x, y + 5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(lines.place, columns[1].x, y + 5)
    doc.setFont('helvetica', 'bold')
    doc.text(textoO(outing.territoryName, '-').replace(/^Territorio\s+/i, ''), columns[2].x, y + 5, {
      maxWidth: columns[2].width,
    })
    doc.setFont('helvetica', 'normal')
    doc.text(lines.driver, columns[3].x, y + 5)
    const mapsUrl = enlaceMapaSalida(outing)
    if (mapsUrl) {
      doc.setTextColor(...OLIVA)
      doc.setFont('helvetica', 'bold')
      doc.textWithLink('Ver mapa', columns[4].x, y + 5, { url: mapsUrl })
    } else {
      doc.setTextColor(...SUAVE)
      doc.text('Sin ubicación', columns[4].x, y + 5)
    }
    doc.setTextColor(...TINTA)
    doc.setFont('helvetica', 'normal')
    doc.text(lines.priority, columns[5].x, y + 5)
    doc.setDrawColor(234, 231, 223)
    doc.line(14, y + rowHeight - 1, 283, y + rowHeight - 1)
    y += rowHeight
    rowIndex += 1
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(222, 218, 208)
    doc.line(14, 199, 283, 199)
    doc.setTextColor(...SUAVE)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(`${label} · Generado desde Territorios`, 14, 204)
    doc.text(`${page} / ${pages}`, 283, 204, { align: 'right' })
  }

  const today = new Date().toISOString().slice(0, 10)
  return { blob: doc.output('blob'), filename: `agenda-salidas-${today}.pdf` }
}
