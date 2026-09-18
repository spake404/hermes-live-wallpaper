// Aria 背景视频与媒体插件 (bg-video) v1.5 — 统一媒体路径控制台版
// 将媒体文件夹与媒体文件选择完全合并：统一入口、智能解析、网格预览、一键切换
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect } from 'react'
import {
  host,
  Button,
  Input,
  Switch,
  Tip,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA
} from '@hermes/plugin-sdk'

const ID = 'bg-video'

let DEFAULT_PATH = ''
// 当前已真正写入媒体元素的源；未变化则永不重设 src
// （Chromium 对同值 src 赋值也会触发重新加载 → 拖动滑块时画面闪黑）
let lastAppliedSrc = ''

async function resolveDefaultPath() {
  if (DEFAULT_PATH) return DEFAULT_PATH
  try {
    const root = await window.hermesDesktop?.desktopPluginsRoot?.()
    if (root) {
      DEFAULT_PATH = root.replace(/[\\/]+$/, '') + '\\bg-video\\bg-default.mp4'
      return DEFAULT_PATH
    }
  } catch (e) {
    /* ignore */
  }
  return ''
}

let cfg = {
  enabled: true,
  mediaSource: '', // 统一路径：可以是文件夹路径，也可以是具体媒体文件路径
  videoPath: '', // 最终解析生效的单文件播放路径（空 = 自带 bg-default.mp4）
  opacity: 0.2, // 可见度
  videoPosition: 50, // 水平位置 0% ~ 100%
  sidebarAlpha: 0.6, // 侧栏透明度
  sidebarColor: '#0D2667', // 侧栏颜色
  showBadge: false // 调试徽标
}

function loadCfg(ctx) {
  if (!cfg.videoPath) {
    resolveDefaultPath().then(p => {
      if (p && !cfg.videoPath) {
        cfg.videoPath = p
        cfg.mediaSource = p
        saveCfg(ctx)
      }
    })
  }
  try {
    const s = ctx.storage
    const storedPath = s.get('videoPath', '')
    const storedSource = s.get('mediaSource', storedPath)
    cfg = {
      enabled: s.get('enabled', true),
      mediaSource: storedSource || storedPath || '',
      videoPath: storedPath || '',
      opacity: s.get('opacity', 0.2),
      videoPosition: s.get('videoPosition', 50),
      sidebarAlpha: s.get('sidebarAlpha', 0.6),
      sidebarColor: s.get('sidebarColor', '#0D2667'),
      showBadge: s.get('showBadge', false)
    }
  } catch (e) {
    /* ignore */
  }
}

function saveCfg(ctx) {
  try {
    ctx.storage.set('enabled', cfg.enabled)
    ctx.storage.set('mediaSource', cfg.mediaSource)
    ctx.storage.set('videoPath', cfg.videoPath)
    ctx.storage.set('opacity', cfg.opacity)
    ctx.storage.set('videoPosition', cfg.videoPosition)
    ctx.storage.set('sidebarAlpha', cfg.sidebarAlpha)
    ctx.storage.set('sidebarColor', cfg.sidebarColor)
    ctx.storage.set('showBadge', cfg.showBadge)
  } catch (e) {
    /* ignore */
  }
}

