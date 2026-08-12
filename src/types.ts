// Espejo de los DTOs que expone el server (server/src/models/**/*.model.ts).
// Al ser dos proyectos npm separados no se pueden compartir los tipos de
// TypeScript directamente; si el server cambia un shape hay que actualizar
// esto a mano.

export type Ambiente = 'certificacion' | 'produccion'

export interface Organization {
  _id: string
  rut: string
  razonSocial: string
  giro?: string
  direccion?: { calle?: string; comuna?: string; ciudad?: string }
  dbName: string
  ambiente: Ambiente
  estado: 'onboarding' | 'activo' | 'suspendido'
  createdAt: string
  updatedAt: string
}

export type Role = 'owner' | 'admin' | 'contador' | 'vendedor'

export interface Membership {
  organizationId: string
  role: Role
  estado: 'activo' | 'invitado'
}

export interface User {
  _id: string
  email: string
  nombre: string
  memberships: Membership[]
  createdAt: string
  updatedAt: string
}

// Vista aplanada de una membresía, tal como la devuelve el servicio
// `organization-members` (no es un documento propio, ver ese servicio en el
// servidor: opera sobre el arreglo `memberships` embebido en cada usuario).
export interface Member {
  userId: string
  email: string
  nombre: string
  role: Role
  estado: 'activo' | 'invitado'
  // Solo presente en la respuesta de invitar cuando se creó un usuario
  // nuevo — se muestra una sola vez, no se vuelve a poder consultar.
  tempPassword?: string
}

export interface Customer {
  _id: string
  rut: string
  razonSocial: string
  giro?: string
  giros?: string[]
  direccion?: string
  comuna?: string
  ciudad?: string
  email?: string
  condicionPago?: string
  createdAt: string
  updatedAt: string
}

export type Moneda = 'CLP' | 'UF'

export interface Product {
  _id: string
  sku: string
  nombre: string
  precio: number
  moneda: Moneda
  unidad: string
  exento: boolean
  impuestoAdicional: number
  createdAt: string
  updatedAt: string
}

export interface ValorUf {
  fecha: string
  valor: number
}

export interface Caf {
  _id: string
  tipoDte: number
  ambiente: Ambiente
  folioDesde: number
  folioHasta: number
  folioActual: number
  xmlRaw: string
  fechaAutorizacion: string
  estado: 'activo' | 'agotado'
  createdAt: string
  updatedAt: string
}

export interface Certificate {
  _id: string
  alias: string
  rut: string
  validFrom: string
  validTo: string
  estado: 'activo' | 'vencido' | 'revocado'
  createdAt: string
  updatedAt: string
}

export type DocumentEstado =
  | 'draft'
  | 'pendiente_firma'
  | 'firmado'
  | 'enviado'
  | 'aceptado'
  | 'rechazado'
  | 'reparo'
  | 'anulado'

export interface DteItem {
  productId?: string
  descripcion: string
  cantidad: number
  precioUnit: number
  descuento: number
  exento: boolean
  // Unidad de medida de la línea (máximo 4 caracteres) — ver
  // document.model.ts en el servidor.
  unidad?: string
}

export interface DtePago {
  monto: number
  fecha: string
  medio?: string
  nota?: string
}

export interface DteMontos {
  neto: number
  iva: number
  exento: number
  total: number
}

export interface DteReferencia {
  tipoDteRef: number
  folioRef: number
  fechaRef: string
  // 1=Anula Documento, 2=Corrige texto, 3=Corrige montos
  codRef?: number
  razon: string
}

export interface DteDocument {
  _id: string
  tipoDte: number
  folio?: number
  // Ausente solo para Factura de Compra (46), que usa supplierId en su
  // lugar — ver document.model.ts en el servidor.
  customerId?: string
  supplierId?: string
  giroReceptor?: string
  // Solo para Guía de Despacho (52) — ver document.model.ts en el servidor.
  indTraslado?: number
  // Quién se hace cargo del traslado. No confundir con indTraslado, que es
  // el MOTIVO (venta, consignación, traslado interno...) — ver
  // document.model.ts en el server.
  tpoDespacho?: number
  // Qué pasó con una Guía de Despacho (52) después de emitida: qué documento
  // la facturó y si se anuló. Es lo que declara el Libro de Guías (ver
  // document.model.ts en el servidor y LibrosView). Las fechas viajan como
  // string en el JSON, igual que el resto.
  guiaFacturada?: { tipoDte: number; folio: number; fecha: string }
  guiaAnulada?: { fecha: string; motivo?: string }
  items: DteItem[]
  // Descuento global (%) sobre el subtotal de ítems afectos — ver
  // document.model.ts en el servidor.
  descuentoGlobalPct?: number
  montos: DteMontos
  referencias: DteReferencia[]
  estado: DocumentEstado
  montoPagado: number
  pagos?: DtePago[]
  ambiente: Ambiente
  trackId?: string
  envioSiiEstado?: string
  envioSiiGlosa?: string
  fechaEmision?: string
  createdAt: string
  updatedAt: string
}

