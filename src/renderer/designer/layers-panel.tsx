import { useDesignerStore } from '../store/designer-store'
import type { ElementType } from '../../../print-core/template-model'

const LABEL: Record<ElementType, string> = {
  text: '文本', param: '参数', image: '图片', shape: '图形'
}

export function LayersPanel(): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const selectedId = useDesignerStore((s) => s.selectedId)
  const select = useDesignerStore((s) => s.select)
  const updateGeometry = useDesignerStore((s) => s.updateGeometry)
  const removeElement = useDesignerStore((s) => s.removeElement)
  const commit = useDesignerStore((s) => s.commit)

  const els = [...doc.content.elements].sort((a, b) => b.zIndex - a.zIndex)
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>图层（{els.length}）</div>
      {els.map((el) => (
        <div key={el.id}
          onClick={() => select(el.id)}
          style={{
            background: el.id === selectedId ? '#2563eb' : '#374151',
            borderRadius: 4, padding: '4px 6px', marginBottom: 3, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12
          }}>
          <span style={{ flex: 1 }}>{LABEL[el.type]}</span>
          <button title="锁定/解锁" onClick={(e) => {
            e.stopPropagation()
            updateGeometry(el.id, { locked: !el.locked }); commit()
          }}>{el.locked ? '🔒' : '🔓'}</button>
          <button title="置顶" onClick={(e) => {
            e.stopPropagation()
            updateGeometry(el.id, { zIndex: Math.max(0, ...doc.content.elements.map((x) => x.zIndex)) + 1 }); commit()
          }}>↑</button>
          <button title="删除" onClick={(e) => {
            e.stopPropagation(); removeElement(el.id); commit()
          }}>×</button>
        </div>
      ))}
      {els.length === 0 && <div style={{ opacity: 0.4, fontSize: 12 }}>暂无元素</div>}
    </div>
  )
}
