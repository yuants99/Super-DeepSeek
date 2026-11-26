import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { fetchServiceStatus, type ServiceKey, type ServiceStatus } from '../../services/status.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconStatusOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import styles from './ServiceStatus.module.css'

const formatTime = (ms: number) => {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const serviceLabel: Record<ServiceKey, 'serviceChat' | 'serviceTools' | 'serviceSpeech' | 'serviceFiles'> = {
  chat: 'serviceChat',
  tools: 'serviceTools',
  speech: 'serviceSpeech',
  files: 'serviceFiles',
}

/** 左下角服务可用性：当前状态 + 分服务健康 + 一条当前/最近事件。 */
export const ServiceStatusButton = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      setStatus(await fetchServiceStatus())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const show = () => {
    setOpen(true)
    if (!status && !loading) {
      void load()
    }
  }

  const label =
    status?.state === 'operational'
      ? t('serviceStatusOperational')
      : status?.state === 'degraded'
        ? t('serviceStatusDegraded')
        : t('serviceStatusUnknown')
  const eventState =
    status?.event?.state === 'resolved'
      ? t('serviceStatusResolved')
      : status?.event?.state === 'investigating'
        ? t('serviceStatusInvestigating')
        : status?.event?.state === 'identified'
          ? t('serviceStatusIdentified')
          : t('serviceStatusMonitoring')

  return (
    <>
      <IconButton
        icon={<IconStatusOutline16 />}
        size="m"
        tooltip={t('serviceStatus')}
        onClick={show}
      />
      {open ? (
        <Modal
          title={t('serviceStatusTitle')}
          className={styles.dialog}
          onClose={() => setOpen(false)}
          footer={
            <div className={styles.footer}>
              <a
                className={styles.link}
                href="https://status.deepseek.com"
                target="_blank"
                rel="noreferrer"
              >
                {t('serviceStatusViewPage')}
              </a>
              <div className={styles.footerActions}>
                <Button variant="outlined" disabled={loading} onClick={() => void load()}>
                  {t('serviceStatusRefresh')}
                </Button>
                <Button onClick={() => setOpen(false)}>{t('close')}</Button>
              </div>
            </div>
          }
        >
          {loading ? (
            <div className={styles.state}>{t('serviceStatusLoading')}</div>
          ) : error ? (
            <div className={styles.state}>{t('serviceStatusError')}</div>
          ) : status ? (
            <div className={styles.body}>
              <div className={styles.summary}>
                <span className={`${styles.dot} ${styles[status.state]}`} />
                <div className={styles.summaryText}>
                  <div className={styles.label}>{label}</div>
                  <div className={styles.meta}>
                    {status.state === 'operational'
                      ? t('serviceStatusAllGood')
                      : t('serviceStatusPartial')}
                    {' · '}
                    {t('serviceStatusUpdated', { time: formatTime(status.fetchedAt) })}
                  </div>
                </div>
              </div>

              <div className={styles.sectionTitle}>{t('serviceStatusServices')}</div>
              <div className={styles.services}>
                {status.services.map((service) => (
                  <div key={service.key} className={styles.serviceRow}>
                    <span className={`${styles.serviceDot} ${styles[service.state]}`} />
                    <span className={styles.serviceName}>{t(serviceLabel[service.key])}</span>
                    <span className={styles.serviceState}>
                      {service.state === 'operational'
                        ? t('serviceStatusNormal')
                        : t('serviceStatusAbnormal')}
                    </span>
                  </div>
                ))}
              </div>

              {status.event ? (
                <>
                  <div className={styles.sectionTitle}>
                    {status.eventActive
                      ? t('serviceStatusCurrentEvent')
                      : t('serviceStatusLatestEvent')}
                  </div>
                  <div className={styles.event}>
                    <div className={styles.eventHead}>
                      <span className={styles.eventTitle}>{status.event.title}</span>
                      <span
                        className={`${styles.eventState} ${
                          status.event.state === 'resolved'
                            ? styles.state_resolved
                            : styles.state_active
                        }`}
                      >
                        {eventState}
                      </span>
                    </div>
                    {status.event.components.length > 0 ? (
                      <div className={styles.eventAffected}>
                        {t('serviceStatusAffected')}：{status.event.components.join('、')}
                      </div>
                    ) : null}
                    {status.event.description ? (
                      <div className={styles.eventDescription}>{status.event.description}</div>
                    ) : null}
                    <div className={styles.eventFoot}>
                      <span>{formatTime(status.event.date)}</span>
                      {status.event.link ? (
                        <a
                          className={styles.link}
                          href={status.event.link}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('serviceStatusViewIncident')}
                        </a>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <div className={styles.allGood}>{t('serviceStatusAllGood')}</div>
              )}
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  )
}
