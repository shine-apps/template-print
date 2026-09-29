/**
 * 未保存修改导航守卫。
 * 设计器等可编辑页面通过 setNavBlocker 注册一个"是否需要拦截"的判定函数；
 * 侧边栏菜单点击前会调用 confirmLeave，用 antd 弹窗询问用户后再决定是否导航。
 * 注意：窗口右上角关闭走的是主进程 will-prevent-unload 原生对话框，不经此模块。
 */
import { Modal, type ModalFuncProps } from 'antd'

type Blocker = () => boolean
type ConfirmFn = (props: ModalFuncProps) => unknown

let blocker: Blocker | null = null
// antd <App> 上下文提供的 confirm（继承 ConfigProvider 主题/语言），
// 由渲染根部注册；未注册时回退到静态 Modal.confirm。
let confirmFn: ConfirmFn | null = null

export function setNavBlocker(fn: Blocker | null): void {
  blocker = fn
}

export function setNavConfirm(fn: ConfirmFn | null): void {
  confirmFn = fn
}

/**
 * 需要拦截时弹出确认框，用户确认离开后才执行 onOk；无需拦截则立即执行。
 */
export function confirmLeave(
  onOk: () => void,
  message = '当前模板有未保存的修改，确定离开吗？'
): void {
  if (!blocker || !blocker()) {
    onOk()
    return
  }
  const options = {
    title: '未保存的修改',
    content: message,
    okText: '离开',
    cancelText: '取消',
    okButtonProps: { danger: true },
    autoFocusButton: 'cancel' as const,
    onOk
  }
  if (confirmFn) confirmFn(options)
  else Modal.confirm(options)
}
