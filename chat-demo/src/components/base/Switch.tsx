import clsx from 'clsx'
import styles from './Switch.module.css'

/** 开关：受控组件，用于设置页里的布尔项。 */
export const Switch = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    className={clsx(styles.switch, checked && styles.on, disabled && styles.disabled)}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.knob} />
  </button>
)
