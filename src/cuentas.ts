import type { Ambiente, Customer, DteDocument, Purchase, PurchaseTipoDocumento, Supplier } from '@/types'
import { nombreCortoTipoDte } from '@/tiposDte'

// Fuente única de las cuentas por cobrar y por pagar.
//
// Antes cada pantalla las calculaba por su cuenta (Panorama y Finanzas), con
// las mismas reglas escritas dos veces: qué documento suma, cuál resta, cuál
// no es una venta. Las dos implementaciones se descuadraron entre sí más de
// una vez —el Panorama mostraba millones de deuda que la página de Compras no
// podía explicar, porque incluía documentos que esa tabla ni siquiera lista—,
// y ese es exactamente el error que este módulo viene a hacer imposible.
//
// La unidad de cuenta es la LÍNEA, no el total: cada peso del total viene de
// un documento concreto que se puede mostrar y auditar. Un total que no se
// puede desglosar es un total en el que no se puede confiar.

// Un documento cuenta desde que se firma: antes es un borrador que todavía no
// se cobra ni se debe. Los rechazados/anulados nunca entran.
export const ESTADOS_EMITIDOS = ['pendiente_firma', 'firmado', 'enviado', 'aceptado', 'reparo']

// Cuánto aporta cada tipo de documento a las VENTAS del período:
//
//  +1  Factura (33), Factura Exenta (34), Nota de Débito (56) y las de
//      exportación (110/111): la nota de débito aumenta lo facturado.
//  -1  Nota de Crédito (61/112): rebaja una venta ya emitida (devolución,
//      descuento o anulación).
//   0  Guía de Despacho (52): no es una venta tributaria por sí sola — la
//      documenta la factura que la respalda, y contar ambas duplicaría.
//   0  Factura de Compra (46): la emitimos nosotros, pero documenta una
//      COMPRA — es plata que se le debe al proveedor, no una venta.
//   0  Liquidación-Factura (43): su total es lo que un mandatario le rinde al
//      mandante; la venta propia es solo la comisión.
export const SIGNO_VENTA: Record<number, number> = { 33: 1, 34: 1, 56: 1, 61: -1, 110: 1, 111: 1, 112: -1 }

export function signoVenta(tipoDte: number): number {
  return SIGNO_VENTA[tipoDte] ?? 0
}

const TIPOS_EXPORTACION = [110, 111, 112]
const PLAZO_LEGAL_DIAS = 30
const DIA_MS = 24 * 60 * 60 * 1000

// Los documentos de exportación llevan sus montos en la MONEDA de la
// operación: se convierten a pesos con su tipo de cambio antes de sumarlos —
// mezclar dólares con pesos daría totales mentirosos.
export function totalClp(doc: DteDocument): number {
  const cambio = TIPOS_EXPORTACION.includes(doc.tipoDte) ? (doc.exportacion?.tipoCambio ?? 0) : 1
  return Math.round(doc.montos.total * cambio)
}

export function ivaClp(doc: DteDocument): number {
  return TIPOS_EXPORTACION.includes(doc.tipoDte) ? 0 : doc.montos.iva
}

// Una NC/ND que corrige una Factura de Compra ajusta la deuda con el
// proveedor: no es venta ni algo por cobrar. Sin esto inflaba el por cobrar
// en el monto exacto de la nota (encontrado en vivo).
export function esNotaDeCompra(doc: DteDocument): boolean {
  return doc.retencionIvaCompra === true && doc.tipoDte !== 46
}

function restaDeuda(doc: DteDocument): boolean {
  return doc.tipoDte === 61 || doc.tipoDte === 112
}

// Los documentos de certificación son pruebas: no son operaciones reales y no
// pueden mezclarse con las de producción.
export function documentosVigentes(documents: DteDocument[], ambiente: Ambiente | undefined): DteDocument[] {
  return documents.filter((doc) => doc.ambiente === ambiente && ESTADOS_EMITIDOS.includes(doc.estado))
}

