import type { SeccionAyuda } from '@/components/AyudaPagina.vue'

// Contenido de la ayuda contextual de cada página (ver AyudaPagina.vue).
// El de Documentos vive aparte (views/documents/ayuda-documentos.ts) por
// su tamaño.

export const AYUDA_PANORAMA: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'El resumen del mes: ventas, cuentas por cobrar, IVA acumulado (débito de tus ventas) y facturas por pagar, más los accesos rápidos a lo pendiente.'
  },
  {
    titulo: 'Cómo se calcula',
    items: [
      { nombre: 'Facturas por pagar', descripcion: 'Suma DOS cosas: las compras que registraste (página Compras) y las facturas de compra que emitiste tú por cambio de sujeto, que viven en Documentos. Por eso el total puede ser mayor que lo que ves en Compras. El desglose documento por documento está en Finanzas.' },
      { nombre: 'Por cobrar', descripcion: 'Todo lo impago histórico, neto de notas de crédito y abonos — no se limita al mes, por eso puede superar a las ventas del mes.' },
      { nombre: 'Certificación', descripcion: 'Lo emitido y comprado en el ambiente de certificación es de prueba y nunca se suma a los números de producción.' }
    ]
  },
  {
    titulo: 'Listas de acción',
    items: [
      { nombre: 'Facturas recibidas', descripcion: 'Documentos que llegaron a tu casilla y nadie ha revisado. "Revisar" abre la bandeja para confirmarlos o descartarlos.' },
      { nombre: 'Facturas por recepcionar', descripcion: 'Compras ya confirmadas a las que falta registrar el acuse de recibo ante el SII. "Recepcionar" lo registra (equivale a aceptar).' },
      { nombre: 'Documentos recientes', descripcion: 'Los últimos DTE emitidos con su estado ante el SII.' }
    ]
  }
]

export const AYUDA_CLIENTES: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'Tus clientes: los receptores de tus documentos de venta. El RUT y giro que registres son los que van en el DTE, y el email es a donde el sistema envía automáticamente el XML y PDF de cada documento.'
  },
  {
    titulo: 'Botones',
    items: [
      { nombre: 'Nuevo cliente', descripcion: 'Crea la ficha. La lupa junto al RUT trae razón social y giros reales desde el SII.' },
      { nombre: 'Cliente extranjero', descripcion: 'Para facturas de exportación: usa el RUT genérico 55555555-5, con el identificador del país del cliente y su nacionalidad.' },
      { nombre: 'Menú ⋮', descripcion: 'Editar o eliminar la ficha. Editar giros no cambia documentos ya emitidos.' }
    ]
  }
]

export const AYUDA_PRODUCTOS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'Tu catálogo de productos y servicios. Al facturar, elegir un producto autocompleta descripción, precio, unidad y exención — todo editable en cada documento.'
  },
  {
    titulo: 'Campos clave',
    items: [
      { nombre: 'Moneda UF', descripcion: 'Un producto tarifado en UF se convierte a pesos con la UF del día al agregarlo a un documento, dejando constancia en la descripción.' },
      { nombre: 'Exento', descripcion: 'Marca el ítem como no afecto a IVA por defecto al facturarlo.' },
      { nombre: 'Unidad', descripcion: 'Unidad de medida de la línea (máx. 4 caracteres), exigida por el SII cuando no son unidades sueltas.' }
    ]
  }
]

export const AYUDA_LIBROS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'La generación y envío al SII de los libros electrónicos del período: Libro de Ventas, Libro de Compras y Libro de Guías (IECV). Cada libro toma TODOS los documentos del mes, así que el período debe estar limpio antes de enviar.'
  },
  {
    titulo: 'Botones',
    items: [
      { nombre: 'Generar libro', descripcion: 'Arma el XML del período con los documentos/compras registrados y lo muestra para revisar.' },
      { nombre: 'Enviar al SII', descripcion: 'Firma y sube el libro. El resultado se consulta con el estado del envío.' },
      { nombre: 'Factor de proporcionalidad', descripcion: 'Para el IVA de uso común del Libro de Compras; si no lo indicas, se calcula desde las ventas del período.' }
    ]
  }
]

