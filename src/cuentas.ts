import type { Ambiente, Customer, DteDocument, Purchase, PurchaseTipoDocumento, Supplier } from '@/types'
import { nombreCortoTipoDte } from '@/tiposDte'
import { codigoIsoMoneda } from '@/codigosAduana'

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
//
// OJO — el saldo de un documento se calcula HOY en dos lugares: acá (para los
// tableros, que cargan la colección completa) y en el servidor (para las
// listas, que van paginadas y no pueden ver una nota de crédito fuera de su
// página). Las dos tienen que dar lo mismo; lo que impide que se separen es
// `npm run verificar:saldo` en el server, que corre los casos límite. Unificarlas
// es la etapa pendiente: mover también los totales de los tableros al servidor.

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
// operación. Para sumarlos con el resto hay que pasarlos a pesos: mezclar
// dólares con pesos daría totales mentirosos, y además los pesos son lo único
// que calza con lo que se le declara al SII.
//
// Una exportación en PESO CL no lleva tipo de cambio (el SII solo exige la
// sección OtraMoneda cuando la moneda es extranjera), y sus montos YA están
// en pesos: el factor es 1. Antes se usaba 0 y esas facturas desaparecían
// enteras de las cuentas por cobrar, sin dejar rastro de por qué.

// La moneda en que está expresado el documento. 'CLP' para todo lo que no es
// exportación en moneda extranjera.
export const MONEDA_LOCAL = 'CLP'

export function monedaDe(doc: DteDocument): string {
  if (!TIPOS_EXPORTACION.includes(doc.tipoDte)) return MONEDA_LOCAL
  const moneda = doc.exportacion?.moneda
  return !moneda || moneda === 'PESO CL' ? MONEDA_LOCAL : moneda
}

export function esMonedaExtranjera(doc: DteDocument): boolean {
  return monedaDe(doc) !== MONEDA_LOCAL
}

// Pesos por unidad de la moneda del documento.
export function factorClp(doc: DteDocument): number {
  return esMonedaExtranjera(doc) ? (doc.exportacion?.tipoCambio ?? 0) : 1
}

export function totalClp(doc: DteDocument): number {
  return Math.round(doc.montos.total * factorClp(doc))
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
  // SIEMPRE en pesos, positivo si suma deuda/cobranza y negativo si la rebaja
  // (nota de crédito). Es lo único sumable entre documentos.
  monto: number
  // La moneda en que se emitió el documento, y cuánto se debe en ella. Solo
  // vienen en moneda extranjera: el `monto` en pesos quedó congelado al
  // cambio del día de emisión, así que no es lo que se va a cobrar si la
  // moneda se mueve.
  moneda?: string
  montoOrigen?: number
  vencimiento: Date
  verEn: 'documentos' | 'compras'
}

