import { useEffect, useMemo, useRef, useState } from 'react'
import { Slider } from 'antd'
import { Stage, Layer, Rect, Image as KImage, Line, Ellipse, Group, Transformer } from 'react-konva'
import type Konva from 'konva'
import { mmToPxAt96 } from '../../../shared/units'
import { useDesignerStore } from '../store/designer-store'
import type { TemplateElement } from '../../../print-core/template-model'
import { snapPosition, type MovingRect } from './guides'
import { LaidText } from './laid-text'

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
    onTransform: () => {
      // 图片缩放时锁定原始宽高比：以宽度驱动，高度按比例推算
      if (el.type === 'image' && imageEl?.naturalWidth) {
        const node = shapeRef.current
        const box = (node as Konva.Container | null)?.findOne('Rect')
        if (node && box) {
          const ratio = imageEl.naturalWidth / imageEl.naturalHeight
          const w = box.width() * node.scaleX()
          node.scaleY(w / box.height() / ratio)
          node.getLayer()?.batchDraw()
        }
      }
    },
    onTransformEnd: () => {
      const node = shapeRef.current
      if (!node) return
      const patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>> = {
        x: node.x() / mmToPxAt96(1) / scale,
        y: node.y() / mmToPxAt96(1) / scale
      }
      // 图片与矩形需回传尺寸；直线/椭圆（Group 包装）只回传坐标
      const needSize = el.type !== 'shape' || el.props.shape === 'rect'
      if (needSize) {
        let w: number, h: number
        if (node.className === 'Group') {
          // 图片 Group：从子透明 Rect 取元素框尺寸
          const box = (node as Konva.Container).findOne('Rect')
          w = box ? box.width() * node.scaleX() : 0
          h = box ? box.height() * node.scaleY() : 0
        } else {
          w = node.width() * node.scaleX()
          h = node.height() * node.scaleY()
        }
        patch.w = Math.max(1, w / mmToPxAt96(1) / scale)
        patch.h = Math.max(1, h / mmToPxAt96(1) / scale)
      }
      patch.rotation = Math.round(node.rotation() * 10) / 10
      onChange(patch)
      node.scaleX(1); node.scaleY(1)
    }
  }

  let body: JSX.Element
  if (el.type === 'text') {
    body = (
      <LaidText el={el} scale={scale} shapeRef={shapeRef as never} commonProps={common}
        onEdit={() => {
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
    // 画布按 contain 渲染：保持图片原始比例、居中、不拉伸，与打印侧 object-fit:contain 一致
    const boxW = MM(el.w, scale)
    const boxH = MM(el.h, scale)
    let imgW = boxW, imgH = boxH, offX = 0, offY = 0
    if (imageEl && imageEl.naturalWidth > 0) {
      const imgRatio = imageEl.naturalWidth / imageEl.naturalHeight
      const boxRatio = boxW / boxH
      if (imgRatio > boxRatio) {
        imgW = boxW; imgH = boxW / imgRatio
        offY = (boxH - imgH) / 2
      } else {
        imgH = boxH; imgW = boxH * imgRatio
        offX = (boxW - imgW) / 2
      }
    }
    // Group 作为 shapeRef 接收拖动/Transformer；透明 Rect 定义元素框并接收指针事件
    // （fill=transparent 在 Konva 中仍有 hit area）；KImage 按 contain 居中显示
    body = (
      <Group ref={shapeRef as never} {...common}
        clipX={0} clipY={0} clipWidth={boxW} clipHeight={boxH}>
        <Rect width={boxW} height={boxH} fill="transparent" />
        <KImage x={offX} y={offY} width={imgW} height={imgH} image={imageEl}
          opacity={el.props.opacity} listening={false} />
      </Group>
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
  const imageEls = doc.content.elements.filter((e) => e.type === 'image')
  const imageAssetIds = imageEls.map((e) => (e as Extract<typeof e, { type: 'image' }>).props.assetId)
  useEffect(() => {
    if (imageAssetIds.length === 0) { setAssetUrls({}); return }
    void window.api.assets.listUrlsByIds(imageAssetIds).then(setAssetUrls).catch(() => setAssetUrls({}))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageAssetIds.join(',')])

  const pw = MM(doc.paper.widthMm, scale)
  const ph = MM(doc.paper.heightMm, scale)
  const sorted = [...doc.content.elements].sort((a, b) => a.zIndex - b.zIndex)

  // 背景层（纸张+网格+边框）引用，用于缓存：网格线可能上万条，
  // 缓存后拖拽/变换元素时只需 blit 位图，不再逐线重绘。
  const bgLayerRef = useRef<Konva.Layer>(null)

  const gridLines = useMemo(() => {
    if (!gridOn) return null
    const lines: JSX.Element[] = []
    for (let i = 0; i < Math.max(0, Math.floor(doc.paper.widthMm / 2) - 1); i++) {
      const gx = MM((i + 1) * 2, scale)
      lines.push(
        <Line key={`gv${i}`} listening={false}
          points={[gx, 0, gx, ph]} stroke="#d9d9d9" strokeWidth={1} />
      )
    }
    for (let i = 0; i < Math.max(0, Math.floor(doc.paper.heightMm / 2) - 1); i++) {
      const gy = MM((i + 1) * 2, scale)
      lines.push(
        <Line key={`gh${i}`} listening={false}
          points={[0, gy, pw, gy]} stroke="#d9d9d9" strokeWidth={1} />
      )
    }
    return lines
  }, [gridOn, doc.paper.widthMm, doc.paper.heightMm, scale, pw, ph])

  // 纸张/网格/边框仅在尺寸或缩放变化时重绘并缓存
  useEffect(() => {
    const layer = bgLayerRef.current
    if (layer) {
      layer.clearCache()
      layer.cache()
    }
  }, [pw, ph, scale, gridOn])

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
      gridOn ? { enabled: true, sizeMm: 2 } : { enabled: false, sizeMm: 2 }
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
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#666', whiteSpace: 'nowrap' }}>缩放</span>
        <button onClick={() => setScale((s) => Math.max(0.2, +(s - 0.01).toFixed(2)))}>－</button>
        <Slider
          style={{ width: 300, margin: 0 }}
          min={0.2} max={3} step={0.01} value={scale} onChange={setScale}
          tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }} />
        <button onClick={() => setScale((s) => Math.min(3, +(s + 0.01).toFixed(2)))}>＋</button>
        <span style={{ color: '#666', minWidth: 42 }}>{Math.round(scale * 100)}%</span>
        <label style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} /> 网格(2mm)
        </label>
      </div>
      <Stage width={Math.max(pw + 80, 400)} height={Math.max(ph + 80, 400)}
        onMouseDown={(e) => { if (e.target === e.target.getStage()) select(null) }}>
        {/* 背景层：纸张 + 边框 + 网格，缓存为位图避免大纸张网格拖拽时重绘 */}
        <Layer ref={bgLayerRef} offsetX={-40} offsetY={-40}>
          <Rect x={-1} y={-1} width={pw + 2} height={ph + 2}
            stroke="#444" strokeWidth={2} fill="transparent" listening={false} />
          <Rect x={0} y={0} width={pw} height={ph} fill="#ffffff" shadowBlur={6} shadowOpacity={0.2} />
          {gridLines}
        </Layer>
        {/* 前景层：元素 + 吸附辅助线，随交互实时重绘 */}
        <Layer offsetX={-40} offsetY={-40}>
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