export const AYUDA_COMPRAS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'Tu registro real de compras: las confirmadas desde la bandeja de facturas recibidas más las ingresadas a mano. De aquí sale el Libro de Compras y el crédito de IVA.'
  },
  {
    titulo: 'Diferencia con "Facturas recibidas"',
    texto: 'Facturas recibidas es la bandeja de entrada (pendientes de revisión, aún no son compras tuyas). Compras es lo ya aceptado en tu contabilidad.'
  },
  {
    titulo: 'Botones',
    items: [
      { nombre: 'Nueva compra', descripcion: 'Ingreso manual — útil para facturas que el proveedor no envió por correo (revísalas en el Registro de Compras de sii.cl). El switch "electrónico" decide el código en el Libro (33 vs 30).' },
      { nombre: 'Tratamientos de IVA', descripcion: 'Crédito normal, uso común (con factor), no recuperable (con motivo) o retención total — determinan cómo entra al Libro de Compras.' },
      { nombre: 'Acuse / Reclamo (menú ⋮)', descripcion: 'Registra ante el SII la aceptación (ERM/ACD) o el RECLAMO (RCD) de la factura. El reclamo debe hacerse dentro de 8 días desde la recepción en el SII — pasado el plazo hay aceptación tácita.' }
    ]
  }
]

export const AYUDA_FACTURAS_RECIBIDAS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'La bandeja de entrada: los DTE que llegaron a tu Casilla de Intercambio más los detectados en el Registro de Compras del SII (RCV), pendientes de revisión. Nada de esto está en tu contabilidad todavía. Al llegar por correo, el sistema ya envió automáticamente el acuse de recibo técnico al emisor (eso NO acepta la factura).'
  },
  {
    titulo: 'RCV y plazo de reclamo',
    items: [
      { nombre: 'Buscar en el RCV', descripcion: 'Consulta el Registro de Compras del SII (mes actual y anterior) y trae las facturas que el proveedor no mandó por correo. El sistema lo hace solo cada hora; el botón es para no esperar.' },
      { nombre: 'Detectada en el RCV', descripcion: 'Esa factura no llegó por correo — no hay a quién responderle el intercambio, pero el reclamo ante el SII funciona igual.' },
      { nombre: 'Plazo de reclamo', descripcion: 'Los 8 días corridos desde la recepción en el SII para reclamar una factura (Ley 19.983). Vencido el plazo opera la aceptación tácita: la factura queda aceptada aunque no hagas nada, con derecho a crédito fiscal para ti y mérito ejecutivo para el emisor.' }
    ]
  },
  {
    titulo: 'Manual del menú ⋮ (facturas tipo 33)',
    items: [
      { nombre: 'Aceptar contenido del documento (ACD)', descripcion: 'Declara al SII que la factura está correcta en montos y datos. Registra la compra, avisa al SII y le envía al emisor la aceptación comercial + recibo de mercaderías (Ley 19.983). Úsala cuando revisaste la factura y está bien.' },
      { nombre: 'Acuse recibo de mercaderías/servicios (ERM)', descripcion: 'Declara al SII que las mercaderías o servicios se RECIBIERON (el hecho físico, no solo el papel). Mismo efecto práctico que ACD: compra registrada + avisos. Es el acuse que le da a la factura mérito para cesión (factoring del emisor).' },
      { nombre: 'Reclamar contenido (RCD)', descripcion: 'La factura está mala o no corresponde (montos, datos, no es tuya). Registra el reclamo ante el SII, envía el rechazo al emisor y la saca de la bandeja SIN crear compra. DEFINITIVO: el SII no permite revertirlo — el emisor deberá anularla con NC y re-emitir.' },
      { nombre: 'Reclamo por falta parcial (RFP) / total (RFT)', descripcion: 'La factura está bien emitida pero la mercadería no llegó completa (RFP) o no llegó nada (RFT). Mismo circuito que RCD: reclamo al SII + rechazo al emisor + fuera de la bandeja, sin compra.' },
      { nombre: 'Registrar compra (sin aviso al SII)', descripcion: 'Solo registra la compra en tu contabilidad, sin mandar nada al SII. Es la opción correcta cuando el aviso no aplica: plazo de 8 días vencido (aceptación tácita ya operó), factura pagada AL CONTADO (el SII rechaza eventos sobre ellas, código 27), o el acuse ya se hizo por otra vía (sii.cl).' },
      { nombre: 'Descartar', descripcion: 'Solo la quita de la bandeja — NO notifica al SII ni al emisor ni crea compra. Para duplicados y documentos de prueba. Si la factura no corresponde, lo correcto es Reclamar, no descartar.' }
    ]
  },
  {
    titulo: '¿Qué opción uso? (guía rápida)',
    items: [
      { nombre: 'Factura correcta, dentro de plazo', descripcion: 'Aceptar contenido (o Acuse recibo si quieres dejar constancia de la recepción física).' },
      { nombre: 'Factura correcta, plazo vencido o pagada al contado', descripcion: 'Registrar compra (sin aviso al SII).' },
      { nombre: 'Factura incorrecta o que no es tuya, dentro de plazo', descripcion: 'Reclamar contenido (RCD).' },
      { nombre: 'Factura OK pero mercadería incompleta o ausente', descripcion: 'Reclamo falta parcial (RFP) o total (RFT).' },
      { nombre: 'Duplicado o prueba', descripcion: 'Descartar.' },
      { nombre: 'Notas de crédito/débito (61/56) y exentas (34)', descripcion: 'Solo ofrecen "Registrar compra" o "Descartar": el registro de acuse/reclamo del SII únicamente existe para facturas tipo 33.' }
    ]
  }
]

