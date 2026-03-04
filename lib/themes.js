export const THEMES = {
  vibrant: {
    label: 'Vibrant',
    description: 'Bold colors for dark themes (One Dark Pro, Dracula)',
    colors: {
      stop: '#AB47BC',
      question: '#2196F3',
      permission: '#FF5722',
      notification: '#FF9800',
    },
  },
  nord: {
    label: 'Nord',
    description: 'Cool tones for Nord/Arctic themes',
    colors: {
      stop: '#B48EAD',
      question: '#88C0D0',
      permission: '#BF616A',
      notification: '#EBCB8B',
    },
  },
  light: {
    label: 'Light',
    description: 'Deep saturated colors for light themes',
    colors: {
      stop: '#7B1FA2',
      question: '#1565C0',
      permission: '#D84315',
      notification: '#EF6C00',
    },
  },
}

export const DEFAULT_THEME = 'vibrant'

export const VALID_OPACITIES = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30]
export const DEFAULT_OPACITY = 0.10
