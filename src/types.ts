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
  // Dirección Regional/Unidad del SII del emisor — va bajo el recuadro en
  // la representación impresa (ver organization.model.ts en el servidor).
  unidadSii?: string
  tasaPpmPct?: number
  // Logotipo (PNG/JPEG en base64) para la esquina superior izquierda del
  // PDF — Manual de Muestras Impresas 1.1.3.
  logoPng?: string
  dbName: string
  // Resolución del SII que autoriza a emitir. NroResol=0 es la convención
  // para quienes se acogen a la resolución general — ver organization.model.ts
  // en el servidor. Va en la Carátula de los envíos y en el pie del PDF.
  resolucionNumero?: number
  resolucionFecha?: string
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
  // Plazo de pago pactado en días; sin pacto rige el default legal de 30
  // días (Ley 21.131). Lo usa el tablero de Finanzas.
  plazoPagoDias?: number
  // Receptor extranjero (documentos de exportación): RUT genérico
  // 55555555-5 y estos datos en la zona <Extranjero> del DTE — ver
  // customer.model.ts en el servidor. `nacionalidad` es el código de PAÍS
  // de Aduana (Anexo 51-9), ver codigosAduana.ts.
  extranjero?: { numId?: string; nacionalidad?: number }
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
  // Monto de la línea cuando viene dado y no se calcula como cantidad ×
  // precio, y el código del documento que la línea liquida. Ambos son de la
  // Liquidación-Factura (43).
  montoLinea?: number
  tipoDocLiq?: number
  // Descuento/recargo porcentual de la línea — solo exportación, donde los
  // montos llevan decimales y el % es la única forma válida en el XSD de
  // justificarlos (ver document.model.ts en el servidor).
  descuentoPct?: number
  recargoPct?: number
}

