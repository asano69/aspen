import { Show, type ParentProps } from "solid-js";
import { A } from "@solidjs/router";

import { useVersion } from "@/lib/version";

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
  <svg
  viewBox="0 0 32 32"
  fill="none"
  class={props.class}
  style={
    props.size !== undefined
      ? { width: `${props.size}px`, height: `${props.size}px` }
      : undefined
  }
  xmlns="http://www.w3.org/2000/svg"
>
  <title>Pea Pod Icon</title>
  <g>
    <path
      fill="#5AB557"
      d="M8.5 12.5c-4.953 5.282-6.132 11.512-6.413 14.18c-.089.846.25 1.658.851 2.259c.673.672 1.606 1.012 2.546.864C8.69 29.298 16.348 27.652 21 23c7-7 7-18 7-18l-1-1S15 5.567 8.5 12.5"
    />
    <path
      fill="#276038"
      d="M9.5 14c-3.878 4.46-5.049 9.22-5.38 11.132c-.094.55.107 1.095.501 1.49c.756.755 1.986.74 2.724-.034L26 7l-1-1S14.5 8.25 9.5 14"
    />
    <path
      fill="#8DD753"
      fill-rule="evenodd"
      d="M30 5a3 3 0 0 1-.794 2.033l.339 1.692a6 6 0 0 1-.739 4.264l-.949 1.582a1 1 0 0 1-1.715 0l-.949-1.582a6 6 0 0 1-.738-4.264l.295-1.475l-1.476.295a6 6 0 0 1-4.263-.738l-1.582-.95a1 1 0 0 1 0-1.714l1.582-.95a6 6 0 0 1 4.263-.738l1.693.338A3 3 0 0 1 30 5"
      clip-rule="evenodd"
    />
    <path
      fill="#7DD74E"
      fill-rule="evenodd"
      d="M21.377 11.855a4 4 0 1 0-5.355 5.623zm-6.872 7.215a4 4 0 1 0-5.261 5.524z"
      clip-rule="evenodd"
    />
  </g>
</svg> 

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
