import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Text as KText, Image as KImage, Line, Ellipse, Group, Transformer } from 'react-konva'
import type Konva from 'konva'
import { mmToPxAt96 } from '../../../shared/units'
import { useDesignerStore } from '../store/designer-store'
import type { TemplateElement } from '../../../print-core/template-model'
import { snapPosition, type MovingRect } from './guides'

function useLoadedImage(url: string | undefined): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement | undefined>()
  useEffect(() => {
    if (!url) { setImg(undefined); return }
    const i = new window.Image()
    i.onload = () => setImg(i)
    i.src = url
  }, [url])
  return img
}

const MM = (v: number, scale: number): number => mmToPxAt96(v) * scale
// 直线/椭圆用 Group 包装（Group 的 x/y 即左上角），Group 无 width/height，
// 这类元素只支持拖动改坐标，尺寸由右侧属性面板修改。
function isGroupWrapped(el: TemplateElement): boolean {
  return el.type === 'shape' && el.props.shape !== 'rect'
}

function ElementShape({ el, scale, selected, onSelect, onChange, assetUrls, onDragMove, onDragEnd }: {
  el: TemplateElement
  scale: number
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>) => void
  assetUrls: Record<string, string>
  onDragMove: (el: TemplateElement, node: Konva.Node) => void
  onDragEnd: (el: TemplateElement, node: Konva.Node) => void
}): JSX.Element {
  const shapeRef = useRef<Konva.Node>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const { updateProps } = useDesignerStore()
  // hooks 必须在所有条件分支之前无条件调用
  const imageEl = useLoadedImage(el.type === 'image' ? assetUrls[el.props.assetId] : undefined)

  useEffect(() => {
    if (selected && shapeRef.current && trRef.current) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [selected])

  const common = {
    id: el.id,
    x: MM(el.x, scale),
    y: MM(el.y, scale),
    width: MM(el.w, scale),
    height: MM(el.h, scale),
    rotation: el.rotation,
    draggable: !el.locked,
    onClick: onSelect,
    onTap: onSelect,
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => onDragMove(el, e.target),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd(el, e.target),
    onTransformEnd: () => {
      const node = shapeRef.current
      if (!node) return
      const patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>> = {
        x: node.x() / mmToPxAt96(1) / scale,
        y: node.y() / mmToPxAt96(1) / scale
      }
      // Group 包装元素（直线/椭圆）只回传坐标，尺寸不回传
      if (node.className !== 'Group') {
        patch.w = Math.max(1, node.width() * node.scaleX() / mmToPxAt96(1) / scale)
        patch.h = Math.max(1, node.height() * node.scaleY() / mmToPxAt96(1) / scale)
      }
      patch.rotation = Math.round(node.rotation() * 10) / 10
      onChange(patch)
      node.scaleX(1); node.scaleY(1)
    }
  }

  let body: JSX.Element
  if (el.type === 'text') {
    body = (
      <KText ref={shapeRef as never} {...common}
        text={el.props.text || '文本'}
        fontSize={MM(el.props.fontSizeMm, scale)}
        fontStyle={`${el.props.bold ? 'bold' : ''} ${el.props.italic ? 'italic' : ''}`.trim()}
        align={el.props.align} fill={el.props.color}
        onDblClick={() => {
          const v = window.prompt('编辑文本', el.props.text)
          if (v !== null) updateProps(el.id, { text: v })
        }} />
    )
  } else if (el.type === 'shape') {
    const stk = MM(el.props.strokeWidthMm, scale)
    if (el.props.shape === 'line') {
      // Group 定位在左上角；内部 Line 相对 Group 画水平中线，不接收指针事件
      body = (
        <Group ref={shapeRef as never} {...common}>
          <Line listening={false}
            points={[0, MM(el.h, scale) / 2, MM(el.w, scale), MM(el.h, scale) / 2]}
            stroke={el.props.strokeColor} strokeWidth={stk} />
        </Group>
      )
    } else if (el.props.shape === 'ellipse') {
      body = (
        <Group ref={shapeRef as never} {...common}>
          <Ellipse listening={false}
            x={MM(el.w, scale) / 2} y={MM(el.h, scale) / 2}
            radiusX={MM(el.w, scale) / 2} radiusY={MM(el.h, scale) / 2}
            stroke={el.props.strokeColor} strokeWidth={stk} fill={el.props.fillColor ?? undefined} />
        </Group>
      )
    } else {
      body = <Rect ref={shapeRef as never} {...common}
        stroke={el.props.strokeColor} strokeWidth={stk} fill={el.props.fillColor ?? undefined} />
    }
  } else if (el.type === 'image') {
    // M1 统一 contain：KImage 直接拉伸到元素框；无 crop 计算（fit 切换放 M2）
    body = (
      <KImage ref={shapeRef as never} {...common} image={imageEl} opacity={el.props.opacity} />
    )
  } else {
    body = <Rect ref={shapeRef as never} {...common} fill="#e6f4ff" stroke="#1677ff" dash={[6, 4]} />
  }

  return (
    <>
      {body}
      {selected && (
        <Transformer ref={trRef}
          enabledAnchors={isGroupWrapped(el) ? [] : undefined}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 4 || newBox.height < 4 ? oldBox : newBox} />
      )}
    </>
  )
}

