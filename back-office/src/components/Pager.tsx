import { Button } from './ui'

export const PAGE_SIZE = 50

/** Pagination : « 51–100 sur 312 ». */
export function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (offset: number) => void }) {
  if (total <= PAGE_SIZE) return null
  return (
    <div className="pager">
      <span className="muted">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} sur {total.toLocaleString('fr-FR')}</span>
      <Button small disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>Précédent</Button>
      <Button small disabled={offset + PAGE_SIZE >= total} onClick={() => onChange(offset + PAGE_SIZE)}>Suivant</Button>
    </div>
  )
}
