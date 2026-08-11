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
  totIVARetTotal?: number
}

export type PurchaseTipoDocumento = 'factura' | 'boleta' | 'nota_credito' | 'nota_debito'

export type PurchaseAccionSii = 'ERM' | 'ACD' | 'RCD' | 'RFP' | 'RFT'

export interface PurchaseSiiAcuse {
  accion: PurchaseAccionSii
  fecha: string
  codResp: number
  descResp: string
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
  montoIva: number
  montoExento: number
  montoTotal: number
  pagado: boolean
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
