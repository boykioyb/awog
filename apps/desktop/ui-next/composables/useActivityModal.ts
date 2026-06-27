// Activity modal — global open state (Nuxt `useState`) so the NavRail footer
// trigger and the modal stay in sync without prop threading. Mirrors
// useSettingsModal: Activity moved from a route to a modal overlay opened from
// the sidebar footer (sits over the current page like Settings / What's New).
export function useActivityModal() {
  const open = useState<boolean>('activity:open', () => false)

  const openActivity = () => {
    open.value = true
  }
  const closeActivity = () => {
    open.value = false
  }

  return { open, openActivity, closeActivity }
}
