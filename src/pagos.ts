import type { Supplier, TipoCuentaBancaria } from '@/types'

// Bancos de Chile por código SBIF — espejo de server/src/pagos/bancos.ts.
export const BANCOS: readonly { codigo: string; nombre: string }[] = [
  { codigo: '1', nombre: 'Banco de Chile' },
  { codigo: '9', nombre: 'Banco Internacional' },
  { codigo: '12', nombre: 'BancoEstado' },
  { codigo: '14', nombre: 'Scotiabank Chile' },
  { codigo: '16', nombre: 'Banco de Crédito e Inversiones (BCI)' },
  { codigo: '28', nombre: 'Banco BICE' },
  { codigo: '37', nombre: 'Banco Santander' },
  { codigo: '39', nombre: 'Banco Itaú Chile' },
  { codigo: '49', nombre: 'Banco Security' },
  { codigo: '51', nombre: 'Banco Falabella' },
  { codigo: '53', nombre: 'Banco Ripley' },
  { codigo: '55', nombre: 'Banco Consorcio' },
  { codigo: '672', nombre: 'Coopeuch' },
  { codigo: '729', nombre: 'Prepago Los Héroes' },
  { codigo: '730', nombre: 'Tenpo' },
  { codigo: '732', nombre: 'Prepago Los Andes' }
]

export const TIPOS_CUENTA: { value: TipoCuentaBancaria; label: string }[] = [
  { value: 'corriente', label: 'Cuenta corriente' },
  { value: 'vista', label: 'Cuenta vista' },
  { value: 'ahorro', label: 'Cuenta de ahorro' },
  { value: 'renta', label: 'Cuenta renta (Scotiabank)' }
]

export function nombreBanco(codigo: string | undefined): string {
  if (!codigo) return '—'
  return BANCOS.find((b) => b.codigo === codigo)?.nombre ?? `Banco ${codigo}`
}

export function nombreTipoCuenta(tipo: string | undefined): string {
  return TIPOS_CUENTA.find((t) => t.value === tipo)?.label ?? tipo ?? '—'
}

export function datosBancariosCompletos(supplier: Supplier | undefined): boolean {
  const d = supplier?.datosBancarios
  return Boolean(d && d.banco && d.tipoCuenta && d.numeroCuenta)
}

// Descarga un archivo de texto generado en el server (la nómina del banco).
export function descargarArchivoTexto(nombre: string, contenido: string, mimeType = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: `${mimeType};charset=windows-1252` }))
  const link = document.createElement('a')
  link.href = url
  link.download = nombre
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
