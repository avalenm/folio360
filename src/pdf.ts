// Descarga un PDF que llegó del servidor en base64, igual que lo hace
// Documentos con el PDF del DTE.
//
// Se usa un enlace de descarga y NO `window.open`: Safari bloquea las
// ventanas que se abren después de un `await` (ya no las considera iniciadas
// por el clic del usuario), así que el botón "PDF" de cotizaciones y órdenes
// de compra parecía no hacer nada.
export function descargarPdf(pdfBase64: string, filename: string): void {
  const bytes = Uint8Array.from(atob(pdfBase64), (ch) => ch.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
