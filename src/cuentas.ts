import type { DteDocument, PurchaseTipoDocumento } from '@/types'
import { codigoIsoMoneda } from '@/codigosAduana'

// Lo que el CLIENTE necesita saber sobre cuentas: cómo mostrarlas.
//
// La matemática ya no vive acá. Está en el servidor
// (server/src/services/cuentas/calculo.ts) y llega calculada por el servicio
// `resumen-cuentas`. Antes estaba en los dos lados —acá para los totales de
// los tableros, allá para el saldo de las listas paginadas— y dos
// implementaciones de la misma regla es exactamente como el Panorama llegó a
// mostrar millones que la página de Compras no podía explicar.
//
// Lo que queda son los tipos que devuelve ese servicio y el formato con que se
// escriben los montos.

// La moneda en que está expresado un documento. 'CLP' para todo lo que no es
// exportación en moneda extranjera.
export const MONEDA_LOCAL = 'CLP'

const TIPOS_EXPORTACION = [110, 111, 112]

export function monedaDe(doc: DteDocument): string {
  if (!TIPOS_EXPORTACION.includes(doc.tipoDte)) return MONEDA_LOCAL
  const moneda = doc.exportacion?.moneda
  return !moneda || moneda === 'PESO CL' ? MONEDA_LOCAL : moneda
}

export function esMonedaExtranjera(doc: DteDocument): boolean {
  return monedaDe(doc) !== MONEDA_LOCAL
}

// Un monto con su moneda. Los pesos no llevan decimales (el SII los exige
// enteros); la moneda extranjera sí, porque ahí el DTE los declara.
//
// Se muestra el código ISO ("USD 1.200,00"), no el nombre del SII ("1.200,00
// DOLAR USA"): el nombre es lo que exige el XML, no lo que le sirve a quien
// lee la pantalla.
export function formatMonto(monto: number, moneda: string): string {
  return moneda === MONEDA_LOCAL
    ? `$${Math.round(monto).toLocaleString('es-CL')}`
    : `${codigoIsoMoneda(moneda)} ${monto.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ---- Lo que devuelve el servicio `resumen-cuentas` ----
// Espejo de los tipos de server/src/services/cuentas/calculo.ts. Las fechas
// viajan como string, igual que en el resto de la API.

// De dónde salió cada peso del total. `verEn` es la pantalla donde está el
// documento: sin eso, una línea que no aparece en la tabla que uno tiene al
// frente es justamente lo que vuelve inexplicable un número.
export interface LineaCuenta {
  id: string
  descripcion: string
  contraparte: string
  // SIEMPRE en pesos: lo único sumable entre documentos.
  monto: number
  // La moneda de emisión y lo adeudado en ella, solo si es extranjera.
  moneda?: string
  montoOrigen?: number
  vencimiento: string
  verEn: 'documentos' | 'compras'
}

export interface Aging {
  total: number
  porVencer: number
  v1a30: number
  v31a60: number
  v61a90: number
  vMas90: number
}

export interface FilaContraparte {
  nombre: string
  saldo: number
  vencido: number
}

export interface ExposicionMoneda {
  moneda: string
  monto: number
  clp: number
}

export type MotivoCreditoSinAplicar = 'sin-referencia' | 'documento-no-encontrado' | 'excede-saldo'

export interface CreditoSinAplicar {
  id: string
  descripcion: string
  contraparte: string
  monto: number
  motivo: MotivoCreditoSinAplicar
}

// Cuánto IVA está poniendo la empresa de su bolsillo por facturas emitidas
// que no le pagaron. El IVA débito se devenga con la EMISIÓN, no con el
// cobro: se declara y se entera al mes siguiente, haya pagado el cliente o
// no. Ver services/cuentas/calculo.ts en el servidor.
export interface LineaIva {
  id: string
  descripcion: string
  contraparte: string
  saldo: number
  iva: number
  vencimiento: string
  diasVencido: number
  enterado: boolean
}

export interface IvaFinanciado {
  // Lo que ya se le pagó al SII y no ha vuelto: el número que duele.
  enterado: number
  // Del mes en curso, todavía no enterado. Alerta de caja, no pérdida.
  porEnterar: number
  aging: Aging
  lineas: LineaIva[]
}

// Desde cuántos días de mora conviene revisar el caso con el contador.
export const DIAS_PARA_REVISAR_INCOBRABLE = 90

export interface ResumenCuentas {
  porCobrar: {
    total: number
    documentos: number
    aging: Aging
    ranking: FilaContraparte[]
    lineas: LineaCuenta[]
    exposicion: ExposicionMoneda[]
    creditosSinAplicar: CreditoSinAplicar[]
  }
  porPagar: {
    total: number
    documentos: number
    aging: Aging
    ranking: FilaContraparte[]
    lineas: LineaCuenta[]
  }
  mes: { ventas: number; ivaDebito: number; ivaCredito: number; ivaNeto: number; documentos: number }
  evolucion: { mes: string; ventas: number; compras: number; margen: number }[]
  posicionNeta: number
  ivaFinanciado: IvaFinanciado
}

// Por qué una nota de crédito no alcanzó a descontarse. El total la ignora a
// propósito —sumarla haría que la cobranza bajara para siempre— pero
// ignorarla en silencio deja que una nota real se evapore sin que nada lo
// diga.
export const GLOSA_CREDITO_SIN_APLICAR: Record<MotivoCreditoSinAplicar, string> = {
  'sin-referencia': 'No referencia ningún documento',
  // Puede ser que el documento no exista entre los emitidos, o que exista y
  // no sea algo por cobrar (una guía, por ejemplo) — la glosa cubre las dos.
  'documento-no-encontrado': 'El documento que corrige no es una venta por cobrar',
  'excede-saldo': 'Supera lo que quedaba por cobrar de ese documento'
}

// Los nombres de los tipos de compra, en un solo lugar por el mismo motivo
// que tiposDte.ts: los usan el selector y la tabla de Compras.
export const NOMBRE_TIPO_COMPRA: Record<PurchaseTipoDocumento, string> = {
  factura: 'Factura',
  boleta: 'Boleta',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
  factura_compra: 'Factura de compra'
}