export interface Supplier {
  _id: string
  rut: string
  razonSocial: string
  giro?: string
  giros?: string[]
  direccion?: string
  comuna?: string
  ciudad?: string
  email?: string
  createdAt: string
  updatedAt: string
}

// Una fila del ResumenPeriodo del Libro de Compra-Venta (ver
// server/src/sii/libro-cv.ts) — un tipo de documento SII (33, 61, etc.) con
// sus totales agregados del período.
export interface LibroResumenTipo {
  tipoDoc: number
  totDoc: number
  totMntExe: number
  totMntNeto: number
  totMntIVA: number
  totMntTotal: number
  totIVAUsoComun?: number
  // Factor de proporcionalidad usado para el IVA de uso común y el crédito
  // que resulta. Lo calcula el server desde las ventas del período si no se
  // le pasa uno (ver generate-libro.service.ts).
  fctProp?: number
  totCredIVAUsoComun?: number
  totIVANoRec?: { codIVANoRec: number; totOpIVANoRec: number; totMntIVANoRec: number }[]
  totOtrosImp?: { codImp: number; totMntImp: number }[]
}

// Resumen del Libro de Guías (ver server/src/sii/libro-guias.ts). No agrupa
// por tipo de documento como el IECV —todas sus líneas son guías—, sino por
// lo que pasó con cada una: cuántas se anularon y cuánto monto dejó de estar
// vigente porque ya lo declaró una factura.
export interface LibroResumenGuias {
  totFolAnulado?: number
  totGuiaAnulada?: number
  totGuiaVenta: number
  totMntGuiaVta: number
  totMntModificado?: number
  totTraslado?: { tpoTraslado: number; cantGuia: number; mntGuia?: number }[]
}

export type PurchaseTipoDocumento = 'factura' | 'boleta' | 'nota_credito' | 'nota_debito' | 'factura_compra'

export type PurchaseAccionSii = 'ERM' | 'ACD' | 'RCD' | 'RFP' | 'RFT'

export interface PurchaseSiiAcuse {
  accion: PurchaseAccionSii
  fecha: string
  codResp: number
  descResp: string
}

// Motivos por los que el IVA de una compra no da derecho a crédito fiscal
// (tabla <IVANoRec> del Formato IECV).
export type PurchaseCodigoIvaNoRec = 1 | 2 | 3 | 4 | 9

// Lo que se manda al guardar una compra. Se separa de `Purchase` porque acá
// `null` tiene un significado que en el documento guardado no existe: BORRAR
// el campo. Un patch ignora las claves `undefined`, así que es la única
// forma de dejar de aplicar un tratamiento de IVA al editar.
export type PurchaseWrite = Partial<Omit<Purchase, 'ivaNoRecuperable' | 'referencia'>> & {
  ivaNoRecuperable?: Purchase['ivaNoRecuperable'] | null
  referencia?: Purchase['referencia'] | null
}

export interface PurchaseReferencia {
  tipoDocumento: PurchaseTipoDocumento
  folio: string
  electronico?: boolean
}

export interface Purchase {
  _id: string
  supplierId: string
  tipoDocumento: PurchaseTipoDocumento
  folio: string
  fecha: string
  fechaVencimiento?: string
  glosa?: string
  montoNeto: number
  // Solo el IVA con derecho a crédito; los otros tres tratamientos van en
  // los campos de abajo (ver purchase.model.ts en el server).
  montoIva: number
  montoExento: number
  ivaUsoComun?: number
  ivaNoRecuperable?: { codigo: PurchaseCodigoIvaNoRec; monto: number }
  ivaRetenidoTotal?: number
  referencia?: PurchaseReferencia
  montoTotal: number
  pagado: boolean
  // Decide si el documento va al Libro de Compras con su código electrónico
  // (33) o manual (30). Ausente = electrónico.
  electronico?: boolean
  origen?: 'manual' | 'email'
  siiAcuse?: PurchaseSiiAcuse
  createdAt: string
  updatedAt: string
}

// Config de la Casilla de Intercambio de DTE (ver server/src/email/casilla-intercambio.ts)
// — nunca trae el password, ese campo solo se manda al guardar, nunca vuelve.
export interface MailboxConfig {
  _id: string
  email: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  imapUsuario: string
  activo: boolean
  ultimoPolling?: string
  ultimoError?: string
  createdAt: string
  updatedAt: string
}

// Un DTE detectado en la Casilla de Intercambio, a la espera de revisión —
// ver server/src/models/tenant/incoming-invoice.model.ts.
export interface IncomingInvoice {
  _id: string
  messageId: string
  emisorRut: string
  emisorRazonSocial?: string
  tipoDte: number
  folio: number
  fechaEmision: string
  montoNeto: number
  montoIva: number
  montoExento: number
  montoTotal: number
  recibidoEn: string
  createdAt: string
  updatedAt: string
}

export interface GiroNegocio {
  codigo: string
  descripcion: string
  indicadorAfectoIva: string
}

export interface SituacionTributaria {
  registrado: boolean
  nombre?: string
  giros: GiroNegocio[]
}

export interface Paginated<T> {
  total: number
  limit: number
  skip: number
  data: T[]
}
