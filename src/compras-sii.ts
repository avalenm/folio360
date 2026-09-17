import type { Purchase, PurchaseSiiRcv } from '@/types'
import { EXPLICACION_DTE_CONTADO, EXPLICACION_PLAZO_VENCIDO } from '@/types'

// Estados derivados de una compra para la tabla de Compras: qué dice el SII
// del acuse, cuán vencida está la deuda y si la clasificación tributaria del
// SII calza con el tratamiento de IVA que se le dio acá. Todo es solo
// lectura; los datos del SII vienen en purchase.siiRcv (sincronización del
// RCV, ver server/src/sii/rcv-sync.ts).

export type Severidad = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'

export interface EstadoTag {
  value: string
  severity: Severidad
  title?: string
  icon?: string
}

const DIA_MS = 86_400_000
// Plazo de reclamo de la Ley 19.983, desde la recepción en el SII.
const PLAZO_RECLAMO_DIAS = 8
// Plazo legal de pago (Ley 21.131) cuando la compra no trae vencimiento —
// mismo criterio que el server (services/cuentas/calculo.ts).
export const PLAZO_LEGAL_DIAS = 30

// Fecha SIN hora (emisión, vencimiento): en la base viven como medianoche
// UTC (así salen del XML y del RCV), y formatearlas con la zona del
// navegador las corre un día hacia atrás en Chile (UTC−3/−4): la 5678 del
// 31-07 se veía "30-07-2026". Se formatean en UTC para que muestren el día
// que son. Las que vienen del selector de fecha (medianoche local = 03:00Z)
// caen en el mismo día también.
export function fechaCorta(valor: string | Date | undefined | null): string {
  if (!valor) return '—'
  return new Date(valor).toLocaleDateString('es-CL', { timeZone: 'UTC' })
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
}

// --- Acuse según el SII ---
// Prevalece sobre siiAcuse (lo que Folio360 intentó): esto es lo que el SII
// tiene registrado, lo haya hecho quien lo haya hecho.
export function acuseSegunSii(purchase: Purchase): EstadoTag | null {
  const r = purchase.siiRcv
  if (!r) return null
  const recibida = r.fechaRecepcionSii ? ` Recibida por el SII el ${fechaHora(r.fechaRecepcionSii)}.` : ''

  if (r.eventoReceptor === 'P') {
    return { value: 'Contado, sin acuse', severity: 'secondary', title: `${EXPLICACION_DTE_CONTADO}${recibida}` }
  }
  if (r.eventoReceptor === 'A') {
    return { value: 'Aceptación tácita', severity: 'secondary', title: `Según el SII: "${r.eventoReceptorLeyenda ?? 'No reclamado en plazo'}". ${EXPLICACION_PLAZO_VENCIDO}${recibida}` }
  }
  if (r.eventoReceptor) {
    const leyenda = r.eventoReceptorLeyenda ?? `Evento ${r.eventoReceptor}`
    const esReclamo = /reclam/i.test(leyenda)
    const cuando = r.fechaReclamo ?? r.fechaAcuse
    return {
      value: leyenda,
      severity: esReclamo ? 'warn' : 'success',
      title: `Registrado en el SII${cuando ? ` el ${fechaHora(cuando)}` : ''}.${recibida}`
    }
  }

  // Sin evento: o está dentro del plazo (se puede aceptar/reclamar) o el SII
  // aún no lo ha marcado como tácita.
  const dias = r.fechaRecepcionSii
    ? PLAZO_RECLAMO_DIAS - Math.floor((Date.now() - new Date(r.fechaRecepcionSii).getTime()) / DIA_MS)
    : null
  if (dias !== null && dias > 0) {
    return {
      value: `Pendiente · ${dias} día${dias === 1 ? '' : 's'} para reclamar`,
      severity: dias <= 2 ? 'danger' : 'warn',
      icon: 'pi pi-clock',
      title: `El SII no tiene acuse ni reclamo tuyo para esta factura. Puedes registrarlo desde el menú de la fila.${recibida}`
    }
  }
  return { value: 'Sin acuse en el SII', severity: 'warn', title: `El SII no registra ningún evento tuyo para esta factura.${recibida}` }
}