function hexToRgba(hex, a) {
  let h = String(hex).replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function toFileURL(p) {
  if (!p) return ''
  return 'file:///' + String(p).replace(/^[/\\]+/, '').split(/[\\/]+/).map(s => encodeURIComponent(s)).join('/')
}

function isImageFile(p) {
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(p || '')
}

function isVideoFile(p) {
  return /\.(mp4|webm|mkv|mov|avi)$/i.test(p || '')
}

function isMediaFile(p) {
  return isImageFile(p) || isVideoFile(p)
}

function getDirName(filePath) {
  if (!filePath) return ''
  const normalized = filePath.replace(/[/\\]+$/, '')
  const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (lastSlash < 0) return ''
  return normalized.slice(0, lastSlash)
}

function getBaseName(filePath) {
  if (!filePath) return ''
  const normalized = filePath.replace(/[/\\]+$/, '')
  const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (lastSlash < 0) return normalized
  return normalized.slice(lastSlash + 1)
}

function bgAlpha(colorStr) {
  if (!colorStr || colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') return 0
  const m = colorStr.match(/\/\s*([0-9.]+)\)\s*$/)
  if (m) return parseFloat(m[1])
  if (colorStr.startsWith('rgba(') || colorStr.startsWith('hsla(')) {
    return parseFloat(colorStr.split(',').pop().replace(/[^\d.]/g, ''))
  }
  return 1
}

function hasBg(el) {
  const cs = getComputedStyle(el)
  const c = cs.backgroundColor || ''
  const i = cs.backgroundImage || ''
  return bgAlpha(c) >= 0.5 || (i && i !== 'none')
}

// ── 伪元素压制：类名方案，幂等且样式表大小恒定 ──────────────────────
// 旧实现每次调用生成随机 rid 并 textContent += 追加规则：随机 id 让旧规则永不
// 再匹配（纯死规则），且 += 会整体重新解析整张样式表 → 规则数随时间无上限增长。
// 现在改成固定类名 + 只写一次的静态规则，类切换天然幂等。
const TRANSPARENT_CLASS = 'aria-bg-nobg'
const PSEUDO_RULE = `.${TRANSPARENT_CLASS}::before,.${TRANSPARENT_CLASS}::after{background:transparent!important;}`

function ensurePseudoRule() {
  let st = document.getElementById('aria-pseudo-style')
  if (!st) {
    st = document.createElement('style')
    st.id = 'aria-pseudo-style'
    document.head.appendChild(st)
  }
  // 快速路径：规则数已正确就直接返回（O(1)，不必每轮比较整串文本）
  const n = st.sheet && st.sheet.cssRules ? st.sheet.cssRules.length : -1
  if (n === 1 && st.textContent === PSEUDO_RULE) return
  // 整体覆盖（非追加）：老版本累积的死规则会被一次性清空
  if (st.textContent !== PSEUDO_RULE) st.textContent = PSEUDO_RULE
}

function nukePseudo(el) {
  if (!el || el.classList.contains(TRANSPARENT_CLASS)) return
  ensurePseudoRule()
  el.classList.add(TRANSPARENT_CLASS)
}

// 已净化 / 已分类缓存：避免每轮重复 getComputedStyle + getBoundingClientRect
let cleanedNodes = new WeakSet()
let classifiedNodes = new WeakSet()
// 已识别的侧栏容器（需要每轮为新增后代补净化）
let sidebarRoots = []

function deepCleanSidebar(el) {
  // 阶段一：只读，收集需要净化的节点
  const targets = []
  for (const k of el.querySelectorAll('*')) {
    if (k.id === 'aria-bg-media' || k.id === 'aria-bg-badge' || k.id === 'aria-bg-style') continue
    if (cleanedNodes.has(k)) continue
    cleanedNodes.add(k)
    const cs = getComputedStyle(k)
    const c = cs.backgroundColor || ''
    const i = cs.backgroundImage || ''
    if (bgAlpha(c) >= 0.3 || (i && i !== 'none')) targets.push(k)
  }
  // 阶段二：只写
  for (const k of targets) {
    k.style.setProperty('background', 'transparent', 'important')
    nukePseudo(k)
  }
}

// force=true 时清空缓存做全量重扫（引导 / 配置变更 / DOM 变更 / 尺寸变更 / 兜底）。
// force=false 时复用缓存，空闲状态几乎零成本。
function processBackgrounds(force = false) {
  if (!cfg.enabled) return { cleared: 0, tinted: 0 }
  if (force) {
    classifiedNodes = new WeakSet()
    cleanedNodes = new WeakSet()
    sidebarRoots = []
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const sbg = hexToRgba(cfg.sidebarColor, cfg.sidebarAlpha)
  // 每轮顺手自愈规则表：如果被历史遗留的旧循环（热重载孤儿）追加过规则，
  // 这里会立刻恢复到 1 条。规则数正确时是 O(1) 返回。
  ensurePseudoRule()

  // ── 阶段一：只读，不写任何样式（避免 Layout Thrashing）──────────
  const plan = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.id === 'aria-bg-media' || el.id === 'aria-bg-badge' || el.id === 'aria-bg-style') continue
    if (classifiedNodes.has(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 60 || r.height < 60) continue
    const wRatio = r.width / vw
    const hRatio = r.height / vh
    const isMain = wRatio >= 0.5 && hRatio >= 0.4
    const isSide = wRatio >= 0.08 && wRatio <= 0.48 && hRatio >= 0.55
    if (!isMain && !isSide) continue
    if (!hasBg(el)) continue
    plan.push({ el, isMain, isSide })
  }

  // ── 阶段二：只写 ────────────────────────────────────────────────
  let cleared = 0
  let tinted = 0
  for (const { el, isMain, isSide } of plan) {
    if (isMain) {
      el.style.setProperty('background', 'transparent', 'important')
      nukePseudo(el)
      cleared++
      classifiedNodes.add(el)
    } else if (isSide) {
      el.style.setProperty('background', sbg, 'important')
      nukePseudo(el)
      tinted++
      classifiedNodes.add(el)
      if (!sidebarRoots.includes(el)) sidebarRoots.push(el)
    }
  }
  // 侧栏后代要在每次增量轮次都补齐（新会话行/新按钮会带自己的底色），
  // 但靠 cleanedNodes 保证同一个节点只算一次 getComputedStyle。
  for (const root of sidebarRoots) {
    if (!root.isConnected) continue
    deepCleanSidebar(root)
  }
  return { cleared, tinted }
}

function ensureStyle() {
  if (document.getElementById('aria-bg-style')) return
  const s = document.createElement('style')
  s.id = 'aria-bg-style'
  s.textContent = `
    html, body { background: transparent !important; }
    #root, #root > div, [data-app], [data-tauri] { background: transparent !important; }
  `
  document.head.appendChild(s)
}

function upsertMedia() {
  if (!cfg.enabled) {
    const old = document.getElementById('aria-bg-media')
    if (old) old.remove()
    return null
  }
  const isImg = isImageFile(cfg.videoPath)
  const wantTag = isImg ? 'IMG' : 'VIDEO'
  let el = document.getElementById('aria-bg-media')
  if (el && el.tagName !== wantTag) {
    el.remove()
    el = null
  }
  if (!el) {
    el = document.createElement(wantTag)
    el.id = 'aria-bg-media'
    if (wantTag === 'VIDEO') {
      el.autoplay = true
      el.loop = true
      el.muted = true
      el.playsInline = true
      el.preload = 'auto'
    }
    Object.assign(el.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100%',
      objectFit: 'cover',
      objectPosition: cfg.videoPosition + '% 50%',
      opacity: String(cfg.opacity),
      pointerEvents: 'none',
      zIndex: '-1',
      border: '0',
      margin: '0'
    })
    document.body.appendChild(el)
    lastAppliedSrc = '' // 新元素没有任何源，强制下面重新赋值
    if (wantTag === 'VIDEO') {
      const pr = el.play()
      if (pr && pr.catch) pr.catch(() => {})
    }
  }
  // 只有源真的变化时才写 src + 起播
  const nextSrc = toFileURL(cfg.videoPath)
  if (nextSrc !== lastAppliedSrc) {
    lastAppliedSrc = nextSrc
    el.src = nextSrc
    if (wantTag === 'VIDEO') {
      const pr = el.play()
      if (pr && pr.catch) pr.catch(() => {})
    }
  }
  el.style.left = '0'
  el.style.width = '100vw'
  el.style.objectPosition = cfg.videoPosition + '% 50%'
  el.style.opacity = String(cfg.opacity)

  let dbg = document.getElementById('aria-bg-badge')
  if (!cfg.showBadge) {
    if (dbg) dbg.remove()
    return el
  }
  if (!dbg) {
    dbg = document.createElement('div')
    dbg.id = 'aria-bg-badge'
    Object.assign(dbg.style, {
      position: 'fixed',
      top: '52px',
      right: '24px',
      zIndex: '2147483647',
      background: 'rgba(0,0,0,0.85)',
      color: '#ff7eb6',
      padding: '6px 10px',
      borderRadius: '8px',
      fontSize: '11px',
      fontFamily: 'monospace',
      pointerEvents: 'none',
      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      maxWidth: '440px',
      whiteSpace: 'pre-wrap',
      lineHeight: '1.5'
    })
    document.body.appendChild(dbg)
  }
  dbg.textContent =
    `🎬 cfg: pos=${cfg.videoPosition}% op=${cfg.opacity}\n` +
    `applied: objectPosition=${el.style.objectPosition}`
  return el
}