// Una línea de "Comisiones y Otros Cargos": lo que cobra el mandatario en
// una Liquidación-Factura. Se resta del total del documento.
export interface DteComision {
  tipoMovim: 'C' | 'O'
  glosa: string
  tasa?: number
  neto: number
  exento: number
  iva: number
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

// Zona de exportación del documento (110/111/112): moneda de la operación,
// forma de pago y los datos de aduana del Encabezado. Espejo de
// DteExportacion en document.model.ts del servidor; los códigos vienen de
// codigosAduana.ts.
export interface DteExportacion {
  moneda: string
  // Pesos por unidad de la moneda — obligatorio salvo PESO CL: el SII exige
  // la sección OtraMoneda con los montos en pesos (ver el servidor).
  tipoCambio?: number
  indServicio?: number
  fmaPagExp?: number
  modalidadVenta?: number
  clausulaVenta?: number
  totalClausula?: number
  viaTransporte?: number
  puertoEmbarque?: number
  puertoDesembarque?: number
  tara?: number
  unidadTara?: number
  pesoBruto?: number
  unidadPesoBruto?: number
  pesoNeto?: number
  unidadPesoNeto?: number
  totalItems?: number
  totalBultos?: number
  tipoBultos?: number
  // Marcas de los bultos ("S/M" si no llevan) — obligatorio con bultos; el
  // identificador y sello son obligatorios cuando el bulto es un contenedor.
  marcas?: string
  idContainer?: string
  sello?: string
  emisorSello?: string
  flete?: number
  seguro?: number
  paisRecep?: number
  paisDestino?: number
}

// Una línea de descuento/recargo global — exportación la usa para el flete
// y el seguro (dos recargos, exige el SII) y las comisiones al exterior.
export interface DteDscRcgGlobal {
  tpoMov: 'D' | 'R'
  glosa?: string
  tpoValor: '%' | '$'
  valor: number
  indExeDR?: number
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
  // Solo para Liquidación-Factura (43), donde el área es obligatoria.
  comisiones?: DteComision[]
  // Verdadero en la Factura de Compra (46) y en las NC/ND que la corrigen:
  // esas notas ajustan la deuda con el PROVEEDOR, no las ventas — ver
  // document.model.ts en el servidor.
  retencionIvaCompra?: boolean
  // Descuento global (%) sobre el subtotal de ítems afectos — ver
  // document.model.ts en el servidor.
  descuentoGlobalPct?: number
  // Solo exportación (110/111/112) — ver DteExportacion.
  exportacion?: DteExportacion
  // Líneas de descuento/recargo global; coexiste con descuentoGlobalPct
  // (un documento usa una cosa o la otra) — ver document.model.ts.
  dscRcgGlobales?: DteDscRcgGlobal[]
  montos: DteMontos
  referencias: DteReferencia[]
  estado: DocumentEstado
  montoPagado: number
  pagos?: DtePago[]
  ambiente: Ambiente
  // Calculados por el SERVIDOR en cada lectura, nunca guardados (ver
  // server/src/services/documents/saldo.ts). `saldo` es lo que queda por
  // cobrar descontando los abonos Y las notas de crédito que corrigen el
  // documento; `creditosAplicados` es el detalle que explica ese descuento.
  //
  // Vienen del servidor porque una nota de crédito es OTRO documento, que con
  // la lista paginada puede no estar cargado: el saldo saldría inflado.
  // `saldo` va SIEMPRE en pesos: es la cifra sumable y la que calza con lo
  // que se le declara al SII. `saldoOrigen` y los montos de
  // `creditosAplicados` van en la MONEDA del documento — son los que se
  // muestran junto al documento, donde poner pesos sería contradecir lo que
  // dice el DTE.
  saldo?: number
  saldoOrigen?: number
  creditosAplicados?: { tipoDte: number; folio: number; monto: number }[]
  trackId?: string
  envioSiiEstado?: string
  envioSiiGlosa?: string
  correoReceptor?: { destinatario: string; enviadoAt: string }
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
  // Los abonos al proveedor. `montoPagado` es su suma y `pagado` el derivado
  // (montoPagado >= montoTotal); los dos los calcula el servidor. Ausentes en
  // las compras anteriores a los abonos parciales, donde solo existía el
  // switch `pagado` — ver purchase.model.ts en el servidor.
  pagos?: DtePago[]
  montoPagado?: number
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
  // Relay SMTP de salida (opcional): sin estos campos, el envío se deriva
  // del IMAP. La contraseña del relay nunca viaja de vuelta al frontend.
  smtpHost?: string
  smtpPort?: number
  smtpUsuario?: string
  // Remitente del correo comercial (cotizaciones); la casilla queda solo
  // para DTE — ver mailbox-config.model.ts en el servidor.
  remitenteComercial?: { nombre?: string; email: string }
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
  // 'rcv' = detectada en el Registro de Compras del SII (no llegó por
  // correo); ausente o 'email' = Casilla de Intercambio.
  origen?: 'email' | 'rcv'
  // Desde cuándo corre el plazo de 8 días para reclamar (Ley 19.983).
  recibidoEn: string
  // Referencias del DTE (801 = orden de compra); solo las de correo.
  referencias?: { tipoDocRef: string; folioRef: string; razonRef?: string }[]
  createdAt: string
  updatedAt: string
}

// Lo que devuelve sugerir-orden-compra para una factura recibida.
export interface SugerenciaOrdenCompra {
  ordenCompraId: string
  numeroFormateado: string
  titulo?: string
  total: number
  saldoPorFacturar: number
  estado: OrdenCompraEstado
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

// ---------------------------------------------------------------------------
// Cotizaciones — espejo de server/src/models/tenant/cotizacion.model.ts.
// Las fechas viajan como string en el JSON, igual que el resto.
// ---------------------------------------------------------------------------

export type CotizacionEstado = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'facturada'
// 'vencida' la deriva el servidor al leer (enviada con la validez cumplida).
export type CotizacionEstadoVisible = CotizacionEstado | 'vencida'

export interface CotizacionItem {
  productId?: string
  descripcion: string
  cantidad: number
  precioUnit: number
  descuento: number
  exento: boolean
  unidad?: string
}

export interface CotizacionVersion {
  version: number
  items: CotizacionItem[]
  descuentoGlobalPct?: number
  montos: DteMontos
  validezDias: number
  fechaVencimiento: string
  condiciones?: string
  notas?: string
  reemplazadaAt: string
}

export interface CotizacionFactura {
  documentId: string
  tipoDte: number
  monto: number
  origen: 'total' | 'items' | 'monto' | 'pie' | 'cuota' | 'interes'
  itemIndices?: number[]
  cuotaNumero?: number
  glosa?: string
  creadoAt: string
}

export type MetodoInteres = 'sin_interes' | 'simple' | 'compuesto' | 'cuota_fija'
export type ModalidadFacturacionCuotas = 'factura_por_cuota' | 'factura_total'

export interface CuotaPago {
  monto: number
  fecha: string
  medio?: string
  nota?: string
}

export interface Cuota {
  numero: number
  vencimiento: string
  capital: number
  interes: number
  monto: number
  estado: 'pendiente' | 'pagada'
  documentId?: string
  notaDebitoId?: string
  pagos: CuotaPago[]
  montoPagado: number
}

export interface PlanPago {
  numeroCuotas: number
  pie?: number
  primerVencimiento: string
  periodicidad: 'mensual' | 'dias'
  cadaDias?: number
  metodo: MetodoInteres
  tasaInteresPct: number
  modalidad: ModalidadFacturacionCuotas
  cuotas: Cuota[]
  totalCapital: number
  totalInteres: number
  totalPlan: number
  facturaTotalId?: string
}

// Lo que el formulario manda para pactar el plan (el servidor calcula el
// calendario) — ver decidir-cotizacion.service.ts.
export interface PlanPagoPactado {
  numeroCuotas: number
  pie?: number
  primerVencimiento: string
  periodicidad: 'mensual' | 'dias'
  cadaDias?: number
  metodo: MetodoInteres
  tasaInteresPct: number
  modalidad: ModalidadFacturacionCuotas
}

export interface Cotizacion {
  _id: string
  numero: number
  numeroFormateado: string
  version: number
  versiones: CotizacionVersion[]
  customerId: string
  giroReceptor?: string
  titulo?: string
  items: CotizacionItem[]
  descuentoGlobalPct?: number
  montos: DteMontos
  fechaEmision: string
  validezDias: number
  fechaVencimiento: string
  condiciones?: string
  notas?: string
  estado: CotizacionEstado
  estadoVisible: CotizacionEstadoVisible
  envios: { destinatario: string; enviadoAt: string; version: number }[]
  decision?: { fecha: string; motivo?: string }
  facturas: CotizacionFactura[]
  montoFacturado: number
  planPago?: PlanPago
  ambiente: Ambiente
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Órdenes de compra — espejo de server/src/models/tenant/orden-compra.model.ts.
// ---------------------------------------------------------------------------

export type OrdenCompraEstado = 'borrador' | 'enviada' | 'recibida_parcial' | 'recibida' | 'cerrada' | 'anulada'
// 'atrasada' la deriva el servidor al leer (enviada o parcial con la fecha de
// entrega pasada).
export type OrdenCompraEstadoVisible = OrdenCompraEstado | 'atrasada'

export interface OrdenCompraItem {
  productId?: string
  descripcion: string
  cantidad: number
  precioUnit: number
  descuento: number
  exento: boolean
  unidad?: string
  cantidadRecibida: number
}

export interface OrdenCompraVersion {
  version: number
  items: OrdenCompraItem[]
  descuentoGlobalPct?: number
  montos: DteMontos
  fechaEntrega?: string
  lugarEntrega?: string
  condicionesPago?: string
  reemplazadaAt: string
}

export interface OrdenCompraRecepcion {
  fecha: string
  items: { indice: number; cantidad: number }[]
  guiaFolio?: string
  nota?: string
  registradaAt: string
}

export interface OrdenCompraFactura {
  purchaseId: string
  tipoDocumento: string
  folio: string
  monto: number
  creadoAt: string
}

export interface OrdenCompra {
  _id: string
  numero: number
  numeroFormateado: string
  version: number
  versiones: OrdenCompraVersion[]
  supplierId: string
  titulo?: string
  items: OrdenCompraItem[]
  descuentoGlobalPct?: number
  montos: DteMontos
  fechaEmision: string
  fechaEntrega?: string
  lugarEntrega?: string
  condicionesPago?: string
  notas?: string
  estado: OrdenCompraEstado
  estadoVisible: OrdenCompraEstadoVisible
  envios: { destinatario: string; enviadoAt: string; version: number }[]
  recepciones: OrdenCompraRecepcion[]
  facturas: OrdenCompraFactura[]
  montoFacturado: number
  saldoPorFacturar: number
  cierre?: { fecha: string; motivo?: string }
  ambiente: Ambiente
  createdAt: string
  updatedAt: string
}
