// Imported first by each window: picks the interface language and fills the page's labels.
import { setLocale, setPlatform, translateDom } from '../shared/i18n'

setPlatform(window.lyrique.platform)
setLocale(window.lyrique.locale)
// Title bar, menu-bar-only features and fonts differ per system.
document.documentElement.dataset.platform = window.lyrique.platform
document.documentElement.lang = window.lyrique.locale
translateDom(document)