function injectLoop() {
  if (typeof document === 'undefined' || !document.body) return
  ensureStyle()
  upsertMedia()
  processBackgrounds(true)
}

// ── 设置页组件 ────────────────────────────────────────────────────
function SettingsPage({ ctx }) {
  const [form, setForm] = useState({ ...cfg })
  const [saved, setSaved] = useState(false)
  const [folderFiles, setFolderFiles] = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [folderError, setFolderError] = useState('')
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'image' | 'video'
  const [visibleCount, setVisibleCount] = useState(60) // 网格首屏限量，避免一次挂载数百个节点

  useEffect(() => {
    const t = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(t)
  }, [saved])

  // 递归/多层级扫描文件夹中的媒体文件（最多向下递归 4 层，避免无意义死循环）
  const scanDirectoryRecursive = async (rootDir) => {
    const collected = []
    const queue = [{ dir: rootDir, depth: 0 }]
    const visited = new Set()

    while (queue.length > 0 && collected.length < 500) {
      const { dir, depth } = queue.shift()
      const normalized = dir.replace(/[/\\]+$/, '')
      if (visited.has(normalized.toLowerCase())) continue
      visited.add(normalized.toLowerCase())

      try {
        const res = await window.hermesDesktop.readDir(dir)
        if (res && res.entries) {
          for (const item of res.entries) {
            if (item.isDirectory) {
              if (depth < 4 && !item.name.startsWith('.')) {
                queue.push({ dir: item.path, depth: depth + 1 })
              }
            } else if (isMediaFile(item.name)) {
              collected.push({
                name: item.name,
                path: item.path,
                subDir: depth > 0 ? getBaseName(dir) : '',
                isVideo: isVideoFile(item.name),
                isImage: isImageFile(item.name)
              })
            }
          }
        }
      } catch (e) {
        // 单个子目录错误跳过
      }
    }
    return collected
  }

  // 扫描指定文件夹中的媒体文件
  const scanDirectory = async (dirPath, targetSelectFile = '') => {
    const dir = (dirPath || '').trim()
    if (!dir) {
      setFolderFiles([])
      setFolderError('')
      return
    }
    setLoadingFiles(true)
    setFolderError('')
    try {
      if (window.hermesDesktop?.readDir) {
        const media = await scanDirectoryRecursive(dir)
        setFolderFiles(media)
        setVisibleCount(60) // 新目录重新分页
        if (media.length === 0) {
          // 尝试单层读一次看看有没有错误提示
          const checkRes = await window.hermesDesktop.readDir(dir)
          if (checkRes && checkRes.error) {
            setFolderError(`无法读取目录: ${checkRes.error}`)
          }
        }
        if (targetSelectFile) {
          applyFile(targetSelectFile)
        } else if (media.length > 0 && !form.videoPath) {
          applyFile(media[0].path)
        }
      } else {
        setFolderError('当前环境未检测到文件系统访问接口')
      }
    } catch (err) {
      setFolderError(err.message || '读取文件夹失败')
      setFolderFiles([])
    } finally {
      setLoadingFiles(false)
    }
  }

  // 智能解析用户输入/传入的路径（无论是文件还是文件夹）
  const resolveAndApplySource = (rawPath) => {
    const p = (rawPath || '').trim()
    setForm(f => ({ ...f, mediaSource: p }))
    if (!p) {
      setFolderFiles([])
      setFolderError('')
      return
    }

    if (isMediaFile(p)) {
      // 传入的是具体文件
      const parentDir = getDirName(p)
      applyFile(p)
      if (parentDir) {
        scanDirectory(parentDir)
      }
    } else {
      // 传入的是目录
      scanDirectory(p)
    }
  }

  // 直接切换具体媒体文件
  const applyFile = (filePath) => {
    setForm(f => ({ ...f, videoPath: filePath }))
    cfg.videoPath = filePath
    upsertMedia()
  }

  // 初始加载当前目录文件列表
  useEffect(() => {
    const current = form.mediaSource || form.videoPath
    if (current) {
      if (isMediaFile(current)) {
        const pDir = getDirName(current)
        if (pDir) scanDirectory(pDir)
      } else {
        scanDirectory(current)
      }
    }
  }, [])

  // 侧栏色调变更去抖：拖动滑块时每个事件都全量重排会让设置页手感发滞
  let sidebarDebounce = null
  const applySidebarSoon = () => {
    if (sidebarDebounce) clearTimeout(sidebarDebounce)
    sidebarDebounce = setTimeout(() => {
      sidebarDebounce = null
      processBackgrounds(true)
    }, 120)
  }

  const set = (k, val) => {
    setForm(f => ({ ...f, [k]: val }))
    if (k === 'opacity' || k === 'videoPosition') {
      // 纯视觉参数：只改样式，绝不走 upsertMedia（否则会重设 src 重载视频）
      cfg[k] = val
      const m = document.getElementById('aria-bg-media')
      if (m) {
        if (k === 'opacity') m.style.opacity = String(val)
        else m.style.objectPosition = val + '% 50%'
      }
      return
    }
    if (k === 'enabled' || k === 'videoPath' || k === 'showBadge') {
      cfg[k] = val
      upsertMedia()
      return
    }
    if (k === 'sidebarAlpha' || k === 'sidebarColor') {
      cfg[k] = val
      applySidebarSoon()
    }
  }

  // 选取文件夹
  const onPickFolder = async () => {
    try {
      let picked = ''
      if (ctx?.os?.pickOpenPath) {
        picked = await ctx.os.pickOpenPath({ directories: true, title: '选择背景媒体文件夹' })
      } else if (window.hermesDesktop?.selectPaths) {
        const paths = await window.hermesDesktop.selectPaths({
          directories: true,
          multiple: false,
          title: '选择背景媒体文件夹'
        })
        picked = paths?.[0] || ''
      }
      if (picked) {
        resolveAndApplySource(picked)
      }
    } catch (e) {
      host.notify({ kind: 'error', message: '选择文件夹失败: ' + e.message })
    }
  }

  // 选取单文件
  const onPickFile = async () => {
    try {
      let picked = ''
      const filters = [{ name: '媒体文件', extensions: ['mp4', 'webm', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      if (ctx?.os?.pickOpenPath) {
        picked = await ctx.os.pickOpenPath({
          directories: false,
          title: '选择背景图片或视频',
          filters
        })
      } else if (window.hermesDesktop?.selectPaths) {
        const paths = await window.hermesDesktop.selectPaths({
          directories: false,
          multiple: false,
          title: '选择背景图片或视频',
          filters
        })
        picked = paths?.[0] || ''
      }
      if (picked) {
        resolveAndApplySource(picked)
      }
    } catch (e) {
      host.notify({ kind: 'error', message: '选择文件失败: ' + e.message })
    }
  }

  // 恢复内置默认壁纸
  const onResetDefault = async () => {
    const def = await resolveDefaultPath()
    if (def) {
      resolveAndApplySource(def)
      host.notify({ kind: 'info', message: '已恢复默认背景视频' })
    }
  }

  const onSave = () => {
    Object.assign(cfg, form)
    saveCfg(ctx)
    injectLoop()
    setSaved(true)
    host.notify({ kind: 'success', message: '🎬 背景媒体设置已保存并生效' })
  }

  const row = (label, children) =>
    jsxs('div', {
      className: 'flex items-center justify-between gap-4 py-3',
      children: [
        jsx('div', { className: 'text-sm font-medium', children: label }),
        children
      ]
    })

  const currentFileName = getBaseName(form.videoPath)
  // 分类过滤结果在组件体内算一次，网格与"加载更多"按钮共用
  const filteredFiles = folderFiles.filter(f => {
    if (activeTab === 'image') return f.isImage
    if (activeTab === 'video') return f.isVideo
    return true
  })

  return jsxs('div', {
    className: 'mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto p-8',
    children: [
      jsx('div', {
        className: 'text-xl font-semibold',
        children: '🎬 背景媒体设置'
      }),
      jsx('p', {
        className: 'text-(--ui-text-secondary) text-sm',
        children:
          '统一媒体管理：支持直接填入文件夹或单文件路径，自动扫描目录并提供可视化网格实时预览与切换。'
      }),

      // 总开关
      row(
        '启用背景效果',
        jsx(Switch, {
          checked: form.enabled,
          onCheckedChange: v => set('enabled', v)
        })
      ),

      // 统一媒体路径控制台（合并后的区域）
      jsxs('div', {
        className: 'flex flex-col gap-3 rounded-xl border border-(--ui-border) p-5 bg-(--card)/40 shadow-sm',
        children: [
          // 标题与操作栏
          jsxs('div', {
            className: 'flex flex-wrap items-center justify-between gap-3',
            children: [
              jsxs('div', {
                children: [
                  jsx('div', { className: 'text-sm font-semibold flex items-center gap-2', children: [
                    '背景媒体来源',
                    currentFileName ? jsx('span', {
                      className: 'text-xs font-normal text-(--ui-accent) bg-(--ui-accent)/10 px-2 py-0.5 rounded border border-(--ui-accent)/20 truncate max-w-xs',
                      children: `当前：${currentFileName}`
                    }) : null
                  ] }),
                  jsx('div', {
                    className: 'text-(--ui-text-tertiary) text-xs mt-0.5',
                    children: '填入文件夹或具体文件均可自动识别；亦可点击右侧按钮直接选择'
                  })
                ]
              }),
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(Button, {
                    onClick: onPickFolder,
                    children: '选文件夹…'
                  }),
                  jsx(Button, {
                    onClick: onPickFile,
                    children: '选文件…'
                  }),
                  jsx(Button, {
                    onClick: onResetDefault,
                    variant: 'ghost',
                    className: 'text-xs text-(--ui-text-secondary)',
                    children: '恢复默认'
                  })
                ]
              })
            ]
          }),

          // 统一单行输入框 + 刷新
          jsxs('div', {
            className: 'flex items-center gap-2 mt-1',
            children: [
              jsx(Input, {
                value: form.mediaSource,
                onChange: e => resolveAndApplySource(e.target.value),
                placeholder: '输入文件夹路径（如 D:\\Wallpapers）或文件路径（如 D:\\Wallpapers\\bg.mp4）',
                spellCheck: false,
                className: 'flex-1 font-mono text-xs'
              }),
              jsx(Button, {
                onClick: () => resolveAndApplySource(form.mediaSource),
                children: '重新扫描'
              })
            ]
          }),
          folderError ? jsx('div', { className: 'text-xs text-red-400', children: folderError }) : null,

          // 媒体网格与预览区
          jsxs('div', {
            className: 'mt-2 flex flex-col gap-2',
            children: [
              // 状态与分类 Tab 栏
              jsxs('div', {
                className: 'flex flex-wrap items-center justify-between gap-2 text-xs',
                children: [
                  jsxs('div', {
                    className: 'flex items-center gap-1.5',
                    children: [
                      jsx('button', {
                        type: 'button',
                        onClick: () => {
                          setActiveTab('all')
                          setVisibleCount(60)
                        },
                        className: `px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                          activeTab === 'all'
                            ? 'bg-(--ui-accent) text-white font-medium shadow-xs'
                            : 'bg-white/5 hover:bg-white/10 text-(--ui-text-secondary)'
                        }`,
                        children: `全部 (${folderFiles.length})`
                      }),
                      jsx('button', {
                        type: 'button',
                        onClick: () => {
                          setActiveTab('image')
                          setVisibleCount(60)
                        },
                        className: `px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                          activeTab === 'image'
                            ? 'bg-(--ui-accent) text-white font-medium shadow-xs'
                            : 'bg-white/5 hover:bg-white/10 text-(--ui-text-secondary)'
                        }`,
                        children: `图片 (${folderFiles.filter(f => f.isImage).length})`
                      }),
                      jsx('button', {
                        type: 'button',
                        onClick: () => {
                          setActiveTab('video')
                          setVisibleCount(60)
                        },
                        className: `px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${
                          activeTab === 'video'
                            ? 'bg-(--ui-accent) text-white font-medium shadow-xs'
                            : 'bg-white/5 hover:bg-white/10 text-(--ui-text-secondary)'
                        }`,
                        children: `视频 (${folderFiles.filter(f => f.isVideo).length})`
                      })
                    ]
                  }),
                  loadingFiles
                    ? jsx('span', { className: 'text-(--ui-text-tertiary)', children: '正在深层递归扫描…' })
                    : jsx('span', { className: 'text-(--ui-text-tertiary) text-[11px]', children: '包含所有子文件夹媒体' })
                ]
              }),

              (() => {
                const displayFiles = filteredFiles
                const shown = displayFiles.slice(0, visibleCount)

                if (displayFiles.length === 0) {
                  if (loadingFiles) return null
                  return jsx('div', {
                    className: 'p-6 text-center text-xs text-(--ui-text-tertiary) border border-dashed border-(--ui-border) rounded-lg',
                    children: folderFiles.length > 0
                      ? '当前分类下没有匹配的媒体文件'
                      : '该目录及其子目录中没有找到可识别的图片或视频文件'
                  })
                }

                return jsx('div', {
                  className: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-72 overflow-y-auto p-2 rounded-lg border border-(--ui-border)/60 bg-black/25',
                  children: shown.map(file => {
                    const isSelected = form.videoPath === file.path
                    const isImg = file.isImage
                    const fileUrl = toFileURL(file.path)

                    return jsxs('button', {
                      key: file.path,
                      type: 'button',
                      onClick: () => applyFile(file.path),
                      className: `group relative flex flex-col items-center overflow-hidden rounded-md border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-(--ui-accent) ring-2 ring-(--ui-accent)/50 shadow-md bg-(--ui-accent)/15'
                          : 'border-(--ui-border) hover:border-(--ui-text-secondary) bg-black/30'
                      }`,
                      children: [
                        jsx('div', {
                          className: 'relative h-24 w-full overflow-hidden bg-black/40 flex items-center justify-center',
                          children: isImg
                            ? jsx('img', {
                                src: fileUrl,
                                alt: file.name,
                                loading: 'lazy',
                                decoding: 'async',
                                className: 'h-full w-full object-cover transition-transform group-hover:scale-105'
                              })
                            : jsxs('div', {
                                className: 'relative h-full w-full',
                                children: [
                                  jsx('video', {
                                    src: fileUrl,
                                    muted: true,
                                    playsInline: true,
                                    preload: 'none',
                                    className: 'h-full w-full object-cover',
                                    onMouseEnter: e => {
                                      // play() 返回 Promise：快速移入移出会以 AbortError 拒绝，
                                      // 同步 try/catch 抓不到，必须显式 catch，否则控制台报未捕获拒绝
                                      const p = e.target.play()
                                      if (p && p.catch) p.catch(() => {})
                                    },
                                    onMouseLeave: e => {
                                      try { e.target.pause() } catch (err) {}
                                    }
                                  }),
                                  jsx('span', {
                                    className: 'absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[9px] text-white font-mono uppercase tracking-wider',
                                    children: 'VIDEO'
                                  })
                                ]
                              })
                        }),
                        jsxs('div', {
                          className: 'w-full p-1.5 flex flex-col gap-0.5 text-[11px] font-mono',
                          children: [
                            jsxs('div', {
                              className: 'flex items-center justify-between',
                              children: [
                                jsx('span', {
                                  className: 'truncate text-(--foreground)',
                                  title: file.name,
                                  children: file.name
                                }),
                                isSelected ? jsx('span', { className: 'text-(--ui-accent) font-bold ml-1', children: '✓' }) : null
                              ]
                            }),
                            file.subDir ? jsx('span', {
                              className: 'text-[9px] text-(--ui-text-tertiary) truncate',
                              title: `来自子文件夹: ${file.subDir}`,
                              children: `📁 ${file.subDir}`
                            }) : null
                          ]
                        })
                      ]
                    })
                  })
                })
              })(),
              filteredFiles.length > visibleCount
                ? jsx('button', {
                    type: 'button',
                    onClick: () => setVisibleCount(c => c + 60),
                    className:
                      'w-full rounded-md border border-(--ui-border) bg-white/5 py-1.5 text-xs text-(--ui-text-secondary) transition-colors cursor-pointer hover:bg-white/10',
                    children: `加载更多（剩余 ${filteredFiles.length - visibleCount} 个，已显示 ${visibleCount} / ${filteredFiles.length}）`
                  })
                : null
            ]
          })
        ]
      }),

      // 视频可见度
      row(
        '背景可见度',
        jsxs('div', {
          className: 'flex w-72 items-center gap-3',
          children: [
            jsx('input', {
              type: 'range',
              min: '0.05',
              max: '0.6',
              step: '0.05',
              value: form.opacity,
              onChange: e => set('opacity', parseFloat(e.target.value)),
              className: 'w-40 accent-(--ui-accent)'
            }),
            jsx('span', {
              className: 'text-sm tabular-nums',
              children: Math.round(form.opacity * 100) + '%'
            })
          ]
        })
      ),

      // 水平位置
      row(
        '水平居中位置',
        jsxs('div', {
          className: 'flex w-72 items-center gap-3',
          children: [
            jsx('input', {
              type: 'range',
              min: '0',
              max: '100',
              step: '5',
              value: form.videoPosition,
              onChange: e => set('videoPosition', parseInt(e.target.value, 10)),
              className: 'w-40 accent-(--ui-accent)'
            }),
            jsx('span', {
              className: 'text-sm tabular-nums',
              children: form.videoPosition + '%'
            })
          ]
        })
      ),
      jsx('p', {
        className: 'text-(--ui-text-tertiary) -mt-4 text-xs',
        children: '0% = 靠左，50% = 居中，100% = 靠右（保持全屏填充，平移画面视野）'
      }),

      // 侧栏底色
      row(
        '侧栏底色',
        jsx('input', {
          type: 'color',
          value: form.sidebarColor,
          onChange: e => set('sidebarColor', e.target.value),
          className: 'h-8 w-16 cursor-pointer rounded border border-(--ui-border) bg-transparent'
        })
      ),

      // 侧栏不透明度
      row(
        '侧栏底色浓度',
        jsxs('div', {
          className: 'flex w-72 items-center gap-3',
          children: [
            jsx('input', {
              type: 'range',
              min: '0.3',
              max: '1',
              step: '0.05',
              value: form.sidebarAlpha,
              onChange: e => set('sidebarAlpha', parseFloat(e.target.value)),
              className: 'w-40 accent-(--ui-accent)'
            }),
            jsx('span', {
              className: 'text-sm tabular-nums',
              children: Math.round(form.sidebarAlpha * 100) + '%'
            })
          ]
        })
      ),

      // 调试徽标开关
      row(
        '显示调试徽标',
        jsx(Switch, {
          checked: form.showBadge,
          onCheckedChange: v => set('showBadge', v)
        })
      ),

      // 保存按钮
      jsxs('div', {
        className: 'flex items-center gap-3 pt-4 border-t border-(--ui-border)',
        children: [
          jsx(Button, {
            onClick: onSave,
            children: saved ? '✓ 已保存并生效' : '保存配置'
          }),
          jsx(Tip, {
            label: '点击保存当前媒体与所有视觉参数'
          })
        ]
      })
    ]
  })
}

