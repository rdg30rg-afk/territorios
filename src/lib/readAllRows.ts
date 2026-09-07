// PostgREST limita cada respuesta. No confundir una página con la lista completa.
export async function readAllRows<T>(page: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null
}>, size = 500): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += size) {
    const result = await page(offset, offset + size - 1)
    if (result.error) throw new Error(result.error.message)
    if (!result.data) throw new Error('La base no devolvió una respuesta válida.')
    rows.push(...result.data)
    if (result.data.length < size) return rows
  }
}
