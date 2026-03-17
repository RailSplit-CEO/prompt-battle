import { C } from './UIColors';
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';

// Avatar portrait images (same as TalkingPortrait system)
const AVATAR_BASE = 'assets/enemies/avatars';
const PROFILE_ICONS = [
  { key: 'gnome', label: 'Gnome' },
  { key: 'turtle', label: 'Turtle' },
  { key: 'skull', label: 'Skull' },
  { key: 'spider', label: 'Spider' },
  { key: 'hyena', label: 'Hyena' },
  { key: 'rogue', label: 'Rogue' },
  { key: 'panda', label: 'Panda' },
  { key: 'lizard', label: 'Lizard' },
  { key: 'minotaur', label: 'Minotaur' },
  { key: 'shaman', label: 'Shaman' },
  { key: 'troll', label: 'Troll' },
] as const;

// Profanity filter — catches leetspeak, character substitution, etc.
const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const USERNAME_REGEX = /^[a-zA-Z0-9_]{2,16}$/;

export class ProfileSetupOverlay {
  private container: HTMLDivElement | null = null;
  private onCheckUsername: (username: string) => Promise<boolean>;
  private resolvePromise: ((value: { username: string; icon: string }) => void) | null = null;
  private selectedIcon: string | null = null;
  private usernameValid = false;
  private usernameAvailable = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private createBtn: HTMLButtonElement | null = null;
  private errorEl: HTMLDivElement | null = null;

  constructor(onCheckUsername: (username: string) => Promise<boolean>) {
    this.onCheckUsername = onCheckUsername;
  }

  show(): Promise<{ username: string; icon: string }> {
    return new Promise<{ username: string; icon: string }>((resolve) => {
      this.resolvePromise = resolve;
      this.container = document.createElement('div');
      const overlay = this.container;

      // Overlay backdrop
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '9999',
        background: C.overlay,
        backdropFilter: C.panelBlur,
        WebkitBackdropFilter: C.panelBlur,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Nunito', sans-serif",
        opacity: '0',
        transition: 'opacity 0.35s ease',
      });

      // Panel — tall vertical layout
      const panel = document.createElement('div');
      Object.assign(panel.style, {
        maxWidth: '420px',
        width: '92%',
        background: C.panelBg,
        border: `2px solid ${C.panelBorder}`,
        borderRadius: '20px',
        boxShadow: C.panelShadow,
        backdropFilter: C.panelBlur,
        WebkitBackdropFilter: C.panelBlur,
        padding: '36px 32px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        maxHeight: '92vh',
        overflowY: 'auto',
      });

      // Title
      const title = document.createElement('div');
      title.textContent = 'CREATE YOUR PROFILE';
      Object.assign(title.style, {
        fontFamily: "'Fredoka', sans-serif",
        fontSize: '26px',
        fontWeight: 'bold',
        color: C.gold,
        letterSpacing: '3px',
        textAlign: 'center',
        marginBottom: '32px',
      });
      panel.appendChild(title);

      // Username section
      const usernameSection = document.createElement('div');
      Object.assign(usernameSection.style, {
        width: '100%',
        marginBottom: '24px',
      });

      const usernameLabel = document.createElement('div');
      usernameLabel.textContent = 'USERNAME';
      Object.assign(usernameLabel.style, {
        fontSize: '13px',
        fontWeight: 'bold',
        color: C.textSecondary,
        letterSpacing: '2px',
        marginBottom: '10px',
      });
      usernameSection.appendChild(usernameLabel);

      const usernameInput = document.createElement('input');
      usernameInput.type = 'text';
      usernameInput.maxLength = 16;
      usernameInput.placeholder = 'Enter a username...';
      usernameInput.spellcheck = false;
      usernameInput.autocomplete = 'off';
      Object.assign(usernameInput.style, {
        width: '100%',
        boxSizing: 'border-box',
        background: C.inputBg,
        border: `1px solid ${C.inputBorder}`,
        borderRadius: '8px',
        padding: '12px 16px',
        color: C.textPrimary,
        fontSize: '16px',
        fontFamily: "'Nunito', sans-serif",
        outline: 'none',
        transition: 'border-color 0.2s ease',
      });

      usernameInput.addEventListener('focus', () => {
        usernameInput.style.borderColor = C.inputBorderHi;
      });
      usernameInput.addEventListener('blur', () => {
        usernameInput.style.borderColor = C.inputBorder;
      });

      usernameSection.appendChild(usernameInput);

      // Status text
      const statusText = document.createElement('div');
      Object.assign(statusText.style, {
        fontSize: '12px',
        marginTop: '6px',
        minHeight: '18px',
        color: C.textMuted,
        transition: 'color 0.2s ease',
      });
      usernameSection.appendChild(statusText);

      // Username input handler with debounce
      usernameInput.addEventListener('input', () => {
        const val = usernameInput.value.trim();

        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }

        this.usernameValid = false;
        this.usernameAvailable = false;
        this.updateCreateButton();

        if (val.length === 0) {
          statusText.textContent = '';
          statusText.style.color = C.textMuted;
          return;
        }

        if (val.length < 2) {
          statusText.textContent = 'Must be at least 2 characters';
          statusText.style.color = C.textMuted;
          return;
        }

        if (!USERNAME_REGEX.test(val)) {
          statusText.textContent = 'Only letters, numbers, and underscores';
          statusText.style.color = C.red;
          return;
        }

        if (profanityMatcher.hasMatch(val)) {
          statusText.textContent = 'Username not allowed';
          statusText.style.color = C.red;
          return;
        }

        this.usernameValid = true;
        statusText.textContent = 'Checking...';
        statusText.style.color = C.textMuted;

        this.debounceTimer = setTimeout(async () => {
          try {
            const available = await this.onCheckUsername(val);
            // Only update if the input value hasn't changed while we were checking
            if (usernameInput.value.trim() === val) {
              if (available) {
                statusText.textContent = 'Available';
                statusText.style.color = C.teal;
                this.usernameAvailable = true;
              } else {
                statusText.textContent = 'Taken';
                statusText.style.color = C.red;
                this.usernameAvailable = false;
              }
              this.updateCreateButton();
            }
          } catch {
            if (usernameInput.value.trim() === val) {
              statusText.textContent = 'Could not check availability';
              statusText.style.color = C.red;
              this.usernameAvailable = false;
              this.updateCreateButton();
            }
          }
        }, 500);
      });