export function DesignerCanvas(): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const selectedId = useDesignerStore((s) => s.selectedId)
  const select = useDesignerStore((s) => s.select)
  const updateGeometry = useDesignerStore((s) => s.updateGeometry)
  const commit = useDesignerStore((s) => s.commit)
  const removeElement = useDesignerStore((s) => s.removeElement)
  const [scale, setScale] = useState(1)
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [gridOn, setGridOn] = useState(() => localStorage.getItem('tp-grid') === '1')
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  useEffect(() => { localStorage.setItem('tp-grid', gridOn ? '1' : '0') }, [gridOn])
  const imageCount = doc.content.elements.filter((e) => e.type === 'image').length
  useEffect(() => {
    void window.api.assets.listUrls(doc.id).then(setAssetUrls).catch(() => setAssetUrls({}))
  }, [doc.id, imageCount])

  const pw = MM(doc.paper.widthMm, scale)
  const ph = MM(doc.paper.heightMm, scale)
  const sorted = [...doc.content.elements].sort((a, b) => a.zIndex - b.zIndex)

  const gridLines: JSX.Element[] = []
  if (gridOn) {
    for (let i = 0; i < Math.max(0, Math.floor(doc.paper.widthMm / 10) - 1); i++) {
      const gx = MM((i + 1) * 10, scale)
      gridLines.push(
        <Line key={`gv${i}`} listening={false}
          points={[gx, 0, gx, ph]} stroke="#d9d9d9" strokeWidth={1} />
      )
    }
    for (let i = 0; i < Math.max(0, Math.floor(doc.paper.heightMm / 10) - 1); i++) {
      const gy = MM((i + 1) * 10, scale)
      gridLines.push(
        <Line key={`gh${i}`} listening={false}
          points={[0, gy, pw, gy]} stroke="#d9d9d9" strokeWidth={1} />
      )
    }
  }

  function handleDragMove(el: TemplateElement, node: Konva.Node): void {
    const moving: MovingRect = {
      x: node.x() / mmToPxAt96(1) / scale,
      y: node.y() / mmToPxAt96(1) / scale,
      w: el.w,
      h: el.h
    }
    const paper = { id: '__paper__', x: 0, y: 0, w: doc.paper.widthMm, h: doc.paper.heightMm }
    const other = doc.content.elements
      .filter((e) => e.id !== el.id)
      .map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h }))
    const r = snapPosition(
      moving, paper, other, 3,
      gridOn ? { enabled: true, sizeMm: 10 } : { enabled: false, sizeMm: 10 }
    )
    if (Math.abs(r.x - moving.x) > 0.001) node.x(MM(r.x, scale))
    if (Math.abs(r.y - moving.y) > 0.001) node.y(MM(r.y, scale))
    setGuides({ v: r.guidesV, h: r.guidesH })
  }

  function handleDragEnd(el: TemplateElement, node: Konva.Node): void {
    updateGeometry(el.id, {
      x: node.x() / mmToPxAt96(1) / scale,
      y: node.y() / mmToPxAt96(1) / scale
    })
    setGuides({ v: [], h: [] })
  }

  return (
    <div tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
          removeElement(selectedId); commit()
        }
      }}
      style={{ outline: 'none', height: '100%', overflow: 'auto', background: '#e9ecef', padding: 24 }}>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => setScale((s) => Math.max(0.2, s - 0.1))}>－</button>
        <span style={{ margin: '0 8px' }}>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, s + 0.1))}>＋</button>
        <label style={{ marginLeft: 12 }}>
          <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} /> 网格(10mm)
        </label>
      </div>
      <Stage width={Math.max(pw + 80, 400)} height={Math.max(ph + 80, 400)}
        onMouseDown={(e) => { if (e.target === e.target.getStage()) select(null) }}>
        <Layer offsetX={-40} offsetY={-40}>
          <Rect x={0} y={0} width={pw} height={ph} fill="#ffffff" shadowBlur={6} shadowOpacity={0.2} />
          {gridLines}
          {sorted.map((el) => (
            <ElementShape key={el.id} el={el} scale={scale} selected={el.id === selectedId}
              onSelect={() => select(el.id)}
              onChange={(patch) => updateGeometry(el.id, patch)}
              assetUrls={assetUrls}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd} />
          ))}
          {guides.v.map((gx) => (
            <Line key={`av${gx}`} listening={false}
              points={[MM(gx, scale), 0, MM(gx, scale), ph]} stroke="#ff4d4f" strokeWidth={1} />
          ))}
          {guides.h.map((gy) => (
            <Line key={`ah${gy}`} listening={false}
              points={[0, MM(gy, scale), pw, MM(gy, scale)]} stroke="#ff4d4f" strokeWidth={1} />
          ))}
        </Layer>
      </Stage>
    </div>
  )
}
