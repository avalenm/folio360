// Los tipos de Documento Tributario Electrónico del SII, en un solo lugar.
// Estaban duplicados entre DocumentsView (para emitir y para la tabla) y
// CafView (para nombrar el CAF), y al aparecer tipos nuevos uno quedó atrás:
// los CAF de exportación se veían como "Tipo 110" sin descripción.
//
// `emitible` separa lo que el sistema sabe generar de lo que solo sabe
// nombrar: un CAF de exportación se puede cargar y mostrar, pero todavía no
// hay cómo emitir el documento (falta la zona de aduana, la moneda
// extranjera y las tablas de códigos — ver certificacion/
// exportacion-y-liquidacion.md). Ofrecerlo en el selector de emisión sería
// prometer algo que no funciona.
export interface TipoDte {
  value: number
  // Nombre completo, como lo llama el SII.
  label: string
  // Sin el "Electrónica" que se repite en todos — para tablas y filtros,
  // donde el nombre largo no aporta y estorba.
  corto: string
  emitible: boolean
}

export const TIPOS_DTE: TipoDte[] = [
  { value: 33, label: 'Factura Electrónica', corto: 'Factura', emitible: true },
  { value: 34, label: 'Factura No Afecta o Exenta Electrónica', corto: 'Factura exenta', emitible: true },
  { value: 43, label: 'Liquidación-Factura Electrónica', corto: 'Liquidación-factura', emitible: false },
  { value: 46, label: 'Factura de Compra Electrónica', corto: 'Factura de compra', emitible: true },
  { value: 52, label: 'Guía de Despacho Electrónica', corto: 'Guía de despacho', emitible: true },
  { value: 56, label: 'Nota de Débito Electrónica', corto: 'Nota de débito', emitible: true },
  { value: 61, label: 'Nota de Crédito Electrónica', corto: 'Nota de crédito', emitible: true },
  { value: 110, label: 'Factura de Exportación Electrónica', corto: 'Factura de exportación', emitible: false },
  { value: 111, label: 'Nota de Débito de Exportación Electrónica', corto: 'Nota de débito exportación', emitible: false },
  { value: 112, label: 'Nota de Crédito de Exportación Electrónica', corto: 'Nota de crédito exportación', emitible: false }
]

export const TIPOS_DTE_EMITIBLES = TIPOS_DTE.filter((tipo) => tipo.emitible)

function buscar(tipoDte: number): TipoDte | undefined {
  return TIPOS_DTE.find((tipo) => tipo.value === tipoDte)
}

// Nombre completo sin el código.
export function nombreTipoDte(tipoDte: number): string {
  return buscar(tipoDte)?.label ?? `Tipo ${tipoDte}`
}

// Nombre completo con el código, para selectores donde importa el número.
export function tipoDteLabel(tipoDte: number): string {
  const tipo = buscar(tipoDte)
  return tipo ? `${tipo.label} (${tipo.value})` : `Tipo ${tipoDte}`
}

// Solo el nombre corto, para textos donde el código sería ruido (p.ej.
// "Factura N° 48", que ya identifica el documento por su folio).
export function nombreCortoTipoDte(tipoDte: number): string {
  return buscar(tipoDte)?.corto ?? `Tipo ${tipoDte}`
}

// Nombre corto con el código, para tablas.
export function tipoDteCorto(tipoDte: number): string {
  const tipo = buscar(tipoDte)
  return tipo ? `${tipo.corto} (${tipo.value})` : `Tipo ${tipoDte}`
}
