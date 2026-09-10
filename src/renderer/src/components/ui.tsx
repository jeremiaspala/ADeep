import {
  createContext, useContext, useEffect, useLayoutEffect, useRef, useState,
  type JSX, type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronRight, Check, AlertTriangle, Info, CircleCheck, CircleX, Loader2 } from 'lucide-react'
import { useApp } from '../store'

/* ------------------------------ Modal ------------------------------ */

export function Modal({
  title,
  subtitle,
  icon,
  size = 'md',
  tall,
  onClose,
  footer,
  children,
  bodyFlush,
  closeOnBackdrop = true
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  size?: 'md' | 'wide' | 'xwide'
  tall?: boolean
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
  bodyFlush?: boolean
  closeOnBackdrop?: boolean
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`modal ${size === 'wide' ? 'wide' : size === 'xwide' ? 'xwide' : ''} ${tall ? 'tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          {icon}
          <div style={{ minWidth: 0 }}>
            <div className="ttl truncate">{title}</div>
            {subtitle && <div className="sub truncate">{subtitle}</div>}
          </div>
          <button className="x" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>
        <div className={`modal-body ${bodyFlush ? 'flush' : ''}`}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/* ------------------------------ Menú ------------------------------ */

export interface MenuItemDef {
  id: string
  label?: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  title?: string
  checked?: boolean
  submenu?: MenuItemDef[]
  onSelect?: () => void
}

export function MenuPopup({
  items,
  x,
  y,
  onClose,
  minWidth
}: {
  items: MenuItemDef[]
  x: number
  y: number
  onClose: () => void
  minWidth?: number
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [openSub, setOpenSub] = useState<{ id: string; x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (nx + r.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - r.width - 8)
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8)
    setPos({ x: nx, y: ny })
  }, [x, y, items])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      // Los submenús viven en otro portal: si sólo mirásemos este popup, el
      // mousedown sobre un ítem de submenú cerraría el menú y desmontaría el
      // elemento antes de que llegara el click, y el onSelect nunca corría.
      if ((e.target as Element | null)?.closest?.('.menu-pop')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // El timeout evita cerrar con el mismo click que abrió el menú.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <>
      <div
        ref={ref}
        className="menu-pop"
        style={{ left: pos.x, top: pos.y, minWidth }}
        role="menu"
      >
        {items.map((it, i) =>
          it.separator ? (
            <div key={`s${i}`} className="menu-sep" />
          ) : it.title ? (
            <div key={`t${i}`} className="menu-title">{it.title}</div>
          ) : (
            <button
              key={it.id}
              className={`menu-item ${it.disabled ? 'disabled' : ''} ${it.danger ? 'danger' : ''}`}
              role="menuitem"
              onMouseEnter={(e) => {
                if (it.submenu?.length && !it.disabled) {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setOpenSub({ id: it.id, x: r.right - 4, y: r.top - 5 })
                } else setOpenSub(null)
              }}
              onClick={() => {
                if (it.disabled || it.submenu?.length) return
                onClose()
                it.onSelect?.()
              }}
            >
              {it.checked !== undefined ? (
                <span style={{ width: 15, display: 'inline-flex' }}>
                  {it.checked && <Check size={14} />}
                </span>
              ) : (
                it.icon
              )}
              <span className="truncate">{it.label}</span>
              {it.shortcut && <span className="kbd">{it.shortcut}</span>}
              {it.submenu?.length ? <ChevronRight size={14} className="sub-arrow" /> : null}
            </button>
          )
        )}
      </div>
      {openSub && (
        <MenuPopup
          items={items.find((i) => i.id === openSub.id)?.submenu ?? []}
          x={openSub.x}
          y={openSub.y}
          onClose={onClose}
        />
      )}
    </>,
    document.body
  )
}

/* ------------------------------ Toasts ------------------------------ */

export function Toasts(): JSX.Element {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  useEffect(() => {
    if (!toasts.length) return
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.id), t.kind === 'error' ? 9000 : 4000)
    )
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])

  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' && <CircleX size={16} color="var(--danger)" />}
          {t.kind === 'ok' && <CircleCheck size={16} color="var(--ok)" />}
          {t.kind === 'warn' && <AlertTriangle size={16} color="var(--warn)" />}
          {t.kind === 'info' && <Info size={16} color="var(--accent)" />}
          <div className="msg">{t.message}</div>
          <button className="x" onClick={() => dismiss(t.id)} aria-label="Cerrar aviso">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}

/* ------------------------------ Pestañas ------------------------------ */

export interface TabDef {
  id: string
  label: string
  dirty?: boolean
}

export function Tabs({
  tabs,
  active,
  onChange
}: {
  tabs: TabDef[]
  active: string
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`tab ${active === t.id ? 'on' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.dirty && <span className="dirty-dot" />}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------ Campos ------------------------------ */

export function Field({
  label,
  hint,
  error,
  children,
  style
}: {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
  style?: React.CSSProperties
}): JSX.Element {
  return (
    <div className="field" style={style}>
      {label && <span className="lbl">{label}</span>}
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Text({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  hint,
  error,
  type = 'text',
  maxLength,
  autoFocus,
  style,
  onEnter
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  hint?: string
  error?: string
  type?: string
  maxLength?: number
  autoFocus?: boolean
  style?: React.CSSProperties
  onEnter?: () => void
}): JSX.Element {
  return (
    <Field label={label} hint={hint} error={error} style={style}>
      <input
        type={type}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }}
      />
    </Field>
  )
}

export function Check2({
  label,
  checked,
  onChange,
  disabled,
  hint
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  hint?: string
}): JSX.Element {
  return (
    <label className={`check ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <div className="hint">{hint}</div>}
      </span>
    </label>
  )
}

export function Spinner({ size = 15 }: { size?: number }): JSX.Element {
  return <Loader2 size={size} className="spin" />
}

/* ------------------------------ Confirmación ------------------------------ */

interface ConfirmOpts {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  danger?: boolean
}

const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)

  const confirm = (o: ConfirmOpts): Promise<boolean> =>
    new Promise((resolve) => setState({ ...o, resolve }))

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.title}
          icon={<AlertTriangle size={18} color={state.danger ? 'var(--danger)' : 'var(--warn)'} />}
          onClose={() => { state.resolve(false); setState(null) }}
          footer={
            <>
              <div className="spacer" />
              <button className="btn" onClick={() => { state.resolve(false); setState(null) }}>
                Cancelar
              </button>
              <button
                className={`btn ${state.danger ? 'danger' : 'primary'}`}
                autoFocus
                onClick={() => { state.resolve(true); setState(null) }}
              >
                {state.confirmLabel ?? 'Aceptar'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13.5 }}>{state.message}</div>
          {state.detail && (
            <div className="hint" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{state.detail}</div>
          )}
        </Modal>
      )}
    </ConfirmCtx.Provider>
  )
}

export function useConfirm(): (o: ConfirmOpts) => Promise<boolean> {
  return useContext(ConfirmCtx)
}

/* ------------------------------ Prompt de texto ------------------------------ */

export function PromptDialog({
  title,
  label,
  initial,
  placeholder,
  confirmLabel = 'Aceptar',
  validate,
  onCancel,
  onConfirm
}: {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  validate?: (v: string) => string | undefined
  onCancel: () => void
  onConfirm: (v: string) => void
}): JSX.Element {
  const [v, setV] = useState(initial ?? '')
  const err = validate?.(v)
  const submit = (): void => { if (!err && v.trim()) onConfirm(v) }
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" disabled={!!err || !v.trim()} onClick={submit}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <Text label={label} value={v} onChange={setV} placeholder={placeholder} error={err} autoFocus onEnter={submit} />
    </Modal>
  )
}
