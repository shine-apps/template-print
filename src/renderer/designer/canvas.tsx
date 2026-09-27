import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Slider } from 'antd'
import { Stage, Layer, Rect, Image as KImage, Line, Ellipse, Group, Transformer } from 'react-konva'
import type Konva from 'konva'
import { mmToPxAt96 } from '../../../shared/units'
import { useDesignerStore } from '../store/designer-store'
import type { TemplateElement } from '../../../print-core/template-model'
import { snapPosition, type MovingRect } from './guides'
import { textCssProps } from '../../../print-core/text-style'

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
// 纸张原点在 Stage 中的偏移（Layer offset 与 DOM 层共用）
const ORIGIN = 40
// 直线/椭圆用 Group 包装（Group 的 x/y 即左上角），Group 无 width/height，
// 这类元素只支持拖动改坐标，尺寸由右侧属性面板修改。
function isGroupWrapped(el: TemplateElement): boolean {
  return el.type === 'shape' && el.props.shape !== 'rect'
}

type TextEl = Extract<TemplateElement, { type: 'text' }>

/** 按 zIndex 顺序把元素切成连续的「图形段/文本段」，用于 canvas 层与 DOM 文本层交错 */
type Seg = { kind: 'shapes' | 'texts'; els: TemplateElement[]; index: number }
function buildSegments(all: TemplateElement[]): Seg[] {
  const segs: Seg[] = []
  all.forEach((el, i) => {
    const kind: Seg['kind'] = el.type === 'text' ? 'texts' : 'shapes'
    const last = segs[segs.length - 1]
    if (last && last.kind === kind) last.els.push(el)
    else segs.push({ kind, els: [el], index: i })
  })
  return segs
}

/** 非文本元素（图片/形状）的 Konva 渲染与交互，与原 ElementShape 一致。
 *  只渲染节点本身；Transformer 由父层在全部节点之后统一渲染，避免锚点命中像素
 *  被同层后绘制的其他元素热区覆盖。 */
function NonTextShape({ el, scale, onSelect, onChange, assetUrls, onDragMove, onDragEnd, registerNode }: {
  el: TemplateElement
  scale: number
  onSelect: () => void
  onChange: (patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>) => void
  assetUrls: Record<string, string>
  onDragMove: (el: TemplateElement, node: Konva.Node) => void
  onDragEnd: (el: TemplateElement, node: Konva.Node) => void
  registerNode: (id: string, node: Konva.Node | null) => void
}): JSX.Element {
  const shapeRef = useRef<Konva.Node>(null)
  const imageEl = useLoadedImage(el.type === 'image' ? assetUrls[el.props.assetId] : undefined)

  useEffect(() => {
    registerNode(el.id, shapeRef.current)
    return () => registerNode(el.id, null)
  }, [el.id, registerNode])

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
  if (el.type === 'shape') {
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

  return body
}

/**
 * DOM 文本元素：样式与打印端 textCssProps 完全同源（同 Chromium CSS 排版），
 * 保证设计器=预览=打印一致。pointer-events:none，交互全部由 hit Layer 的透明 Rect 承担。
 */
function TextDom({ el, scale, registerRef }: {
  el: TextEl
  scale: number
  registerRef: (id: string, node: HTMLDivElement | null) => void
}): JSX.Element {
  const { outer, inner } = textCssProps(el.props)
  const boxStyle: CSSProperties = {
    position: 'absolute',
    boxSizing: 'border-box',
    left: ORIGIN + MM(el.x, scale),
    top: ORIGIN + MM(el.y, scale),
    width: MM(el.w, scale),
    height: MM(el.h, scale),
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: '50% 50%',
    pointerEvents: 'none'
  }
  return (
    <div ref={(d) => registerRef(el.id, d)} style={boxStyle}>
      <div style={outer as CSSProperties}>
        {inner
          ? <div style={inner as CSSProperties}>{el.props.text}</div>
          : el.props.text}
      </div>
    </div>
  )
}

/** 文本元素的透明热区 Rect：选中/拖拽/缩放/旋转/双击编辑。
 *  Transformer 由 hit 层在所有热区 Rect 之后统一渲染（见 DesignerCanvas），
 *  否则高 zIndex 文本的热区命中像素会盖住低 zIndex 选中文本的变换锚点。 */
function TextHit({ el, scale, onSelect, onEdit, onChange, onSyncDom, registerNode }: {
  el: TextEl
  scale: number
  onSelect: () => void
  onEdit: () => void
  onChange: (patch: Partial<Pick<TemplateElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>>) => void
  onSyncDom: (el: TemplateElement, node: Konva.Node) => void
  registerNode: (id: string, node: Konva.Rect | null) => void
}): JSX.Element {
  const rectRef = useRef<Konva.Rect>(null)
  useEffect(() => {
    registerNode(el.id, rectRef.current)
    return () => registerNode(el.id, null)
  }, [el.id, registerNode])
  return (
    <Rect
      ref={rectRef}
      id={el.id}
      x={MM(el.x, scale)}
      y={MM(el.y, scale)}
      width={MM(el.w, scale)}
      height={MM(el.h, scale)}
      rotation={el.rotation}
      draggable={!el.locked}
      fill="transparent"
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onEdit}
      onDragMove={(e) => onSyncDom(el, e.target)}
      onTransform={(e) => onSyncDom(el, e.target)}
      onTransformEnd={(e) => {
        const node = e.target
        onChange({
          x: node.x() / mmToPxAt96(1) / scale,
          y: node.y() / mmToPxAt96(1) / scale,
          w: Math.max(1, node.width() * node.scaleX() / mmToPxAt96(1) / scale),
          h: Math.max(1, node.height() * node.scaleY() / mmToPxAt96(1) / scale),
          rotation: Math.round(node.rotation() * 10) / 10
        })
        node.scaleX(1); node.scaleY(1)
      }}
    />
  )
}

