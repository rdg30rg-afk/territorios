import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function usePwaInstall() {
  const [installPromptEvent, setInstallPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)')
    const updateInstalledState = () => {
      setIsInstalled(mediaQuery.matches)
    }

    updateInstalledState()

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setInstallPromptEvent(null)
      setIsInstalled(true)
      setIsInstalling(false)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    mediaQuery.addEventListener('change', updateInstalledState)

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      )
      window.removeEventListener('appinstalled', handleAppInstalled)
      mediaQuery.removeEventListener('change', updateInstalledState)
    }
  }, [])

  const promptInstall = async () => {
    if (!installPromptEvent) {
      return 'unavailable' as const
    }

    setIsInstalling(true)
    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice
    setIsInstalling(false)

    if (choice.outcome === 'accepted') {
      setInstallPromptEvent(null)
      return 'accepted' as const
    }

    return 'dismissed' as const
  }

  return {
    canInstall: Boolean(installPromptEvent) && !isInstalled,
    isInstalled,
    isInstalling,
    promptInstall,
  }
}