      panel.appendChild(usernameSection);

      // Icon section
      const iconSection = document.createElement('div');
      Object.assign(iconSection.style, {
        width: '100%',
        marginBottom: '24px',
      });

      const iconLabel = document.createElement('div');
      iconLabel.textContent = 'CHOOSE YOUR ICON';
      Object.assign(iconLabel.style, {
        fontSize: '13px',
        fontWeight: 'bold',
        color: C.textSecondary,
        letterSpacing: '2px',
        marginBottom: '14px',
      });
      iconSection.appendChild(iconLabel);

      // Icon grid
      const grid = document.createElement('div');
      Object.assign(grid.style, {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
        justifyItems: 'center',
        width: '100%',
      });

      const iconCells: Map<string, HTMLDivElement> = new Map();

      for (const icon of PROFILE_ICONS) {
        const cell = document.createElement('div');
        Object.assign(cell.style, {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          cursor: 'pointer',
          transition: 'transform 0.15s ease',
        });

        const iconBox = document.createElement('div');
        Object.assign(iconBox.style, {
          width: '88px',
          height: '88px',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '3px solid transparent',
          transition: 'border-color 0.2s ease, filter 0.2s ease',
          background: C.surface,
        });

        const img = document.createElement('img');
        img.src = `${AVATAR_BASE}/${icon.key}.png`;
        img.alt = icon.label;
        Object.assign(img.style, {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          imageRendering: 'pixelated',
        });
        iconBox.appendChild(img);

        const label = document.createElement('div');
        label.textContent = icon.label;
        Object.assign(label.style, {
          fontSize: '12px',
          color: C.textMuted,
          textTransform: 'capitalize',
          marginTop: '6px',
          textAlign: 'center',
          fontWeight: '600',
        });

        cell.appendChild(iconBox);
        cell.appendChild(label);

        cell.addEventListener('mouseenter', () => {
          if (this.selectedIcon !== icon.key) {
            iconBox.style.filter = 'brightness(1.25)';
          }
          cell.style.transform = 'scale(1.05)';
        });
        cell.addEventListener('mouseleave', () => {
          if (this.selectedIcon !== icon.key) {
            iconBox.style.filter = 'brightness(1)';
          }
          cell.style.transform = 'scale(1)';
        });

        cell.addEventListener('click', () => {
          // Deselect previous
          if (this.selectedIcon) {
            const prev = iconCells.get(this.selectedIcon);
            if (prev) {
              (prev.firstChild as HTMLDivElement).style.borderColor = 'transparent';
              (prev.firstChild as HTMLDivElement).style.filter = 'brightness(1)';
            }
          }
          this.selectedIcon = icon.key;
          iconBox.style.borderColor = '#FFD93D';
          iconBox.style.filter = 'brightness(1.15)';
          this.updateCreateButton();
        });

        iconCells.set(icon.key, cell);
        grid.appendChild(cell);
      }

