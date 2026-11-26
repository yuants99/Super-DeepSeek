import { getRegionName, provinces, regionCodes } from '../../services/location.js'
import { isChineseBrowser, setLocation, useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

/** 位置设置：中文环境提供省市联动下拉，英文环境提供国家/地区选择。 */
export const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <div className={`${styles.cell} ${styles.row} ${styles.locationCell}`}>
      <div className={styles.text}>
        <div className={styles.label}>{t('settingsLocation')}</div>
      </div>
      <div className={styles.locationSelectors}>
        {isChineseBrowser() ? (
          <>
            <Select
              ariaLabel={t('settingsLocationProvince')}
              className={styles.provinceSelect}
              value={province?.code ?? ''}
              placeholder={t('settingsLocationProvince')}
              options={provinces.map((item) => ({ value: item.code, label: item.name }))}
              onChange={(value) => {
                if (value !== province?.code) {
                  setLocation({ region: 'CN', province: value })
                }
              }}
            />
            <Select
              ariaLabel={t('settingsLocationCity')}
              className={styles.citySelect}
              value={province ? (location?.city ?? '') : ''}
              disabled={!province?.cities.length}
              placeholder={t('settingsLocationCity')}
              options={
                province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
              }
              onChange={(value) => {
                if (province) {
                  setLocation({ region: 'CN', province: province.code, city: value })
                }
              }}
            />
          </>
        ) : (
          <Select
            ariaLabel={t('settingsLocationRegion')}
            className={styles.regionSelect}
            value={location?.region ?? ''}
            placeholder={t('settingsLocationRegion')}
            options={regionCodes
              .map((code) => ({ value: code, label: getRegionName(code, locale) }))
              .sort((a, b) => a.label.localeCompare(b.label, locale))}
            onChange={(value) => setLocation({ region: value })}
          />
        )}
      </div>
    </div>
  )
}
