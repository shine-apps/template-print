/**
 * 未保存修改导航守卫。
 * 设计器等可编辑页面通过 setNavBlocker 注册一个"是否需要拦截"的判定函数；
 * 侧边栏菜单点击与窗口关闭前都会调用 confirmLeave 询问用户。
 */

type Blocker = () => boolean

let blocker: Blocker | null = null

export function setNavBlocker(fn: Blocker | null): void {
  blocker = fn
}

/** 返回 true 表示允许离开；false 表示用户取消。无拦截器时直接放行。 */
export function confirmLeave(message = '当前模板有未保存的修改，确定离开吗？'): boolean {
  if (!blocker || !blocker()) return true
  return window.confirm(message)
}
