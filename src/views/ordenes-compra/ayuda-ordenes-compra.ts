import type { SeccionAyuda } from '@/components/AyudaPagina.vue'

export const AYUDA_ORDENES_COMPRA: SeccionAyuda[] = [
  {
    titulo: 'Qué es una orden de compra',
    texto:
      'El pedido formal que la empresa le manda a un proveedor: ítems, precios, fecha y lugar de entrega, condiciones de pago. No es un documento tributario (el SII no la visa ni lleva folio autorizado); es un documento comercial que sirve de respaldo de lo pactado. Cuando llega la factura del proveedor, se registra desde acá como una compra normal —la misma que ve la pantalla Compras y el Libro de Compras— y queda vinculada a la orden.'
  },
  {
    titulo: 'Estados',
    items: [
      { nombre: 'Borrador', descripcion: 'Se edita libremente. El proveedor todavía no la recibió.' },
      { nombre: 'Enviada', descripcion: 'Salió por correo. Si se modifica, se guarda una versión nueva y la anterior queda en el historial.' },
      { nombre: 'Atrasada', descripcion: 'Enviada (o recibida en parte) y con la fecha de entrega pasada.' },
      { nombre: 'Recibida parcial', descripcion: 'Llegó parte de lo pedido. Los ítems quedan congelados.' },
      { nombre: 'Recibida', descripcion: 'Llegó todo lo pedido.' },
      { nombre: 'Cerrada', descripcion: 'Facturada al 100 % (se cierra sola) o cerrada a mano porque el resto no va a llegar.' },
      { nombre: 'Anulada', descripcion: 'La orden nunca corrió. Solo se anula sin recepciones ni facturas.' }
    ]
  },
  {
    titulo: 'Recepcionar',
    texto: 'Registra cada entrega del proveedor: qué ítems llegaron y cuánto, con el folio de la guía si la hubo. Puede ser en partes; nunca se recibe más de lo pedido. Así se ve pedido vs. recibido y se detectan órdenes atrasadas.'
  },
  {
    titulo: 'Registrar la factura del proveedor',
    texto: 'La factura que llega es una compra igual a las de la pantalla Compras: entra al Libro de Compras y a las cuentas por pagar como siempre. La orden solo la anota como "esta factura cubre $X de mí".',
    items: [
      { nombre: 'Crear compra', descripcion: 'Se prellenan proveedor y montos desde la orden; solo hay que poner el folio y la fecha. Si la factura cubre parte de la orden, los montos se reparten en la misma proporción afecto/exento.' },
      { nombre: 'Vincular compra existente', descripcion: 'Si la factura ya entró (por Facturas recibidas o cargada a mano), se asocia sin crear nada.' },
      { nombre: 'Tope', descripcion: 'Una factura no puede cubrir más que el saldo por facturar de la orden: si el proveedor cobra de más, se ve enseguida en vez de absorberse.' }
    ]
  }
]