// Cuánto del total está expresado en cada moneda extranjera. No reemplaza al
// total en pesos —ese es el que calza con el SII— sino que dice qué parte de
// él depende del tipo de cambio.
export function exposicionExtranjera(lineas: LineaCuenta[]): { moneda: string; monto: number; clp: number }[] {
  const porMoneda = new Map<string, { moneda: string; monto: number; clp: number }>()

  for (const linea of lineas) {
    if (!linea.moneda || linea.moneda === MONEDA_LOCAL || linea.montoOrigen === undefined) continue
    const fila = porMoneda.get(linea.moneda) ?? { moneda: linea.moneda, monto: 0, clp: 0 }
    fila.monto += linea.montoOrigen
    fila.clp += linea.monto
    porMoneda.set(linea.moneda, fila)
  }

  return [...porMoneda.values()].sort((a, b) => b.clp - a.clp)
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

// La clave con que una nota de crédito encuentra el documento que corrige.
// Lleva el ambiente porque el folio solo es único dentro de su ambiente: sin
// eso, una nota de certificación podría rebajar una factura de producción con
// el mismo tipo y folio.
function claveDocumento(ambiente: string, tipoDte: number | string, folio: number | string): string {
  return `${ambiente}-${tipoDte}-${folio}`
}

function esVentaCobrable(doc: DteDocument): boolean {
  // El 46 es deuda nuestra con el proveedor, no algo por cobrar.
  return signoVenta(doc.tipoDte) > 0 && doc.tipoDte !== 46 && !esNotaDeCompra(doc)
}

interface CreditoAgrupado {
  monto: number
  notas: DteDocument[]
}

// Una nota de crédito no es una línea suelta por cobrar: rebaja el saldo de la
// factura que referencia. Restada por su cuenta seguiría restando para siempre
// incluso después de que esa factura quedó pagada, y la cobranza terminaría en
// negativo.
function agruparCreditos(docs: DteDocument[]): {
  porDocumento: Map<string, CreditoAgrupado>
  sinReferencia: DteDocument[]
} {
  const porDocumento = new Map<string, CreditoAgrupado>()
  const sinReferencia: DteDocument[] = []

  for (const doc of docs) {
    if (!restaDeuda(doc) || esNotaDeCompra(doc) || !ESTADOS_EMITIDOS.includes(doc.estado)) continue

    // La primera referencia a un documento real: en certificación la primera
    // es "SET", que no apunta a ningún folio nuestro.
    const referencia = (doc.referencias ?? []).find((ref) => typeof ref.tipoDteRef === 'number' && ref.tipoDteRef < 800)
    if (!referencia) {
      sinReferencia.push(doc)
      continue
    }

    // En la moneda de la nota, que es la del documento que corrige: la deuda
    // se rebaja en la moneda en que se pactó y recién el saldo final pasa a
    // pesos. Convertir cada nota con SU tipo de cambio —que puede diferir del
    // de la factura— mezclaría dos cambios distintos en una misma deuda.
    const clave = claveDocumento(doc.ambiente, referencia.tipoDteRef as number, referencia.folioRef)
    const agrupado = porDocumento.get(clave) ?? { monto: 0, notas: [] }
    agrupado.monto += doc.montos.total
    agrupado.notas.push(doc)
    porDocumento.set(clave, agrupado)
  }

  return { porDocumento, sinReferencia }
}

// Una nota de crédito cuyo monto no alcanza a descontarse de ninguna factura.
// El total por cobrar la ignora a propósito, y esa es la decisión correcta:
// sumarla haría que la cobranza bajara para siempre. Pero
// ignorarla EN SILENCIO significa que una nota real puede evaporarse sin que
// nada lo diga, así que se reporta aparte para que se vea.
export type MotivoCreditoSinAplicar = 'sin-referencia' | 'documento-no-encontrado' | 'excede-saldo'

export const GLOSA_CREDITO_SIN_APLICAR: Record<MotivoCreditoSinAplicar, string> = {
  'sin-referencia': 'No referencia ningún documento',
  // Puede ser que el documento no exista entre los emitidos, o que exista y
  // no sea algo por cobrar (una guía, por ejemplo) — la glosa cubre las dos.
  'documento-no-encontrado': 'El documento que corrige no es una venta por cobrar',
  'excede-saldo': 'Supera lo que quedaba por cobrar de ese documento'
}

export interface CreditoSinAplicar {
  id: string
  descripcion: string
  contraparte: string
  monto: number
  motivo: MotivoCreditoSinAplicar
}

export interface CuentasPorCobrar {
  lineas: LineaCuenta[]
  creditosSinAplicar: CreditoSinAplicar[]
}

export function cuentasPorCobrar(docs: DteDocument[], customers: Customer[]): CuentasPorCobrar {
  const { porDocumento, sinReferencia } = agruparCreditos(docs)
  const nombreCliente = (id: string | undefined): string =>
    customers.find((c) => c._id === id)?.razonSocial ?? 'Sin cliente'
  const descripcionDe = (doc: DteDocument): string =>
    `${nombreCortoTipoDte(doc.tipoDte)} N° ${doc.folio ?? '—'}`

  const lineas: LineaCuenta[] = []
  // Cuánto crédito alcanzó a descontarse de cada documento: lo que sobre es
  // lo que hay que reportar.
  const aplicado = new Map<string, number>()

  for (const doc of docs) {
    if (!esVentaCobrable(doc)) continue

    // Todo se resta en la MONEDA del documento —total, abonos y notas son la
    // misma deuda— y la conversión a pesos ocurre una sola vez, al final.
    const clave = doc.folio != null ? claveDocumento(doc.ambiente, doc.tipoDte, doc.folio) : null
    const credito = clave ? (porDocumento.get(clave)?.monto ?? 0) : 0
    const bruto = Math.max(0, doc.montos.total - doc.montoPagado)
    if (clave) aplicado.set(clave, Math.min(credito, bruto))

    const saldoOrigen = bruto - Math.min(credito, bruto)
    if (saldoOrigen <= 0) continue

    const cliente = customers.find((c) => c._id === doc.customerId)
    const moneda = monedaDe(doc)
    lineas.push({
      id: doc._id,
      descripcion: descripcionDe(doc),
      contraparte: cliente?.razonSocial ?? 'Sin cliente',
      monto: Math.round(saldoOrigen * factorClp(doc)),
      moneda,
      // Lo que se debe en la moneda del documento. Se conserva porque el
      // monto en pesos quedó fijado al cambio del día de emisión: si el dólar
      // se mueve, lo que realmente se va a cobrar es otro.
      montoOrigen: moneda === MONEDA_LOCAL ? undefined : saldoOrigen,
      // El plazo pactado con ese cliente manda; el default es el legal de 30
      // días (Ley 21.131).
      vencimiento: vencimientoA(fechaDoc(doc), cliente?.plazoPagoDias ?? PLAZO_LEGAL_DIAS),
      verEn: 'documentos'
    })
  }

  const creditosSinAplicar: CreditoSinAplicar[] = sinReferencia.map((nota) => ({
    id: nota._id,
    descripcion: descripcionDe(nota),
    contraparte: nombreCliente(nota.customerId),
    monto: totalClp(nota),
    motivo: 'sin-referencia'
  }))

  for (const [clave, { monto, notas }] of porDocumento) {
    if (!aplicado.has(clave)) {
      // Ninguna factura respondió a esa referencia: se reporta cada nota
      // entera, que es la unidad que el usuario puede ir a revisar.
      for (const nota of notas) {
        creditosSinAplicar.push({
          id: nota._id,
          descripcion: descripcionDe(nota),
          contraparte: nombreCliente(nota.customerId),
          monto: totalClp(nota),
          motivo: 'documento-no-encontrado'
        })
      }
      continue
    }

    // Acá el sobrante es del conjunto de notas sobre ese documento, no de una
    // en particular, así que se reporta por documento corregido.
    const sobrante = monto - (aplicado.get(clave) ?? 0)
    if (sobrante <= 0) continue

    const primera = notas[0]
    creditosSinAplicar.push({
      id: clave,
      descripcion:
        notas.length === 1 ? descripcionDe(primera) : `${notas.length} notas de crédito sobre un mismo documento`,
      contraparte: nombreCliente(primera.customerId),
      monto: sobrante,
      motivo: 'excede-saldo'
    })
  }

  return { lineas, creditosSinAplicar }
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