export const AYUDA_PROVEEDORES: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'Tus proveedores. Se crean solos al confirmar facturas recibidas, o a mano. En una Factura de Compra (46) el proveedor es el receptor del documento.'
  }
]

export const AYUDA_CAF: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'Los CAF (Código de Autorización de Folios) por tipo de documento: el rango de folios que el SII te autorizó y cuántos quedan libres. Sin folios disponibles no se puede emitir ese tipo.'
  },
  {
    titulo: 'Claves',
    items: [
      { nombre: 'Cargar CAF', descripcion: 'Sube el archivo XML descargado desde sii.cl (Timbraje electrónico). Uno por tipo de documento y ambiente.' },
      { nombre: 'Folios', descripcion: 'Un folio se consume al EMITIR (firmar) y no se recupera aunque el envío falle. Vigila el saldo antes de operar.' },
      { nombre: 'Ambiente', descripcion: 'Los CAF de certificación y producción son independientes: para operar en producción hay que cargar CAF de producción.' }
    ]
  }
]

export const AYUDA_CERTIFICADOS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'El certificado digital de la empresa (archivo .pfx/.p12): con él se firman los documentos, los libros, los envíos y las respuestas de intercambio. La contraseña se guarda cifrada. Vigila la fecha de vencimiento: con el certificado vencido no se puede firmar nada.'
  }
]

export const AYUDA_CASILLA: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'La Casilla de Intercambio de DTE: el correo registrado ante el SII a donde tus proveedores envían sus facturas en XML. El sistema la revisa por IMAP cada pocos minutos y deja lo recibido en la bandeja de Facturas recibidas.'
  },
  {
    titulo: 'Claves',
    items: [
      { nombre: 'Correo saliente', descripcion: 'La misma casilla se usa para ENVIAR: tus DTE a los clientes, los acuses y las aceptaciones a proveedores (SMTP con las mismas credenciales).' },
      { nombre: 'Servidor de salida (SMTP) — opcional', descripcion: 'Solo si el envío directo está bloqueado (los datacenters suelen bloquear los puertos SMTP estándar): un relay transaccional con sus propias credenciales y el dominio del correo verificado (SPF/DKIM), típicamente en el puerto 2525. Vacío = se usa el servidor del proveedor de la casilla.' },
      { nombre: 'Último polling / error', descripcion: 'Cuándo se revisó por última vez y si hubo problemas de conexión.' }
    ]
  }
]

export const AYUDA_MIEMBROS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'Quiénes acceden a esta organización y con qué rol. Vendedor crea borradores; Contador además emite, envía al SII y registra acuses (acciones legalmente vinculantes); Admin configura; Owner todo.'
  }
]

export const AYUDA_ORGANIZACIONES: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'Las empresas a las que perteneces. Editar permite ajustar razón social, giro, la Unidad del SII (va bajo el recuadro en la representación impresa) y el logo (esquina superior izquierda del PDF, máx. 300 KB).'
  }
]

export const AYUDA_USUARIOS: SeccionAyuda[] = [
  {
    titulo: '¿Qué se muestra aquí?',
    texto: 'Administración de usuarios de la plataforma y sus membresías en organizaciones.'
  }
]