      iconSection.appendChild(grid);
      panel.appendChild(iconSection);

      // Create button
      this.createBtn = document.createElement('button');
      this.createBtn.textContent = 'Create Profile';
      Object.assign(this.createBtn.style, {
        background: C.green,
        color: '#fff',
        fontFamily: "'Fredoka', sans-serif",
        fontWeight: 'bold',
        fontSize: '18px',
        border: 'none',
        borderRadius: '12px',
        padding: '14px 40px',
        width: '100%',
        maxWidth: '300px',
        cursor: 'not-allowed',
        opacity: '0.4',
        transition: 'opacity 0.2s ease, background 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease',
        marginBottom: '12px',
      });

      this.createBtn.addEventListener('mouseenter', () => {
        if (this.createBtn && this.isFormValid()) {
          this.createBtn.style.background = '#6ab55e';
          this.createBtn.style.transform = 'translateY(-1px)';
          this.createBtn.style.boxShadow = '0 4px 16px rgba(90,154,78,0.35)';
        }
      });
      this.createBtn.addEventListener('mouseleave', () => {
        if (!this.createBtn) return;
        this.createBtn.style.background = C.green;
        this.createBtn.style.transform = 'translateY(0)';
        this.createBtn.style.boxShadow = 'none';
      });

      this.createBtn.addEventListener('click', () => {
        if (!this.isFormValid()) return;
        if (!this.resolvePromise) return;
        const username = usernameInput.value.trim();
        this.resolvePromise({ username, icon: this.selectedIcon! });
      });

      panel.appendChild(this.createBtn);

      // Error area
      this.errorEl = document.createElement('div');
      Object.assign(this.errorEl.style, {
        color: C.red,
        fontSize: '13px',
        fontFamily: "'Nunito', sans-serif",
        textAlign: 'center',
        minHeight: '20px',
        opacity: '0',
        transition: 'opacity 0.3s ease',
      });
      panel.appendChild(this.errorEl);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      // Fade in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay.style.opacity = '1';
        });
      });

      // Focus the input after transition
      setTimeout(() => {
        usernameInput.focus();
      }, 350);
    });
  }

  hide(): void {
    if (!this.container) return;
    this.container.style.opacity = '0';
    const el = this.container;
    setTimeout(() => {
      el.remove();
    }, 350);
    this.container = null;
    this.createBtn = null;
    this.errorEl = null;
    this.resolvePromise = null;
    this.selectedIcon = null;
    this.usernameValid = false;
    this.usernameAvailable = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private isFormValid(): boolean {
    return this.usernameValid && this.usernameAvailable && this.selectedIcon !== null;
  }

  private updateCreateButton(): void {
    if (!this.createBtn) return;
    const valid = this.isFormValid();
    this.createBtn.style.opacity = valid ? '1' : '0.4';
    this.createBtn.style.cursor = valid ? 'pointer' : 'not-allowed';
  }
}
