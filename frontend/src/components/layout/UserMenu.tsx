import { For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Image } from "@kobalte/core/image";
import {
  LogOut,
  Settings,
  Help,
  About,
  Sun,
  Moon,
  SunMoon,
  Check,
  ChevronDown,
  ChevronRight,
} from "@/lib/icons";
import { avatarURL, currentUser, logout, userInitial } from "@/lib/api/auth";
import { currentMode, setMode, type Mode } from "@/lib/theme";

interface ThemeOption {
  value: Mode;
  label: string;
  icon: typeof Sun;
}

// Options in the order they're listed in the theme submenu. Each pairs a
// mode value with the icon shown next to its own item (and on the submenu's
// trigger when active), so there's a single source of truth for the
// icon/label/value mapping.
const THEME_OPTIONS: ThemeOption[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: SunMoon },
];

// Dropdown menu at the bottom of the sidebar (see SidebarFooter.tsx):
// settings, help, theme and logout. It opens upwards, since its trigger sits
// at the bottom edge of the screen. The trigger is one button holding the
// avatar, the user's name and a chevron, so the whole group opens the menu.
export default function UserMenu() {
  const handleLogout = () => {
    logout();
  };

  // Placeholder only -- no settings screen exists yet, so this item
  // does nothing when selected. Wire this up once a real settings
  // page/dialog is built.
  const handleSettings = () => {};

  // The trigger icon always reflects the current setting, so the submenu
  // doubles as a status indicator.
  const activeTheme = () =>
    THEME_OPTIONS.find((o) => o.value === currentMode()) ?? THEME_OPTIONS[2];

  return (
    <DropdownMenu placement="top-start">
      <DropdownMenu.Trigger aria-label="Open menu" class="user-menu-trigger">
        {/* The user's avatar cropped to a circle. While it is missing,
            loading or failed, Kobalte shows the fallback: the user's
            initial. */}
        <Image fallbackDelay={0} class="avatar">
          <Image.Img src={avatarURL()} alt="" class="avatar-img" />
          <Image.Fallback class="avatar-fallback">
            {userInitial()}
          </Image.Fallback>
        </Image>
        <span class="user-menu-name">{currentUser()?.name}</span>
        <ChevronDown size={16} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="menu-content">
          <DropdownMenu.Item onSelect={handleSettings} class="menu-item">
            <Settings size={16} />
            User Settings
          </DropdownMenu.Item>

          <DropdownMenu.Item onSelect={handleSettings} class="menu-item">
            <About size={16} />
            About Cardpot
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={handleSettings} class="menu-item">
            <Help size={16} />
            Help
          </DropdownMenu.Item>

          <DropdownMenu.Sub gutter={4} shift={-4}>
            <DropdownMenu.SubTrigger class="menu-item">
              <Dynamic component={activeTheme().icon} size={16} />
              <span class="menu-item-label">Theme</span>
              <ChevronRight size={16} />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent class="menu-content">
                <For each={THEME_OPTIONS}>
                  {(option) => (
                    <DropdownMenu.Item
                      onSelect={() => setMode(option.value)}
                      class="menu-item"
                    >
                      <option.icon size={16} />
                      <span class="menu-item-label">{option.label}</span>
                      <Show when={currentMode() === option.value}>
                        <Check size={16} />
                      </Show>
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          <DropdownMenu.Item onSelect={handleLogout} class="menu-item">
            <LogOut size={16} />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
