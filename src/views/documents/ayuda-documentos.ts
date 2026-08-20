import type { SeccionAyuda } from '@/components/AyudaPagina.vue'

// Manual en pantalla de la página Documentos — ver AyudaPagina.vue.
export const AYUDA_DOCUMENTOS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto:
      'Todos los documentos tributarios electrónicos (DTE) de tu empresa: facturas, facturas exentas, notas de crédito y débito, guías de despacho, facturas de compra, liquidaciones y documentos de exportación. Un documento nace como Borrador, se emite (recibe folio y firma) y luego se envía al SII.'
  },
  {
    titulo: 'Estados de un documento',
    items: [
      { nombre: 'Borrador', descripcion: 'Editable y eliminable. Aún no existe ante el SII ni consume folio.' },
      { nombre: 'Firmado', descripcion: 'Ya tiene folio y firma electrónica. No se puede modificar; falta enviarlo al SII.' },
      { nombre: 'Enviado', descripcion: 'Subido al SII, esperando su veredicto (usa "Consultar estado SII").' },
      { nombre: 'Aceptado', descripcion: 'Validado por el SII. Es un documento tributario definitivo.' },
      { nombre: 'Rechazado', descripcion: 'El SII lo rechazó. El folio se pierde: corrige y emite uno nuevo.' },
      { nombre: 'Con reparo', descripcion: 'Aceptado con observaciones del SII (ver la glosa al pasar el mouse por el estado).' },
      { nombre: 'Anulado', descripcion: 'Descartado localmente o guía anulada tributariamente.' }
    ]
  },
  {
    titulo: 'Botones principales',
    items: [
      { nombre: 'Nuevo documento', descripcion: 'Crea un borrador. El formulario se adapta al tipo elegido (referencias en notas, traslado en guías, comisiones en liquidaciones, aduana en exportación).' },
      { nombre: 'Importar XML emitido', descripcion: 'Trae un DTE que la empresa emitió en OTRO sistema (p. ej. el facturador gratuito del SII, antes de migrar acá): sube el XML firmado descargado de sii.cl y entra como aceptado, con su timbre, PDF y montos — sin consumir folios ni enviar nada al SII. El cliente se crea solo si no existe.' },
      { nombre: 'Filtros', descripcion: 'Folio, tipo, cliente/RUT, estado y rango de fechas. "Limpiar filtros" restablece todo.' },
      { nombre: 'Enviar como set', descripcion: 'Con 2+ documentos firmados seleccionados: los sube al SII en UN solo sobre. Se usa casi solo en certificación; el día a día es "Enviar al SII" por documento.' },
      { nombre: 'Eliminar seleccionados', descripcion: 'Borra los borradores seleccionados (los demás estados no se pueden eliminar).' }
    ]
  },
  {
    titulo: 'Menú de cada fila (⋮)',
    items: [
      { nombre: 'Revisar y emitir…', descripcion: 'Solo en borradores: vista previa + botón "Emitir y firmar", que reserva el folio real del CAF y firma. Irreversible.' },
      { nombre: 'Vista previa', descripcion: 'En documentos ya emitidos: muestra la representación del documento.' },
      { nombre: 'Enviar al SII', descripcion: 'Sube el documento firmado al SII. Además le envía automáticamente el XML y PDF al correo del receptor.' },
      { nombre: 'Consultar estado SII', descripcion: 'Pregunta al SII el veredicto del envío y actualiza el estado.' },
      { nombre: 'Descargar PDF', descripcion: 'La representación impresa con timbre electrónico (incluye copia cedible cuando corresponde).' },
      { nombre: 'Registrar pago / Ver pagos', descripcion: 'Abonos parciales y su historial. El saldo se ve en la columna Saldo.' },
      { nombre: 'Marcar como facturada / Anular guía', descripcion: 'Solo guías emitidas: registra qué documento la facturó, o su anulación tributaria. Ambas cosas las declara el Libro de Guías.' },
      { nombre: 'Editar / Eliminar', descripcion: 'Solo en borradores.' }
    ]
  },
  {
    titulo: 'Documentos de exportación (110/111/112)',
    texto:
      'Requieren cliente extranjero (RUT 55555555-5 con país en su ficha), moneda de la operación y tipo de cambio a pesos. Los montos van con decimales en la moneda extranjera. La sección Exportación del formulario trae los códigos de Aduana (puertos, países, cláusulas, bultos); los recargos globales cubren flete, seguro y comisiones.'
  }
]
