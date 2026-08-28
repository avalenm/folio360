import type { SeccionAyuda } from '@/components/AyudaPagina.vue'

export const AYUDA_COTIZACIONES: SeccionAyuda[] = [
  {
    titulo: 'Qué es una cotización',
    texto:
      'Una propuesta comercial para un cliente: ítems, precios y condiciones, con una validez en días. No es un documento tributario (no se firma ni va al SII); cuando el cliente la acepta, desde acá se generan las facturas como borradores, que después se emiten en Documentos igual que siempre.'
  },
  {
    titulo: 'Estados',
    items: [
      { nombre: 'Borrador', descripcion: 'Se edita libremente. El cliente todavía no la recibió.' },
      { nombre: 'Enviada', descripcion: 'Salió por correo. Si se modifica, se guarda una versión nueva y la anterior queda en el historial.' },
      { nombre: 'Vencida', descripcion: 'Enviada y con la validez cumplida. Igual se puede aceptar si el cliente se decide tarde.' },
      { nombre: 'Aceptada', descripcion: 'El cliente la aprobó: los ítems quedan congelados y ya se puede facturar.' },
      { nombre: 'Rechazada', descripcion: 'El cliente la descartó. Se puede duplicar como una nueva o reabrir si fue un error.' },
      { nombre: 'Facturada', descripcion: 'El 100% del total ya está convertido en facturas.' }
    ]
  },
  {
    titulo: 'Facturar',
    texto: 'Solo cotizaciones aceptadas. Cada opción crea borradores en Documentos, nunca emite sola.',
    items: [
      { nombre: 'Total', descripcion: 'Todos los ítems en una factura. Si no caben en una hoja (norma del SII), se reparten en varias.' },
      { nombre: 'Por ítems', descripcion: 'Elija qué líneas facturar ahora; el resto queda pendiente.' },
      { nombre: 'Por monto', descripcion: 'Un anticipo o un saldo, como una sola línea proporcional entre afecto y exento.' },
      { nombre: 'Cuota', descripcion: 'Con plan de pago por cuota: una factura por cuota, con su interés como línea afecta.' }
    ]
  },
  {
    titulo: 'Plan de pago en cuotas',
    texto: 'Se pacta al aceptar (o después, mientras ninguna cuota esté facturada o pagada). Las cuotas cuadran al peso con el total.',
    items: [
      { nombre: 'Sin interés', descripcion: 'El total dividido en partes iguales.' },
      { nombre: 'Interés simple', descripcion: 'Interés sobre el capital inicial por cada período, sumado al final (C × (1 + i × n)). Cuotas iguales.' },
      { nombre: 'Interés compuesto', descripcion: 'El interés de cada período se suma al capital y genera interés (C × (1 + i)^n). Cuotas iguales.' },
      { nombre: 'Cuota fija', descripcion: 'Cuota constante que paga el interés del saldo y amortiza el resto. Menos interés total que el compuesto.' },
      { nombre: 'Factura por cuota', descripcion: 'Cada cuota es su propia factura (capital + interés). Es la modalidad por defecto.' },
      { nombre: 'Factura total + cuotas', descripcion: 'Se factura el 100% de una vez; las cuotas son el calendario de cobranza y cada pago queda como abono de esa factura. El interés se documenta con una nota de débito por cuota.' },
      { nombre: 'Pagar cuota', descripcion: 'Registra el pago y lo refleja como abono en la factura correspondiente; si la cuota aún no tiene factura, el pago espera y pasa al borrador cuando se cree.' }
    ]
  }
]