// De dónde salió cada peso del total. `verEn` es la pantalla donde el usuario
// puede abrir el documento: sin eso, una línea que no está en la tabla que
// tiene al frente es justamente lo que vuelve inexplicable el número.
export interface LineaCuenta {
  id: string
  descripcion: string
  contraparte: string
  // Positivo si suma deuda/cobranza, negativo si la rebaja (nota de crédito).
  monto: number
  vencimiento: Date
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

// El total nunca es negativo: si las notas de crédito superan lo facturado,
// nadie pasa a deber menos que cero.
export function totalDe(lineas: LineaCuenta[]): number {
  return Math.max(0, lineas.reduce((suma, linea) => suma + linea.monto, 0))
}

// Antigüedad por VENCIMIENTO, no por emisión: una factura a 30 días emitida
// ayer no está atrasada.
export function agingDe(lineas: LineaCuenta[]): Aging {
  const aging: Aging = { total: 0, porVencer: 0, v1a30: 0, v31a60: 0, v61a90: 0, vMas90: 0 }

  for (const linea of lineas) {
    aging.total += linea.monto
    const dias = Math.floor((Date.now() - linea.vencimiento.getTime()) / DIA_MS)
    if (dias <= 0) aging.porVencer += linea.monto
    else if (dias <= 30) aging.v1a30 += linea.monto
    else if (dias <= 60) aging.v31a60 += linea.monto
    else if (dias <= 90) aging.v61a90 += linea.monto
    else aging.vMas90 += linea.monto
  }

  return aging
}

export interface FilaContraparte {
  nombre: string
  saldo: number
  vencido: number
}

export function rankingDe(lineas: LineaCuenta[], limite = 8): FilaContraparte[] {
  const porContraparte = new Map<string, FilaContraparte>()

  for (const linea of lineas) {
    const fila = porContraparte.get(linea.contraparte) ?? { nombre: linea.contraparte, saldo: 0, vencido: 0 }
    fila.saldo += linea.monto
    if (linea.vencimiento.getTime() < Date.now()) fila.vencido += linea.monto
    porContraparte.set(linea.contraparte, fila)
  }

  return [...porContraparte.values()].sort((a, b) => b.saldo - a.saldo).slice(0, limite)
}

function fechaDoc(doc: DteDocument): Date {
  return new Date(doc.fechaEmision ?? doc.createdAt)
}

function vencimientoA(desde: Date, dias: number): Date {
  return new Date(desde.getTime() + dias * DIA_MS)
}

// ---- Cuentas por cobrar ----

// Una nota de crédito no es una línea suelta por cobrar: rebaja el saldo de la
// factura que referencia. Restada por su cuenta seguiría restando para siempre
// incluso después de que esa factura quedó pagada, y la cobranza terminaría en
// negativo.
function creditosPorDocumento(docs: DteDocument[]): Map<string, number> {
  const porDocumento = new Map<string, number>()

  for (const doc of docs) {
    if (!restaDeuda(doc) || esNotaDeCompra(doc)) continue

    // La primera referencia a un documento real: en certificación la primera
    // es "SET", que no apunta a ningún folio nuestro.
    const referencia = (doc.referencias ?? []).find((ref) => typeof ref.tipoDteRef === 'number' && ref.tipoDteRef < 800)
    if (!referencia) continue

    const clave = `${referencia.tipoDteRef}-${referencia.folioRef}`
    porDocumento.set(clave, (porDocumento.get(clave) ?? 0) + totalClp(doc))
  }

  return porDocumento
}

export function lineasPorCobrar(docs: DteDocument[], customers: Customer[]): LineaCuenta[] {
  const creditos = creditosPorDocumento(docs)
  const lineas: LineaCuenta[] = []

  for (const doc of docs) {
    // El 46 es deuda nuestra con el proveedor, no algo por cobrar.
    if (signoVenta(doc.tipoDte) <= 0 || doc.tipoDte === 46 || esNotaDeCompra(doc)) continue

    const credito = doc.folio != null ? (creditos.get(`${doc.tipoDte}-${doc.folio}`) ?? 0) : 0
    const saldo = Math.max(0, totalClp(doc) - doc.montoPagado - credito)
    if (saldo <= 0) continue

    const cliente = customers.find((c) => c._id === doc.customerId)
    lineas.push({
      id: doc._id,
      descripcion: `${nombreCortoTipoDte(doc.tipoDte)} N° ${doc.folio ?? '—'}`,
      contraparte: cliente?.razonSocial ?? 'Sin cliente',
      monto: saldo,
      // El plazo pactado con ese cliente manda; el default es el legal de 30
      // días (Ley 21.131).
      vencimiento: vencimientoA(fechaDoc(doc), cliente?.plazoPagoDias ?? PLAZO_LEGAL_DIAS),
      verEn: 'documentos'
    })
  }

  return lineas
}

// ---- Cuentas por pagar ----

// La deuda con proveedores sale de DOS colecciones, y esa es la razón de que
// el total nunca calzara con lo que muestra la página de Compras:
//
//  · `purchases`: lo que un proveedor nos emitió y registramos a mano o desde
//    la Casilla de Intercambio. Es lo único que esa página lista.
//  · `documents`: las Facturas de Compra (46) que emitimos nosotros por
//    cambio de sujeto, más las NC/ND que las corrigen. Viven en Documentos.
//
// Las compras de tipo 'factura_compra' se excluyen a propósito: son el mismo
// documento cargado por el otro lado, y la fuente que manda es el DTE emitido.
export function lineasPorPagar(docs: DteDocument[], purchases: Purchase[], suppliers: Supplier[]): LineaCuenta[] {
  const lineas: LineaCuenta[] = []
  const nombreProveedor = (id: string | undefined): string =>
    suppliers.find((s) => s._id === id)?.razonSocial ?? 'Sin proveedor'

  for (const compra of purchases) {
    if (compra.tipoDocumento === 'factura_compra') continue

    // Una nota de crédito del proveedor REBAJA la deuda siempre; el resto
    // suma solo mientras esté impago.
    const esCredito = compra.tipoDocumento === 'nota_credito'
    if (!esCredito && compra.pagado) continue

    lineas.push({
      id: compra._id,
      descripcion: `${NOMBRE_TIPO_COMPRA[compra.tipoDocumento]} N° ${compra.folio}`,
      contraparte: nombreProveedor(compra.supplierId),
      monto: (esCredito ? -1 : 1) * compra.montoTotal,
      vencimiento: compra.fechaVencimiento
        ? new Date(compra.fechaVencimiento)
        : vencimientoA(new Date(compra.fecha), PLAZO_LEGAL_DIAS),
      verEn: 'compras'
    })
  }

  for (const doc of docs) {
    const esNota = esNotaDeCompra(doc)
    if (!esNota && doc.tipoDte !== 46) continue

    // La factura de compra suma lo que queda impago; la nota que la corrige
    // ajusta la deuda completa (una ND suma, una NC resta).
    const monto = esNota
      ? (restaDeuda(doc) ? -1 : 1) * doc.montos.total
      : doc.montos.total - doc.montoPagado
    // Una factura de compra saldada deja de ser deuda; una nota siempre
    // ajusta, salvo que su monto sea cero.
    if (esNota ? monto === 0 : monto <= 0) continue

    lineas.push({
      id: doc._id,
      descripcion: `${nombreCortoTipoDte(doc.tipoDte)} N° ${doc.folio ?? '—'}`,
      contraparte: nombreProveedor(doc.supplierId),
      monto,
      vencimiento: vencimientoA(fechaDoc(doc), PLAZO_LEGAL_DIAS),
      verEn: 'documentos'
    })
  }

  return lineas
}

// Los nombres de los tipos de compra, en un solo lugar por el mismo motivo
// que tiposDte.ts: los usan el selector y la tabla de Compras además del
// desglose de las cuentas por pagar.
export const NOMBRE_TIPO_COMPRA: Record<PurchaseTipoDocumento, string> = {
  factura: 'Factura',
  boleta: 'Boleta',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
  factura_compra: 'Factura de compra'
}
