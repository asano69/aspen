import { Show, type ParentProps } from "solid-js";
import { A } from "@solidjs/router";

import { useVersion } from "@/lib/version";
// The single source of the icon; the favicon is emitted from the same file
// (see faviconFromLogo in vite.config.ts).
import logoSvg from "@/assets/logo.svg?raw";

export interface LogoProps {
  // Overall pixel size of the icon (width == height). Defaults to 30px.
  size?: number;
  // Whether to render "App Title" next to the icon.
  showTitle?: boolean;
  // Whether to show the running server version next to the title.
  showVersion?: boolean;
  // Whether clicking the logo navigates home ("/"). Defaults to false,
  // since Login renders pre-auth where there's nowhere to navigate to
  // yet -- it uses Logo without linkable and gets plain text/icon.
  linkable?: boolean;
  // If provided, the logo becomes a plain clickable button instead of
  // a link, and `linkable` is ignored.
  onClick?: () => void;
}

// The app's own icon. Also used as the fallback of PodIcon and of a pod's
// cover in the pod grid. Without `size` it has no fixed pixel size, so the
// caller sizes it through `class`.
export function LogoIcon(props: { size?: number; class?: string }) {
  return (
    <span
      class={`logo-icon ${props.class ?? ""}`}
      style={
        props.size !== undefined
          ? { width: `${props.size}px`, height: `${props.size}px` }
          : undefined
      }
      innerHTML={logoSvg}
    />
  );
}

export default function Logo(props: LogoProps) {
  // Shared with Sidebar's footer (see lib/version.ts), so both display
  // the same value from one fetch implementation.
  const version = useVersion();

  const size = () => props.size ?? 30;
  // Scales with the icon: at the old default size (40px), this works
  // out to 24px, matching the previous fixed title size.
  const titleFontSize = () => size() * 0.6;

  const icon = <LogoIcon size={size()} />;

  const title = () =>
    props.showTitle && (
      <div class="logo" style={{ "font-size": `${titleFontSize()}px` }}>
        {__APP_NAME__}
      </div>
    );

  // Wraps `children` in whatever interactive element this instance
  // needs: a plain button when onClick is given (takes priority over
  // linkable), a home link with the original hover effects when
  // linkable, or a plain flex container otherwise (Login's case).
  const Wrap = (p: ParentProps) =>
    props.onClick ? (
      <button type="button" onClick={props.onClick} class="logo-button">
        {p.children}
      </button>
    ) : props.linkable ? (
      <A href="/" class="logo-group logo-link">
        {p.children}
      </A>
    ) : (
      <div class="logo-group">{p.children}</div>
    );

  return (
    <div class="logo-box">
      <Wrap>
        {icon}
        {title()}
      </Wrap>
      {/* Rendered outside Wrap so it's never part of the clickable
          logo (button/link). Only shown when showVersion is set (e.g.
          TopBar hides it on mobile to save space), not by default. */}
      <Show when={props.showVersion && version()}>
        <span class="logo-version">v{version()}</span>
      </Show>
    </div>
  );
}
