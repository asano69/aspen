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
  viewBox="0 0 379.236 379.236"
  class={props.class}
  style={
    props.size !== undefined
      ? { width: `${props.size}px`, height: `${props.size}px` }
      : undefined
  }
  xmlns="http://www.w3.org/2000/svg"
>
  <g>
    <g>
      <g>
        <rect x="174.158" y="40.843" width="30.925" height="66.389" fill="#997668" />
        <rect x="174.158" y="40.843" width="30.925" height="30.056" fill="#222222" opacity="0.3" />
      </g>
    </g>
    <g>
      <g>
        <path
          fill="#FF9500"
          d="M270.346,284.571c18.977,0,34.357,15.383,34.357,34.357c0,18.975-15.381,34.357-34.357,34.357H108.896c-18.975,0-34.357-15.383-34.357-34.357c0-18.975,15.383-34.357,34.357-34.357H270.346z"
        />
        <path
          fill="#222222"
          opacity="0.2"
          d="M304.289,313.596c-2.563,16.441-16.781,29.024-33.943,29.024H108.896c-17.16,0-31.381-12.583-33.943-29.024c-0.271,1.738-0.414,3.519-0.414,5.333c0,18.975,15.383,34.357,34.357,34.357h161.449c18.977,0,34.357-15.383,34.357-34.357C304.703,317.114,304.561,315.334,304.289,313.596z"
        />
        <path
          fill="#222222"
          opacity="0.2"
          d="M108.896,284.571c-18.975,0-34.357,15.383-34.357,34.357c0,18.975,15.383,34.357,34.357,34.357h80.725v-68.715H108.896z"
        />
      </g>
      <g>
        <path
          fill="#FFC843"
          d="M301.834,220.857c18.977,0,34.357,15.382,34.357,34.356c0,18.976-15.381,34.357-34.357,34.357H77.408c-18.975,0-34.357-15.382-34.357-34.357c0-18.975,15.383-34.356,34.357-34.356H301.834z"
        />
        <path
          fill="#FF9500"
          opacity="0.4"
          d="M335.777,249.881c-2.563,16.442-16.781,29.024-33.943,29.024H77.408c-17.16,0-31.381-12.582-33.943-29.024c-0.271,1.738-0.414,3.519-0.414,5.333c0,18.976,15.383,34.357,34.357,34.357h224.426c18.977,0,34.357-15.382,34.357-34.357C336.191,253.4,336.049,251.619,335.777,249.881z"
        />
        <path
          fill="#FF9500"
          opacity="0.4"
          d="M77.408,220.857c-18.975,0-34.357,15.382-34.357,34.356c0,18.976,15.383,34.357,34.357,34.357h112.213v-68.714H77.408z"
        />
      </g>
      <circle fill="#333E48" cx="245.933" cy="253.214" r="12.799" />
      <g>
        <path
          fill="#FF9500"
          d="M314.946,157.143c18.977,0,34.357,15.383,34.357,34.357s-15.381,34.357-34.357,34.357H64.296c-18.975,0-34.357-15.383-34.357-34.357s15.383-34.357,34.357-34.357H314.946z"
        />
        <path
          fill="#222222"
          opacity="0.2"
          d="M348.89,186.167c-2.563,16.441-16.781,29.024-33.943,29.024H64.296c-17.16,0-31.381-12.583-33.943-29.024c-0.271,1.738-0.414,3.519-0.414,5.333c0,18.975,15.383,34.357,34.357,34.357h250.65c18.977,0,34.357-15.383,34.357-34.357C349.304,189.686,349.161,187.905,348.89,186.167z"
        />
        <path
          fill="#222222"
          opacity="0.2"
          d="M64.296,157.143c-18.975,0-34.357,15.383-34.357,34.357s15.383,34.357,34.357,34.357h125.325v-68.715H64.296z"
        />
      </g>
      <g>
        <path
          fill="#FFC843"
          d="M282.908,93.429c18.977,0,34.357,15.382,34.357,34.356c0,18.976-15.381,34.357-34.357,34.357H96.334c-18.975,0-34.357-15.382-34.357-34.357c0-18.975,15.383-34.356,34.357-34.356H282.908z"
        />
        <path
          fill="#FF9500"
          opacity="0.4"
          d="M316.852,122.452c-2.563,16.442-16.781,29.024-33.943,29.024H96.334c-17.16,0-31.381-12.582-33.943-29.024c-0.271,1.738-0.414,3.519-0.414,5.333c0,18.976,15.383,34.357,34.357,34.357h186.574c18.977,0,34.357-15.382,34.357-34.357C317.266,125.971,317.123,124.19,316.852,122.452z"
        />
        <path
          fill="#FF9500"
          opacity="0.4"
          d="M96.334,93.429c-18.975,0-34.357,15.382-34.357,34.356c0,18.976,15.383,34.357,34.357,34.357h93.287V93.429H96.334z"
        />
      </g>
    </g>
    <path
      fill="#985F35"
      d="M364.344,55.735H14.893C6.668,55.735,0,49.068,0,40.843C0,32.618,6.668,25.95,14.893,25.95h349.451c8.225,0,14.893,6.668,14.893,14.893C379.236,49.068,372.568,55.735,364.344,55.735z"
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