// --- Vencimiento de la deuda ---
export function saldoDe(purchase: Purchase): number {
  const abonado = typeof purchase.montoPagado === 'number' ? purchase.montoPagado : purchase.pagado ? purchase.montoTotal : 0
  return Math.max(0, purchase.montoTotal - abonado)
}

export function vencimientoDe(purchase: Purchase): Date {
  if (purchase.fechaVencimiento) return new Date(purchase.fechaVencimiento)
  return new Date(new Date(purchase.fecha).getTime() + PLAZO_LEGAL_DIAS * DIA_MS)
}

export function estadoVencimiento(purchase: Purchase, ahora: Date = new Date()): EstadoTag | null {
  if (purchase.tipoDocumento === 'nota_credito') return null
  if (saldoDe(purchase) <= 0) return { value: 'Pagada', severity: 'success' }

  const venc = vencimientoDe(purchase)
  const dias = Math.floor((ahora.getTime() - venc.getTime()) / DIA_MS)
  const origen = purchase.fechaVencimiento ? 'vencimiento del documento' : `emisión + ${PLAZO_LEGAL_DIAS} días (plazo legal)`
  const title = `Vence el ${fechaCorta(venc)} (${origen}).`

  if (dias < 0) return { value: `Vence en ${-dias} día${dias === -1 ? '' : 's'}`, severity: 'info', title }
  if (dias === 0) return { value: 'Vence hoy', severity: 'warn', title }
  if (dias <= 30) return { value: `Vencida ${dias} día${dias === 1 ? '' : 's'}`, severity: 'warn', title }
  const tramo = dias > 90 ? 90 : dias > 60 ? 60 : 30
  return { value: `Morosa +${tramo}`, severity: 'danger', title: `${title} ${dias} días de atraso.` }
}

// --- Clasificación tributaria del SII vs tratamiento de IVA en Folio360 ---
type GrupoIva = 'credito' | 'uso_comun' | 'sin_credito' | 'no_incluir'

function grupoDeTipoTransaccion(tipo: number): GrupoIva {
  if (tipo >= 1 && tipo <= 4) return 'credito'
  if (tipo === 5) return 'uso_comun'
  if (tipo === 6) return 'sin_credito'
  return 'no_incluir'
}

function grupoDeCompra(purchase: Purchase): GrupoIva {
  if (purchase.ivaNoRecuperable) return 'sin_credito'
  if ((purchase.ivaUsoComun ?? 0) > 0) return 'uso_comun'
  return 'credito'
}

const NOMBRE_GRUPO: Record<GrupoIva, string> = {
  credito: 'con derecho a crédito',
  uso_comun: 'IVA de uso común',
  sin_credito: 'sin derecho a crédito',
  no_incluir: 'no incluir en el registro'
}

// Solo tiene sentido para facturas con IVA: en una exenta no hay crédito
// que clasificar.
export function discrepanciaClasificacion(purchase: Purchase): EstadoTag | null {
  const r: PurchaseSiiRcv | undefined = purchase.siiRcv
  if (!r?.tipoTransaccion || purchase.tipoDocumento !== 'factura') return null
  if (purchase.montoIva === 0 && !purchase.ivaUsoComun && !purchase.ivaNoRecuperable) return null

  const sii = grupoDeTipoTransaccion(r.tipoTransaccion)
  const local = grupoDeCompra(purchase)
  if (sii === local) return null

  return {
    value: `SII: ${r.descTipoTransaccion ?? `tipo ${r.tipoTransaccion}`}`,
    severity: 'warn',
    icon: 'pi pi-exclamation-triangle',
    title: `El SII clasifica esta compra como "${r.descTipoTransaccion ?? r.tipoTransaccion}" (${NOMBRE_GRUPO[sii]}) y en Folio360 está ${NOMBRE_GRUPO[local]}. La propuesta de F29 del SII usa SU clasificación: corrige una de las dos con tu contador.`
  }
}