// ── 插件导出 ──────────────────────────────────────────────────────
export default {
  id: ID,
  name: 'Aria 背景视频与媒体',
  register(ctx) {
    loadCfg(ctx)

    ensurePseudoRule()

    // ── 背景维护：事件驱动为主，低频轮询仅作兜底 ────────────────────
    // 旧实现是 1.5s 全量 DOM 遍历 + 强制同步重排，且定时器从未回收：
    // 每次热重载都会遗留一份旧循环继续跑。
    if (typeof document !== 'undefined') {
      const prev = globalThis.__ariaBgVideoTimer
      if (prev) clearInterval(prev)

      let booted = false
      let refreshTimer = null
      let tick = 0

      // 任何 DOM 变更都只置脏标记并去抖，绝不在观察者回调里做全量重排。
      // 增量（force=false）：只测量新出现的节点，已分类的走 WeakSet 跳过。
      const scheduleRefresh = () => {
        if (refreshTimer) return
        refreshTimer = setTimeout(() => {
          refreshTimer = null
          if (booted) processBackgrounds(false)
        }, 400)
      }

      let observer = null
      const onResize = () => processBackgrounds(true)

      const ticking = setInterval(() => {
        if (document.visibilityState !== 'visible') return
        if (!booted) {
          if (!document.body) return
          booted = true
          injectLoop()
          observer = new MutationObserver(scheduleRefresh)
          observer.observe(document.body, { childList: true, subtree: true })
          window.addEventListener('resize', onResize)
          return
        }
        // 兜底：默认走缓存（几乎零成本），每 12 拍做一次全量校验
        tick += 1
        processBackgrounds(tick % 12 === 0)
      }, 5000)

      globalThis.__ariaBgVideoTimer = ticking
      ctx.onDispose(() => {
        clearInterval(ticking)
        if (refreshTimer) clearTimeout(refreshTimer)
        if (observer) observer.disconnect()
        window.removeEventListener('resize', onResize)
        if (globalThis.__ariaBgVideoTimer === ticking) globalThis.__ariaBgVideoTimer = null
      })
    }

    // 设置页路由
    ctx.register({
      id: 'settings-page',
      area: ROUTES_AREA,
      title: '背景媒体设置',
      data: { path: '/bg-video-settings' },
      render: () => jsx(SettingsPage, { ctx })
    })

    // 侧边栏入口
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: {
        path: '/bg-video-settings',
        label: '背景视频',
        codicon: 'play-circle'
      }
    })

    // Ctrl+K 命令
    ctx.register({
      id: 'cmd',
      area: PALETTE_AREA,
      data: {
        label: '打开背景视频与媒体设置',
        keywords: ['bg-video', '背景视频', '壁纸', '皮肤'],
        run: () => host.navigate('/bg-video-settings')
      }
    })
  }
}
