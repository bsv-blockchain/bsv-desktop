export const FALLBACK_APP_ICON = 'https://metanetapps.com/favicon.ico'

export const applyAppIconFallback = (image: Pick<HTMLImageElement, 'src'>): void => {
  if (image.src !== FALLBACK_APP_ICON) {
    image.src = FALLBACK_APP_ICON
  }
}