/** 统一在层内所有节点之后渲染的 Transformer：保证锚点命中像素不被同层其他元素覆盖 */
function NodeTransformer({ node, keepRatio, enabledAnchors }: {
  node: Konva.Node
  keepRatio?: boolean
  enabledAnchors?: string[]
}): JSX.Element {
  const trRef = useRef<Konva.Transformer>(null)
  useEffect(() => {
    if (trRef.current) {
      trRef.current.nodes([node])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [node])
  return (
    <Transformer ref={trRef}
      keepRatio={keepRatio}
      enabledAnchors={enabledAnchors}
      boundBoxFunc={(oldBox, newBox) =>
        newBox.width < 4 || newBox.height < 4 ? oldBox : newBox} />
  )
}

export function DesignerCanvas(): JSX.Element {
  const doc = useDesignerStore((s) => s.doc)
  const selectedId = useDesignerStore((s) => s.selectedId)
  const select = useDesignerStore((s) => s.select)
  const updateGeometry = useDesignerStore((s) => s.updateGeometry)
  const commit = useDesignerStore((s) => s.commit)
  const removeElement = useDesignerStore((s) => s.removeElement)
  const requestTextEdit = useDesignerStore((s) => s.requestTextEdit)
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
  const sorted = useMemo(
    () => [...doc.content.elements].sort((a, b) => a.zIndex - b.zIndex),
    [doc.content.elements]
  )
  const segs = useMemo(() => buildSegments(sorted), [sorted])
  const textEls = sorted.filter((e): e is TextEl => e.type === 'text')

  // 背景层（纸张+网格+边框）引用，用于缓存：网格线可能上万条，
  // 缓存后拖拽/变换元素时只需 blit 位图，不再逐线重绘。
  const bgLayerRef = useRef<Konva.Layer>(null)
  // Portal 目标：Konva Stage 的 content div（canvas 的同级容器，文本 div 注入其中参与 z-index 排序）
  const stageRef = useRef<Konva.Stage>(null)
  // 画布外层容器（tabIndex=0）：点击画布时聚焦它以承接 Delete/Backspace
  const outerRef = useRef<HTMLDivElement>(null)
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  // 文本 DOM 节点引用：拖拽/变换时命令式同步位置，避免每帧 React 重渲染
  const textDomRefs = useRef(new Map<string, HTMLDivElement>())
  const registerTextRef = (id: string, node: HTMLDivElement | null): void => {
    if (node) textDomRefs.current.set(id, node)
    else textDomRefs.current.delete(id)
  }
  // Konva 节点注册表：Transformer 在各层所有节点之后单独渲染时按 id 取挂载目标
  const shapeNodeRefs = useRef(new Map<string, Konva.Node>())
  const registerShapeNode = useCallback((id: string, node: Konva.Node | null): void => {
    if (node) shapeNodeRefs.current.set(id, node)
    else shapeNodeRefs.current.delete(id)
  }, [])
  const hitNodeRefs = useRef(new Map<string, Konva.Rect>())
  const registerHitNode = useCallback((id: string, node: Konva.Rect | null): void => {
    if (node) hitNodeRefs.current.set(id, node)
    else hitNodeRefs.current.delete(id)
  }, [])
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

  // Konva v9 从不同步 Layer 的 canvas style.zIndex（Node.setZIndex 只重排内部数组，
  // 且越界值直接忽略），层叠完全由 canvas 在 content 中的 DOM 顺序决定；而 portal 文本
  // div 的插入时机（mutation）早于 canvas 挂载（layout effect），无法依赖节点顺序与
  // canvas 交错。这里直接写 canvas DOM 的 z-index，与文本段 div（seg.index*2+3）严格交错。
  const setLayerDomZ = (l: Konva.Layer | null, z: number): void => {
    const cv = l?.canvas?._canvas
    if (cv) cv.style.zIndex = String(z)
  }

  // Stage mount 后取 content 节点用于 portal
  useEffect(() => {
    setContentEl((stageRef.current?.content as HTMLDivElement | undefined) ?? null)
  }, [])

  /** 拖拽/变换中把 Konva 节点的实时几何同步给文本 DOM（仅视觉跟随，onEnd 才落 store） */
  function syncTextDom(el: TemplateElement, node: Konva.Node): void {
    const div = textDomRefs.current.get(el.id)
    if (!div) return
    div.style.left = `${ORIGIN + node.x()}px`
    div.style.top = `${ORIGIN + node.y()}px`
    div.style.width = `${node.width() * node.scaleX()}px`
    div.style.height = `${node.height() * node.scaleY()}px`
    div.style.transform = `rotate(${node.rotation()}deg)`
  }

  function handleDragMove(el: TemplateElement, node: Konva.Node): void {
    syncTextDom(el, node)
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
    // snap 可能修正了坐标，再同步一次
    syncTextDom(el, node)
    setGuides({ v: r.guidesV, h: r.guidesH })
  }

  function handleDragEnd(el: TemplateElement, node: Konva.Node): void {
    updateGeometry(el.id, {
      x: node.x() / mmToPxAt96(1) / scale,
      y: node.y() / mmToPxAt96(1) / scale
    })
    setGuides({ v: [], h: [] })
  }

  // 双击文本：选中元素并让右侧属性面板的文本输入框聚焦（光标到末尾），不弹任何窗口
  function editText(el: TextEl): void {
    requestTextEdit(el.id)
  }

  return (
    <div ref={outerRef} tabIndex={0}
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
      <Stage ref={stageRef} width={Math.max(pw + 80, 400)} height={Math.max(ph + 80, 400)}
        onMouseDown={(e) => {
          // 点击画布即把焦点收到画布容器，保证 Delete/Backspace 快捷键生效
          // （双击文本时随后属性面板 textarea 会再取走焦点）
          outerRef.current?.focus({ preventScroll: true })
          if (e.target === e.target.getStage()) select(null)
        }}>
        {/* 背景层：纸张 + 边框 + 网格，缓存为位图避免大纸张网格拖拽时重绘（z-index 最底） */}
        <Layer ref={(l) => setLayerDomZ(l, 0)} offsetX={-ORIGIN} offsetY={-ORIGIN}>
          <Rect x={-1} y={-1} width={pw + 2} height={ph + 2}
            stroke="#444" strokeWidth={2} fill="transparent" listening={false} />
          {/* 白纸不参与命中：点击纸张空白处应落到 Stage 以取消选中 */}
          <Rect x={0} y={0} width={pw} height={ph} fill="#ffffff" shadowBlur={6} shadowOpacity={0.2} listening={false} />
          {gridLines}
        </Layer>
        {/* 图形段：连续的非文本元素归一段 Layer；z-index 与文本 DOM 层交错（段 index*2+2）。
            节点先全部绘制，Transformer 最后绘制——锚点命中像素不被同层其他元素覆盖 */}
        {segs.filter((s) => s.kind === 'shapes').map((seg) => (
          <Layer key={`shapes-${seg.index}`} offsetX={-ORIGIN} offsetY={-ORIGIN}
            ref={(l) => setLayerDomZ(l, seg.index * 2 + 2)}>
            {seg.els.map((el) => (
              <NonTextShape key={el.id} el={el} scale={scale}
                onSelect={() => select(el.id)}
                onChange={(patch) => updateGeometry(el.id, patch)}
                assetUrls={assetUrls}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                registerNode={registerShapeNode} />
            ))}
            {seg.els.filter((el) => el.id === selectedId).map((el) => (
              <NodeTransformer key={`tr-${el.id}`} node={shapeNodeRefs.current.get(el.id) as Konva.Node}
                enabledAnchors={isGroupWrapped(el) ? [] : undefined} />
            ))}
          </Layer>
        ))}
        {/* 文本热区层：透明 Rect 承担交互，空白处自动穿透到下层图形 canvas。
            热区先全部绘制，选中元素的 Transformer 最后绘制 */}
        <Layer ref={(l) => setLayerDomZ(l, 9999)} offsetX={-ORIGIN} offsetY={-ORIGIN}>
          {textEls.map((el) => (
            <TextHit key={el.id} el={el} scale={scale}
              onSelect={() => select(el.id)}
              onEdit={() => editText(el)}
              onChange={(patch) => updateGeometry(el.id, patch)}
              onSyncDom={syncTextDom}
              registerNode={registerHitNode} />
          ))}
          {textEls.filter((el) => el.id === selectedId).map((el) => (
            // 文本框宽高独立可调（文本随框回流），关闭 Konva v9 默认开启的等比缩放
            <NodeTransformer key={`tr-${el.id}`} node={hitNodeRefs.current.get(el.id) as Konva.Node} keepRatio={false} />
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
      {/* DOM 文本层：portal 注入 Stage content，与各 canvas 同级，z-index 段 index*2+3 */}
      {contentEl && createPortal(
        segs.filter((s) => s.kind === 'texts').map((seg) => (
          <div key={`texts-${seg.index}`}
            style={{ position: 'absolute', inset: 0, zIndex: seg.index * 2 + 3, overflow: 'hidden', pointerEvents: 'none' }}>
            {(seg.els as TextEl[]).map((el) => (
              <TextDom key={el.id} el={el} scale={scale} registerRef={registerTextRef} />
            ))}
          </div>
        )),
        contentEl
      )}
    </div>
  )
}
